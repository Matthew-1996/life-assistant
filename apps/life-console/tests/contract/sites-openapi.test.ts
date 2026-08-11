import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import type { operations } from "../../src/contracts/life-console-sites";

type Method = "get" | "post" | "patch" | "delete";
type Operation = { operationId: keyof operations };
type Contract = {
  openapi: string;
  servers: Array<{ url: string }>;
  paths: Record<string, Partial<Record<Method, Operation>>>;
};

const suiteDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(suiteDirectory, "../..");
const contract = parse(
  readFileSync(resolve(appRoot, "contracts/life-console-sites.openapi.yaml"), "utf8"),
) as Contract;

describe("Life Console Sites OpenAPI contract", () => {
  it("is owner-only and same-origin", () => {
    expect(contract.openapi).toBe("3.1.0");
    expect(contract.servers).toEqual([{ url: "/" }]);
  });

  it("covers every implemented cloud management endpoint", () => {
    const required = [
      ["post", "/api/v1/backup/trigger"],
      ["get", "/api/v1/backup/queue/{id}/payload"],
      ["post", "/api/v1/backup/queue/{id}/report"],
      ["post", "/api/v1/crypto/recovery-pack"],
      ["post", "/api/v1/crypto/verify-recovery-pack"],
      ["post", "/api/v1/crypto/rotate-keks"],
      ["patch", "/api/v1/health/days/{id}"],
      ["get", "/api/v1/health/days/{id}/segments"],
    ] as const;

    for (const [method, path] of required) {
      expect(contract.paths[path]?.[method]?.operationId).toBeTruthy();
    }
  });

  it("generates unique operation ids", () => {
    const operationIds = Object.values(contract.paths).flatMap((pathItem) =>
      Object.values(pathItem)
        .map((operation) => operation?.operationId)
        .filter((value): value is keyof operations => Boolean(value)),
    );
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });
});
