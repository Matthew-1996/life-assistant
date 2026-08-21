import {
  selectTopFive,
  type PublicNewsCandidate,
} from "./daily-news-validator.js";

export type DailyNewsDiscoverySource =
  | "gdelt"
  | "publisher_fallback"
  | "gdelt_plus_publisher_fallback";

export interface DailyNewsDiscoveryResult {
  candidates: PublicNewsCandidate[];
  source: DailyNewsDiscoverySource;
}

export interface DailyNewsDiscoveryDependencies {
  primary(): Promise<PublicNewsCandidate[]>;
  fallback(): Promise<PublicNewsCandidate[]>;
}

export class DailyNewsDiscoveryError extends Error {
  constructor(
    public readonly code: "news_discovery_unavailable" | "candidate_mix_unavailable",
    public readonly source: DailyNewsDiscoverySource | "none",
  ) {
    super(code);
    this.name = "DailyNewsDiscoveryError";
  }
}

function validateMix(
  candidates: PublicNewsCandidate[],
  source: DailyNewsDiscoverySource,
): void {
  try {
    selectTopFive(candidates);
  } catch {
    throw new DailyNewsDiscoveryError("candidate_mix_unavailable", source);
  }
}

export async function discoverDailyNewsCandidates(
  dependencies: DailyNewsDiscoveryDependencies,
): Promise<DailyNewsDiscoveryResult> {
  let primaryCandidates: PublicNewsCandidate[];
  try {
    primaryCandidates = await dependencies.primary();
  } catch {
    let fallbackCandidates: PublicNewsCandidate[];
    try {
      fallbackCandidates = await dependencies.fallback();
    } catch {
      throw new DailyNewsDiscoveryError("news_discovery_unavailable", "none");
    }
    validateMix(fallbackCandidates, "publisher_fallback");
    return {
      candidates: fallbackCandidates,
      source: "publisher_fallback",
    };
  }

  try {
    selectTopFive(primaryCandidates);
    return {
      candidates: primaryCandidates,
      source: "gdelt",
    };
  } catch {
    let fallbackCandidates: PublicNewsCandidate[];
    try {
      fallbackCandidates = await dependencies.fallback();
    } catch {
      throw new DailyNewsDiscoveryError("news_discovery_unavailable", "gdelt");
    }
    const combined = [...primaryCandidates, ...fallbackCandidates];
    validateMix(combined, "gdelt_plus_publisher_fallback");
    return {
      candidates: combined,
      source: "gdelt_plus_publisher_fallback",
    };
  }
}
