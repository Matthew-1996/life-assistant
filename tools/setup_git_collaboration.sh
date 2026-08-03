#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

git config --local core.hooksPath .githooks
tools/check_git_privacy.sh

printf 'PASS: 已启用 .githooks；main 直提/直推与私有文件入库会被本地阻止。\n'
