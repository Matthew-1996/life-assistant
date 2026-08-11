import { describe, expect, it } from "vitest";

import {
  decryptWithPassphrase,
  decryptField,
  encryptWithPassphrase,
  encryptField,
  generateKekMaterial,
  sha256Hex,
} from "../../worker/lib/crypto.js";

describe("field encryption", () => {
  it("round-trips plaintext without storing it in the envelope", async () => {
    const kek = generateKekMaterial();
    const plaintext = "synthetic journal content";
    const encrypted = await encryptField(plaintext, {
      kid: "journal-v1",
      kekMaterial: kek,
    });

    expect(encrypted).not.toContain(plaintext);
    expect(JSON.parse(encrypted)).toEqual(expect.objectContaining({
      v: 1,
      alg: "AES-256-GCM",
      kid: "journal-v1",
    }));
    expect(
      await decryptField(encrypted, async (kid: string) => {
        expect(kid).toBe("journal-v1");
        return kek;
      }),
    ).toBe(plaintext);
  });

  it("rejects a different KEK", async () => {
    const encrypted = await encryptField("synthetic health payload", {
      kid: "health-v1",
      kekMaterial: generateKekMaterial(),
    });

    await expect(
      decryptField(encrypted, async () => generateKekMaterial()),
    ).rejects.toThrow();
  });

  it("creates deterministic SHA-256 digests", async () => {
    expect(await sha256Hex("synthetic")).toBe(
      "b3cc0475bb78a5026098858e9889acf666d31062d513d303314eca31d36e72f2",
    );
  });

  it("encrypts recovery payloads with a strong passphrase and rejects a wrong one", async () => {
    const encrypted = await encryptWithPassphrase(
      "synthetic recovery payload",
      "synthetic-passphrase-2026",
    );

    expect(encrypted).not.toContain("synthetic recovery payload");
    await expect(
      decryptWithPassphrase(encrypted, "synthetic-passphrase-2026"),
    ).resolves.toBe("synthetic recovery payload");
    await expect(
      decryptWithPassphrase(encrypted, "wrong-passphrase-value"),
    ).rejects.toThrow();
  });

  it("rejects recovery passphrases shorter than 16 characters", async () => {
    await expect(
      encryptWithPassphrase("payload", "too-short"),
    ).rejects.toThrow("at least 16");
  });
});
