export interface EncryptionOptions {
  kid: string;
  kekMaterial: string;
}

export function generateKekMaterial(): string;
export function encryptField(
  plaintext: string,
  options: EncryptionOptions,
): Promise<string>;
export function decryptField(
  serialized: string,
  resolveKek: (kid: string) => string | Promise<string>,
): Promise<string>;
export function encryptWithPassphrase(
  plaintext: string,
  passphrase: string,
): Promise<string>;
export function decryptWithPassphrase(
  serialized: string,
  passphrase: string,
): Promise<string>;
export function sha256Hex(value: string | Uint8Array): Promise<string>;
export function hmacHex(secret: string, value: string): Promise<string>;
