import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";

await stat("dist/client/index.html");
try {
  await stat("dist/client/life-console-snapshot.json");
} catch {
  const synthetic = JSON.parse(
    await readFile("contracts/fixtures/dashboard.synthetic.json", "utf8"),
  );
  synthetic.records.recent_journals = [];
  synthetic.source_revisions = {
    daily: "redacted",
    journal: "redacted",
    goals: "redacted",
  };
  await writeFile(
    "dist/client/life-console-snapshot.json",
    `${JSON.stringify(synthetic)}\n`,
    { mode: 0o600 },
  );
}

const snapshot = JSON.parse(
  await readFile("dist/client/life-console-snapshot.json", "utf8"),
);
if (
  snapshot?.schema_version !== 1
  || !Array.isArray(snapshot?.records?.recent_journals)
  || snapshot.records.recent_journals.length !== 0
  || Object.values(snapshot?.source_revisions ?? {}).some((value) => value !== "redacted")
) {
  throw new Error("Sites snapshot violates the read-only privacy projection");
}
await mkdir("dist/server", { recursive: true });
await copyFile("worker/sites.js", "dist/server/index.js");
