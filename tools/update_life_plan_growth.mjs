import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = process.argv[2];
const outputPath = process.argv[3] ?? inputPath;
const previewDir = process.argv[4];

if (!inputPath || !outputPath) {
  throw new Error("Usage: node update_life_plan_growth.mjs <input.xlsx> [output.xlsx] [preview-dir]");
}

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const navy = "#193752";
const teal = "#2A9D8F";
const tealPale = "#E4F3EF";
const bluePale = "#E8F1F8";
const sagePale = "#E8F0E7";
const goldPale = "#F5EEDF";
const coralPale = "#F9E7E1";
const yellowPale = "#FFF4C7";
const paper = "#F6F1E8";
const white = "#FFFFFF";
const ink = "#193752";
const body = "#40576B";
const line = "#D5DFE6";

function setMerged(sheet, address, value, format = {}) {
  const range = sheet.getRange(address);
  range.merge();
  range.values = [[value]];
  range.format = format;
  return range;
}

function sectionBand(sheet, address, title) {
  return setMerged(sheet, address, title, {
    fill: teal,
    font: { bold: true, color: white, size: 12 },
    verticalAlignment: "center",
    horizontalAlignment: "left",
  });
}

const overview = workbook.worksheets.getItem("总览");
sectionBand(overview, "A30:O30", "候选分支｜阶段复盘后也只启用一条");
const cardHeaders = [
  ["A31:E31", "健身分支｜仅选中后启用", teal],
  ["F31:J31", "生活体验｜每周只选一个", "#7A9E7E"],
  ["K31:O31", "职业分支｜仅选中后启用", "#5B8DB8"],
];
for (const [address, value, fill] of cardHeaders) {
  setMerged(overview, address, value, {
    fill,
    font: { bold: true, color: white, size: 11 },
    horizontalAlignment: "left",
    verticalAlignment: "center",
  });
}

const overviewCards = [
  ["A32:E32", "现在｜轻活动属于恢复锚点；不排训练任务", tealPale],
  ["A33:E33", "8/14｜只有选择健身，才分批补身体与现实条件", tealPale],
  ["A34:E34", "选中后｜准备度允许再试每周 2 次低量熟悉", tealPale],
  ["A35:E35", "持续选择｜按真实反馈设计 4–6 周小实验", tealPale],
  ["F32:J32", "规则｜低目的外出、关系、环境、兴趣四选一", sagePale],
  ["F33:J33", "本周｜只选最想要或最容易的一项，不累计", sagePale],
  ["F34:J34", "最低版｜下楼、通话 10 分钟或整理一个表面", sagePale],
  ["F35:J35", "删减规则｜一旦挤压睡眠或恢复，先缩小或暂停", sagePale],
  ["K32:O32", "现在｜不排职业任务；经验可随手交给助手保存", bluePale],
  ["K33:O33", "8/14｜只有选择职业，才开始去敏素材整理", bluePale],
  ["K34:O34", "选中后｜方向假设 + 访谈或一个小实验", bluePale],
  ["K35:O35", "持续选择｜有证据后再做 6 周验证冲刺", bluePale],
];
for (const [address, value, fill] of overviewCards) {
  setMerged(overview, address, value, {
    fill,
    font: { color: body, size: 10 },
    wrapText: true,
    verticalAlignment: "center",
    horizontalAlignment: "left",
    borders: { preset: "outside", style: "thin", color: line },
  });
}
setMerged(overview, "A37:O37", "8/14 只选择健身、职业或都先不聊；未选中的分支不排期、不提醒。单个执行目标或连续工作块原则上 ≤4 小时，超出先拆分、标明主次并商量。", {
  fill: paper,
  font: { italic: true, color: body, size: 10 },
  wrapText: true,
  verticalAlignment: "center",
});
overview.getRange("30:30").format.rowHeight = 26;
overview.getRange("31:31").format.rowHeight = 27;
overview.getRange("32:35").format.rowHeight = 27;
overview.getRange("36:36").format.rowHeight = 10;
overview.getRange("37:37").format.rowHeight = 42;

const route = workbook.worksheets.getItem("阶段路线");
route.getRange("F5:F9").values = [
  ["每天早晨可选 1 分钟记录；健身和职业两条候选分支都不排期。"],
  ["只启用阶段复盘明确选择的一条：健身低量熟悉、职业去敏素材整理，或都不启用。"],
  ["只继续已选分支的最低有效版本；另一条保持候选且不排期。"],
  ["只把健身或职业中的一条升级为辅助目标；另一条保持最低版或候选。"],
  ["为选中的下一重点设计一个 4–6 周小实验，写清成功、停止与复盘条件。"],
];
route.getRange("H5:H9").values = [
  ["高强度健身、完整训练处方、系统学习、完整职业规划、补打卡。"],
  ["直接加大训练量；深夜做职业决策；新增长期承诺；用周末补偿全部工作。"],
  ["把休息排满；立刻建立完美新作息；用高强度求职替代恢复。"],
  ["同时把两条候选轨道都升级；用忙碌证明离职选择。"],
  ["因为焦虑一次选择所有目标；把暂停或改变方向视为失败。"],
];
route.getRange("F5:H9").format.wrapText = true;

const guide = workbook.worksheets.getItem("使用说明");
sectionBand(guide, "A35:H35", "新增候选轨道的使用规则");
const guideRows = [
  ["A36:B36", "互斥开关", "C36:H36", "8/14 只选择健身、职业或都先不聊；未选中的分支不排期、不提醒，日期到达也不自动启动。", yellowPale],
  ["A37:B37", "长期方向", "C37:H37", "每周 150–300 分钟中等强度有氧和至少 2 天力量训练是公共健康长期方向，不是现在的立即任务。", tealPale],
  ["A38:B38", "职业状态", "C38:H38", "只有选择职业分支后才安排去敏素材整理；未选择时只在自然想起时交给助手保存，不设数量任务。", bluePale],
  ["A39:B39", "生活活动", "C39:H39", "低目的外出、关系连接、20 分钟环境整理、兴趣或创作每周只选一个，不累计。", sagePale],
];
for (const [leftAddr, leftValue, rightAddr, rightValue, fill] of guideRows) {
  setMerged(guide, leftAddr, leftValue, {
    fill,
    font: { bold: true, color: ink, size: 10 },
    verticalAlignment: "center",
  });
  setMerged(guide, rightAddr, rightValue, {
    fill: white,
    font: { color: body, size: 10 },
    wrapText: true,
    verticalAlignment: "center",
    borders: { preset: "outside", style: "thin", color: line },
  });
}
setMerged(guide, "A40:B40", "主次与时长", {
  fill: goldPale,
  font: { bold: true, color: ink, size: 10 },
  verticalAlignment: "center",
});
setMerged(guide, "C40:H40", "每个阶段先定一个主项；单个可执行目标或连续工作块原则上不超过 4 小时。预计超出时先拆分并商量，其余标为次项、可延后、可合并或不做。", {
  fill: white,
  font: { color: body, size: 10 },
  wrapText: true,
  verticalAlignment: "center",
  borders: { preset: "outside", style: "thin", color: line },
});
sectionBand(guide, "A41:H41", "新增依据");
const sources = [
  ["A42:C42", "WHO｜身体活动指南", "D42:H42", "https://www.who.int/europe/publications/i/item/9789240014886"],
  ["A43:C43", "CDC｜成年人如何开始活动", "D43:H43", "https://www.cdc.gov/physical-activity-basics/adding-adults/index.html"],
  ["A44:C44", "AHA｜活动警示信号", "D44:H44", "https://www.heart.org/en/health-topics/cardiac-rehab/getting-physically-active/develop-a-physical-activity-plan-for-you"],
  ["A45:C45", "详细扩展路线", "D45:H45", "plans/2026-08-01-生活扩展路线图.md"],
];
for (const [leftAddr, leftValue, rightAddr, rightValue] of sources) {
  setMerged(guide, leftAddr, leftValue, {
    fill: "#F2F4F6",
    font: { bold: true, color: ink, size: 9 },
    verticalAlignment: "center",
  });
  setMerged(guide, rightAddr, rightValue, {
    fill: white,
    font: { color: body, size: 9 },
    wrapText: true,
    verticalAlignment: "center",
  });
}
guide.getRange("35:35").format.rowHeight = 25;
guide.getRange("36:39").format.rowHeight = 34;
guide.getRange("40:40").format.rowHeight = 40;
guide.getRange("41:41").format.rowHeight = 25;
guide.getRange("42:45").format.rowHeight = 30;

const growth = workbook.worksheets.getOrAdd("扩展规划");
growth.showGridLines = false;
growth.getRange("A1:I32").clear({ applyTo: "all" });
growth.getRange("A1:I1").merge();
growth.getRange("A1").values = [["扩展规划｜健身、生活体验与职业探索"]];
growth.getRange("A1:I1").format = {
  fill: navy,
  font: { bold: true, color: white, size: 20 },
  verticalAlignment: "center",
  horizontalAlignment: "left",
};
setMerged(growth, "A2:I2", "当前重点仍是睡眠与生活体验。8/14 只选择健身、职业或都先不聊；未选中的分支不排期、不提醒。", {
  fill: bluePale,
  font: { color: body, size: 10 },
  wrapText: true,
  verticalAlignment: "center",
});

growth.getRange("A4:I4").values = [["阶段", "日期", "健身分支", "健身内容（选中后）", "启用条件", "生活体验菜单", "职业分支", "职业内容（选中后）", "检查点"]];
growth.getRange("A4:I4").format = {
  fill: navy,
  font: { bold: true, color: white, size: 10 },
  wrapText: true,
  horizontalAlignment: "center",
  verticalAlignment: "center",
  borders: { preset: "inside", style: "thin", color: "#FFFFFF" },
};
growth.getRange("A5:I9").values = [
  ["阶段 1", "8/01–8/14", "未启用", "散步、见光和轻活动仍属恢复锚点，不代表训练分支启动。", "8/14 明确选择健身，并愿意后续分批补充身体与现实条件。", "四选一：低目的外出 / 关系 / 20 分钟环境 / 兴趣创作。", "未启用", "自然想起的去敏经验可交给助手保存；没有每周数量任务。", "8/14"],
  ["阶段 2", "8/15–8/31", "仅选中后｜低量熟悉", "若选健身且准备度允许：每周 2 次 15–25 分钟，间隔至少一天。", "复盘明确选择健身；信息充分；恢复未因活动恶化。", "继续每周至多一项，不叠加。", "仅选中后｜素材整理", "若选职业：整理经历、能力、工作边界和个人资料迁移。", "8/31"],
  ["阶段 3", "9/01–9/14", "仅持续选择时｜维持", "只维持已选健身分支的最低有效版本，不追求加量。", "已选健身且至少两周反馈稳定。", "优先无目的休息、外出或关系连接。", "仅持续选择时｜低压发现", "只对已选职业分支安排方向假设和低压力访谈。", "9/14"],
  ["阶段 4", "9/15–10/12", "仅持续选择时｜小实验", "只对已选健身分支设计 4–6 周小实验；一次只增加一个变量。", "前一阶段可持续，恢复余量足够且无警示信号。", "只保留真正增加生活感的 1–2 项。", "仅持续选择时｜证据实验", "只对已选职业分支做 2–3 个可逆实验并统一比较。", "每两周"],
  ["阶段 5", "10/13–10/31", "若仍选健身｜再决定", "依据真实反馈决定升级、维持、暂停或换项目。", "用户再次明确选择，且与恢复、时间和现实不冲突。", "保留最有效的体验。", "若仍选职业｜再决定", "有证据后才形成一个 6 周验证冲刺；正式求职另行决定。", "10/31"],
];
growth.getRange("A5:I9").format = {
  font: { color: body, size: 9 },
  wrapText: true,
  verticalAlignment: "top",
  borders: { preset: "inside", style: "thin", color: line },
};
growth.getRange("A5:I5").format.fill = tealPale;
growth.getRange("A6:I6").format.fill = bluePale;
growth.getRange("A7:I7").format.fill = sagePale;
growth.getRange("A8:I8").format.fill = goldPale;
growth.getRange("A9:I9").format.fill = coralPale;

sectionBand(growth, "A11:I11", "8 月 14 日｜只有选择健身后，才分批补充这些信息");
growth.getRange("A12:B16").values = [
  ["01", "身体限制"],
  ["02", "运动基础"],
  ["03", "优先目标"],
  ["04", "项目偏好"],
  ["05", "现实条件"],
];
growth.getRange("C12:I16").values = [
  ["伤病、疼痛、慢性病、用药、医生限制或近期异常症状；没有也可以直接说没有。", null, null, null, null, null, null],
  ["最近三个月活动量，以及过去做过哪些运动。", null, null, null, null, null, null],
  ["力量、心肺、体态、体重、情绪、精力、睡眠或其他。", null, null, null, null, null, null],
  ["喜欢、愿意尝试和明确讨厌的项目。", null, null, null, null, null, null],
  ["可用场地或器械；每周现实天数和单次时长。", null, null, null, null, null, null],
];
for (let row = 12; row <= 16; row += 1) growth.getRange(`C${row}:I${row}`).merge();
growth.getRange("A12:I16").format = {
  fill: yellowPale,
  font: { color: body, size: 10 },
  wrapText: true,
  verticalAlignment: "center",
  borders: { preset: "inside", style: "thin", color: line },
};
growth.getRange("A12:A16").format.font = { bold: true, color: teal, size: 10 };
growth.getRange("B12:B16").format.font = { bold: true, color: ink, size: 10 };

sectionBand(growth, "A18:I18", "职业分支｜只有被选中后，才安排素材整理与方向验证");
growth.getRange("A19:B22").values = [
  ["选中后", "经历素材"],
  ["选中后", "边界与能力"],
  ["9 月", "方向假设"],
  ["10 月", "证据决策"],
];
growth.getRange("C19:I22").values = [
  ["整理 6–8 个去敏经历素材：背景、自己的判断与行动、结果、学到什么；不复制公司或第三方机密。", null, null, null, null, null, null],
  ["列出能力、愿意保留的工作方式、想减少的消耗和不能再接受的边界。", null, null, null, null, null, null],
  ["形成 3–5 个可验证方向；每个方向只安排一个低成本证据：访谈、案例、短课或小项目。", null, null, null, null, null, null],
  ["按能量、能力、生活方式、成长、经济可行性和可逆性比较；只升级一个方向。", null, null, null, null, null, null],
];
for (let row = 19; row <= 22; row += 1) growth.getRange(`C${row}:I${row}`).merge();
growth.getRange("A19:I22").format = {
  fill: bluePale,
  font: { color: body, size: 10 },
  wrapText: true,
  verticalAlignment: "center",
  borders: { preset: "inside", style: "thin", color: line },
};
growth.getRange("A19:B22").format.font = { bold: true, color: ink, size: 10 };

sectionBand(growth, "A24:I24", "安全与依据");
setMerged(growth, "A25:I25", "有慢性健康问题、长期不活动后想直接进行高强度运动，或活动中出现胸部不适、异常气短、眩晕或晕厥时，先暂停并咨询医疗专业人员。", {
  fill: coralPale,
  font: { color: body, size: 10 },
  wrapText: true,
  verticalAlignment: "center",
});
growth.getRange("A26:C28").values = [
  ["WHO｜长期活动方向", null, null],
  ["CDC｜循序渐进开始", null, null],
  ["AHA｜活动警示信号", null, null],
];
for (let row = 26; row <= 28; row += 1) growth.getRange(`A${row}:C${row}`).merge();
growth.getRange("D26:I28").values = [
  ["https://www.who.int/europe/publications/i/item/9789240014886", null, null, null, null, null],
  ["https://www.cdc.gov/physical-activity-basics/adding-adults/index.html", null, null, null, null, null],
  ["https://www.heart.org/en/health-topics/cardiac-rehab/getting-physically-active/develop-a-physical-activity-plan-for-you", null, null, null, null, null],
];
for (let row = 26; row <= 28; row += 1) growth.getRange(`D${row}:I${row}`).merge();
growth.getRange("A26:I28").format = {
  fill: "#F2F4F6",
  font: { color: body, size: 9 },
  wrapText: true,
  verticalAlignment: "center",
  borders: { preset: "inside", style: "thin", color: line },
};
growth.getRange("A26:C28").format.font = { bold: true, color: ink, size: 9 };

sectionBand(growth, "A30:I30", "统一规划边界");
setMerged(growth, "A31:I31", "长期方向可以跨阶段；每个阶段只设一个主项。单个可执行目标或连续工作块原则上不超过 4 小时；预计超出时先拆成独立交付、说明异常来源，并与用户商量是否继续。其余内容明确标为次项、可延后、可合并或不做。", {
  fill: goldPale,
  font: { color: body, size: 10 },
  wrapText: true,
  verticalAlignment: "center",
});

growth.getRange("A1:I1").format.rowHeight = 40;
growth.getRange("A2:I2").format.rowHeight = 30;
growth.getRange("A3:I3").format.rowHeight = 10;
growth.getRange("A4:I4").format.rowHeight = 36;
growth.getRange("A5:I9").format.rowHeight = 82;
growth.getRange("A10:I10").format.rowHeight = 10;
growth.getRange("A11:I11").format.rowHeight = 26;
growth.getRange("A12:I16").format.rowHeight = 34;
growth.getRange("A17:I17").format.rowHeight = 10;
growth.getRange("A18:I18").format.rowHeight = 26;
growth.getRange("A19:I22").format.rowHeight = 38;
growth.getRange("A23:I23").format.rowHeight = 10;
growth.getRange("A24:I24").format.rowHeight = 26;
growth.getRange("A25:I25").format.rowHeight = 42;
growth.getRange("A26:I28").format.rowHeight = 32;
growth.getRange("A29:I29").format.rowHeight = 10;
growth.getRange("A30:I30").format.rowHeight = 26;
growth.getRange("A31:I31").format.rowHeight = 44;

const widths = [15, 14, 19, 34, 31, 28, 24, 32, 13];
for (let i = 0; i < widths.length; i += 1) {
  growth.getRangeByIndexes(0, i, 31, 1).format.columnWidth = widths[i];
}
growth.freezePanes.freezeRows(4);

const check = await workbook.inspect({
  kind: "table",
  range: "扩展规划!A1:I31",
  include: "values,formulas",
  tableMaxRows: 30,
  tableMaxCols: 10,
  maxChars: 14000,
});
console.log(check.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
  maxChars: 6000,
});
console.log(errors.ndjson);

await fs.mkdir(path.dirname(outputPath), { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

if (previewDir) {
  await fs.mkdir(previewDir, { recursive: true });
  const sheets = ["总览", "阶段路线", "两周行动", "每日记录", "每周复盘", "使用说明", "扩展规划"];
  for (const sheetName of sheets) {
    const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
    await fs.writeFile(path.join(previewDir, `${sheetName}.png`), new Uint8Array(await preview.arrayBuffer()));
  }
}

console.log(`Saved ${outputPath}`);
