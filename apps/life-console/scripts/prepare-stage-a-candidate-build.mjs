import { copyFile, cp, mkdir, readdir, rm, stat } from "node:fs/promises";

const clientDirectory = "dist/client";
const serverDirectory = "dist/server";
const workerSource = "worker/stage-a-candidate.js";
const workerTarget = `${serverDirectory}/index.js`;

await stat(`${clientDirectory}/index.html`);
await stat(workerSource);

for (const entry of await readdir("dist")) {
  if (entry !== "client") {
    await rm(`dist/${entry}`, { recursive: true, force: true });
  }
}
await mkdir(`${serverDirectory}/lib`, { recursive: true });
await copyFile(workerSource, workerTarget);
await cp("worker/lib", `${serverDirectory}/lib`, { recursive: true });
