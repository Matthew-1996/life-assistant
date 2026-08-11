import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../../src/styles.css", import.meta.url),
  "utf8",
);

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("system page layout contracts", () => {
  it("keeps the single backup card readable and safety copy visible", () => {
    const card = rule(".backup-card");
    const scope = rule(".backup-scope");
    const safety = rule(".backup-safety-note");

    expect(card).toContain("display: grid");
    expect(card).toContain("gap: 16px");
    expect(scope).toContain("border-radius: 14px");
    expect(safety).toContain("font-weight: 600");
  });

  it("gives migration checks dedicated wrapping columns", () => {
    const row = rule(".day-row.migration-check-row");
    const title = rule(".day-row.migration-check-row > strong");
    const description = rule(
      ".day-row.migration-check-row > span:not(.status)",
    );

    expect(row).toContain(
      "grid-template-columns: minmax(0, 1fr) auto",
    );
    expect(title).toContain("white-space: normal");
    expect(description).toContain("grid-column: 1 / -1");
    expect(description).toContain("overflow-wrap: anywhere");
  });
});
