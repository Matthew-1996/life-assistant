import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const journalManager = path.join(scriptDir, "journal_manager.py");
const workbookSync = path.join(scriptDir, "update_life_plan_journal.mjs");
const formalWorkbook = path.join(
  projectRoot,
  "outputs/019fb832-be4f-74f1-add5-58cb6fb6fc09/生活计划表.xlsx",
);
const realJournalRoot = path.join(projectRoot, "journal");
const pythonExecutable = process.env.PYTHON ?? "python3";
const formulaErrorPattern = /#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A/;

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function fileHash(filePath) {
  return sha256(await fs.readFile(filePath));
}

function syncReceiptPath(workbookPath) {
  const extension = path.extname(workbookPath);
  return path.join(
    path.dirname(workbookPath),
    `${path.basename(workbookPath, extension)}.sync-state.json`,
  );
}

async function sourceReceiptState(filePath) {
  try {
    const stat = await fs.lstat(filePath);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), "同步源必须是普通文件");
    return { present: true, sha256: await fileHash(filePath) };
  } catch (error) {
    if (error?.code === "ENOENT") return { present: false, sha256: null };
    throw error;
  }
}

async function assertPortableSyncReceipt(workbookPath, journalRoot, recordsRoot, privateValues) {
  const receiptPath = syncReceiptPath(workbookPath);
  const receiptBytes = await fs.readFile(receiptPath);
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  assert.deepEqual(Object.keys(receipt).sort(), [
    "schema_version", "sources", "synced_at", "workbook_sha256",
  ]);
  assert.equal(receipt.schema_version, 1);
  assert.match(receipt.workbook_sha256, /^[0-9a-f]{64}$/);
  assert.equal(receipt.workbook_sha256, await fileHash(workbookPath));
  assert.match(receipt.synced_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.deepEqual(Object.keys(receipt.sources).sort(), ["daily", "journal", "weekly"]);
  const expected = {
    journal: {
      path_category: "journal-index-jsonl",
      ...await sourceReceiptState(path.join(journalRoot, "index.jsonl")),
    },
    daily: {
      path_category: "daily-checkins-jsonl",
      ...await sourceReceiptState(path.join(recordsRoot, "daily-checkins.jsonl")),
    },
    weekly: {
      path_category: "weekly-reviews-jsonl",
      ...await sourceReceiptState(path.join(recordsRoot, "weekly-reviews.jsonl")),
    },
  };
  assert.deepEqual(receipt.sources, expected);
  for (const source of Object.values(receipt.sources)) {
    assert.deepEqual(Object.keys(source).sort(), ["path_category", "present", "sha256"]);
    assert.ok(!path.isAbsolute(source.path_category), "收据不得包含绝对路径");
  }
  const serialized = receiptBytes.toString("utf8");
  assert.ok(!serialized.includes(projectRoot), "收据不得包含项目绝对路径");
  assert.ok(!serialized.includes(journalRoot), "收据不得包含隔离日记绝对路径");
  assert.ok(!serialized.includes(recordsRoot), "收据不得包含隔离台账绝对路径");
  for (const privateValue of privateValues) {
    assert.ok(!serialized.includes(privateValue), "收据不得包含原文或私密摘要");
  }
  const receiptMode = (await fs.stat(receiptPath)).mode & 0o777;
  assert.equal(receiptMode, 0o600, "同步收据权限应为 0600");
  const workbookMode = (await fs.stat(workbookPath)).mode & 0o777;
  assert.equal(workbookMode, 0o600, "同步生成的工作簿权限应为 0600");
  const directoryNames = await fs.readdir(path.dirname(workbookPath));
  const workbookBase = path.basename(workbookPath);
  const receiptBase = path.basename(receiptPath);
  assert.deepEqual(
    directoryNames.filter((name) => (
      name.startsWith(`.${workbookBase}.sync-`)
      || name.startsWith(`.${receiptBase}.sync-`)
    )),
    [],
    "同步成功后不得残留工作簿或收据临时文件",
  );
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function treeHash(root) {
  const items = [];

  async function walk(current, relative) {
    let children;
    try {
      children = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        items.push(`missing\0${relative}`);
        return;
      }
      throw error;
    }
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const childRelative = relative ? `${relative}/${child.name}` : child.name;
      const childPath = path.join(current, child.name);
      if (child.isDirectory()) {
        items.push(`directory\0${childRelative}`);
        await walk(childPath, childRelative);
      } else if (child.isFile()) {
        items.push(`file\0${childRelative}\0${await fileHash(childPath)}`);
      } else if (child.isSymbolicLink()) {
        items.push(`symlink\0${childRelative}\0${await fs.readlink(childPath)}`);
      } else {
        items.push(`other\0${childRelative}`);
      }
    }
  }

  await walk(root, "");
  return sha256(Buffer.from(items.join("\n"), "utf8"));
}

function runProcess(command, args, { input = null, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(
        `${command} ${args.join(" ")} failed (code=${code}, signal=${signal ?? "none"})\n`
        + `stdout:\n${stdout}\nstderr:\n${stderr}`,
      ));
    });
    child.stdin.end(input ?? undefined);
  });
}

function containsKey(value, wanted) {
  if (Array.isArray(value)) return value.some((item) => containsKey(item, wanted));
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, item]) => key === wanted || containsKey(item, wanted),
  );
}

function assertOutputDoesNotContainRaw(result, rawValues, label) {
  for (const raw of rawValues) {
    assert.ok(!result.stdout.includes(raw), `${label} stdout 不得包含 raw 原文`);
    assert.ok(!result.stderr.includes(raw), `${label} stderr 不得包含 raw 原文`);
  }
}

async function runJournal(root, command, args = [], payload = null, rawValues = []) {
  const commandArgs = ["-B", journalManager, command];
  if (payload !== null) commandArgs.push("--input", "-");
  commandArgs.push("--root", root, ...args);
  const result = await runProcess(pythonExecutable, commandArgs, {
    input: payload === null ? null : JSON.stringify(payload),
  });
  assertOutputDoesNotContainRaw(result, rawValues, `journal_manager ${command}`);
  const parsed = JSON.parse(result.stdout);
  assert.ok(!containsKey(parsed, "raw"), `journal_manager ${command} 输出不得含 raw 字段`);
  return { ...result, parsed };
}

async function runWorkbookSync(
  inputPath,
  outputPath,
  previewDir,
  journalRoot,
  recordsRoot,
  rawValues,
  env = {},
) {
  const result = await runProcess(process.execPath, [
    workbookSync,
    inputPath,
    outputPath,
    previewDir,
    journalRoot,
    recordsRoot,
  ], { env });
  assertOutputDoesNotContainRaw(result, rawValues, "workbook sync");
  return result;
}

function entry(overrides) {
  return {
    date: "2026-08-01",
    time: "20:15",
    time_precision: "exact",
    title: "精确时间记录",
    source: "explicit",
    privacy: "local-only",
    raw: "RAW-E2E-EXACT：这是只应进入隔离原文归档的合成内容。",
    summary: "旧摘要不应在更正后继续出现。",
    facts: ["旧事实"],
    feelings: ["旧感受"],
    people: ["旧人物"],
    places: ["旧地点"],
    themes: ["旧主题"],
    tags: ["旧标签"],
    planning_clues: ["旧规划线索"],
    inferences: ["旧待确认推测"],
    ...overrides,
  };
}

function rowMap(values) {
  const rows = new Map();
  for (const row of values.slice(1)) {
    if (typeof row?.[2] === "string" && row[2]) rows.set(row[2], row);
  }
  return rows;
}

function isBlank(value) {
  return value === null || value === "" || value === undefined;
}

async function workbookEvidence(workbookPath, rawValues) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
  const journal = workbook.worksheets.getItem("日记索引");
  const journalValues = journal.getRange("A10:J25").values ?? [];

  const sheetInspect = await workbook.inspect({
    kind: "sheet",
    include: "id,name",
    maxChars: 5000,
  });
  const sheetNames = sheetInspect.ndjson
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line).name)
    .filter(Boolean);
  const allValues = [];
  for (const sheetName of sheetNames) {
    const usedRange = workbook.worksheets.getItem(sheetName).getUsedRange();
    if (usedRange?.values) allValues.push(...usedRange.values.flat(2));
  }
  const serializedValues = JSON.stringify(allValues);
  for (const raw of rawValues) {
    assert.ok(!serializedValues.includes(raw), `xlsx 单元格不得包含 raw 原文：${raw}`);
  }
  const formulaErrors = allValues.filter(
    (value) => typeof value === "string" && formulaErrorPattern.test(value),
  );
  assert.deepEqual(formulaErrors, [], "xlsx 不得含公式错误");
  return { workbook, rows: rowMap(journalValues), allValues };
}

const exactRaw = entry({}).raw;
const unknownRaw = "RAW-E2E-UNKNOWN：只知道发生日期，不知道具体时刻。";
const approximateRaw = "RAW-E2E-APPROX：大约九点散步，不应被伪装成精确时间。";
const lateBackfillRaw = "RAW-E2E-LATE-BACKFILL：这是最后录入但发生更早的隐式记录。";
const rawValues = [exactRaw, unknownRaw, approximateRaw, lateBackfillRaw];

const formalWorkbookBefore = await fileHash(formalWorkbook);
const realJournalBefore = await treeHash(realJournalRoot);
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "journal-workbook-e2e-"));

try {
  const isolatedJournal = path.join(tempRoot, "journal");
  const isolatedRecords = path.join(tempRoot, "records");
  const templateWorkbook = path.join(tempRoot, "template.xlsx");
  const withdrawnWorkbook = path.join(tempRoot, "withdrawn.xlsx");
  const reviewedWorkbook = path.join(tempRoot, "reviewed.xlsx");
  await fs.mkdir(isolatedRecords, { recursive: true });
  await fs.copyFile(formalWorkbook, templateWorkbook);

  const exact = await runJournal(
    isolatedJournal,
    "add",
    [],
    entry({}),
    rawValues,
  );
  const unknown = await runJournal(
    isolatedJournal,
    "add",
    [],
    entry({
      date: "2026-08-02",
      time: null,
      time_precision: "unknown",
      title: "时间未知的隐式记录",
      source: "implicit",
      raw: unknownRaw,
      summary: "只保留用户确定的日期。",
      facts: ["发生在 2026-08-02"],
      feelings: [],
      people: [],
      places: ["家附近"],
      themes: ["生活记录"],
      tags: ["时间未知"],
      planning_clues: [],
      inferences: [],
    }),
    rawValues,
  );
  const approximate = await runJournal(
    isolatedJournal,
    "add",
    [],
    entry({
      date: "2026-07-31",
      time: "21:00",
      time_precision: "approximate",
      title: "大约九点的明确记录",
      source: "explicit",
      raw: approximateRaw,
      summary: "保留九点左右的精度。",
      facts: ["大约 21:00 散步"],
      feelings: ["平静"],
      people: ["自己"],
      places: ["小区"],
      themes: ["恢复"],
      tags: ["散步"],
      planning_clues: ["观察轻活动的感受"],
      inferences: [],
    }),
    rawValues,
  );
  // 兼容 recorded_at 只保留到秒的旧版实现，保证最后补记的
  // implicit 条目在记录时间上严格晚于前一条。
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const lateBackfill = await runJournal(
    isolatedJournal,
    "add",
    [],
    entry({
      date: "2026-07-30",
      time: "18:10",
      time_precision: "exact",
      title: "最后录入的较早隐式记录",
      source: "implicit",
      raw: lateBackfillRaw,
      summary: "较早事件在最后才被补记。",
      facts: ["2026-07-30 18:10 发生一段经历"],
      feelings: ["放松"],
      people: ["朋友"],
      places: ["餐厅"],
      themes: ["关系"],
      tags: ["补记"],
      planning_clues: [],
      inferences: [],
    }),
    rawValues,
  );

  const amendedTitle = "精确时间记录（已完整更正）";
  await runJournal(
    isolatedJournal,
    "amend",
    [],
    {
      id: exact.parsed.id,
      note: "完整重建这条记录的轻量索引。",
      privacy: "local-only",
      title: amendedTitle,
      summary: "新摘要只保留更正后的说法。",
      facts: ["新事实"],
      feelings: ["新感受"],
      people: ["新人物"],
      places: ["新地点"],
      themes: ["新主题"],
      tags: ["新标签"],
      planning_clues: ["新规划线索"],
      inferences: ["新待确认推测"],
    },
    rawValues,
  );

  const withdrawn = await runJournal(
    isolatedJournal,
    "withdraw-latest-implicit",
    [],
    null,
    rawValues,
  );
  assert.equal(withdrawn.parsed.id, lateBackfill.parsed.id);
  assert.equal(withdrawn.parsed.resolved_by, "latest_recorded_implicit");

  const indexBeforeSync = await fs.readFile(
    path.join(isolatedJournal, "index.jsonl"),
    "utf8",
  );
  assert.ok(!/"raw"\s*:/.test(indexBeforeSync), "index.jsonl 不得含 raw 字段");
  for (const raw of rawValues) assert.ok(!indexBeforeSync.includes(raw));
  for (const stale of ["旧摘要不应在更正后继续出现。", "旧人物", "旧地点"] ) {
    assert.ok(!indexBeforeSync.includes(stale), `完整 reindex 后不得残留：${stale}`);
  }

  await runWorkbookSync(
    templateWorkbook,
    withdrawnWorkbook,
    path.join(tempRoot, "preview-withdrawn"),
    isolatedJournal,
    isolatedRecords,
    rawValues,
  );
  await assertPortableSyncReceipt(
    withdrawnWorkbook,
    isolatedJournal,
    isolatedRecords,
    rawValues,
  );
  const firstWorkbook = await workbookEvidence(withdrawnWorkbook, rawValues);
  assert.equal(firstWorkbook.rows.size, 3);
  assert.ok(!firstWorkbook.rows.has(lateBackfill.parsed.title));
  assert.ok(isBlank(firstWorkbook.rows.get(unknown.parsed.title)[1]));
  assert.equal(firstWorkbook.rows.get(approximate.parsed.title)[1], "约 21:00");
  assert.equal(typeof firstWorkbook.rows.get(amendedTitle)[1], "number");
  assert.ok(
    Math.abs(firstWorkbook.rows.get(amendedTitle)[1] - ((20 * 60 + 15) / 1440)) < 1e-10,
  );
  for (const row of firstWorkbook.rows.values()) assert.equal(row[9], "待整理");
  const firstWorkbookText = JSON.stringify(firstWorkbook.allValues);
  for (const stale of ["旧摘要不应在更正后继续出现。", "旧人物", "旧地点"]) {
    assert.ok(!firstWorkbookText.includes(stale), `工作簿不得残留旧索引：${stale}`);
  }

  const restored = await runJournal(
    isolatedJournal,
    "restore",
    ["--id", lateBackfill.parsed.id],
    null,
    rawValues,
  );
  assert.equal(restored.parsed.status, "restored");

  const plan = await runJournal(
    isolatedJournal,
    "review-plan",
    ["--type", "weekly", "--as-of", "2026-08-03"],
    null,
    rawValues,
  );
  assert.equal(plan.parsed.due.length, 1);
  const due = plan.parsed.due[0];
  assert.deepEqual([due.start, due.end], ["2026-07-27", "2026-08-02"]);
  assert.match(due.source_set_etag, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    new Set(due.entry_ids),
    new Set([
      exact.parsed.id,
      unknown.parsed.id,
      approximate.parsed.id,
      lateBackfill.parsed.id,
    ]),
  );

  const review = await runJournal(
    isolatedJournal,
    "review",
    [],
    {
      type: "weekly",
      start: due.start,
      end: due.end,
      title: "隔离端到端周回顾",
      entry_ids: due.entry_ids,
      source_set_etag: due.source_set_etag,
      events: ["四条合成生活记录"],
      replenishing: ["轻量活动"],
      draining: [],
      recurring: ["保留用户表达的时间精度"],
      open_threads: [],
      planning_implications: ["继续使用低负担记录"],
      candidate_memories: [],
      privacy: "local-only",
    },
    rawValues,
  );
  const finalPlan = await runJournal(
    isolatedJournal,
    "review-plan",
    ["--type", "weekly", "--as-of", "2026-08-03"],
    null,
    rawValues,
  );
  assert.deepEqual(finalPlan.parsed.due, []);

  const finalIndex = await fs.readFile(path.join(isolatedJournal, "index.jsonl"), "utf8");
  assert.ok(!/"raw"\s*:/.test(finalIndex), "最终 index.jsonl 不得含 raw 字段");
  for (const raw of rawValues) assert.ok(!finalIndex.includes(raw));

  const reviewText = await fs.readFile(path.join(isolatedJournal, review.parsed.file), "utf8");
  assert.match(reviewText, /2026-07-30 18:10｜/);
  assert.match(reviewText, /2026-07-31 约 21:00｜/);
  assert.match(reviewText, /2026-08-01 20:15｜/);
  assert.match(reviewText, /2026-08-02 时间未知｜/);
  assert.ok(!reviewText.includes(" None｜"));
  for (const raw of rawValues) assert.ok(!reviewText.includes(raw));

  await runWorkbookSync(
    withdrawnWorkbook,
    reviewedWorkbook,
    path.join(tempRoot, "preview-reviewed"),
    isolatedJournal,
    isolatedRecords,
    rawValues,
  );
  await assertPortableSyncReceipt(
    reviewedWorkbook,
    isolatedJournal,
    isolatedRecords,
    rawValues,
  );
  const finalWorkbook = await workbookEvidence(reviewedWorkbook, rawValues);
  assert.equal(finalWorkbook.rows.size, 4);
  for (const title of [
    amendedTitle,
    unknown.parsed.title,
    approximate.parsed.title,
    lateBackfill.parsed.title,
  ]) {
    assert.equal(finalWorkbook.rows.get(title)[9], "已纳入周回顾");
  }
  assert.ok(isBlank(finalWorkbook.rows.get(unknown.parsed.title)[1]));
  assert.equal(finalWorkbook.rows.get(approximate.parsed.title)[1], "约 21:00");
  assert.equal(typeof finalWorkbook.rows.get(amendedTitle)[1], "number");
  assert.equal(typeof finalWorkbook.rows.get(lateBackfill.parsed.title)[1], "number");

  const privatePreviewBase = path.join(tempRoot, "private-preview-tmp");
  const privatePreviewWorkbook = path.join(tempRoot, "reviewed-private-preview.xlsx");
  await fs.mkdir(privatePreviewBase, { mode: 0o700 });
  await runWorkbookSync(
    reviewedWorkbook,
    privatePreviewWorkbook,
    "-",
    isolatedJournal,
    isolatedRecords,
    rawValues,
    { TMPDIR: privatePreviewBase },
  );
  assert.deepEqual(
    await fs.readdir(privatePreviewBase),
    [],
    "私密临时预览目录应在同步成功后清理",
  );
  await assertPortableSyncReceipt(
    privatePreviewWorkbook,
    isolatedJournal,
    isolatedRecords,
    rawValues,
  );
  await workbookEvidence(privatePreviewWorkbook, rawValues);

  const driftInput = path.join(tempRoot, "drift-input.xlsx");
  const driftOutput = path.join(tempRoot, "drift-output.xlsx");
  const driftPreview = path.join(tempRoot, "drift-preview");
  await fs.copyFile(reviewedWorkbook, driftInput);
  const driftRun = runWorkbookSync(
    driftInput,
    driftOutput,
    driftPreview,
    isolatedJournal,
    isolatedRecords,
    rawValues,
  ).then(
    () => ({ ok: true, error: null }),
    (error) => ({ ok: false, error }),
  );
  let renderingObserved = false;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      const names = await fs.readdir(driftPreview);
      if (names.some((name) => name.endsWith(".png"))) {
        renderingObserved = true;
        break;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(renderingObserved, "应在发布前观察到隔离预览渲染阶段");
  await fs.writeFile(path.join(isolatedRecords, "daily-checkins.jsonl"), "", { mode: 0o600 });
  const driftResult = await driftRun;
  assert.equal(driftResult.ok, false, "源存在性漂移时同步必须失败");
  assert.match(String(driftResult.error?.message), /源台账.*变更/);
  for (const raw of rawValues) {
    assert.ok(!String(driftResult.error?.message).includes(raw));
  }
  assert.equal(await pathExists(driftOutput), false, "源漂移时不得发布工作簿");
  assert.equal(
    await pathExists(syncReceiptPath(driftOutput)),
    false,
    "源漂移时不得发布同步收据",
  );
  const driftDirectoryNames = await fs.readdir(tempRoot);
  assert.deepEqual(
    driftDirectoryNames.filter((name) => (
      name.startsWith(".drift-output.xlsx.sync-")
      || name.startsWith(".drift-output.sync-state.json.sync-")
    )),
    [],
    "源漂移失败后不得残留发布临时文件",
  );

} finally {
  let integrityError = null;
  try {
    assert.equal(
      await fileHash(formalWorkbook),
      formalWorkbookBefore,
      "隔离测试不得修改正式工作簿",
    );
    assert.equal(
      await treeHash(realJournalRoot),
      realJournalBefore,
      "隔离测试不得修改真实 journal/ 树",
    );
  } catch (error) {
    integrityError = error;
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
  if (integrityError !== null) throw integrityError;
}

await assert.rejects(
  fs.access(tempRoot),
  (error) => error?.code === "ENOENT",
  "端到端测试必须清理 mkdtemp 隔离目录",
);

console.log("journal workbook e2e test passed");
