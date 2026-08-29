import { createSupabaseCandidateVercelConfig } from "./supabase-candidate-config.mjs";

try {
  createSupabaseCandidateVercelConfig({
    ...process.env,
    VERCEL_ENV: "preview",
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
