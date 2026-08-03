import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the private life dashboard with growth and journal guidance", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>生活助手｜恢复、健身与职业探索路线<\/title>/);
  assert.match(html, /今天只守三个锚点/);
  assert.match(html, /从今天起的七日轻量路径/);
  assert.match(html, /守住今天三个锚点/);
  assert.equal((html.match(/<article class="day-card/g) ?? []).length, 7);
  assert.doesNotMatch(html, /轻轻开始|一个交接重点/);
  assert.match(html, /两条候选分支，复盘只启用一条/);
  assert.match(html, /互斥规则/);
  assert.match(html, /选健身时，职业不排期/);
  assert.match(html, /选职业时，健身只保留恢复所需的轻活动/);
  assert.match(html, /都不选时，系统保持安静/);
  assert.match(html, /先知道身体，再谈训练/);
  assert.match(html, /先留个人资产，再验证方向/);
  assert.ok((html.match(/8\/14 选择门/g) ?? []).length >= 2);
  assert.match(html, /暂未启用健身分支/);
  assert.match(html, /暂未启用职业分支/);
  assert.doesNotMatch(html, /每周 15–20 分钟素材留存/);
  assert.match(html, /把生活留给未来的自己/);
  assert.match(html, /日记：/);
  assert.match(html, /日记记录：/);
  assert.match(html, /生活记录：/);
  assert.match(html, /记录一下：/);
  assert.match(html, /保存原始事实/);
  assert.match(html, /生成轻量摘要/);
  assert.match(html, /添加标签与关联/);
  assert.match(html, /形成周与月回顾/);
  assert.match(html, /更正刚才的日记/);
  assert.match(html, /不要记刚才那条/);
  assert.match(html, /最近一次仍有效的隐式保存/);
  assert.match(html, /从后续索引与回顾中隐藏/);
  assert.match(html, /原文仍保留在当前项目/);
  assert.match(html, /恢复刚才撤回的日记/);
  assert.match(html, /这不是删除/);
  assert.match(html, /永久删除那篇日记/);
  assert.match(html, /当次精确确认/);
  assert.match(html, /只读 · 私密查看/);
  assert.doesNotMatch(html, /<form|<input|<textarea/i);
});

test("keeps recovery first and includes auditable health sources", async () => {
  const [page, layout, css, lifePlan, readme] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/life-plan.js", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /睡眠与生活体验仍是当前重点/);
  assert.match(page, /不自动变成待办/);
  assert.match(page, /who\.int\/europe\/publications/);
  assert.match(page, /cdc\.gov\/physical-activity-basics/);
  assert.match(page, /heart\.org\/en\/health-topics\/cardiac-rehab/);
  assert.match(page, /日记归档在你的 iCloud 项目/);
  assert.match(page, /不会自动把原文发布到这个网页/);
  assert.match(page, /对话平台、iCloud 同步和历史备份副本按各自设置保留/);
  assert.match(page, /当次的明确授权/);
  assert.match(page, /等待你确认下一阶段/);
  assert.match(page, /继续最低恢复锚点/);
  assert.match(page, /仍是建议，不会按日期自动开始/);
  assert.match(page, /路线已到复盘节点/);
  assert.match(page, /不自动延续旧阶段/);
  assert.match(page, /href="#journal"/);
  assert.match(css, /grid-template-columns: repeat\(5/);
  assert.match(lifePlan, /confirmedPhaseTruth/);
  assert.match(lifePlan, /phaseId: "01"/);
  assert.match(lifePlan, /status: "awaiting_review"/);
  assert.match(lifePlan, /status: "review_due"/);
  assert.match(readme, /GOALS\.md.*真相来源/);
  assert.match(readme, /日期只决定已确认阶段内的进度，不能确认新阶段/);
  assert.match(readme, /本地修改和构建不等于发布/);
  assert.match(layout, /复盘后再从健身与职业候选分支中至多启用一条/);
  assert.doesNotMatch(page, /_sites-preview|SkeletonPreview|codex-preview/);
});
