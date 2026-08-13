import { describe, expect, it } from "vitest";

import { createRecoveryRedirect } from "../../../src/features/auth/recovery-redirect";

describe("createRecoveryRedirect", () => {
  it("uses a fixed recovery path at an HTTPS origin", () => {
    expect(createRecoveryRedirect("https://preview.example.invalid")).toBe(
      "https://preview.example.invalid/auth/recovery",
    );
  });

  it.each([
    ["http://localhost:5173", "http://localhost:5173/auth/recovery"],
    ["http://127.0.0.1:5173", "http://127.0.0.1:5173/auth/recovery"],
  ])("allows local HTTP origin %s", (origin, expected) => {
    expect(createRecoveryRedirect(origin)).toBe(expected);
  });

  it.each([
    "http://preview.example.invalid",
    "https://owner@preview.example.invalid",
    "https://owner:secret@preview.example.invalid",
    "https://preview.example.invalid/path",
    "https://preview.example.invalid?next=https://unsafe.example.invalid",
    "https://preview.example.invalid#unsafe",
    "https://*.example.invalid",
    "not-an-origin",
    "",
  ])("rejects unsafe origin %s", (origin) => {
    expect(() => createRecoveryRedirect(origin)).toThrow(
      "Recovery redirect requires an HTTPS origin",
    );
  });
});
