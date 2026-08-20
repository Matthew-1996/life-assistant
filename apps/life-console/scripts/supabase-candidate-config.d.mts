export interface CandidateEnvironment {
  VERCEL_ENV?: string;
  VERCEL_PROJECT_NAME?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  [key: string]: string | undefined;
}

export interface CandidateVercelConfig {
  buildCommand: string;
  crons?: Array<{
    path: string;
    schedule: string;
  }>;
  framework: string;
  functions: Record<string, {
    maxDuration: number;
    regions: string[];
  }>;
  installCommand: string;
  outputDirectory: string;
  headers: Array<{
    source: string;
    headers: Array<{ key: string; value: string }>;
  }>;
  rewrites: Array<{
    source: string;
    destination: string;
  }>;
}

export function resolveCandidateProjectOrigin(
  environment: CandidateEnvironment,
): string;

export function candidateContentSecurityPolicy(
  environment: CandidateEnvironment,
): string;

export function createSupabaseCandidateVercelConfig(
  environment: CandidateEnvironment,
): CandidateVercelConfig;

export function createSupabaseProductionVercelConfig(
  environment: CandidateEnvironment,
): CandidateVercelConfig;

export function createLifeConsoleVercelConfig(
  environment: CandidateEnvironment,
): CandidateVercelConfig;
