import { Ajv } from "ajv";

import contract from "../../contracts/journal-normalization-v1.json" with { type: "json" };
import type { JournalNormalization } from "../journal/normalization-contract.js";

export class JournalNormalizationError extends Error {}

const ajv = new Ajv({ allErrors: true, strict: true });
const validateSchema = ajv.compile(contract.schema);
const evidenceFields = [
  "facts",
  "feelings",
  "places",
  "planning_clues",
  "inferences",
] as const;

function assertEvidence(rawText: string, evidence: string): void {
  if (!rawText.includes(evidence)) {
    throw new JournalNormalizationError(
      "Journal normalization evidence is absent from raw text",
    );
  }
}

export function validateJournalNormalization(
  value: unknown,
  rawText: string,
  contextRevisions: Readonly<Record<string, string>>,
): JournalNormalization {
  if (!validateSchema(value)) {
    throw new JournalNormalizationError(
      `Journal normalization schema validation failed: ${ajv.errorsText(validateSchema.errors)}`,
    );
  }
  const normalization = value as unknown as JournalNormalization;
  for (const field of evidenceFields) {
    for (const item of normalization[field]) {
      assertEvidence(rawText, item.evidence);
    }
  }
  for (const person of normalization.people) {
    assertEvidence(rawText, person.evidence);
    if (person.basis === "confirmed_profile") {
      if (
        !person.profile_revision
        || contextRevisions[person.text] !== person.profile_revision
      ) {
        throw new JournalNormalizationError(
          "Journal normalization profile revision is not approved",
        );
      }
    } else if (person.profile_revision !== null) {
      throw new JournalNormalizationError(
        "Explicit people must not carry a profile revision",
      );
    }
  }
  return normalization;
}
