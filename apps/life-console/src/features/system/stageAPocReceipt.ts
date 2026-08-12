export const STAGE_A_POC_RECEIPT_VERSION = "life-console-poc-receipt/1" as const;

export type PocTerminalState = "failed" | "passed";
export type PocCapacityProfile = "S" | "M" | "L";

export interface PocCapacityResult {
  archive_bytes: number;
  elapsed_ms: number;
  input_bytes: number;
  profile: PocCapacityProfile;
  synthetic: true;
}

export interface StageAPocReceipt {
  browser_mode: "manual-chrome";
  capacity: Array<{
    archive_bytes: number;
    elapsed_ms: number;
    input_bytes: number;
    profile: PocCapacityProfile;
  }>;
  capacity_status: PocTerminalState;
  format_version: typeof STAGE_A_POC_RECEIPT_VERSION;
  generated_at: string;
  loopback: PocTerminalState;
  synthetic: true;
  transfer: PocTerminalState;
}

interface ReceiptInput {
  capacity: PocCapacityResult[];
  capacityState: PocTerminalState;
  loopbackState: PocTerminalState;
  transferState: PocTerminalState;
}

const CAPACITY_PROFILES: PocCapacityProfile[] = ["S", "M", "L"];

function isSafeMetric(value: number) {
  return Number.isFinite(value) && value >= 0;
}

export function createStageAPocReceipt(
  input: ReceiptInput,
  generatedAt = new Date(),
): StageAPocReceipt {
  const capacity = input.capacity.map((result) => {
    if (
      result.synthetic !== true
      || !CAPACITY_PROFILES.includes(result.profile)
      || !isSafeMetric(result.archive_bytes)
      || !isSafeMetric(result.elapsed_ms)
      || !isSafeMetric(result.input_bytes)
    ) {
      throw new Error("invalid_synthetic_capacity_result");
    }
    return {
      archive_bytes: result.archive_bytes,
      elapsed_ms: result.elapsed_ms,
      input_bytes: result.input_bytes,
      profile: result.profile,
    };
  });

  if (
    input.capacityState === "passed"
    && (
      capacity.length !== CAPACITY_PROFILES.length
      || capacity.some((result, index) => result.profile !== CAPACITY_PROFILES[index])
    )
  ) {
    throw new Error("incomplete_synthetic_capacity_result");
  }

  return {
    browser_mode: "manual-chrome",
    capacity,
    capacity_status: input.capacityState,
    format_version: STAGE_A_POC_RECEIPT_VERSION,
    generated_at: generatedAt.toISOString(),
    loopback: input.loopbackState,
    synthetic: true,
    transfer: input.transferState,
  };
}

export function serializeStageAPocReceipt(receipt: StageAPocReceipt) {
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

export function stageAPocReceiptFilename(generatedAt: string) {
  const safeTimestamp = generatedAt.replaceAll(":", "-").replaceAll(".", "-");
  return `life-console-stage-a-poc-receipt-${safeTimestamp}.json`;
}
