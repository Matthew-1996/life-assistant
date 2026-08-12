export interface CandidateEnvironment {
  VERCEL_ENV?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  [key: string]: string | undefined;
}

export interface CandidateVercelConfig {
  buildCommand: string;
  framework: string;
  installCommand: string;
  outputDirectory: string;
  headers: Array<{
    source: string;
    headers: Array<{ key: string; value: string }>;
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
