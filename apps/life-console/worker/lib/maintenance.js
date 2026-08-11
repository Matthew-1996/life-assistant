import {
  decryptField,
  decryptWithPassphrase,
  encryptField,
  encryptWithPassphrase,
  hmacHex,
  sha256Hex,
} from "./crypto.js";
import { all, batch } from "./db.js";
import { HttpError } from "./errors.js";
import {
  auditStatement,
  newId,
  nowIso,
  resolveKek,
} from "./repository.js";

const BACKUP_TABLES = [
  "goals",
  "journals",
  "journal_revisions",
  "daily_checkins",
  "weekly_reviews",
  "phase_reviews",
  "health_days",
  "health_segments",
];
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const RECOVERY_DOWNLOAD_TTL_MS = 5 * 60 * 1000;

function constantTimeEqual(left, right) {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function downloadSecret(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new HttpError(
      503,
      "security_not_configured",
      "Recovery download signing is not configured.",
    );
  }
  return env.SESSION_SECRET;
}

function recoveryObjectKey(value) {
  if (
    typeof value !== "string"
    || !value.startsWith("recovery-packs/")
    || !value.endsWith(".zip.enc")
  ) {
    throw new HttpError(400, "invalid_request", "Recovery object key is invalid.");
  }
  return value;
}

function downloadPayload(objectKey, expires) {
  return `recovery-download.v1.${expires}.${objectKey}`;
}

export async function createRecoveryDownloadUrl(
  requestUrl,
  objectKey,
  env,
  now = Date.now(),
) {
  const expires = now + RECOVERY_DOWNLOAD_TTL_MS;
  const signature = await hmacHex(
    downloadSecret(env),
    downloadPayload(objectKey, expires),
  );
  const url = new URL("/api/v1/crypto/recovery-pack/download", requestUrl);
  url.searchParams.set("object_key", objectKey);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature);
  return url.toString();
}

function concatenate(chunks) {
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function header(length) {
  return new Uint8Array(length);
}

function write16(view, offset, value) {
  new DataView(view.buffer).setUint16(offset, value, true);
}

function write32(view, offset, value) {
  new DataView(view.buffer).setUint32(offset, value, true);
}

function createZip(entries) {
  const localChunks = [];
  const centralChunks = [];
  let localOffset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = textEncoder.encode(name);
    const data = textEncoder.encode(text);
    const checksum = crc32(data);
    const local = header(30);
    write32(local, 0, 0x04034b50);
    write16(local, 4, 20);
    write16(local, 8, 0);
    write32(local, 14, checksum);
    write32(local, 18, data.length);
    write32(local, 22, data.length);
    write16(local, 26, nameBytes.length);
    localChunks.push(local, nameBytes, data);

    const central = header(46);
    write32(central, 0, 0x02014b50);
    write16(central, 4, 20);
    write16(central, 6, 20);
    write16(central, 10, 0);
    write32(central, 16, checksum);
    write32(central, 20, data.length);
    write32(central, 24, data.length);
    write16(central, 28, nameBytes.length);
    write32(central, 42, localOffset);
    centralChunks.push(central, nameBytes);
    localOffset += local.length + nameBytes.length + data.length;
  }
  const central = concatenate(centralChunks);
  const end = header(22);
  write32(end, 0, 0x06054b50);
  write16(end, 8, Object.keys(entries).length);
  write16(end, 10, Object.keys(entries).length);
  write32(end, 12, central.length);
  write32(end, 16, localOffset);
  return concatenate([...localChunks, central, end]);
}

function zipToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToZip(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function readZipEntries(bytes) {
  const entries = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = textDecoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    entries[name] = textDecoder.decode(bytes.slice(dataStart, dataStart + compressedSize));
    offset = dataStart + compressedSize;
  }
  return entries;
}

function requireBucket(env) {
  if (!env.BACKUP_BUCKET?.put) {
    throw new HttpError(503, "backup_not_configured", "R2 backup bucket is not configured.");
  }
  return env.BACKUP_BUCKET;
}

export async function createFullBackup(db, input, context) {
  const bucket = requireBucket(context.env);
  const exportedAt = nowIso();
  const batchId = newId("backup_batch");
  const data = {};
  for (const table of BACKUP_TABLES) data[table] = await all(db, `SELECT * FROM ${table}`);
  const manifest = {
    v: 1,
    batch_id: batchId,
    exported_at: exportedAt,
    reason: typeof input.reason === "string" ? input.reason.slice(0, 120) : "manual",
    tables: Object.fromEntries(
      Object.entries(data).map(([table, rows]) => [table, rows.length]),
    ),
    data,
  };
  const encrypted = await encryptField(JSON.stringify(manifest), {
    kid: "backup-v1",
    kekMaterial: resolveKek(context.env, "backup-v1"),
  });
  const digest = await sha256Hex(encrypted);
  const objectKey = `full-backups/${batchId}.json.enc`;
  await bucket.put(objectKey, encrypted, {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { sha256: digest, exported_at: exportedAt },
  });
  await batch(db, [
    auditStatement({
      ...context,
      resourceType: "backup",
      resourceId: batchId,
      action: "EXPORT",
      createdAt: exportedAt,
    }),
  ]);
  return {
    batch_id: batchId,
    object_key: objectKey,
    sha256: digest,
    exported_at: exportedAt,
  };
}

function recoveryKeys(env) {
  const definitions = [
    ["journal-v1", "KEK_JOURNAL_V1"],
    ["journal-v2", "KEK_JOURNAL_V2"],
    ["health-v1", "KEK_HEALTH_V1"],
    ["health-v2", "KEK_HEALTH_V2"],
    ["backup-v1", "KEK_BACKUP_V1"],
  ];
  return Object.fromEntries(
    definitions
      .filter(([, name]) => typeof env[name] === "string" && env[name])
      .map(([kid, name]) => [kid, env[name]]),
  );
}

export async function createRecoveryPack(db, input, context) {
  const bucket = requireBucket(context.env);
  if (
    input.acknowledged !== true
    || input.passphrase !== input.confirmation
  ) {
    throw new HttpError(
      400,
      "recovery_confirmation_required",
      "Matching passphrases and acknowledgement are required.",
    );
  }
  const keys = recoveryKeys(context.env);
  const samplePlaintext = `life-console-recovery-${crypto.randomUUID()}`;
  const sampleKid = keys["journal-v1"] ? "journal-v1" : Object.keys(keys)[0];
  if (!sampleKid) {
    throw new HttpError(503, "encryption_key_unavailable", "No recovery keys are configured.");
  }
  const createdAt = nowIso();
  const packId = newId("recovery");
  const manifest = {
    v: 1,
    pack_id: packId,
    created_at: createdAt,
    key_ids: Object.keys(keys),
  };
  const verifySample = {
    kid: sampleKid,
    encrypted: await encryptField(samplePlaintext, {
      kid: sampleKid,
      kekMaterial: keys[sampleKid],
    }),
    plaintext_sha256: await sha256Hex(samplePlaintext),
  };
  const entries = {
    "manifest.json": JSON.stringify(manifest),
    "verify-sample.json": JSON.stringify(verifySample),
    ...Object.fromEntries(
      Object.entries(keys).map(([kid, material]) => [`kek-${kid}.key`, material]),
    ),
  };
  const encryptedPack = await encryptWithPassphrase(
    zipToBase64(createZip(entries)),
    input.passphrase,
  );
  const digest = await sha256Hex(encryptedPack);
  const objectKey = `recovery-packs/${packId}.zip.enc`;
  await bucket.put(objectKey, encryptedPack, {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { sha256: digest, created_at: createdAt },
  });
  await batch(db, [
    auditStatement({
      ...context,
      resourceType: "crypto",
      resourceId: packId,
      action: "RESTORE_PACK",
      createdAt,
    }),
  ]);
  return {
    pack_id: packId,
    object_key: objectKey,
    sha256: digest,
    created_at: createdAt,
    key_ids: Object.keys(keys),
    download_url: await createRecoveryDownloadUrl(
      context.requestUrl,
      objectKey,
      context.env,
    ),
  };
}

export async function downloadRecoveryPack(input, context, now = Date.now()) {
  const objectKey = recoveryObjectKey(input.object_key);
  const expires = Number(input.expires);
  if (!Number.isSafeInteger(expires) || expires <= now) {
    throw new HttpError(410, "download_url_expired", "Recovery download URL has expired.");
  }
  if (expires > now + RECOVERY_DOWNLOAD_TTL_MS) {
    throw new HttpError(403, "download_signature_invalid", "Recovery download signature is invalid.");
  }
  const expected = await hmacHex(
    downloadSecret(context.env),
    downloadPayload(objectKey, expires),
  );
  if (
    typeof input.signature !== "string"
    || !constantTimeEqual(input.signature, expected)
  ) {
    throw new HttpError(403, "download_signature_invalid", "Recovery download signature is invalid.");
  }
  const object = await requireBucket(context.env).get(objectKey);
  if (!object?.body) {
    throw new HttpError(404, "not_found", "Recovery pack was not found.");
  }
  return new Response(object.body, {
    headers: {
      "Content-Disposition": "attachment; filename=life-console-recovery-pack.zip.enc",
      "Content-Type": "application/octet-stream",
    },
  });
}

export async function verifyRecoveryPack(input, context) {
  let encryptedPack = input.encrypted_pack;
  if (!encryptedPack && typeof input.object_key === "string") {
    if (
      !input.object_key.startsWith("recovery-packs/")
      || !input.object_key.endsWith(".zip.enc")
      || !context.env.BACKUP_BUCKET?.get
    ) {
      throw new HttpError(400, "invalid_request", "Recovery object key is invalid.");
    }
    const object = await context.env.BACKUP_BUCKET.get(input.object_key);
    if (!object?.text) {
      throw new HttpError(404, "not_found", "Recovery pack was not found.");
    }
    encryptedPack = await object.text();
  }
  if (typeof encryptedPack !== "string") {
    throw new HttpError(400, "invalid_request", "Encrypted recovery pack is required.");
  }
  let payload;
  try {
    const entries = readZipEntries(base64ToZip(await decryptWithPassphrase(
      encryptedPack,
      input.passphrase,
    )));
    const manifest = JSON.parse(entries["manifest.json"]);
    const sample = JSON.parse(entries["verify-sample.json"]);
    const keys = Object.fromEntries(
      manifest.key_ids.map((kid) => [kid, entries[`kek-${kid}.key`]]),
    );
    payload = { manifest, verify_sample: sample, keys };
  } catch {
    throw new HttpError(400, "recovery_pack_invalid", "Recovery pack verification failed.");
  }
  const sample = payload?.verify_sample;
  const keys = payload?.keys;
  if (!sample?.kid || !keys?.[sample.kid]) {
    throw new HttpError(400, "recovery_pack_invalid", "Recovery pack is incomplete.");
  }
  const plaintext = await decryptField(sample.encrypted, (kid) => keys[kid]);
  const verified = await sha256Hex(plaintext) === sample.plaintext_sha256;
  if (!verified) {
    throw new HttpError(400, "recovery_pack_invalid", "Recovery sample digest differs.");
  }
  return {
    verified: true,
    pack_id: payload.manifest?.pack_id ?? null,
    key_ids: Object.keys(keys),
  };
}

const ROTATION_DOMAINS = {
  journal: {
    sourceKid: "journal-v1",
    targetKid: "journal-v2",
    fields: [
      ["goals", "description_encrypted", null, "encryption_version"],
      ["journals", "content_encrypted", "encryption_kid", "encryption_version"],
      ["journal_revisions", "content_encrypted", "encryption_kid", null],
      ["daily_checkins", "anchors_encrypted", null, "encryption_version"],
      ["daily_checkins", "notes_encrypted", null, "encryption_version"],
      ["weekly_reviews", "summary_encrypted", null, "encryption_version"],
      ["phase_reviews", "body_encrypted", null, "encryption_version"],
    ],
  },
  health: {
    sourceKid: "health-v1",
    targetKid: "health-v2",
    fields: [
      ["health_days", "raw_payload_encrypted", "encryption_kid", "encryption_version"],
      ["health_days", "source_device_encrypted", "encryption_kid", "encryption_version"],
      ["health_segments", "value_1_encrypted", "encryption_kid", "encryption_version"],
      ["health_segments", "value_2_encrypted", "encryption_kid", "encryption_version"],
      ["health_segments", "source_encrypted", "encryption_kid", "encryption_version"],
    ],
  },
};

export async function rotateKeks(db, input, context) {
  const config = ROTATION_DOMAINS[input.domain];
  if (!config) throw new HttpError(400, "invalid_request", "Rotation domain is invalid.");
  const targetMaterial = resolveKek(context.env, config.targetKid);
  const statements = [];
  let recordsRotated = 0;
  for (const [table, field, kidColumn, versionColumn] of config.fields) {
    const rows = await all(
      db,
      `SELECT id, ${field}${kidColumn ? `, ${kidColumn}` : ""}
       FROM ${table} WHERE ${field} IS NOT NULL`,
    );
    for (const row of rows) {
      const envelope = JSON.parse(row[field]);
      if (envelope.kid === config.targetKid) continue;
      const plaintext = await decryptField(
        row[field],
        (kid) => resolveKek(context.env, kid),
      );
      const encrypted = await encryptField(plaintext, {
        kid: config.targetKid,
        kekMaterial: targetMaterial,
      });
      const assignments = [`${field} = ?`];
      const bindings = [encrypted];
      if (kidColumn) {
        assignments.push(`${kidColumn} = ?`);
        bindings.push(config.targetKid);
      }
      if (versionColumn) {
        assignments.push(`${versionColumn} = ?`);
        bindings.push(config.targetKid);
      }
      bindings.push(row.id);
      statements.push([
        `UPDATE ${table} SET ${assignments.join(", ")} WHERE id = ?`,
        bindings,
      ]);
      recordsRotated += 1;
    }
  }
  const rotatedAt = nowIso();
  statements.push(auditStatement({
    ...context,
    resourceType: "crypto",
    resourceId: input.domain,
    action: "KEY_ROTATE",
    createdAt: rotatedAt,
  }));
  await batch(db, statements);
  return {
    domain: input.domain,
    source_kid: config.sourceKid,
    target_kid: config.targetKid,
    records_rotated: recordsRotated,
    rotated_at: rotatedAt,
  };
}
