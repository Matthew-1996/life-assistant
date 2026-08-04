import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

type JsonSchema = Record<string, unknown>;

interface OpenApiDocument {
  openapi: string;
  servers: Array<{ url: string }>;
  paths: Record<
    string,
    Record<string, { operationId?: string; responses?: Record<string, unknown> }>
  >;
  components: {
    schemas: Record<string, JsonSchema>;
  };
}

const suiteDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(suiteDirectory, "../..");
const contractPath = resolve(appRoot, "contracts/life-console.openapi.yaml");
const fixtureDirectory = resolve(appRoot, "contracts/fixtures");
const contract = parse(readFileSync(contractPath, "utf8")) as OpenApiDocument;

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixtureDirectory, name), "utf8"));
}

function createValidator(schemaName: string): ValidateFunction {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
  });
  addFormats(ajv);

  return ajv.compile({
    $id: "https://life-console.local/openapi-schema",
    components: {
      schemas: contract.components.schemas,
    },
    $ref: `#/components/schemas/${schemaName}`,
  });
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("\n");
}

describe("Life Console OpenAPI contract", () => {
  it("is versioned and localhost-only", () => {
    expect(contract.openapi).toBe("3.1.0");
    expect(contract.servers).toEqual([{ url: "http://127.0.0.1:47321" }]);
  });

  it("uses unique operation IDs for every operation", () => {
    const operationIds = Object.values(contract.paths).flatMap((pathItem) =>
      Object.values(pathItem)
        .map((operation) => operation.operationId)
        .filter((value): value is string => Boolean(value)),
    );

    expect(operationIds).toEqual([
      "getHealth",
      "createSession",
      "getDashboard",
      "createJournal",
      "upsertCheckin",
      "previewCapture",
      "commitCapture",
      "getConfirmations",
      "createPurgePlan",
      "confirmPurge",
    ]);
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  it.each([
    ["dashboard.synthetic.json", "Dashboard"],
    ["dashboard.empty.synthetic.json", "Dashboard"],
    ["command-receipt.synthetic.json", "CommandReceipt"],
    ["error-response.synthetic.json", "ErrorResponse"],
  ])("validates %s against %s", (fixtureName, schemaName) => {
    const validate = createValidator(schemaName);
    const valid = validate(readFixture(fixtureName));

    expect(formatErrors(validate.errors)).toBe("");
    expect(valid).toBe(true);
  });

  it("rejects unknown dashboard fields", () => {
    const validate = createValidator("Dashboard");
    const fixture = readFixture("dashboard.empty.synthetic.json") as Record<
      string,
      unknown
    >;

    expect(validate({ ...fixture, raw_journal: "not allowed" })).toBe(false);
    expect(validate.errors?.[0]?.keyword).toBe("additionalProperties");
  });
});
