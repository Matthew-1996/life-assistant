import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import type { components, operations } from "../../src/contracts/life-console";

type JsonObject = Record<string, unknown>;
type HttpMethod = "get" | "post";

interface OpenApiOperation {
  operationId: keyof operations;
  responses: Record<string, OpenApiResponse | OpenApiReference>;
}

interface OpenApiResponse {
  content: {
    "application/json": {
      schema: JsonObject;
    };
  };
}

interface OpenApiReference {
  $ref: string;
}

interface OpenApiDocument {
  openapi: string;
  servers: Array<{ url: string }>;
  paths: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>;
  components: {
    schemas: Record<string, JsonObject>;
    responses: Record<string, OpenApiResponse>;
  };
}

const suiteDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(suiteDirectory, "../..");
const contractPath = resolve(appRoot, "contracts/life-console.openapi.yaml");
const fixtureDirectory = resolve(appRoot, "contracts/fixtures");
const contract = parse(readFileSync(contractPath, "utf8")) as OpenApiDocument;

const typedFixtureCoverage: {
  dashboard: components["schemas"]["Dashboard"];
  receipt: components["schemas"]["CommandReceipt"];
  error: components["schemas"]["ErrorResponse"];
} = {
  dashboard:
    readFixture<components["schemas"]["Dashboard"]>("dashboard.synthetic.json"),
  receipt:
    readFixture<components["schemas"]["CommandReceipt"]>(
      "command-receipt.synthetic.json",
    ),
  error:
    readFixture<components["schemas"]["ErrorResponse"]>(
      "error-response.synthetic.json",
    ),
};

function readFixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(resolve(fixtureDirectory, name), "utf8")) as T;
}

function resolveResponse(
  response: OpenApiResponse | OpenApiReference,
): OpenApiResponse {
  if ("$ref" in response) {
    const name = response.$ref.split("/").at(-1);
    if (!name || !contract.components.responses[name]) {
      throw new Error(`Unknown response reference: ${response.$ref}`);
    }
    return contract.components.responses[name];
  }
  return response;
}

function responseSchema(
  path: string,
  method: HttpMethod,
  status: string,
): JsonObject {
  const operation = contract.paths[path]?.[method];
  const response = operation?.responses[status];
  if (!response) {
    throw new Error(`Missing ${method.toUpperCase()} ${path} response ${status}`);
  }
  return resolveResponse(response).content["application/json"].schema;
}

function createValidator(schema: JsonObject): ValidateFunction {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
  });
  addFormats(ajv);

  return ajv.compile({
    $id: "https://life-console.local/openapi-schema",
    components: contract.components,
    ...schema,
  });
}

function createComponentValidator(schemaName: string): ValidateFunction {
  return createValidator({
    $ref: `#/components/schemas/${schemaName}`,
  });
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("\n");
}

function expectValid(validate: ValidateFunction, value: unknown): void {
  const valid = validate(value);
  expect(formatErrors(validate.errors)).toBe("");
  expect(valid).toBe(true);
}

describe("Life Console OpenAPI contract", () => {
  it("is versioned and localhost-only", () => {
    expect(contract.openapi).toBe("3.1.0");
    expect(contract.servers).toEqual([{ url: "http://127.0.0.1:47321" }]);
  });

  it("generates complete TypeScript operations", () => {
    const operationIds = Object.values(contract.paths).flatMap((pathItem) =>
      Object.values(pathItem)
        .map((operation) => operation?.operationId)
        .filter((value): value is keyof operations => Boolean(value)),
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
    expect(Object.keys(typedFixtureCoverage)).toEqual([
      "dashboard",
      "receipt",
      "error",
    ]);
  });

  it.each([
    ["/api/v1/health", "get", "health.synthetic.json"],
    ["/api/v1/session", "get", "session.synthetic.json"],
    ["/api/v1/dashboard", "get", "dashboard.synthetic.json"],
    ["/api/v1/journals", "post", "command-receipt.synthetic.json"],
    ["/api/v1/checkins/{date}", "post", "command-receipt.synthetic.json"],
    ["/api/v1/capture/preview", "post", "capture-preview.synthetic.json"],
    ["/api/v1/capture/commit", "post", "command-receipt.synthetic.json"],
    ["/api/v1/confirmations", "get", "confirmations.synthetic.json"],
    ["/api/v1/purge-plans", "post", "purge-plan.synthetic.json"],
    ["/api/v1/purge-confirmations", "post", "command-receipt.synthetic.json"],
  ] as const)(
    "validates the primary response for %s",
    (path, method, fixtureName) => {
      const validate = createValidator(responseSchema(path, method, "200"));
      expectValid(validate, readFixture(fixtureName));
    },
  );

  it.each([
    ["dashboard.synthetic.json", "Dashboard"],
    ["dashboard.empty.synthetic.json", "Dashboard"],
    ["command-receipt.synthetic.json", "CommandReceipt"],
    ["error-response.synthetic.json", "ErrorResponse"],
  ])("validates %s against component %s", (fixtureName, schemaName) => {
    expectValid(createComponentValidator(schemaName), readFixture(fixtureName));
  });

  it("rejects unknown dashboard fields", () => {
    const validate = createComponentValidator("Dashboard");
    const fixture = readFixture<JsonObject>("dashboard.empty.synthetic.json");

    expect(validate({ ...fixture, raw_journal: "not allowed" })).toBe(false);
    expect(validate.errors?.[0]?.keyword).toBe("additionalProperties");
  });

  it("rejects a higher schema version", () => {
    const validate = createComponentValidator("Dashboard");
    const fixture = readFixture<JsonObject>("dashboard.empty.synthetic.json");

    expect(validate({ ...fixture, schema_version: 2 })).toBe(false);
    expect(validate.errors?.some((error) => error.keyword === "const")).toBe(true);
  });

  it("rejects unknown error codes", () => {
    const validate = createComponentValidator("ErrorResponse");
    const fixture = readFixture<{
      request_id: string;
      error: JsonObject;
    }>("error-response.synthetic.json");

    expect(
      validate({
        ...fixture,
        error: { ...fixture.error, code: "SUBPROCESS_FAILED" },
      }),
    ).toBe(false);
    expect(validate.errors?.some((error) => error.keyword === "enum")).toBe(true);
  });

  it("rejects subprocess stderr fields", () => {
    const validate = createComponentValidator("ErrorResponse");
    const fixture = readFixture<{
      request_id: string;
      error: JsonObject;
    }>("error-response.synthetic.json");

    expect(
      validate({
        ...fixture,
        error: { ...fixture.error, stderr: "synthetic child-process output" },
      }),
    ).toBe(false);
    expect(
      validate.errors?.some((error) => error.keyword === "additionalProperties"),
    ).toBe(true);
  });
});
