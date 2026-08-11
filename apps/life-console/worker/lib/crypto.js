const encoder = new TextEncoder();
const decoder = new TextDecoder();
const AES_GCM_TAG_BYTES = 16;

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function importAesKey(raw, usages) {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, usages);
}

async function encryptAes(key, plaintext) {
  const iv = randomBytes(12);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );
  const ciphertext = encrypted.slice(0, -AES_GCM_TAG_BYTES);
  const tag = encrypted.slice(-AES_GCM_TAG_BYTES);
  return {
    iv: bytesToBase64Url(iv),
    tag: bytesToBase64Url(tag),
    ct: bytesToBase64Url(ciphertext),
  };
}

async function decryptAes(key, payload) {
  const ciphertext = base64UrlToBytes(payload.ct);
  const tag = base64UrlToBytes(payload.tag);
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlToBytes(payload.iv) },
      key,
      combined,
    ),
  );
}

export function generateKekMaterial() {
  return bytesToBase64Url(randomBytes(32));
}

export async function encryptField(plaintext, { kid, kekMaterial }) {
  if (typeof plaintext !== "string") {
    throw new TypeError("Encrypted field plaintext must be a string");
  }
  if (!kid || typeof kid !== "string") {
    throw new TypeError("Encrypted field kid is required");
  }

  const kekBytes = base64UrlToBytes(kekMaterial);
  if (kekBytes.length !== 32) {
    throw new TypeError("KEK material must contain exactly 32 bytes");
  }

  const dekBytes = randomBytes(32);
  const [kek, dek] = await Promise.all([
    importAesKey(kekBytes, ["encrypt", "decrypt"]),
    importAesKey(dekBytes, ["encrypt", "decrypt"]),
  ]);
  const [wrappedDek, encryptedData] = await Promise.all([
    encryptAes(kek, dekBytes),
    encryptAes(dek, encoder.encode(plaintext)),
  ]);

  return JSON.stringify({
    v: 1,
    alg: "AES-256-GCM",
    kid,
    dek: wrappedDek,
    data: encryptedData,
  });
}

export async function decryptField(serialized, resolveKek) {
  const envelope = JSON.parse(serialized);
  if (
    envelope?.v !== 1
    || envelope?.alg !== "AES-256-GCM"
    || typeof envelope?.kid !== "string"
  ) {
    throw new TypeError("Unsupported encrypted field envelope");
  }

  const kekMaterial = await resolveKek(envelope.kid);
  const kekBytes = base64UrlToBytes(kekMaterial);
  if (kekBytes.length !== 32) {
    throw new TypeError("KEK material must contain exactly 32 bytes");
  }

  const kek = await importAesKey(kekBytes, ["decrypt"]);
  const dekBytes = await decryptAes(kek, envelope.dek);
  const dek = await importAesKey(dekBytes, ["decrypt"]);
  return decoder.decode(await decryptAes(dek, envelope.data));
}

async function derivePassphraseKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function assertRecoveryPassphrase(passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < 16) {
    throw new TypeError("Recovery passphrase must contain at least 16 characters");
  }
  const normalized = passphrase.toLowerCase().replaceAll(/\s+/gu, "");
  if (["passwordpassword", "1234567890123456", "qwertyuiopasdfgh"].includes(normalized)) {
    throw new TypeError("Recovery passphrase is too common");
  }
}

export async function encryptWithPassphrase(plaintext, passphrase) {
  if (typeof plaintext !== "string") {
    throw new TypeError("Recovery plaintext must be a string");
  }
  assertRecoveryPassphrase(passphrase);
  const iterations = 1_000_000;
  const salt = randomBytes(16);
  const key = await derivePassphraseKey(passphrase, salt, iterations);
  return JSON.stringify({
    v: 1,
    alg: "PBKDF2-SHA256+A256GCM",
    iterations,
    salt: bytesToBase64Url(salt),
    data: await encryptAes(key, encoder.encode(plaintext)),
  });
}

export async function decryptWithPassphrase(serialized, passphrase) {
  assertRecoveryPassphrase(passphrase);
  const envelope = JSON.parse(serialized);
  if (
    envelope?.v !== 1
    || envelope?.alg !== "PBKDF2-SHA256+A256GCM"
    || envelope?.iterations !== 1_000_000
    || typeof envelope?.salt !== "string"
  ) {
    throw new TypeError("Unsupported recovery envelope");
  }
  const key = await derivePassphraseKey(
    passphrase,
    base64UrlToBytes(envelope.salt),
    envelope.iterations,
  );
  return decoder.decode(await decryptAes(key, envelope.data));
}

export async function sha256Hex(value) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
  );
  return Array.from(signature, (byte) =>
    byte.toString(16).padStart(2, "0")).join("");
}
