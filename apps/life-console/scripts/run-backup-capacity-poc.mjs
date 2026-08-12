import { performance } from "node:perf_hooks";
import { createZip } from "../worker/lib/maintenance.js";

const profiles = [
  { name: "S", targetBytes: 1 * 1024 * 1024 },
  { name: "M", targetBytes: 4 * 1024 * 1024 },
  { name: "L", targetBytes: 8 * 1024 * 1024 },
];

function canonicalSyntheticNdjson(targetBytes) {
  const lines = [];
  let bytes = 0;
  for (let index = 0; bytes < targetBytes; index += 1) {
    const line = JSON.stringify({
      id: `synthetic-${String(index).padStart(8, "0")}`,
      note: `合成容量数据-${index % 997}-🙂-${(index * 2654435761 >>> 0).toString(16)}`,
      revision: index % 7,
    }) + "\n";
    lines.push(line);
    bytes += Buffer.byteLength(line);
  }
  return lines.join("");
}

const requestedProfile = process.argv[2];
const selectedProfiles = requestedProfile
  ? profiles.filter((profile) => profile.name === requestedProfile)
  : profiles;
if (selectedProfiles.length === 0) {
  throw new Error("profile must be S, M, or L");
}

const results = [];
for (const profile of selectedProfiles) {
  const data = canonicalSyntheticNdjson(profile.targetBytes);
  const before = process.memoryUsage().heapUsed;
  const rssBefore = process.memoryUsage().rss;
  const started = performance.now();
  const archive = createZip({
    "manifest.json": JSON.stringify({
      format_version: "life-console-poc/1",
      profile: profile.name,
      synthetic: true,
    }),
    "data/synthetic.ndjson": data,
  });
  const elapsedMs = performance.now() - started;
  const after = process.memoryUsage().heapUsed;
  const rssAfter = process.memoryUsage().rss;
  results.push({
    profile: profile.name,
    input_bytes: Buffer.byteLength(data),
    archive_bytes: archive.byteLength,
    elapsed_ms: Number(elapsedMs.toFixed(2)),
    heap_delta_bytes: Math.max(0, after - before),
    rss_delta_bytes: Math.max(0, rssAfter - rssBefore),
  });
}

process.stdout.write(`${JSON.stringify({ synthetic: true, results }, null, 2)}\n`);
