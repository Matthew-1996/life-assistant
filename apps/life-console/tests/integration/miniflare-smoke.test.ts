import { afterEach, describe, expect, it } from "vitest";

import {
  createSyntheticMiniflare,
  type SyntheticMiniflareHarness,
} from "./helpers/miniflare";

describe("Life Console Miniflare smoke", () => {
  let harness: SyntheticMiniflareHarness | undefined;

  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });

  it("boots the real Worker with D1 and a synthetic owner", async () => {
    harness = await createSyntheticMiniflare();

    const response = await harness.fetch("/api/v1/bootstrap");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.goals).toEqual([]);
    expect(payload.system.source_truth).toBe("ICLOUD_PRIMARY");
  });
});
