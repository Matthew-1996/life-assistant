import { copyFile, cp, mkdir, rm, stat } from "node:fs/promises";

const clientDirectory = "dist/client";
const serverDirectory = "dist/server";
const workerSource = "worker/sites-200.js";
const workerTarget = `${serverDirectory}/index.js`;
const legacySnapshot = `${clientDirectory}/life-console-snapshot.json`;

await stat(`${clientDirectory}/index.html`);
await stat(workerSource);

await rm(legacySnapshot, { force: true });
await rm(serverDirectory, { recursive: true, force: true });
await mkdir(serverDirectory, { recursive: true });
await copyFile(workerSource, workerTarget);
await cp("worker/lib", `${serverDirectory}/lib`, { recursive: true });
await cp("worker/routes", `${serverDirectory}/routes`, { recursive: true });
