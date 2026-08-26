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

QUESTION_MARKERS = ("开始每日回访提问", "逐项询问", "只问缺失字段")
FAILURE_CONTINUE_PATTERN = re.compile(r"(?:若失败|失败|未同步).{0,80}继续回访", re.DOTALL)
HISTORY_PROHIBITION_PATTERN = re.compile(
    r"(?:不得|禁止|不进行).{0,40}(?:补历史|历史回填)", re.DOTALL
)
LOCAL_FALLBACK_PROHIBITION_PATTERN = re.compile(
    r"(?:不得|禁止|不进行).{0,40}回退本地写入", re.DOTALL
)
METRIC_PROHIBITION_PATTERN = re.compile(
    r"(?:不得|禁止|不).{0,40}(?:展示|输出|透露|回显).{0,40}(?:设备)?健康(?:数值|指标)",
    re.DOTALL,
)


def _contains_permitted_action(prompt_text: str, object_pattern: str) -> bool:
    return re.search(
        rf"(?:允许|可以|应当|需要|请).{{0,16}}{object_pattern}",
        prompt_text,
        re.DOTALL,
    ) is not None


def validate_prompt(prompt_text: str) -> list[str]:
    """Return contract violations for a daily check-in Prompt without executing it."""
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
    elif command_positions and min(command_positions) > min(question_positions):
        errors.append("Apple Health 同步必须发生在每日回访提问前")

    if "只读取命令回执" not in prompt_text:
        errors.append("每日回访健康同步契约缺失：只读取命令回执")
    if "status=saved" not in prompt_text:
        errors.append("每日回访健康同步契约缺失：成功回执处理")

    if FAILURE_CONTINUE_PATTERN.search(prompt_text) is None or re.search(
        r"(?:失败|未同步).{0,80}(?:停止|中断|终止).{0,20}回访",
        prompt_text,
        re.DOTALL,
    ) is not None:
        errors.append("每日回访健康同步契约缺失：同步失败不得阻断回访")

    if (
        HISTORY_PROHIBITION_PATTERN.search(prompt_text) is None
        or _contains_permitted_action(prompt_text, r"(?:补历史|历史回填)")
    ):
        errors.append("每日回访健康同步契约缺失：禁止健康历史回填")
    if (
        LOCAL_FALLBACK_PROHIBITION_PATTERN.search(prompt_text) is None
        or _contains_permitted_action(prompt_text, r"回退本地写入")
        or re.search(r"(?:失败后|失败时).{0,16}回退本地写入", prompt_text, re.DOTALL)
        is not None
    ):
        errors.append("每日回访健康同步契约缺失：禁止本地回退写入")
    if (
        METRIC_PROHIBITION_PATTERN.search(prompt_text) is None
        or _contains_permitted_action(prompt_text, r"(?:设备)?健康(?:数值|指标)")
    ):
        errors.append("每日回访健康同步契约缺失：禁止展示设备健康数值")
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
