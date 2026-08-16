import {
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createLifeConsoleVercelConfig } from "./supabase-candidate-config.mjs";

const outputRelativePath = ".vercel/life-console.production.json";
const outputFilename = "life-console.production.json";

function optionalLstat(path) {
  return lstatSync(path, { throwIfNoEntry: false });
}

function assertRegularOutputOrMissing(outputPath) {
  const outputStat = optionalLstat(outputPath);
  if (outputStat?.isSymbolicLink()) {
    throw new Error(`${outputFilename} must not be a symbolic link`);
  }
  if (outputStat && !outputStat.isFile()) {
    throw new Error(`${outputFilename} must be a regular file`);
  }
}

function assertTrustedParent(parent) {
  const currentStat = optionalLstat(parent.requested);
  if (!currentStat) {
    throw new Error(".vercel disappeared during config generation");
  }
  if (currentStat.isSymbolicLink()) {
    throw new Error(".vercel must not be a symbolic link");
  }
  if (!currentStat.isDirectory()) {
    throw new Error(".vercel must be a directory");
  }
  if (
    currentStat.dev !== parent.dev
    || currentStat.ino !== parent.ino
    || realpathSync(parent.requested) !== parent.resolved
  ) {
    throw new Error(".vercel changed during config generation");
  }

  const resolvedStat = lstatSync(parent.resolved);
  if (
    resolvedStat.isSymbolicLink()
    || !resolvedStat.isDirectory()
    || resolvedStat.dev !== parent.dev
    || resolvedStat.ino !== parent.ino
  ) {
    throw new Error(".vercel resolved parent is not trusted");
  }
}

function resolveOutputParent() {
  const workspaceRoot = realpathSync(process.cwd());
  const requestedParent = resolve(workspaceRoot, ".vercel");
  const initialStat = optionalLstat(requestedParent);
  if (initialStat?.isSymbolicLink()) {
    throw new Error(".vercel must not be a symbolic link");
  }
  if (initialStat && !initialStat.isDirectory()) {
    throw new Error(".vercel must be a directory");
  }
  if (!initialStat) {
    mkdirSync(requestedParent, { mode: 0o700 });
  }

  const parentStat = lstatSync(requestedParent);
  if (parentStat.isSymbolicLink()) {
    throw new Error(".vercel must not be a symbolic link");
  }
  if (!parentStat.isDirectory()) {
    throw new Error(".vercel must be a directory");
  }

  const parent = {
    requested: requestedParent,
    resolved: realpathSync(requestedParent),
    dev: parentStat.dev,
    ino: parentStat.ino,
  };
  assertTrustedParent(parent);
  return parent;
}

export function writeVercelConfig(environment = process.env) {
  const parent = resolveOutputParent();
  const outputPath = resolve(parent.resolved, outputFilename);
  const temporaryPath = resolve(
    parent.resolved,
    `.${outputFilename}.${process.pid}.${randomUUID()}.tmp`,
  );
  const serializedConfig = `${JSON.stringify(
    createLifeConsoleVercelConfig(environment),
    null,
    2,
  )}\n`;

  try {
    assertTrustedParent(parent);
    assertRegularOutputOrMissing(outputPath);
    writeFileSync(temporaryPath, serializedConfig, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    assertTrustedParent(parent);
    assertRegularOutputOrMissing(outputPath);
    renameSync(temporaryPath, outputPath);
  } finally {
    try {
      assertTrustedParent(parent);
      rmSync(temporaryPath, { force: true });
    } catch {
      // Never follow a replaced parent merely to clean up a temporary file.
    }
  }

  return outputPath;
}

function assertCliArguments(argv) {
  if (argv.length !== 2 || argv[0] !== "--write" || !argv[1]) {
    throw new Error(
      `Usage: node scripts/write-vercel-config.mjs --write ${outputRelativePath}`,
    );
  }
  if (argv[1] !== outputRelativePath) {
    throw new Error(`Output path must be ${outputRelativePath}`);
  }
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectExecution) {
  try {
    assertCliArguments(process.argv.slice(2));
    writeVercelConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
