const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const SESSION_DRAFT_STORAGE_PREFIX =
  "life-console:session-draft:";

const SESSION_DRAFT_INDEX_KEY =
  `${SESSION_DRAFT_STORAGE_PREFIX}active`;
const SESSION_DRAFT_ACTIVITY_EVENT =
  "life-console:session-draft-activity";
const sessionDraftClearGenerations = new Map<string, number>();

function usableStorage(candidate: unknown): Storage | null {
  if (!candidate || typeof candidate !== "object") return null;
  const storage = candidate as Partial<Storage>;
  return typeof storage.getItem === "function"
      && typeof storage.setItem === "function"
      && typeof storage.removeItem === "function"
    ? storage as Storage
    : null;
}

function localDraftStorage(): Storage | null {
  return usableStorage(globalThis.localStorage);
}

function sessionDraftStorage(): Storage | null {
  return usableStorage(globalThis.sessionStorage);
}

function keyMaterialName(storageKey: string): string {
  return `life-console:draft-key:${storageKey}`;
}

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
  const session = sessionDraftStorage();
  if (!session) throw new Error("Session storage is unavailable");
  const keyName = keyMaterialName(storageKey);
  let encoded = session.getItem(keyName);
  if (!encoded) {
    const material = crypto.getRandomValues(new Uint8Array(32));
    encoded = toBase64(material);
    session.setItem(keyName, encoded);
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
  expectedClearGeneration?: number,
): Promise<boolean> {
  const local = localDraftStorage();
  if (!local || !sessionDraftStorage()) return false;
  if (
    expectedClearGeneration !== undefined
    && expectedClearGeneration !== sessionDraftGeneration(storageKey)
  ) return false;
  const key = await draftKey(storageKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(value)),
  ));
  if (
    expectedClearGeneration !== undefined
    && expectedClearGeneration !== sessionDraftGeneration(storageKey)
  ) return false;
  local.setItem(storageKey, JSON.stringify({
    v: 1,
    alg: "AES-GCM",
    iv: toBase64(iv),
    ciphertext: toBase64(encrypted),
  }));
  return true;
}

export async function loadEncryptedDraft<T>(
  storageKey: string,
): Promise<T | null> {
  const local = localDraftStorage();
  if (!local || !sessionDraftStorage()) return null;
  const serialized = local.getItem(storageKey);
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
  localDraftStorage()?.removeItem(storageKey);
  sessionDraftStorage()?.removeItem(keyMaterialName(storageKey));
}

function assertSessionDraftKey(storageKey: string): void {
  if (
    !storageKey.startsWith(SESSION_DRAFT_STORAGE_PREFIX)
    || storageKey === SESSION_DRAFT_INDEX_KEY
  ) {
    throw new Error("Session drafts must use the approved storage prefix");
  }
}

function sessionDraftIndex(): string[] {
  const session = sessionDraftStorage();
  if (!session) return [];
  try {
    const value = JSON.parse(
      session.getItem(SESSION_DRAFT_INDEX_KEY) ?? "[]",
    );
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.filter((item): item is string =>
      typeof item === "string"
      && item.startsWith(SESSION_DRAFT_STORAGE_PREFIX)
      && item !== SESSION_DRAFT_INDEX_KEY
    )));
  } catch {
    return [];
  }
}

function scopedSessionDraftKeys(scope?: string): string[] {
  const prefix = scope === undefined
    ? SESSION_DRAFT_STORAGE_PREFIX
    : `${SESSION_DRAFT_STORAGE_PREFIX}${scope}:`;
  return sessionDraftIndex().filter((storageKey) =>
    storageKey.startsWith(prefix)
  );
}

function emitSessionDraftActivity(): void {
  window.dispatchEvent(new Event(SESSION_DRAFT_ACTIVITY_EVENT));
}

export function markSessionDraftActive(
  storageKey: string,
  active: boolean,
): void {
  assertSessionDraftKey(storageKey);
  const keys = new Set(sessionDraftIndex());
  const session = sessionDraftStorage();
  if (!session) return;
  if (active) keys.add(storageKey);
  else keys.delete(storageKey);

  if (keys.size === 0) {
    session.removeItem(SESSION_DRAFT_INDEX_KEY);
  } else {
    session.setItem(SESSION_DRAFT_INDEX_KEY, JSON.stringify([...keys]));
  }
  emitSessionDraftActivity();
}

export function clearSessionDraft(storageKey: string): void {
  assertSessionDraftKey(storageKey);
  clearEncryptedDraft(storageKey);
  markSessionDraftActive(storageKey, false);
}

export function hasActiveSessionDrafts(scope?: string): boolean {
  return scopedSessionDraftKeys(scope).length > 0;
}

export function sessionDraftGeneration(storageKey: string): number {
  return sessionDraftClearGenerations.get(storageKey) ?? 0;
}

export function clearAllSessionDrafts(scope?: string): void {
  const clearedKeys = new Set(scopedSessionDraftKeys(scope));
  for (const storageKey of clearedKeys) {
    sessionDraftClearGenerations.set(
      storageKey,
      sessionDraftGeneration(storageKey) + 1,
    );
    clearEncryptedDraft(storageKey);
  }
  const remainingKeys = sessionDraftIndex().filter((storageKey) =>
    !clearedKeys.has(storageKey)
  );
  const session = sessionDraftStorage();
  if (remainingKeys.length === 0) {
    session?.removeItem(SESSION_DRAFT_INDEX_KEY);
  } else {
    session?.setItem(SESSION_DRAFT_INDEX_KEY, JSON.stringify(remainingKeys));
  }
  emitSessionDraftActivity();
}

export function subscribeSessionDraftActivity(
  listener: () => void,
): () => void {
  window.addEventListener(SESSION_DRAFT_ACTIVITY_EVENT, listener);
  return () => {
    window.removeEventListener(SESSION_DRAFT_ACTIVITY_EVENT, listener);
  };
}
