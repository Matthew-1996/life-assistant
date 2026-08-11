import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createSyntheticMiniflare,
  type SyntheticMiniflareHarness,
} from "./helpers/miniflare";

describe("Life Console Miniflare security boundaries", () => {
  let harness: SyntheticMiniflareHarness;

  beforeEach(async () => {
    harness = await createSyntheticMiniflare();
  });

  afterEach(async () => {
    await harness.dispose();
  });

  it("rejects API requests without an owner session", async () => {
    const response = await harness.rawFetch("/api/v1/bootstrap");

    expect(response.status).toBe(401);
  });

  it("returns owner metadata for the synthetic owner", async () => {
    const response = await harness.fetch("/api/v1/auth/me");

    expect(await response.json()).toEqual(expect.objectContaining({
      role: "owner",
      version: "2.0.0",
    }));
  });

  it("rejects a write from a foreign origin", async () => {
    const response = await harness.rawFetch("/api/v1/goals", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://foreign.example",
        "X-Synthetic-Owner": "synthetic-owner",
      },
      body: JSON.stringify({
        title: "Synthetic goal",
        status: "focus",
        priority_order: 1,
      }),
    });

    expect(response.status).toBe(403);
  });

  it("rejects a same-origin write without a CSRF token", async () => {
    const response = await harness.fetch("/api/v1/goals", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: harness.origin,
      },
      body: JSON.stringify({
        title: "Synthetic goal",
        status: "focus",
        priority_order: 1,
      }),
    });

    expect(response.status).toBe(403);
  });

  it("accepts a same-origin write with a CSRF token", async () => {
    const response = await harness.write("/api/v1/goals", {
      title: "Synthetic goal",
      status: "focus",
      priority_order: 1,
    }, {
      "Idempotency-Key": "security-goal",
    });

    expect(response.status).toBe(200);
  });

  it("rejects write methods outside the API namespace", async () => {
    const response = await harness.rawFetch("/index.html", {
      method: "POST",
    });

    expect(response.status).toBe(405);
  });
});
