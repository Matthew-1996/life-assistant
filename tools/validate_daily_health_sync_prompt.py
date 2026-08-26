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
NEGATION_PATTERN = re.compile(r"\b(?:never|do not|must not)\b|(?:不得|禁止)", re.IGNORECASE)


def _has_unsafe_instruction(text: str, pattern: str) -> bool:
    """Match a concrete positive instruction while ignoring a negated sentence."""
    for sentence in re.split(r"[\n。！？!?]", text):
        match = re.search(pattern, sentence, re.IGNORECASE)
        if match is None:
            continue
        if NEGATION_PATTERN.search(sentence[:match.start()]) is None:
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
    if not question_positions:
        errors.append("每日回访健康同步契约缺失：每日回访提问")
    elif not command_positions or min(command_positions) > min(question_positions):
        errors.append("Apple Health 同步必须发生在每日回访提问前")

    if not _has_canonical_block(prompt_text):
        errors.append("每日回访健康同步契约缺失：精确 rollout 契约")

    surrounding_text = prompt_text.replace(CANONICAL_ROLLOUT_BLOCK, "")
    conflicts = (
        (
            r"\baction\s*=\s*(?!created\b|updated\b|unchanged\b)\w+"
            r"|\b(?:regardless of action|any action)\b",
            "每日回访健康同步契约冲突：封闭成功 action 集合",
        ),
        (
            r"\b(?:print|show|display|output|reveal)\b.{0,60}"
            r"\b(?:detailed errors?|source path)\b",
            "每日回访健康同步契约冲突：禁止输出来源或详细错误",
        ),
        (
            r"\bread\b.{0,40}\bsource file\b"
            r"|\b(?:display|show)\b.{0,40}\bsource (?:contents?|file)\b",
            "每日回访健康同步契约冲突：只读取去敏回执",
        ),
        (r"\b(?:retry|rerun|re-run)\b", "每日回访健康同步契约冲突：禁止重试"),
        (r"--expect-date\b", "每日回访健康同步契约冲突：禁止替代日期同步命令"),
        (
            r"\bwrite\b.{0,30}\b(?:a past date|history|iCloud)\b"
            r"|(?:补历史|历史回填|回退本地写入)",
            "每日回访健康同步契约冲突：禁止历史或 iCloud 写入",
        ),
        (
            r"\b(?:display|show|output|print|reveal)\b.{0,50}"
            r"\b(?:steps?|sleep|active energy|exercise minutes)\b",
            "每日回访健康同步契约冲突：禁止输出健康数值",
        ),
        (
            r"\b(?:display|show|output|print|reveal)\b.{0,50}"
            r"\b(?:access token|owner jwt|credentials?)\b",
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
