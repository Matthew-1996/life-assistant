import { createSupabaseCandidateVercelConfig } from "./scripts/supabase-candidate-config.mjs";

export const config = createSupabaseCandidateVercelConfig(process.env);
