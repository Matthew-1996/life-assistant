import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const styleEntry = readFileSync(
  new URL("../../src/styles.css", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../../src/styles/shared.css", import.meta.url),
  "utf8",
);

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("system page layout contracts", () => {
  it("loads tokens, shared components, and focused page styles from one entry", () => {
    for (const name of ["tokens", "shared", "today", "records", "progress"]) {
      expect(styleEntry).toContain(`@import "./styles/${name}.css";`);
    }
  });

  it("keeps the single backup card readable and safety copy visible", () => {
    const card = rule(".backup-card");
    const scope = rule(".backup-scope");
    const safety = rule(".backup-safety-note");

    expect(card).toContain("display: grid");
    expect(card).toContain("gap: 16px");
    expect(scope).toContain("border-radius: 14px");
    expect(safety).toContain("font-weight: 600");
  });
});
