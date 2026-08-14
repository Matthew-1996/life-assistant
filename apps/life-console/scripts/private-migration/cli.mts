import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { createDryRunReport } from "./dry-run";
import { importMigration } from "./import";
import { verifyMigration } from "./verify";
import { rollbackMigration } from "./rollback";
import { validateSourceManifest } from "./source-manifest";

type Command = "dry-run" | "import" | "verify" | "rollback";

const VALID_COMMANDS: readonly Command[] = [
  "dry-run",
  "import",
  "verify",
  "rollback",
];

function printUsage(): void {
  console.error(`Usage: cli.mts <command> [options]

Commands:
  dry-run    Validate manifest and generate dry-run report
  import     Run dry-run first, then import (fails if dry-run has errors)
  verify     Verify previously imported data matches source
  rollback   Roll back a specific migration run

Environment variables (required):
  SUPABASE_URL              Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY Supabase service role key (never commit this)
  OWNER_USER_ID             UUID of the user who will own imported records
  MANIFEST_PATH             Absolute path to the migration manifest JSON file
  PRIVATE_REPORT_DIR        Directory to write JSON reports (git-ignored)

For rollback, also pass --migration-run-id=<uuid>
`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value.trim();
}

function parseArgs(): {
  command: Command;
  migrationRunId?: string;
} {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const command = args[0];
  if (!VALID_COMMANDS.includes(command as Command)) {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }

  let migrationRunId: string | undefined;
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--migration-run-id=")) {
      migrationRunId = arg.slice("--migration-run-id=".length);
    } else if (arg === "--migration-run-id" && i + 1 < args.length) {
      migrationRunId = args[i + 1];
      i += 1;
    } else {
      console.error(`Unknown argument: ${arg}`);
      printUsage();
      process.exit(1);
    }
  }

  return { command: command as Command, migrationRunId };
}

function redactError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { message: error.message, name: error.name };
  }
  return { message: String(error) };
}

function writeReport(
  reportDir: string,
  name: string,
  data: unknown,
): string {
  mkdirSync(reportDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${name}-${timestamp}.json`;
  const path = join(reportDir, filename);
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  return path;
}

function createServiceClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: {
      retry: false,
    },
  });
}

async function main(): Promise<void> {
  const { command, migrationRunId: runIdArg } = parseArgs();

  const manifestPath = resolve(requireEnv("MANIFEST_PATH"));
  const reportDir = resolve(requireEnv("PRIVATE_REPORT_DIR"));

  if (command !== "dry-run") {
    requireEnv("SUPABASE_URL");
    requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    requireEnv("OWNER_USER_ID");
  }

  console.error(`[migration] Reading manifest: ${manifestPath}`);
  const manifestRaw = readFileSync(manifestPath, "utf8");
  const manifestJson = JSON.parse(manifestRaw);
  const manifest = await validateSourceManifest(manifestJson);

  if (command === "dry-run") {
    console.error("[migration] Running dry-run...");
    const report = await createDryRunReport(manifest);
    const path = writeReport(reportDir, "dry-run", report);
    const errorCount = report.resources.reduce(
      (sum, r) => sum + r.errors.length,
      0,
    );
    const recordCount = report.resources.reduce((sum, r) => sum + r.count, 0);
    console.error(`[migration] Dry run complete: ${recordCount} records, ${errorCount} errors`);
    console.error(`[migration] Report written to: ${path}`);
    console.error(`[migration] Overall digest: ${report.overallDigest.slice(0, 16)}...`);
    if (errorCount > 0) {
      process.exit(1);
    }
    return;
  }

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const ownerUserId = requireEnv("OWNER_USER_ID");
  const client = createServiceClient(supabaseUrl, serviceRoleKey);

  if (command === "import") {
    console.error("[migration] Running pre-import dry-run...");
    const dryRunReport = await createDryRunReport(manifest);
    const errorCount = dryRunReport.resources.reduce(
      (sum, r) => sum + r.errors.length,
      0,
    );
    if (errorCount > 0) {
      const path = writeReport(reportDir, "dry-run-failed", dryRunReport);
      console.error(`[migration] Dry run found ${errorCount} errors; aborting import`);
      console.error(`[migration] Report written to: ${path}`);
      process.exit(1);
    }

    const migrationRunId = randomUUID();
    console.error(`[migration] Starting import run: ${migrationRunId}`);
    try {
      const stats = await importMigration({
        manifest,
        dryRunReport,
        migrationRunId,
        client,
        ownerUserId,
      });
      const report = { migrationRunId, stats, dryRun: { overallDigest: dryRunReport.overallDigest } };
      const path = writeReport(reportDir, "import-success", report);
      console.error(`[migration] Import complete: inserted=${stats.inserted} skipped=${stats.skipped} failed=${stats.failed}`);
      console.error(`[migration] Report written to: ${path}`);
    } catch (error) {
      const report = { migrationRunId, error: redactError(error) };
      const path = writeReport(reportDir, "import-failed", report);
      console.error(`[migration] Import failed`);
      console.error(`[migration] Report written to: ${path}`);
      process.exit(1);
    }
    return;
  }

  if (command === "verify") {
    const migrationRunId = runIdArg;
    if (!migrationRunId) {
      console.error("--migration-run-id=<uuid> is required for verify");
      process.exit(1);
    }
    console.error(`[migration] Verifying run: ${migrationRunId}`);
    try {
      const result = await verifyMigration({
        manifest,
        migrationRunId,
        client,
        ownerUserId,
      });
      const path = writeReport(reportDir, "verify", { migrationRunId, ...result });
      console.error(`[migration] Verification ${result.match ? "PASSED" : "FAILED"}`);
      if (!result.match) {
        console.error(`[migration] Mismatches: ${result.mismatches.length}, Errors: ${result.errors.length}`);
      }
      console.error(`[migration] Report written to: ${path}`);
      if (!result.match) {
        process.exit(1);
      }
    } catch (error) {
      const report = { migrationRunId, error: redactError(error) };
      const path = writeReport(reportDir, "verify-failed", report);
      console.error(`[migration] Verification failed with error`);
      console.error(`[migration] Report written to: ${path}`);
      process.exit(1);
    }
    return;
  }

  if (command === "rollback") {
    const migrationRunId = runIdArg;
    if (!migrationRunId) {
      console.error("--migration-run-id=<uuid> is required for rollback");
      process.exit(1);
    }
    console.error(`[migration] Rolling back run: ${migrationRunId}`);
    try {
      const stats = await rollbackMigration({
        migrationRunId,
        client,
        ownerUserId,
      });
      const report = { migrationRunId, stats };
      const path = writeReport(reportDir, "rollback", report);
      console.error(`[migration] Rollback complete: deleted ${stats.deletedRecords} records, ${stats.deletedImports} imports`);
      console.error(`[migration] Report written to: ${path}`);
    } catch (error) {
      const report = { migrationRunId, error: redactError(error) };
      const path = writeReport(reportDir, "rollback-failed", report);
      console.error(`[migration] Rollback failed`);
      console.error(`[migration] Report written to: ${path}`);
      process.exit(1);
    }
    return;
  }

  printUsage();
  process.exit(1);
}

main().catch((error) => {
  console.error("[migration] Fatal error:", redactError(error).message);
  process.exit(1);
});
