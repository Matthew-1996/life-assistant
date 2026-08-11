import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";

const clientDirectory = "dist/client";
const serverDirectory = "dist/server";
const workerSource = "worker/candidate-preview.js";
const workerTarget = `${serverDirectory}/index.js`;

await stat(`${clientDirectory}/index.html`);
await stat(workerSource);

for (const entry of await readdir("dist")) {
  if (entry !== "client") {
    await rm(`dist/${entry}`, { recursive: true, force: true });
  }
}
await rm(serverDirectory, { recursive: true, force: true });
await mkdir(serverDirectory, { recursive: true });
await copyFile(workerSource, workerTarget);
