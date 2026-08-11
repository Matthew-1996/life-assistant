const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function draftKey(storageKey: string): Promise<CryptoKey> {
  const keyName = `life-console:draft-key:${storageKey}`;
  let encoded = sessionStorage.getItem(keyName);
  if (!encoded) {
    const material = crypto.getRandomValues(new Uint8Array(32));
    encoded = toBase64(material);
    sessionStorage.setItem(keyName, encoded);
  }
  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(fromBase64(encoded)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

export async function saveEncryptedDraft(
  storageKey: string,
  value: unknown,
): Promise<void> {
  const key = await draftKey(storageKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(value)),
  ));
  localStorage.setItem(storageKey, JSON.stringify({
    v: 1,
    alg: "AES-GCM",
    iv: toBase64(iv),
    ciphertext: toBase64(encrypted),
  }));
}

export async function loadEncryptedDraft<T>(
  storageKey: string,
): Promise<T | null> {
  const serialized = localStorage.getItem(storageKey);
  if (!serialized) return null;
  try {
    const envelope = JSON.parse(serialized) as {
      v: number;
      alg: string;
      iv: string;
      ciphertext: string;
    };
    if (envelope.v !== 1 || envelope.alg !== "AES-GCM") return null;
    const key = await draftKey(storageKey);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(fromBase64(envelope.iv)) },
      key,
      toArrayBuffer(fromBase64(envelope.ciphertext)),
    );
    return JSON.parse(decoder.decode(plaintext)) as T;
  } catch {
    return null;
  }
}

export function clearEncryptedDraft(storageKey: string): void {
  localStorage.removeItem(storageKey);
}
