#!/usr/bin/env python3
"""Archive the minimal Apple Health shortcut summary as a private daily ledger.

The source is treated as untrusted data. Only the six documented keys are
parsed, no source text is echoed, and one normalized record is kept per local
generation date.
"""

from __future__ import annotations

import argparse
import copy
import fcntl
import json
import math
import os
import re
import sys
import tempfile
import time
from contextlib import contextmanager
from datetime import date as Date
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterator
from zoneinfo import ZoneInfo


SCHEMA_VERSION = 1
DATA_FILE = "apple-health-history.jsonl"
LOCK_FILE = ".apple-health-history.lock"
SOURCE_FILE = "apple-health-latest.txt"
MAX_SOURCE_BYTES = 64 * 1024
LOCK_TIMEOUT_SECONDS = 10.0
LOCAL_ZONE = ZoneInfo("Asia/Shanghai")

SOURCE_KEYS = (
    "generated_at",
    "steps",
    "active_energy",
    "exercise_minutes",
    "sleep_start",
    "sleep_end",
)
METRIC_FIELDS = ("steps", "active_energy", "exercise_minutes")
SLEEP_FIELDS = ("sleep_start", "sleep_end")
RECORD_FIELDS = {
    "schema_version",
    "key",
    "date",
    "generated_at",
    *METRIC_FIELDS,
    *SLEEP_FIELDS,
    "revision",
    "created_at",
    "updated_at",
}

_SOURCE_DATETIME_RE = re.compile(
    r"^(?P<year>\d{4})年(?P<month>\d{1,2})月(?P<day>\d{1,2})日\s+"
    r"(?P<hour>\d{1,2}):(?P<minute>\d{2})(?::(?P<second>\d{2}))?$"
)
_ISO_LOCAL_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\+08:00|\+0800)$"
)
_UTC_TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
_NONNEGATIVE_NUMBER_RE = re.compile(r"^(?:0|[1-9]\d*)(?:\.\d+)?$")


class HealthHistoryError(RuntimeError):
    """Safe, content-free error for callers."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _validate_date(value: str) -> str:
    try:
        parsed = Date.fromisoformat(value)
    except ValueError as error:
        raise HealthHistoryError("日期必须是有效的 YYYY-MM-DD") from error
    if parsed.isoformat() != value:
        raise HealthHistoryError("日期必须是有效的 YYYY-MM-DD")
    return value


def _parse_source_datetime(value: str, field: str, *, allow_empty: bool) -> str | None:
    normalized = value.strip()
    if not normalized:
        if allow_empty:
            return None
        raise HealthHistoryError(f"{field} 不能为空")
    match = _SOURCE_DATETIME_RE.fullmatch(normalized)
    if match is None:
        raise HealthHistoryError(f"{field} 的本地日期时间格式无效")
    parts = {name: int(value) if value is not None else 0 for name, value in match.groupdict().items()}
    try:
        parsed = datetime(
            parts["year"],
            parts["month"],
            parts["day"],
            parts["hour"],
            parts["minute"],
            parts["second"],
            tzinfo=LOCAL_ZONE,
        )
    except ValueError as error:
        raise HealthHistoryError(f"{field} 的本地日期时间无效") from error
    return parsed.isoformat(timespec="seconds")


def _parse_metric(value: str, field: str) -> int | float | None:
    normalized = value.strip()
    if not normalized:
        return None
    if _NONNEGATIVE_NUMBER_RE.fullmatch(normalized) is None:
        raise HealthHistoryError(f"{field} 必须为空或非负数字")
    try:
        parsed = Decimal(normalized)
    except InvalidOperation as error:
        raise HealthHistoryError(f"{field} 必须为空或非负数字") from error
    if not parsed.is_finite() or parsed < 0:
        raise HealthHistoryError(f"{field} 必须为空或非负数字")
    if field == "steps" and parsed != parsed.to_integral_value():
        raise HealthHistoryError("steps 必须为空或非负整数")
    if parsed == parsed.to_integral_value():
        return int(parsed)
    return float(parsed)


def _read_source(source_path: Path) -> dict[str, Any]:
    try:
        stat_result = source_path.lstat()
    except FileNotFoundError as error:
        raise HealthHistoryError("苹果健康摘要不存在") from error
    if source_path.is_symlink() or not source_path.is_file() or stat_result.st_nlink != 1:
        raise HealthHistoryError("苹果健康摘要必须是单一普通文件")
    if stat_result.st_size > MAX_SOURCE_BYTES:
        raise HealthHistoryError("苹果健康摘要大小异常")
    try:
        raw = source_path.read_bytes()
        text = raw.decode("utf-8")
    except (OSError, UnicodeDecodeError) as error:
        raise HealthHistoryError("苹果健康摘要无法安全读取") from error

    recognized: dict[str, str] = {}
    for line in text.splitlines():
        key, separator, value = line.partition(":")
        key = key.strip()
        if not separator or key not in SOURCE_KEYS:
            continue
        if key in recognized:
            raise HealthHistoryError(f"苹果健康摘要中 {key} 重复")
        recognized[key] = value.strip()
    missing = [key for key in SOURCE_KEYS if key not in recognized]
    if missing:
        raise HealthHistoryError("苹果健康摘要缺少固定字段：" + ", ".join(missing))

    generated_at = _parse_source_datetime(recognized["generated_at"], "generated_at", allow_empty=False)
    assert generated_at is not None
    return {
        "generated_at": generated_at,
        "steps": _parse_metric(recognized["steps"], "steps"),
        "active_energy": _parse_metric(recognized["active_energy"], "active_energy"),
        "exercise_minutes": _parse_metric(recognized["exercise_minutes"], "exercise_minutes"),
        "sleep_start": _parse_source_datetime(recognized["sleep_start"], "sleep_start", allow_empty=True),
        "sleep_end": _parse_source_datetime(recognized["sleep_end"], "sleep_end", allow_empty=True),
    }


def _validate_iso_local(value: Any, field: str, line_number: int, *, allow_none: bool) -> None:
    if value is None and allow_none:
        return
    if not isinstance(value, str) or _ISO_LOCAL_RE.fullmatch(value) is None:
        raise HealthHistoryError(f"{DATA_FILE} 第 {line_number} 行的 {field} 无效")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as error:
        raise HealthHistoryError(f"{DATA_FILE} 第 {line_number} 行的 {field} 无效") from error
    if parsed.utcoffset() != LOCAL_ZONE.utcoffset(parsed):
        raise HealthHistoryError(f"{DATA_FILE} 第 {line_number} 行的 {field} 时区无效")


def _validate_utc_timestamp(value: Any, field: str, line_number: int) -> datetime:
    if not isinstance(value, str) or _UTC_TIMESTAMP_RE.fullmatch(value) is None:
        raise HealthHistoryError(f"{DATA_FILE} 第 {line_number} 行的 {field} 无效")
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError as error:
        raise HealthHistoryError(f"{DATA_FILE} 第 {line_number} 行的 {field} 无效") from error


def _validate_record(record: Any, line_number: int) -> dict[str, Any]:
    if not isinstance(record, dict) or set(record) != RECORD_FIELDS:
        raise HealthHistoryError(f"{DATA_FILE} 第 {line_number} 行字段集无效")
    if record.get("schema_version") != SCHEMA_VERSION:
        raise HealthHistoryError(f"{DATA_FILE} 第 {line_number} 行的 schema_version 无效")
    record_date = _validate_date(str(record.get("date", "")))
    if record.get("key") != f"apple-health-summary:{record_date}":
        raise HealthHistoryError(f"{DATA_FILE} 第 {line_number} 行的 key 无效")
    _validate_iso_local(record.get("generated_at"), "generated_at", line_number, allow_none=False)
    if record["generated_at"][:10] != record_date:
        raise HealthHistoryError(f"{DATA_FILE} 第 {line_number} 行的 generated_at 与 date 不一致")
    for field in METRIC_FIELDS:
        value = record.get(field)
        if value is not None and (
            type(value) not in (int, float) or not math.isfinite(value) or value < 0
        ):
            raise HealthHistoryError(f"{DATA_FILE} 第 {line_number} 行的 {field} 无效")
    if record.get("steps") is not None and type(record["steps"]) is not int:
        raise HealthHistoryError(f"{DATA_FILE} 第 {line_number} 行的 steps 无效")
    for field in SLEEP_FIELDS:
        _validate_iso_local(record.get(field), field, line_number, allow_none=True)
    if type(record.get("revision")) is not int or record["revision"] < 1:
        raise HealthHistoryError(f"{DATA_FILE} 第 {line_number} 行的 revision 无效")
    created_at = _validate_utc_timestamp(record.get("created_at"), "created_at", line_number)
    updated_at = _validate_utc_timestamp(record.get("updated_at"), "updated_at", line_number)
    if created_at > updated_at:
        raise HealthHistoryError(f"{DATA_FILE} 第 {line_number} 行的时间顺序无效")
    return record


def _load_records(data_path: Path) -> tuple[bytes, list[dict[str, Any]]]:
    try:
        raw = data_path.read_bytes()
    except FileNotFoundError:
        return b"", []
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise HealthHistoryError(f"{DATA_FILE} 不是有效 UTF-8") from error
    records: list[dict[str, Any]] = []
    seen: set[str] = set()
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as error:
            raise HealthHistoryError(f"{DATA_FILE} 第 {line_number} 行不是有效 JSON") from error
        validated = _validate_record(record, line_number)
        if validated["date"] in seen:
            raise HealthHistoryError(f"{DATA_FILE} 存在重复日期，已停止写入")
        seen.add(validated["date"])
        records.append(validated)
    return raw, records


def _serialize_records(records: list[dict[str, Any]]) -> bytes:
    return "".join(
        json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
        for record in sorted(records, key=lambda item: item["date"])
    ).encode("utf-8")


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
                    raise HealthHistoryError("健康历史正在被另一个进程更新，请稍后重试")
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
        raise HealthHistoryError("健康历史在本次更新期间发生变化，已停止覆盖")
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


def ingest(root: Path, source_path: Path, expected_date: str | None) -> dict[str, Any]:
    source = _read_source(source_path)
    record_date = source["generated_at"][:10]
    if expected_date is not None and _validate_date(expected_date) != record_date:
        raise HealthHistoryError("苹果健康摘要不是指定日期生成，已忽略")
    key = f"apple-health-summary:{record_date}"

    with _records_lock(root):
        data_path = root / DATA_FILE
        original, records = _load_records(data_path)
        existing = next((record for record in records if record["date"] == record_date), None)
        now = _utc_now()
        if existing is None:
            record = {
                "schema_version": SCHEMA_VERSION,
                "key": key,
                "date": record_date,
                **source,
                "revision": 1,
                "created_at": now,
                "updated_at": now,
            }
            records.append(record)
            changed_fields = list(SOURCE_KEYS)
            action = "created"
        else:
            incoming_generated = datetime.fromisoformat(source["generated_at"])
            current_generated = datetime.fromisoformat(existing["generated_at"])
            if incoming_generated < current_generated:
                raise HealthHistoryError("同日摘要比已归档版本更早，已停止覆盖")
            record = copy.deepcopy(existing)
            changed_fields = []
            for field in SOURCE_KEYS:
                if record[field] != source[field]:
                    record[field] = source[field]
                    changed_fields.append(field)
            if changed_fields:
                record["revision"] += 1
                record["updated_at"] = now
                records[records.index(existing)] = record
                action = "updated"
            else:
                action = "unchanged"
        if changed_fields:
            _validate_record(record, 1)
            _atomic_replace_if_unchanged(data_path, original, _serialize_records(records))

    return {
        "action": action,
        "date": record_date,
        "key": key,
        "revision": record["revision"],
        "fields_updated": sorted(changed_fields),
    }


def list_records(root: Path, start: str, end: str) -> dict[str, Any]:
    start_date = _validate_date(start)
    end_date = _validate_date(end)
    if start_date > end_date:
        raise HealthHistoryError("--start 不能晚于 --end")
    _, records = _load_records(root / DATA_FILE)
    selected = [record for record in records if start_date <= record["date"] <= end_date]
    return {"count": len(selected), "records": selected}


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="幂等维护 iCloud 内的苹果健康日摘要历史")
    subparsers = parser.add_subparsers(dest="command", required=True)

    ingest_parser = subparsers.add_parser("ingest", help="归档最新六行摘要")
    ingest_parser.add_argument("--root", type=Path, default=Path("records"))
    ingest_parser.add_argument("--source", type=Path)
    ingest_parser.add_argument("--expect-date")

    list_parser = subparsers.add_parser("list", help="按日期范围读取客观历史")
    list_parser.add_argument("--root", type=Path, default=Path("records"))
    list_parser.add_argument("--start", required=True)
    list_parser.add_argument("--end", required=True)
    return parser


def main() -> int:
    args = _build_parser().parse_args()
    try:
        if args.command == "ingest":
            source_path = args.source if args.source is not None else args.root / SOURCE_FILE
            result = ingest(args.root, source_path, args.expect_date)
        else:
            result = list_records(args.root, args.start, args.end)
    except (HealthHistoryError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
