#!/usr/bin/env bash
# tools/dev_dashboard.sh
#
# 在 iCloud 项目内的 web/life-dashboard 源码与 iCloud 外的开发工作区之间双向同步。
# 目的：把 node_modules / dist / .wrangler 等生成物留在 iCloud 之外，源码与个人内容
# 仍以 iCloud web/life-dashboard 为唯一真相源。
#
# 用法：
#   tools/dev_dashboard.sh init [ext-root]   创建并填充外部工作区（默认 ~/Projects/life-dashboard）
#   tools/dev_dashboard.sh pull [ext-root]   iCloud 源码 → 外部工作区
#   tools/dev_dashboard.sh push [ext-root]   外部工作区源码 → iCloud（回写真相源）
#   tools/dev_dashboard.sh status [ext-root] 显示两端差异
#
# 可选环境变量：
#   LIFE_DASHBOARD_EXT  外部工作区路径（覆盖默认 ~/Projects/life-dashboard）
#
# 默认同步为“增量更新”，不删除目标端独有文件；加 --mirror 参数做精确镜像（会删除
# 目标端在源端已不存在的源码文件，但不触碰被排除的生成物）。
#
# 本脚本只含通用同步逻辑，不含个人数据，可纳入 git。

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
site_dir="$project_root/web/life-dashboard"
default_ext="$HOME/Projects/life-dashboard"

ext_root="${LIFE_DASHBOARD_EXT:-${2:-$default_ext}}"

# rsync 排除集：只搬源码与配置，生成物留在外部工作区
excludes=(
  --exclude 'node_modules/'
  --exclude 'dist/'
  --exclude '.next/'
  --exclude '.vinext/'
  --exclude '.wrangler/'
  --exclude 'out/'
  --exclude 'coverage/'
  --exclude 'work/'
  --exclude 'outputs/'
  --exclude '.DS_Store'
  --exclude '*.log'
  --exclude 'next-env.d.ts'
)

if [[ ! -d "$site_dir" ]]; then
  printf '错误：iCloud 看板源码目录不存在：%s\n' "$site_dir" >&2
  exit 1
fi

usage() {
  sed -n '3,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 1
}

cmd="${1:-}"
mirror=0
if [[ "${3:-}" == "--mirror" ]]; then
  mirror=1
fi

rsync_flags=(-a --itemize-changes "${excludes[@]}")
if [[ "$mirror" -eq 1 ]]; then
  rsync_flags+=(--delete)
fi

case "$cmd" in
  init)
    if [[ -e "$ext_root" && -n "$(ls -A "$ext_root" 2>/dev/null)" ]]; then
      printf '错误：外部工作区已存在且非空：%s\n' "$ext_root" >&2
      printf '若要重建，请先手动删除或改用 pull。\n' >&2
      exit 1
    fi
    mkdir -p "$ext_root"
    printf '→ 从 iCloud 同步源码到 %s ...\n' "$ext_root"
    rsync "${rsync_flags[@]}" "$site_dir/" "$ext_root/"
    printf '\n完成。接下来在外部工作区安装依赖（node_modules 只在这里，不进 iCloud）：\n'
    printf '  cd "%s" && npm ci\n' "$ext_root"
    printf '之后用 npm run dev / npm test / npm run build 开发与验证。\n'
    ;;

  pull)
    if [[ ! -d "$ext_root" ]]; then
      printf '错误：外部工作区不存在：%s\n' "$ext_root" >&2
      printf '请先运行：tools/dev_dashboard.sh init "%s"\n' "$ext_root" >&2
      exit 1
    fi
    printf '→ iCloud 源码 → 外部工作区 (%s) ...\n' "$ext_root"
    rsync "${rsync_flags[@]}" "$site_dir/" "$ext_root/"
    printf '完成。\n'
    ;;

  push)
    if [[ ! -d "$ext_root" ]]; then
      printf '错误：外部工作区不存在：%s\n' "$ext_root" >&2
      exit 1
    fi
    printf '→ 外部工作区源码 → iCloud 真相源 ...\n'
    rsync "${rsync_flags[@]}" "$ext_root/" "$site_dir/"
    printf '完成。iCloud 已更新；如需纳入 git 的脚手架变更，请在项目根提交。\n'
    ;;

  status)
    if [[ ! -d "$ext_root" ]]; then
      printf '外部工作区不存在：%s\n' "$ext_root" >&2
      printf '请先运行：tools/dev_dashboard.sh init "%s"\n' "$ext_root" >&2
      exit 1
    fi
    printf '== pull 会变更（iCloud → 外部） ==\n'
    rsync -an --itemize-changes "${excludes[@]}" "$site_dir/" "$ext_root/" || true
    printf '\n== push 会变更（外部 → iCloud） ==\n'
    rsync -an --itemize-changes "${excludes[@]}" "$ext_root/" "$site_dir/" || true
    printf '\n（无输出表示两端源码一致。）\n'
    ;;

  ""|-h|--help|help)
    usage
    ;;

  *)
    printf '未知子命令：%s\n' "$cmd" >&2
    usage
    ;;
esac
