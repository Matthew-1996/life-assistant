#!/usr/bin/env bash
set -euo pipefail

# 检查 Git 隐私边界与凭据。
#
# 默认扫描当前索引（提交前防线）。
# 传入 --history <range> 或设置环境变量 PRIVACY_SCAN_RANGE 时，额外扫描该
# 提交范围内新增/修改过的所有路径与对应 blob，阻止“先提交个人数据、后删除再
# 推送”仍能通过索引检查的历史泄露。CI 应对 PR 使用 origin/main..HEAD。

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

history_range="${PRIVACY_SCAN_RANGE:-}"
while (($# > 0)); do
  case "$1" in
    --history)
      shift
      history_range="${1:-}"
      ;;
    --history=*)
      history_range="${1#*=}"
      ;;
    *)
      printf '未知参数：%s\n' "$1" >&2
      exit 2
      ;;
  esac
  shift || true
done

secret_pattern='sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|(AKIA|ASIA)[A-Z0-9]{16}|authorization:[[:space:]]*bearer[[:space:]]+[A-Za-z0-9._-]{16,}|-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----'
machine_path_pattern='/'"Users/"'[A-Za-z0-9._-]+/'

# 判断单个路径是否属于禁止进入 Git 的 iCloud 私有文件或凭据路径。
is_private_path() {
  local path="$1"
  if [[ "$path" == "plans/睡眠与状态记录模板.md" ]]; then
    return 1
  fi
  case "$path" in
    USER.md|MEMORY.md|GOALS.md|PROJECT_CONTEXT.md|PORTABILITY.md|STATUS.md|\
    automations/*|backups/*|outputs/*|\
    journal/entries/*|journal/reviews/*|journal/index.jsonl|journal/INDEX.md|\
    journal/insight-decisions.jsonl|journal/review-policy.json|\
    journal/people-aliases.json|journal/enrichment-audit.jsonl|journal/.operations/*|\
    records/*.jsonl|records/apple-health-latest.txt|records/apple-sleep-details-latest.txt|\
    integrations/google-sheets.json|integrations/google-sheets.sync-state.json|\
    integrations/journal-enrichment.json|\
    life-plan-schedule.json|tools/render_life_plan.mjs|\
    tools/test_journal_workbook_e2e.mjs|tools/update_life_plan_growth.mjs|\
    tools/update_life_plan_journal.mjs|plans/*.md|需求文档（个人维护）/*)
      return 0
      ;;
  esac

  local name="${path##*/}"
  if [[ "$path" == apps/life-console/* ]]; then
    case "$name" in
      USER.md|MEMORY.md|GOALS.md|PROJECT_CONTEXT.md|PORTABILITY.md|STATUS.md|\
      index.jsonl|insight-decisions.jsonl|review-policy.json|\
      people-aliases.json|enrichment-audit.jsonl|\
      apple-health-latest.txt|apple-sleep-details-latest.txt|\
      google-sheets.json|google-sheets.sync-state.json|journal-enrichment.json)
        return 0
        ;;
    esac
    case "$path" in
      */journal/entries/*|*/journal/reviews/*|*/journal/.operations/*|\
      */records/*.jsonl|*/backups/*)
        return 0
        ;;
    esac
  fi

  case "$name" in
    .env.example|.env.sample|.env.template)
      return 1
      ;;
    .env|.env.*|.netrc|.npmrc|.pypirc|credentials|credentials.*|\
    id_dsa|id_ecdsa|id_ed25519|id_rsa|*.pem|*.key|*.p12|*.pfx)
      return 0
      ;;
  esac
  return 1
}

# ---- 索引扫描（提交前防线）----
violations=()
while IFS= read -r -d '' path; do
  if is_private_path "$path"; then
    violations+=("$path")
  fi
done < <(git ls-files --cached -z)

if ((${#violations[@]} > 0)); then
  printf '拒绝：Git 索引包含 iCloud 私有文件或凭据路径：\n' >&2
  printf '  - %s\n' "${violations[@]}" >&2
  exit 1
fi

if git grep --cached -I -q -E "$secret_pattern" --; then
  printf '拒绝：Git 索引内容命中高置信凭据模式；为避免泄露，未输出匹配内容。\n' >&2
  exit 1
fi

if git grep --cached -I -q -E "$machine_path_pattern" --; then
  printf '拒绝：Git 索引内容包含机器专属绝对路径；为避免泄露，未输出匹配内容。\n' >&2
  exit 1
fi

git diff --cached --check

# ---- 历史扫描（推送前 / CI 防线）----
if [[ -n "$history_range" ]]; then
  if ! git rev-parse --quiet --verify "${history_range%%..*}" >/dev/null 2>&1 \
     && ! git rev-list --quiet "$history_range" >/dev/null 2>&1; then
    printf '提示：历史范围 %s 无法解析，跳过历史扫描。\n' "$history_range"
    printf 'PASS: Git 隐私边界与凭据检查通过（仅索引）\n'
    exit 0
  fi

  hist_violations=()
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    if is_private_path "$path"; then
      hist_violations+=("$path")
    fi
  done < <(git log "$history_range" --pretty=format: --name-only --diff-filter=AM 2>/dev/null | sort -u)

  if ((${#hist_violations[@]} > 0)); then
    printf '拒绝：提交历史 %s 引入过 iCloud 私有文件或凭据路径：\n' "$history_range" >&2
    printf '  - %s\n' "${hist_violations[@]}" >&2
    printf '请在合入前从历史中剥离这些路径（见 GIT_WORKFLOW.md 历史清理）。\n' >&2
    exit 1
  fi

  while IFS= read -r commit; do
    [[ -z "$commit" ]] && continue
    if git grep -I -q -E "$secret_pattern" "$commit" -- 2>/dev/null; then
      printf '拒绝：提交 %s 内容命中高置信凭据模式；为避免泄露，未输出匹配内容。\n' "$commit" >&2
      exit 1
    fi
    if git grep -I -q -E "$machine_path_pattern" "$commit" -- 2>/dev/null; then
      printf '拒绝：提交 %s 内容包含机器专属绝对路径；为避免泄露，未输出匹配内容。\n' "$commit" >&2
      exit 1
    fi
  done < <(git rev-list "$history_range" 2>/dev/null)

  printf 'PASS: Git 隐私边界与凭据检查通过（索引 + 历史 %s）\n' "$history_range"
  exit 0
fi

printf 'PASS: Git 隐私边界与凭据检查通过\n'
