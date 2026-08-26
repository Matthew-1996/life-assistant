#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys


HEALTH_SYNC_COMMAND = (
    "PYTHONPATH=.:tools python3 tools/life_console_cloud.py health-day "
    "--source records/apple-health-latest.txt --expect-today"
)
CANONICAL_ROLLOUT_BLOCK = """Read only the redacted receipt.
If status=saved, including action created, updated or unchanged, continue quietly.
On any failure, say only “今日健康数据未同步” and continue the check-in.
Never display device health values, retry a past date, backfill history or write a local fallback."""

QUESTION_MARKERS = (
    "开始每日回访提问",
    "逐项询问",
    "只问缺失字段",
    "今天感觉如何",
)
NEGATION_PATTERN = re.compile(
    r"\b(?:never|do not|don't|must not|avoid|without)\b"
    r"|\bneither\b|(?:不得|禁止|不要|不可|不应|避免)",
    re.IGNORECASE,
)
CLAUSE_SPLIT_PATTERN = re.compile(
    r"(?:[\n。！？!?;；]+|\.\s+|[，,]\s*(?:随后|然后)|\b(?:but|however)\b|(?:但是|但))",
    re.IGNORECASE,
)


def _is_locally_negated(clause: str, match: re.Match[str]) -> bool:
    before = clause[max(0, match.start() - 32) : match.start()]
    matched_text = clause[match.start() : match.end()]
    return (
        NEGATION_PATTERN.search(before) is not None
        or re.search(r"\bneither\b", matched_text, re.IGNORECASE) is not None
    )


def _has_unsafe_instruction(text: str, pattern: str) -> bool:
    """Match every positive concrete instruction after splitting adversative clauses."""
    for clause in CLAUSE_SPLIT_PATTERN.split(text):
        for match in re.finditer(pattern, clause, re.IGNORECASE):
            if not _is_locally_negated(clause, match):
                return True
    return False


def _has_canonical_block(prompt_text: str) -> bool:
    if prompt_text.count(CANONICAL_ROLLOUT_BLOCK) != 1:
        return False
    position = prompt_text.find(CANONICAL_ROLLOUT_BLOCK)
    before = prompt_text[position - 1 : position]
    after_position = position + len(CANONICAL_ROLLOUT_BLOCK)
    after = prompt_text[after_position : after_position + 1]
    return before in ("", "\n") and after in ("", "\n")


def validate_prompt(prompt_text: str) -> list[str]:
    """Return daily health-sync Prompt contract violations without executing it."""
    errors: list[str] = []
    health_day_lines = [
        line.strip() for line in prompt_text.splitlines() if "health-day" in line
    ]
    command_positions = [
        match.start() for match in re.finditer(re.escape(HEALTH_SYNC_COMMAND), prompt_text)
    ]
    if not command_positions:
        errors.append("每日回访缺少当天 Apple Health 同步命令")
    elif health_day_lines != [HEALTH_SYNC_COMMAND]:
        errors.append("每日回访只能尝试一次精确当天同步命令")

    question_positions = [
        position for marker in QUESTION_MARKERS
        if (position := prompt_text.find(marker)) >= 0
    ]
    line_position = 0
    for line in prompt_text.splitlines(keepends=True):
        if "?" in line or "？" in line:
            question_positions.append(line_position)
        line_position += len(line)
    if not question_positions:
        errors.append("每日回访健康同步契约缺失：每日回访提问")
    elif not command_positions or min(command_positions) > min(question_positions):
        errors.append("Apple Health 同步必须发生在每日回访提问前")

    if not _has_canonical_block(prompt_text):
        errors.append("每日回访健康同步契约缺失：精确 rollout 契约")

    surrounding_text = prompt_text.replace(CANONICAL_ROLLOUT_BLOCK, "")
    conflicts = (
        (
            r"\baction(?:\s*(?:=|:)\s*|\s+is\s+|\s+(?!is\b))"
            r"(?!(?:created|updated|unchanged)\b)\w+"
            r"|\b(?:regardless of action|any action)\b",
            "每日回访健康同步契约冲突：封闭成功 action 集合",
        ),
        (
            r"\b(?:print|show|display|output|reveal|echo)\b.{0,60}"
            r"\b(?:full|original|detailed)\s+(?:errors?|source (?:path|contents?|content|file))\b"
            r"|\b(?:print|show|display|output|reveal|echo)\b.{0,60}\bsource path\b"
            r"|(?:输出|展示|显示|打印).{0,30}(?:完整|原始|详细).{0,20}(?:错误|来源)",
            "每日回访健康同步契约冲突：禁止输出来源或详细错误",
        ),
        (
            r"\bread\b.{0,40}\bsource file\b"
            r"|\b(?:display|show|echo|print)\b.{0,40}\b(?:original )?source (?:contents?|content|file)\b"
            r"|(?:读取|展示|显示).{0,30}(?:原始)?来源.{0,20}(?:内容|文件)",
            "每日回访健康同步契约冲突：只读取去敏回执",
        ),
        (
            r"\b(?:retry|rerun|re-run)\b"
            r"|\b(?:reexecute|execute|run)\b.{0,40}\b(?:again|a second time|second time|health sync)\b"
            r"|(?:再次|第二次).{0,16}(?:执行|运行|同步)"
            r"|(?:重试|重新执行).{0,16}(?:健康)?同步",
            "每日回访健康同步契约冲突：只能尝试一次，禁止重试",
        ),
        (r"--expect-date\b", "每日回访健康同步契约冲突：禁止替代日期同步命令"),
        (
            r"\bbackfill\b.{0,50}\b(?:yesterday|past|health record)\b"
            r"|\bwrite\b.{0,30}\ba past date\b"
            r"|\b(?:persist|write|save)\b.{0,50}\b(?:iCloud|history|local fallback|local file|file)\b"
            r"|(?:补历史|历史回填|回退本地写入|回填.{0,16}(?:昨天|历史|健康记录)"
            r"|补.{0,16}(?:昨天|昨日).{0,16}健康数据|写入.{0,16}(?:iCloud|历史|本地)"
            r"|保存.{0,20}(?:iCloud|本地回退文件))",
            "每日回访健康同步契约冲突：禁止历史或 iCloud 写入",
        ),
        (
            r"\b(?:display|show|output|print|reveal|echo)\b.{0,50}"
            r"\b(?:heart rate|stand hours|calories|steps?|sleep|exercise|active energy)\b"
            r"|(?:展示|显示|输出|打印).{0,40}(?:心率|站立小时|卡路里|步数|睡眠|锻炼|活动能量)",
            "每日回访健康同步契约冲突：禁止输出健康数值",
        ),
        (
            r"\b(?:display|show|output|print|reveal|echo)\b.{0,50}"
            r"\b(?:access token|refresh token|owner jwt|jwt|api key|password|secret|credentials?)\b"
            r"|(?:输出|展示|显示|打印).{0,40}(?:访问令牌|刷新令牌|Owner JWT|JWT|API 密钥|密码|秘密|凭据)",
            "每日回访健康同步契约冲突：禁止输出凭据",
        ),
    )
    for pattern, error in conflicts:
        if _has_unsafe_instruction(surrounding_text, pattern):
            errors.append(error)
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="验证每日回访 Apple Health 同步契约")
    parser.add_argument("--prompt", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        prompt_text = args.prompt.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        print(json.dumps({"status": "unavailable"}), file=sys.stderr)
        return 2
    errors = validate_prompt(prompt_text)
    if errors:
        print(
            json.dumps({"status": "invalid", "errors": errors}, ensure_ascii=False),
            file=sys.stderr,
        )
        return 2
    print(json.dumps({"status": "valid"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
