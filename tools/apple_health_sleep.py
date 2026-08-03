#!/usr/bin/env python3
"""只读解析并校准苹果健康最近一晚的入睡与醒来时间。

设备的 sleep_end 只表示最终醒来时间；离床时间永远只采用用户表达。
任何文件内的额外文字都只作为不可信数据忽略，不会被执行。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import date as Date
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


MAX_SLEEP_SPAN = timedelta(hours=18)
EPISODE_GAP = timedelta(minutes=120)
SUMMARY_KEYS = (
    "generated_at",
    "steps",
    "active_energy",
    "exercise_minutes",
    "sleep_start",
    "sleep_end",
)
SLEEP_STAGES = (
    "快速动眼睡眠",
    "核心睡眠",
    "深度睡眠",
    "未指定睡眠",
    "睡眠",
)
NON_SLEEP_STAGES = ("清醒时间", "在床")
ALL_STAGES = (*SLEEP_STAGES, *NON_SLEEP_STAGES)

_LOCAL_DATETIME_RE = re.compile(
    r"^(?P<year>\d{4})年(?P<month>\d{1,2})月(?P<day>\d{1,2})日\s*"
    r"(?P<hour>\d{1,2}):(?P<minute>\d{2})$"
)
_TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
_DETAIL_LINE_RE = re.compile(
    rf"^(?P<stage>{'|'.join(map(re.escape, ALL_STAGES))})"
    r"(?P<start>\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2})"
    r"(?P<end>\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2})"
)


class SleepResolveError(RuntimeError):
    """可安全展示的解析参数错误。"""


@dataclass(frozen=True)
class SleepEpisode:
    start: datetime
    end: datetime


@dataclass(frozen=True)
class DeviceTime:
    value: datetime
    source: str


def _parse_date(value: str) -> Date:
    try:
        parsed = Date.fromisoformat(value)
    except ValueError as error:
        raise SleepResolveError("--date 必须是有效的 YYYY-MM-DD") from error
    if parsed.isoformat() != value:
        raise SleepResolveError("--date 必须是有效的 YYYY-MM-DD")
    return parsed


def _parse_local_datetime(value: str) -> datetime | None:
    match = _LOCAL_DATETIME_RE.fullmatch(value.strip())
    if match is None:
        return None
    try:
        return datetime(**{key: int(raw) for key, raw in match.groupdict().items()})
    except ValueError:
        return None


def _read_text(path: Path) -> str | None:
    try:
        if path.is_symlink() or not path.is_file():
            return None
        return path.read_text("utf-8")
    except (OSError, UnicodeError):
        return None


def _parse_summary(
    path: Path,
    target: Date,
) -> tuple[DeviceTime | None, DeviceTime | None, bool]:
    """逐字段返回摘要端点，以及摘要是否需要明细回退。"""

    text = _read_text(path)
    if text is None:
        return None, None, True
    values: dict[str, str] = {}
    duplicates: set[str] = set()
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        if key not in SUMMARY_KEYS:
            continue
        if key in values:
            duplicates.add(key)
            continue
        values[key] = value.strip()
    if duplicates or any(key not in values for key in SUMMARY_KEYS):
        return None, None, True
    generated_at = _parse_local_datetime(values["generated_at"])
    if generated_at is None or generated_at.date() != target:
        return None, None, True
    start = _parse_local_datetime(values["sleep_start"])
    end = _parse_local_datetime(values["sleep_end"])
    summary_start = (
        DeviceTime(start, "apple_health_summary")
        if start is not None and start.date() in (target, target - timedelta(days=1))
        else None
    )
    summary_end = (
        DeviceTime(end, "apple_health_summary")
        if end is not None and end.date() == target
        else None
    )
    pair_is_valid = (
        start is not None
        and end is not None
        and end.date() == target
        and start < end
        and end - start <= MAX_SLEEP_SPAN
    )
    return summary_start, summary_end, not pair_is_valid


def _parse_details(path: Path, target: Date) -> SleepEpisode | None:
    text = _read_text(path)
    if text is None:
        return None
    segments: set[tuple[str, datetime, datetime]] = set()
    for raw_line in text.splitlines():
        match = _DETAIL_LINE_RE.match(raw_line.strip())
        if match is None:
            continue
        start = _parse_local_datetime(match.group("start"))
        end = _parse_local_datetime(match.group("end"))
        if start is None or end is None or start >= end or end - start > MAX_SLEEP_SPAN:
            continue
        segments.add((match.group("stage"), start, end))

    sleep_segments = sorted(
        ((start, end) for stage, start, end in segments if stage in SLEEP_STAGES),
        key=lambda item: (item[0], item[1]),
    )
    episodes: list[SleepEpisode] = []
    for start, end in sleep_segments:
        if not episodes or start - episodes[-1].end > EPISODE_GAP:
            episodes.append(SleepEpisode(start=start, end=end))
            continue
        previous = episodes[-1]
        episodes[-1] = SleepEpisode(start=min(previous.start, start), end=max(previous.end, end))

    candidates = [
        episode
        for episode in episodes
        if episode.end.date() == target
        and episode.start < episode.end
        and episode.end - episode.start <= MAX_SLEEP_SPAN
    ]
    return max(candidates, key=lambda episode: episode.end, default=None)


def resolve_device_times(
    summary_path: Path,
    details_path: Path,
    target: Date,
) -> tuple[DeviceTime | None, DeviceTime | None, str]:
    summary_sleep, summary_wake, summary_needs_fallback = _parse_summary(
        summary_path, target
    )
    if not summary_needs_fallback:
        return summary_sleep, summary_wake, "summary"

    details = _parse_details(details_path, target)
    if details is not None:
        return (
            DeviceTime(details.start, "apple_health_details"),
            DeviceTime(details.end, "apple_health_details"),
            "details",
        )
    if summary_sleep is not None or summary_wake is not None:
        return summary_sleep, summary_wake, "summary_partial"
    return None, None, "none"


def _time_minutes(value: str) -> int:
    if not _TIME_RE.fullmatch(value):
        raise SleepResolveError("时间必须是 24 小时制 HH:MM")
    hour, minute = map(int, value.split(":"))
    return hour * 60 + minute


def _clock_delta_minutes(left: str, right: str) -> int:
    difference = abs(_time_minutes(left) - _time_minutes(right))
    return min(difference, 1440 - difference)


def _device_clock(device: DeviceTime | None) -> str | None:
    return device.value.strftime("%H:%M") if device is not None else None


def _resolve_field(
    user_time: str | None,
    precision: str | None,
    device: DeviceTime | None,
    user_priority: bool = False,
) -> dict[str, Any]:
    device_time = _device_clock(device)
    if user_time is None:
        if device_time is None:
            return {
                "resolved_time": None,
                "decision": "missing",
                "source": None,
                "delta_minutes": None,
            }
        return {
            "resolved_time": device_time,
            "decision": "device_only",
            "source": device.source,
            "delta_minutes": None,
        }

    _time_minutes(user_time)
    if precision not in ("approximate", "exact"):
        raise SleepResolveError("提供用户时间时必须同时指定 approximate 或 exact 精度")
    if user_priority or precision == "exact" or device_time is None:
        return {
            "resolved_time": user_time,
            "decision": (
                "user_priority"
                if user_priority
                else "user_exact" if precision == "exact" else "user_only"
            ),
            "source": "user",
            "delta_minutes": (
                _clock_delta_minutes(user_time, device_time) if device_time is not None else None
            ),
        }

    delta = _clock_delta_minutes(user_time, device_time)
    if delta <= 60:
        return {
            "resolved_time": device_time,
            "decision": "device_within_60_minutes",
            "source": device.source,
            "delta_minutes": delta,
        }
    if delta < 120:
        return {
            "resolved_time": user_time,
            "decision": "user_61_to_119_minutes",
            "source": "user",
            "delta_minutes": delta,
        }
    return {
        "resolved_time": None,
        "decision": "confirmation_required",
        "source": None,
        "delta_minutes": delta,
        "user_time": user_time,
        "device_time": device_time,
        "device_source": device.source,
    }


def resolve(args: argparse.Namespace) -> dict[str, Any]:
    target = _parse_date(args.date)
    if (args.sleep_time is None) != (args.sleep_precision is None):
        raise SleepResolveError("--sleep-time 与 --sleep-precision 必须一起提供")
    if (args.wake_time is None) != (args.wake_precision is None):
        raise SleepResolveError("--wake-time 与 --wake-precision 必须一起提供")
    if args.sleep_user_priority and args.sleep_time is None:
        raise SleepResolveError("--sleep-user-priority 必须与用户入睡时间一起提供")
    if args.wake_user_priority and args.wake_time is None:
        raise SleepResolveError("--wake-user-priority 必须与用户醒来时间一起提供")
    if args.out_of_bed_time is not None:
        _time_minutes(args.out_of_bed_time)

    device_sleep, device_wake, device_selection = resolve_device_times(
        args.summary.resolve(), args.details.resolve(), target
    )
    sleep = _resolve_field(
        args.sleep_time, args.sleep_precision, device_sleep, args.sleep_user_priority
    )
    wake = _resolve_field(
        args.wake_time, args.wake_precision, device_wake, args.wake_user_priority
    )
    confirmation_fields = [
        field
        for field, result in (("sleep_time", sleep), ("wake_time", wake))
        if result["decision"] == "confirmation_required"
    ]
    return {
        "action": "resolved",
        "date": target.isoformat(),
        "device_selection": device_selection,
        "sleep_time": sleep,
        "wake_time": wake,
        "out_of_bed_time": {
            "resolved_time": args.out_of_bed_time,
            "decision": "user_only" if args.out_of_bed_time is not None else "missing",
            "source": "user" if args.out_of_bed_time is not None else None,
        },
        "confirmation_required": confirmation_fields,
    }


def _parser() -> argparse.ArgumentParser:
    project_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="只读解析并校准苹果健康睡眠时间")
    subparsers = parser.add_subparsers(dest="command", required=True)
    command = subparsers.add_parser("resolve", help="解析设备记录并逐字段核对用户时间")
    command.add_argument("--date", required=True)
    command.add_argument(
        "--summary", type=Path, default=project_root / "records" / "apple-health-latest.txt"
    )
    command.add_argument(
        "--details",
        type=Path,
        default=project_root / "records" / "apple-sleep-details-latest.txt",
    )
    command.add_argument("--sleep-time")
    command.add_argument("--sleep-precision", choices=("approximate", "exact"))
    command.add_argument(
        "--sleep-user-priority",
        action="store_true",
        help="用户否定设备或明确要求以自己的入睡时间为准",
    )
    command.add_argument("--wake-time")
    command.add_argument("--wake-precision", choices=("approximate", "exact"))
    command.add_argument(
        "--wake-user-priority",
        action="store_true",
        help="用户否定设备或明确要求以自己的醒来时间为准",
    )
    command.add_argument("--out-of-bed-time")
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        if args.command != "resolve":  # pragma: no cover - argparse 会拦截
            raise SleepResolveError("未知命令")
        result = resolve(args)
    except SleepResolveError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
