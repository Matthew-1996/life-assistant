#!/usr/bin/env python3
"""按日期幂等维护低负担生活状态回访。

只保存规范化字段和经去敏的短摘要，不接收或保存完整对话原文；
删除要求精确确认，并只证明当前项目源记录已移除。
"""

from __future__ import annotations

import argparse
import copy
import fcntl
import hashlib
import json
import os
import re
import sys
import tempfile
import time
from contextlib import contextmanager
from datetime import date as Date
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator


SCHEMA_VERSION = 2
LEGACY_SCHEMA_VERSION = 1
DATA_FILE = "daily-checkins.jsonl"
LOCK_FILE = ".daily-checkins.lock"
LOCK_TIMEOUT_SECONDS = 10.0
ANCHOR_VALUES = ("complete", "minimum", "skipped")
YES_NO_VALUES = ("yes", "no")
RATING_FIELDS = ("sleep_quality", "energy", "mood", "life_feeling")
ANCHOR_FIELDS = ("wake", "body_light", "life_action", "wind_down")
CLEARABLE_FIELDS = (
    "sleep_time",
    "wake_time",
    "out_of_bed_time",
    *RATING_FIELDS,
    "awake_in_bed",
    *ANCHOR_FIELDS,
    "note_summary",
)

_TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
_TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
_WHITESPACE_RE = re.compile(r"\s+")
_SENSITIVE_PATTERNS = (
    re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    re.compile(
        r"(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\."
        r"[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])"
    ),
    re.compile(
        r"(?i)-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY(?: BLOCK)?-----.*?"
        r"(?:-----END(?: [A-Z0-9]+)* PRIVATE KEY(?: BLOCK)?-----|$)"
    ),
    re.compile(r"(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])"),
    re.compile(r"(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{20,}(?![A-Za-z0-9_])"),
    re.compile(r"(?<![A-Za-z0-9-])xox[baprs]-[A-Za-z0-9-]{10,}(?![A-Za-z0-9-])"),
    re.compile(
        r"(?i)(?:恢复码|恢复代码|恢复密钥|recovery code|backup code)"
        r"\s*[:=：]?\s*[\"']?(?:(?:[A-Za-z0-9]{4}[\s-]+)+[A-Za-z0-9]{4}|"
        r"[A-Za-z0-9-]{8,})[\"']?"
    ),
    re.compile(
        r"(?i)\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)"
        r"\s*[:=：]\s*(?:\"[^\"]{6,}\"|'[^']{6,}'|[^\s,;\uff0c\uff1b]{6,})"
    ),
    re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b"),
    re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"),
    re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)"),
    re.compile(r"(?<!\d)\d{12,19}(?!\d)"),
)


class CheckinError(RuntimeError):
    """可向调用者安全展示的回访数据错误。"""


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _validate_date(value: str) -> str:
    try:
        parsed = Date.fromisoformat(value)
    except ValueError as error:
        raise CheckinError("--date 必须是有效的 YYYY-MM-DD") from error
    normalized = parsed.isoformat()
    if normalized != value:
        raise CheckinError("--date 必须是有效的 YYYY-MM-DD")
    return normalized


def _validate_week_start(value: str) -> Date:
    normalized = _validate_date(value)
    parsed = Date.fromisoformat(normalized)
    if parsed.weekday() != 0:
        raise CheckinError("--week-start 必须是自然周周一")
    return parsed


def _validate_time(value: str | None, option_name: str) -> str | None:
    if value is None:
        return None
    if not _TIME_RE.fullmatch(value):
        raise CheckinError(f"{option_name} 必须是 24 小时制 HH:MM")
    return value


def _validate_rating(value: int | None, option_name: str) -> int | None:
    if value is None:
        return None
    if not 1 <= value <= 5:
        raise CheckinError(f"{option_name} 必须是 1–5")
    return value


def _validate_timestamp(value: Any, field: str, line_number: int) -> datetime:
    if not isinstance(value, str) or not _TIMESTAMP_RE.fullmatch(value):
        raise CheckinError(f"{DATA_FILE} 第 {line_number} 行的 {field} 无效")
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError as error:
        raise CheckinError(f"{DATA_FILE} 第 {line_number} 行的 {field} 无效") from error


def _redact_summary(value: str | None) -> str | None:
    if value is None:
        return None
    summary = _WHITESPACE_RE.sub(" ", value).strip()
    if not summary:
        return None
    for pattern in _SENSITIVE_PATTERNS:
        summary = pattern.sub("[敏感信息已省略]", summary)
    if len(summary) > 160:
        raise CheckinError("--note-summary 必须是 160 字符以内的去敏摘要，不要传入整段原文")
    return summary


def _empty_record(checkin_date: str, timestamp: str) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "key": f"daily-checkin:{checkin_date}",
        "date": checkin_date,
        "sleep_time": None,
        "wake_time": None,
        "out_of_bed_time": None,
        "ratings": {field: None for field in RATING_FIELDS},
        "awake_in_bed": None,
        "anchors": {field: None for field in ANCHOR_FIELDS},
        "note_summary": None,
        "revision": 0,
        "created_at": timestamp,
        "updated_at": timestamp,
    }


def _validate_record(
    record: Any,
    line_number: int,
    *,
    allow_legacy: bool = False,
) -> dict[str, Any]:
    if not isinstance(record, dict):
        raise CheckinError(f"{DATA_FILE} 第 {line_number} 行必须是 JSON 对象")
    current_fields = {
        "schema_version",
        "key",
        "date",
        "sleep_time",
        "wake_time",
        "out_of_bed_time",
        "ratings",
        "awake_in_bed",
        "anchors",
        "note_summary",
        "revision",
        "created_at",
        "updated_at",
    }
    legacy_fields = current_fields - {"wake_time"}
    schema_version = record.get("schema_version")
    if schema_version == SCHEMA_VERSION:
        required_fields = current_fields
    elif allow_legacy and schema_version == LEGACY_SCHEMA_VERSION:
        required_fields = legacy_fields
    else:
        raise CheckinError(
            f"{DATA_FILE} 第 {line_number} 行的 schema_version 无效；"
            "请先运行 migrate-v2"
        )
    if set(record) != required_fields:
        raise CheckinError(
            f"{DATA_FILE} 第 {line_number} 行字段集无效；未知字段不会被保留"
        )
    checkin_date = _validate_date(str(record.get("date", "")))
    expected_key = f"daily-checkin:{checkin_date}"
    if record.get("key") != expected_key:
        raise CheckinError(f"{DATA_FILE} 第 {line_number} 行的 key 无效")
    if type(record.get("revision")) is not int or record["revision"] < 1:
        raise CheckinError(f"{DATA_FILE} 第 {line_number} 行的 revision 无效")
    _validate_time(record.get("sleep_time"), "sleep_time")
    if schema_version == SCHEMA_VERSION:
        _validate_time(record.get("wake_time"), "wake_time")
    _validate_time(record.get("out_of_bed_time"), "out_of_bed_time")
    ratings = record.get("ratings")
    anchors = record.get("anchors")
    if not isinstance(ratings, dict) or set(ratings) != set(RATING_FIELDS):
        raise CheckinError(f"{DATA_FILE} 第 {line_number} 行的 ratings 结构无效")
    if not isinstance(anchors, dict) or set(anchors) != set(ANCHOR_FIELDS):
        raise CheckinError(f"{DATA_FILE} 第 {line_number} 行的 anchors 结构无效")
    for field in RATING_FIELDS:
        _validate_rating(ratings[field], field)
    for field in ANCHOR_FIELDS:
        if anchors[field] not in (*ANCHOR_VALUES, None):
            raise CheckinError(f"{DATA_FILE} 第 {line_number} 行的 anchors.{field} 无效")
    if record.get("awake_in_bed") not in (*YES_NO_VALUES, None):
        raise CheckinError(f"{DATA_FILE} 第 {line_number} 行的 awake_in_bed 无效")
    created_at = _validate_timestamp(record.get("created_at"), "created_at", line_number)
    updated_at = _validate_timestamp(record.get("updated_at"), "updated_at", line_number)
    if created_at > updated_at:
        raise CheckinError(f"{DATA_FILE} 第 {line_number} 行的时间顺序无效")
    note = record.get("note_summary")
    if note is not None and (not isinstance(note, str) or _redact_summary(note) != note):
        raise CheckinError(f"{DATA_FILE} 第 {line_number} 行的 note_summary 未通过去敏校验")
    return record


def _load_records_bytes(
    data_path: Path,
    *,
    allow_legacy: bool = False,
) -> tuple[bytes, list[dict[str, Any]]]:
    try:
        raw = data_path.read_bytes()
    except FileNotFoundError:
        return b"", []
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise CheckinError(f"{DATA_FILE} 不是有效 UTF-8") from error
    records: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    seen_dates: set[str] = set()
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as error:
            raise CheckinError(f"{DATA_FILE} 第 {line_number} 行不是有效 JSON") from error
        validated = _validate_record(record, line_number, allow_legacy=allow_legacy)
        if validated["key"] in seen_keys or validated["date"] in seen_dates:
            raise CheckinError(f"{DATA_FILE} 存在重复日期或稳定键，已停止写入")
        seen_keys.add(validated["key"])
        seen_dates.add(validated["date"])
        records.append(validated)
    return raw, records


def _serialize_records(records: list[dict[str, Any]]) -> bytes:
    ordered = sorted(records, key=lambda record: record["date"])
    text = "".join(
        json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
        for record in ordered
    )
    return text.encode("utf-8")


def _record_etag(record: dict[str, Any]) -> str:
    return hashlib.sha256(_serialize_records([record])).hexdigest()


@contextmanager
def _records_lock(root: Path) -> Iterator[None]:
    root.mkdir(parents=True, exist_ok=True)
    lock_path = root / LOCK_FILE
    with lock_path.open("a+b") as lock_file:
        deadline = time.monotonic() + LOCK_TIMEOUT_SECONDS
        while True:
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise CheckinError("日状态台账正在被另一个进程更新，请稍后重试")
                time.sleep(0.05)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _atomic_replace_if_unchanged(data_path: Path, expected: bytes, content: bytes) -> None:
    try:
        current = data_path.read_bytes()
    except FileNotFoundError:
        current = b""
    if current != expected:
        raise CheckinError("日状态台账在本次更新期间发生了变化，已停止覆盖；请重试")

    data_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(
        prefix=f".{data_path.name}.", suffix=".tmp", dir=data_path.parent
    )
    temp_path = Path(temp_name)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as temp_file:
            temp_file.write(content)
            temp_file.flush()
            os.fsync(temp_file.fileno())
        os.replace(temp_path, data_path)
        try:
            directory_fd = os.open(data_path.parent, os.O_RDONLY)
        except OSError:
            directory_fd = None
        if directory_fd is not None:
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
    finally:
        try:
            temp_path.unlink()
        except FileNotFoundError:
            pass


def upsert(root: Path, args: argparse.Namespace) -> dict[str, Any]:
    checkin_date = _validate_date(args.date)
    clear_fields = set(args.clear_field or [])
    updates: dict[str, Any] = {}
    if args.sleep_time is not None:
        updates["sleep_time"] = _validate_time(args.sleep_time, "--sleep-time")
    if args.wake_time is not None:
        updates["wake_time"] = _validate_time(args.wake_time, "--wake-time")
    if args.out_of_bed_time is not None:
        updates["out_of_bed_time"] = _validate_time(args.out_of_bed_time, "--out-of-bed-time")
    if args.awake_in_bed is not None:
        updates["awake_in_bed"] = args.awake_in_bed
    if args.note_summary is not None:
        note_summary = _redact_summary(args.note_summary)
        if note_summary is not None:
            updates["note_summary"] = note_summary

    rating_updates = {
        field: _validate_rating(getattr(args, field), f"--{field.replace('_', '-')}")
        for field in RATING_FIELDS
        if getattr(args, field) is not None
    }
    anchor_updates = {
        field: getattr(args, field)
        for field in ANCHOR_FIELDS
        if getattr(args, field) is not None
    }
    provided_fields = set(updates) | set(rating_updates) | set(anchor_updates)
    overlap = sorted(clear_fields.intersection(provided_fields))
    if overlap:
        raise CheckinError(
            "同一字段不能同时更新和清空：" + ", ".join(overlap)
        )
    if not updates and not rating_updates and not anchor_updates and not clear_fields:
        raise CheckinError("至少提供一个要更新的状态字段")

    with _records_lock(root):
        data_path = root / DATA_FILE
        original, records = _load_records_bytes(data_path)
        key = f"daily-checkin:{checkin_date}"
        existing = next((record for record in records if record["key"] == key), None)
        if existing is None and clear_fields:
            raise CheckinError("不能清空尚不存在的日状态记录")
        timestamp = _utc_now()
        action = "updated" if existing else "created"
        base_record = existing if existing is not None else _empty_record(checkin_date, timestamp)
        current_revision = int(base_record["revision"])
        if args.expect_revision is not None and args.expect_revision != current_revision:
            raise CheckinError(
                f"修订冲突：期望 revision={args.expect_revision}，当前 revision={current_revision}"
            )

        record = copy.deepcopy(base_record)
        changed_fields: list[str] = []
        for field, value in updates.items():
            if record[field] != value:
                record[field] = value
                changed_fields.append(field)
        for field, value in rating_updates.items():
            if record["ratings"][field] != value:
                record["ratings"][field] = value
                changed_fields.append(f"ratings.{field}")
        for field, value in anchor_updates.items():
            if record["anchors"][field] != value:
                record["anchors"][field] = value
                changed_fields.append(f"anchors.{field}")
        for field in sorted(clear_fields):
            if field in RATING_FIELDS:
                container = record["ratings"]
                changed_name = f"ratings.{field}"
            elif field in ANCHOR_FIELDS:
                container = record["anchors"]
                changed_name = f"anchors.{field}"
            else:
                container = record
                changed_name = field
            if container[field] is not None:
                container[field] = None
                changed_fields.append(changed_name)

        if not changed_fields:
            if existing is None:
                raise CheckinError("所有输入规范化后均为空，未创建日状态记录")
            action = "unchanged"
            record = base_record
        else:
            record["revision"] = current_revision + 1
            record["updated_at"] = timestamp
            if existing is None:
                records.append(record)
            else:
                records[records.index(existing)] = record
            _atomic_replace_if_unchanged(data_path, original, _serialize_records(records))

    changed_fields = sorted(changed_fields)
    return {
        "action": action,
        "key": key,
        "date": checkin_date,
        "revision": record["revision"],
        "fields_updated": changed_fields,
    }


def migrate_v2(root: Path) -> dict[str, Any]:
    """在同一文件锁内把 v1 记录原子迁移为 v2，旧记录的 wake_time 保持未知。"""

    with _records_lock(root):
        data_path = root / DATA_FILE
        original, records = _load_records_bytes(data_path, allow_legacy=True)
        timestamp = _utc_now()
        migrated_count = 0
        migrated_records: list[dict[str, Any]] = []
        for record in records:
            if record["schema_version"] == SCHEMA_VERSION:
                migrated_records.append(record)
                continue
            migrated = copy.deepcopy(record)
            migrated["schema_version"] = SCHEMA_VERSION
            migrated["wake_time"] = None
            migrated["revision"] += 1
            migrated["updated_at"] = timestamp
            _validate_record(migrated, 1)
            migrated_records.append(migrated)
            migrated_count += 1

        if migrated_count:
            _atomic_replace_if_unchanged(
                data_path,
                original,
                _serialize_records(migrated_records),
            )
            action = "migrated"
        else:
            action = "unchanged"
    return {
        "action": action,
        "schema_version": SCHEMA_VERSION,
        "migrated_count": migrated_count,
        "total_records": len(records),
    }


def purge_plan(root: Path, args: argparse.Namespace) -> dict[str, Any]:
    """只读预览指定日期的删除范围，不输出状态内容或摘要。"""

    checkin_date = _validate_date(args.date)
    key = f"daily-checkin:{checkin_date}"
    with _records_lock(root):
        _, records = _load_records_bytes(root / DATA_FILE)
        existing = next((record for record in records if record["key"] == key), None)
    return {
        "action": "purge_plan",
        "key": key,
        "date": checkin_date,
        "exists": existing is not None,
        "revision": existing["revision"] if existing is not None else None,
        "record_etag": _record_etag(existing) if existing is not None else None,
        "required_confirmation": key,
        "requires_historical_copies_acknowledgement": True,
        "workbook_sync_required": True,
    }


def purge(root: Path, args: argparse.Namespace) -> dict[str, Any]:
    """删除当前项目中的单日源记录；历史副本与聊天不在本命令范围内。"""

    checkin_date = _validate_date(args.date)
    key = f"daily-checkin:{checkin_date}"
    if args.confirm != key:
        raise CheckinError(f"--confirm 必须与稳定键完全一致：{key}")
    if not args.acknowledge_historical_copies:
        raise CheckinError(
            "永久删除前必须确认：旧 ZIP、聊天、iCloud/设备历史可能仍保留副本"
        )

    with _records_lock(root):
        data_path = root / DATA_FILE
        original, records = _load_records_bytes(data_path)
        existing = next((record for record in records if record["key"] == key), None)
        if existing is None:
            action = "already_absent"
            removed_revision = None
        else:
            if args.expect_revision != existing["revision"]:
                raise CheckinError(
                    f"修订冲突：期望 revision={args.expect_revision}，"
                    f"当前 revision={existing['revision']}"
                )
            if (
                not re.fullmatch(r"[0-9a-f]{64}", args.expect_record_etag)
                or args.expect_record_etag != _record_etag(existing)
            ):
                raise CheckinError("记录内容在删除预览后发生变化，已停止删除；请重新预览")
            removed_revision = existing["revision"]
            records.remove(existing)
            _atomic_replace_if_unchanged(data_path, original, _serialize_records(records))
            action = "purged"

    return {
        "action": action,
        "key": key,
        "date": checkin_date,
        "removed_revision": removed_revision,
        "workbook_sync_required": True,
        "historical_copies_not_deleted": True,
    }


def week_summary(root: Path, args: argparse.Namespace) -> dict[str, Any]:
    """只读汇总一个周一至周日自然周，永不输出自由文本摘要。"""

    week_start = _validate_week_start(args.week_start)
    week_end = week_start + timedelta(days=6)
    with _records_lock(root):
        _, all_records = _load_records_bytes(root / DATA_FILE)

    records = [
        record
        for record in all_records
        if week_start <= Date.fromisoformat(record["date"]) <= week_end
    ]
    rating_values = {
        field: [record["ratings"][field] for record in records if record["ratings"][field] is not None]
        for field in RATING_FIELDS
    }
    rating_counts = {field: len(values) for field, values in rating_values.items()}
    rating_averages = {
        field: (round(sum(values) / len(values), 2) if values else None)
        for field, values in rating_values.items()
    }
    awake_counts = {
        value: sum(record["awake_in_bed"] == value for record in records)
        for value in YES_NO_VALUES
    }
    anchor_counts = {
        field: {
            value: sum(record["anchors"][field] == value for record in records)
            for value in ANCHOR_VALUES
        }
        for field in ANCHOR_FIELDS
    }
    return {
        "action": "week_summary",
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "checkin_days": len(records),
        "rating_counts": rating_counts,
        "rating_averages": rating_averages,
        "awake_in_bed_counts": awake_counts,
        "anchor_counts": anchor_counts,
    }


def _add_root_argument(command: argparse.ArgumentParser) -> None:
    command.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "records",
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="幂等维护每日生活状态，不保存对话原文")
    subparsers = parser.add_subparsers(dest="command", required=True)
    command = subparsers.add_parser("upsert", help="按日期创建或更新唯一记录")
    _add_root_argument(command)
    command.add_argument("--date", required=True)
    command.add_argument("--sleep-time")
    command.add_argument("--wake-time")
    command.add_argument("--out-of-bed-time")
    command.add_argument("--sleep-quality", type=int)
    command.add_argument("--energy", type=int)
    command.add_argument("--mood", type=int)
    command.add_argument("--life-feeling", type=int)
    command.add_argument("--awake-in-bed", choices=YES_NO_VALUES)
    command.add_argument("--wake", choices=ANCHOR_VALUES)
    command.add_argument("--body-light", choices=ANCHOR_VALUES)
    command.add_argument("--life-action", choices=ANCHOR_VALUES)
    command.add_argument("--wind-down", choices=ANCHOR_VALUES)
    command.add_argument("--note-summary")
    command.add_argument(
        "--clear-field",
        action="append",
        choices=CLEARABLE_FIELDS,
        help="更正时将指定字段恢复为未知；可重复使用",
    )
    command.add_argument("--expect-revision", type=int)

    plan_command = subparsers.add_parser("purge-plan", help="只读预览单日删除范围")
    _add_root_argument(plan_command)
    plan_command.add_argument("--date", required=True)

    purge_command = subparsers.add_parser("purge", help="精确删除当前项目中的单日源记录")
    _add_root_argument(purge_command)
    purge_command.add_argument("--date", required=True)
    purge_command.add_argument("--confirm", required=True)
    purge_command.add_argument("--acknowledge-historical-copies", action="store_true")
    purge_command.add_argument("--expect-revision", type=int, required=True)
    purge_command.add_argument("--expect-record-etag", required=True)

    week_command = subparsers.add_parser(
        "week-summary",
        help="只读汇总周一至周日的结构化状态，不输出 note_summary",
    )
    _add_root_argument(week_command)
    week_command.add_argument("--week-start", required=True)

    migrate_command = subparsers.add_parser(
        "migrate-v2",
        help="原子迁移 v1 台账；旧记录的醒来时间保持未知",
    )
    _add_root_argument(migrate_command)
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        if args.command == "upsert":
            result = upsert(args.root.resolve(), args)
        elif args.command == "purge-plan":
            result = purge_plan(args.root.resolve(), args)
        elif args.command == "purge":
            result = purge(args.root.resolve(), args)
        elif args.command == "week-summary":
            result = week_summary(args.root.resolve(), args)
        elif args.command == "migrate-v2":
            result = migrate_v2(args.root.resolve())
        else:  # pragma: no cover - argparse 会拦截
            raise CheckinError("未知命令")
    except CheckinError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
