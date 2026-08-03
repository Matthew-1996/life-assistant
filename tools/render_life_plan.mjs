import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = process.argv[2];
const outputDir = process.argv[3];

if (!inputPath || !outputDir) {
  throw new Error("Usage: node render_life_plan.mjs <input.xlsx> <output-dir>");
}

await fs.mkdir(outputDir, { recursive: true });
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));

const summary = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 8000,
  tableMaxRows: 8,
  tableMaxCols: 16,
  tableMaxCellChars: 120,
});
console.log(summary.ndjson);

const sheetSummary = await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 4000 });
const sheetNames = [];
for (const line of sheetSummary.ndjson.split("\n")) {
  if (!line.trim()) continue;
  const item = JSON.parse(line);
  if (item.name) sheetNames.push(item.name);
}

for (const sheetName of sheetNames) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  const safeName = sheetName.replaceAll(/[\\/:*?"<>|]/g, "_");
  await fs.writeFile(path.join(outputDir, `${safeName}.png`), new Uint8Array(await preview.arrayBuffer()));
}

console.log(`Rendered ${sheetNames.length} sheets to ${outputDir}`);
