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
  it("keeps the recovery acknowledgement checkbox compact and inline", () => {
    const checkboxRow = rule(".checkbox-row");
    const checkbox = rule('.checkbox-row input[type="checkbox"]');

    expect(checkboxRow).toContain("display: flex");
    expect(checkboxRow).toContain("width: 100%");
    expect(checkboxRow).toContain("align-items: center");
    expect(checkboxRow).toContain("white-space: nowrap");
    expect(checkbox).toContain("width: 16px");
    expect(checkbox).toContain("height: 16px");
    expect(checkbox).toContain("padding: 0");
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
