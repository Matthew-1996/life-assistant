import { normalizeJournalRequest } from "../src/server/journal-normalization-service";

export default async function handler(request: Request): Promise<Response> {
  const environment = {
    supabaseUrl: process.env.VITE_SUPABASE_URL ?? "",
    supabasePublishableKey:
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
    deepSeekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
  };
  if (
    !environment.supabaseUrl
    || !environment.supabasePublishableKey
    || !environment.deepSeekApiKey
  ) {
    return Response.json({ status: "normalization_unavailable" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return await normalizeJournalRequest(request, environment);
}
