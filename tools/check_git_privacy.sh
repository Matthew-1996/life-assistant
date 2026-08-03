#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

violations=()
while IFS= read -r -d '' path; do
  case "$path" in
    USER.md|MEMORY.md|GOALS.md|PROJECT_CONTEXT.md|PORTABILITY.md|STATUS.md|\
    automations/*|backups/*|outputs/*|\
    journal/entries/*|journal/reviews/*|journal/index.jsonl|journal/INDEX.md|\
    journal/insight-decisions.jsonl|journal/review-policy.json|\
    records/*.jsonl|records/apple-health-latest.txt|records/apple-sleep-details-latest.txt|\
    integrations/google-sheets.json|integrations/google-sheets.sync-state.json|\
    web/life-dashboard/.openai/*|web/life-dashboard/PUBLICATION_STATE.json|\
    web/life-dashboard/README.md|web/life-dashboard/personal.config.js|\
    web/life-dashboard/app/life-plan.js|web/life-dashboard/app/page.tsx|\
    web/life-dashboard/tests/life-plan.test.mjs|web/life-dashboard/tests/rendered-html.test.mjs|\
    life-plan-schedule.json|tools/render_life_plan.mjs|\
    tools/test_journal_workbook_e2e.mjs|tools/update_life_plan_growth.mjs|\
    tools/update_life_plan_journal.mjs|\
    plans/2026-07-31-两周睡眠与生活恢复计划.md|\
    plans/2026-08-01-生活扩展路线图.md|\
    plans/2026-08-14-待决策清单.md)
      violations+=("$path")
      ;;
  esac

  name="${path##*/}"
  case "$name" in
    .env.example|.env.sample|.env.template)
      ;;
    .env|.env.*|.netrc|.npmrc|.pypirc|credentials|credentials.*|\
    id_dsa|id_ecdsa|id_ed25519|id_rsa|*.pem|*.key|*.p12|*.pfx)
      violations+=("$path")
      ;;
  esac
done < <(git ls-files --cached -z)

if ((${#violations[@]} > 0)); then
  printf '拒绝：Git 索引包含 iCloud 私有文件或凭据路径：\n' >&2
  printf '  - %s\n' "${violations[@]}" >&2
  exit 1
fi

secret_pattern='sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|(AKIA|ASIA)[A-Z0-9]{16}|authorization:[[:space:]]*bearer[[:space:]]+[A-Za-z0-9._-]{16,}|-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----'
if git grep --cached -I -q -E "$secret_pattern" --; then
  printf '拒绝：Git 索引内容命中高置信凭据模式；为避免泄露，未输出匹配内容。\n' >&2
  exit 1
fi

git diff --cached --check
printf 'PASS: Git 隐私边界与凭据检查通过\n'
