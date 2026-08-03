#!/usr/bin/env python3
"""按 ISO 自然周幂等维护低暴露的生活周复盘回答。

本工具只接受助手从用户明确回答中提取的一句话摘要，不保存完整对话、
日记回顾或助手推断。摘要通过 stdin 传入；删除只覆盖当前项目源记录，
并要求精确周键、revision、内容哈希与历史副本边界确认。
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


SCHEMA_VERSION = 1
DATA_FILE = "weekly-reviews.jsonl"
LOCK_FILE = ".weekly-reviews.lock"
LOCK_TIMEOUT_SECONDS = 10.0
MAX_INPUT_BYTES = 8192
MAX_SUMMARY_LENGTH = 160

SUMMARY_FIELDS = (
    "better_summary",
    "friction_summary",
    "experiment_summary",
    "stop_summary",
)
GOAL_FIELD = "goal_intent"
ANSWER_FIELDS = (*SUMMARY_FIELDS, GOAL_FIELD)
GOAL_INTENTS = (
    "continue",
    "adjust",
    "downgrade",
    "pause",
    "complete",
    "replace",
    "unsure",
)

_TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
_ETAG_RE = re.compile(r"^[0-9a-f]{64}$")
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


class WeeklyReviewError(RuntimeError):
    """可向调用者安全展示、且不包含复盘内容的错误。"""


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _validate_date(value: Any, option_name: str) -> str:
    if not isinstance(value, str):
        raise WeeklyReviewError(f"{option_name} 必须是有效的 YYYY-MM-DD")
    try:
        parsed = Date.fromisoformat(value)
    except ValueError as error:
        raise WeeklyReviewError(f"{option_name} 必须是有效的 YYYY-MM-DD") from error
    if parsed.isoformat() != value:
        raise WeeklyReviewError(f"{option_name} 必须是有效的 YYYY-MM-DD")
    return value


def _week_details(week_start: Any) -> dict[str, str]:
    normalized = _validate_date(week_start, "--week-start")
    start = Date.fromisoformat(normalized)
    if start.weekday() != 0:
        raise WeeklyReviewError("--week-start 必须是周一，周记录只接受周一至周日自然周")
    iso_year, iso_number, iso_weekday = start.isocalendar()
    if iso_weekday != 1 or Date.fromisocalendar(iso_year, iso_number, 1) != start:
        raise WeeklyReviewError("--week-start 无法映射到唯一 ISO 自然周")
    iso_week = f"{iso_year:04d}-W{iso_number:02d}"
    return {
        "key": f"weekly-review:{iso_week}",
        "iso_week": iso_week,
        "week_start": start.isoformat(),
        "week_end": (start + timedelta(days=6)).isoformat(),
    }


def _validate_timestamp(value: Any, field: str, line_number: int) -> datetime:
    if not isinstance(value, str) or not _TIMESTAMP_RE.fullmatch(value):
        raise WeeklyReviewError(f"{DATA_FILE} 第 {line_number} 行的 {field} 无效")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError as error:
        raise WeeklyReviewError(f"{DATA_FILE} 第 {line_number} 行的 {field} 无效") from error
    return parsed


def _redact_summary(value: str) -> str:
    summary = _WHITESPACE_RE.sub(" ", value).strip()
    if not summary:
        raise WeeklyReviewError("复盘摘要规范化后不能为空；未回答的字段请直接省略")
    for pattern in _SENSITIVE_PATTERNS:
        summary = pattern.sub("[敏感信息已省略]", summary)
    if len(summary) > MAX_SUMMARY_LENGTH:
        raise WeeklyReviewError(
            f"每个复盘摘要必须在 {MAX_SUMMARY_LENGTH} 字符以内，不要传入整段回复"
        )
    return summary


def _reject_json_constant(_: str) -> None:
    raise WeeklyReviewError("JSON 不能包含 NaN 或 Infinity")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise WeeklyReviewError("JSON 包含重复字段，已停止处理")
        result[key] = value
    return result


def _strict_json_loads(text: str, context: str) -> Any:
    try:
        return json.loads(
            text,
            object_pairs_hook=_unique_object,
            parse_constant=_reject_json_constant,
        )
    except WeeklyReviewError:
        raise
    except json.JSONDecodeError as error:
        raise WeeklyReviewError(f"{context} 不是有效 JSON") from error


def _read_upsert_input() -> dict[str, Any]:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        raise WeeklyReviewError(
            f"stdin 输入不能超过 {MAX_INPUT_BYTES} 字节；只传结构化短摘要，不要传整段回复"
        )
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise WeeklyReviewError("stdin 不是有效 UTF-8") from error
    if not text.strip():
        raise WeeklyReviewError("--input - 需要从 stdin 读取一个 JSON 对象")
    payload = _strict_json_loads(text, "stdin 输入")
    if not isinstance(payload, dict):
        raise WeeklyReviewError("stdin 输入必须是 JSON 对象")
    unknown = set(payload) - set(ANSWER_FIELDS)
    if unknown:
        raise WeeklyReviewError("stdin 输入字段集无效；未知字段不会被保存")

    normalized: dict[str, Any] = {}
    for field, value in payload.items():
        if field in SUMMARY_FIELDS:
            if not isinstance(value, str):
                raise WeeklyReviewError(
                    f"{field} 必须是字符串；未知字段请省略，null 不是清空指令"
                )
            normalized[field] = _redact_summary(value)
        elif field == GOAL_FIELD:
            if not isinstance(value, str) or value not in GOAL_INTENTS:
                raise WeeklyReviewError(
                    f"{GOAL_FIELD} 必须是明确枚举值；未知状态请省略"
                )
            normalized[field] = value
    return normalized


def _empty_record(details: dict[str, str], timestamp: str) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "key": details["key"],
        "iso_week": details["iso_week"],
        "week_start": details["week_start"],
        "week_end": details["week_end"],
        "answers": {field: None for field in ANSWER_FIELDS},
        "revision": 0,
        "created_at": timestamp,
        "updated_at": timestamp,
    }


def _validate_record(record: Any, line_number: int) -> dict[str, Any]:
    if not isinstance(record, dict):
        raise WeeklyReviewError(f"{DATA_FILE} 第 {line_number} 行必须是 JSON 对象")
    required_fields = {
        "schema_version",
        "key",
        "iso_week",
        "week_start",
        "week_end",
        "answers",
        "revision",
        "created_at",
        "updated_at",
    }
    if set(record) != required_fields:
        raise WeeklyReviewError(
            f"{DATA_FILE} 第 {line_number} 行字段集无效；未知字段不会被保留"
        )
    if type(record.get("schema_version")) is not int or record["schema_version"] != SCHEMA_VERSION:
        raise WeeklyReviewError(f"{DATA_FILE} 第 {line_number} 行的 schema_version 无效")

    details = _week_details(record.get("week_start"))
    for field in ("key", "iso_week", "week_start", "week_end"):
        if record.get(field) != details[field]:
            raise WeeklyReviewError(f"{DATA_FILE} 第 {line_number} 行的自然周或稳定键无效")

    revision = record.get("revision")
    if type(revision) is not int or revision < 1:
        raise WeeklyReviewError(f"{DATA_FILE} 第 {line_number} 行的 revision 无效")
    created_at = _validate_timestamp(record.get("created_at"), "created_at", line_number)
    updated_at = _validate_timestamp(record.get("updated_at"), "updated_at", line_number)
    if created_at > updated_at:
        raise WeeklyReviewError(f"{DATA_FILE} 第 {line_number} 行的时间顺序无效")

    answers = record.get("answers")
    if not isinstance(answers, dict) or set(answers) != set(ANSWER_FIELDS):
        raise WeeklyReviewError(f"{DATA_FILE} 第 {line_number} 行的 answers 结构无效")
    for field in SUMMARY_FIELDS:
        value = answers[field]
        if value is not None and (
            not isinstance(value, str) or _redact_summary(value) != value
        ):
            raise WeeklyReviewError(
                f"{DATA_FILE} 第 {line_number} 行的 answers.{field} 未通过去敏校验"
            )
    if answers[GOAL_FIELD] not in (*GOAL_INTENTS, None):
        raise WeeklyReviewError(
            f"{DATA_FILE} 第 {line_number} 行的 answers.{GOAL_FIELD} 无效"
        )
    if all(answers[field] is None for field in ANSWER_FIELDS):
        raise WeeklyReviewError(f"{DATA_FILE} 第 {line_number} 行不能是全空周记录")
    return record


def _load_records_bytes(data_path: Path) -> tuple[bytes, list[dict[str, Any]]]:
    try:
        raw = data_path.read_bytes()
    except FileNotFoundError:
        return b"", []
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise WeeklyReviewError(f"{DATA_FILE} 不是有效 UTF-8") from error

    records: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    seen_weeks: set[str] = set()
    seen_starts: set[str] = set()
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = _strict_json_loads(line, f"{DATA_FILE} 第 {line_number} 行")
        except WeeklyReviewError as error:
            message = str(error)
            if message.startswith(f"{DATA_FILE} 第 {line_number} 行"):
                raise
            raise WeeklyReviewError(
                f"{DATA_FILE} 第 {line_number} 行包含重复或非法 JSON 字段"
            ) from error
        validated = _validate_record(record, line_number)
        if (
            validated["key"] in seen_keys
            or validated["iso_week"] in seen_weeks
            or validated["week_start"] in seen_starts
        ):
            raise WeeklyReviewError(f"{DATA_FILE} 存在重复自然周或稳定键，已停止写入")
        seen_keys.add(validated["key"])
        seen_weeks.add(validated["iso_week"])
        seen_starts.add(validated["week_start"])
        records.append(validated)
    return raw, records


def _serialize_records(records: list[dict[str, Any]]) -> bytes:
    ordered = sorted(records, key=lambda record: record["week_start"])
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
        try:
            os.chmod(lock_path, 0o600)
        except OSError:
            pass
        deadline = time.monotonic() + LOCK_TIMEOUT_SECONDS
        while True:
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise WeeklyReviewError("周复盘台账正在被另一个进程更新，请稍后重试")
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
        raise WeeklyReviewError("周复盘台账在本次更新期间发生了变化，已停止覆盖；请重试")

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
    details = _week_details(args.week_start)
    updates = _read_upsert_input()
    clear_fields = list(args.clear_field or [])
    if len(clear_fields) != len(set(clear_fields)):
        raise WeeklyReviewError("--clear-field 不能重复指定同一字段")
    overlap = set(updates) & set(clear_fields)
    if overlap:
        raise WeeklyReviewError("同一字段不能在一次 upsert 中同时更新和清空")
    if not updates and not clear_fields:
        raise WeeklyReviewError("至少提供一个明确回答或 --clear-field")
    if clear_fields and args.expect_revision is None:
        raise WeeklyReviewError("清空单个回答必须提供 --expect-revision，避免删除并发更新")
    if args.expect_revision is not None and args.expect_revision < 0:
        raise WeeklyReviewError("--expect-revision 必须是非负整数")

    with _records_lock(root):
        data_path = root / DATA_FILE
        original, records = _load_records_bytes(data_path)
        existing = next((record for record in records if record["key"] == details["key"]), None)
        timestamp = _utc_now()
        base_record = existing if existing is not None else _empty_record(details, timestamp)
        current_revision = int(base_record["revision"])
        if args.expect_revision is not None and args.expect_revision != current_revision:
            raise WeeklyReviewError(
                f"修订冲突：期望 revision={args.expect_revision}，当前 revision={current_revision}"
            )
        if existing is None and clear_fields:
            raise WeeklyReviewError("目标自然周还没有记录，不能清空字段")

        record = copy.deepcopy(base_record)
        updated_fields: list[str] = []
        cleared_fields: list[str] = []
        for field, value in updates.items():
            if record["answers"][field] != value:
                record["answers"][field] = value
                updated_fields.append(f"answers.{field}")
        for field in clear_fields:
            if record["answers"][field] is not None:
                record["answers"][field] = None
                cleared_fields.append(f"answers.{field}")

        changed = bool(updated_fields or cleared_fields)
        if changed and all(record["answers"][field] is None for field in ANSWER_FIELDS):
            raise WeeklyReviewError("不能把周记录清成全空；如需删除整周，请使用 purge-plan/purge")

        if not changed:
            if existing is None:
                raise WeeklyReviewError("所有输入规范化后均为空，未创建周记录")
            action = "unchanged"
            record = base_record
        else:
            action = "updated" if existing is not None else "created"
            record["revision"] = current_revision + 1
            record["updated_at"] = timestamp
            if existing is None:
                records.append(record)
            else:
                records[records.index(existing)] = record
            _atomic_replace_if_unchanged(data_path, original, _serialize_records(records))

    return {
        "action": action,
        **details,
        "revision": record["revision"],
        "fields_updated": sorted(updated_fields),
        "fields_cleared": sorted(cleared_fields),
        "workbook_sync_required": True,
        "historical_copies_not_deleted": bool(cleared_fields),
    }


def purge_plan(root: Path, args: argparse.Namespace) -> dict[str, Any]:
    """只读预览一个自然周的删除范围，不输出回答内容。"""

    details = _week_details(args.week_start)
    with _records_lock(root):
        _, records = _load_records_bytes(root / DATA_FILE)
        existing = next((record for record in records if record["key"] == details["key"]), None)
    return {
        "action": "purge_plan",
        **details,
        "exists": existing is not None,
        "revision": existing["revision"] if existing is not None else None,
        "record_etag": _record_etag(existing) if existing is not None else None,
        "required_confirmation": details["key"],
        "requires_historical_copies_acknowledgement": True,
        "workbook_sync_required": True,
    }


def purge(root: Path, args: argparse.Namespace) -> dict[str, Any]:
    """删除当前项目中的单周源记录；其他数据层与历史副本不在范围内。"""

    details = _week_details(args.week_start)
    if args.confirm != details["key"]:
        raise WeeklyReviewError(f"--confirm 必须与稳定键完全一致：{details['key']}")
    if not args.acknowledge_historical_copies:
        raise WeeklyReviewError(
            "永久删除前必须确认：旧 ZIP、聊天、iCloud/设备历史可能仍保留副本"
        )
    if args.expect_revision < 1:
        raise WeeklyReviewError("--expect-revision 必须是正整数")
    if not _ETAG_RE.fullmatch(args.expect_record_etag):
        raise WeeklyReviewError("--expect-record-etag 必须是 purge-plan 返回的 SHA-256")

    with _records_lock(root):
        data_path = root / DATA_FILE
        original, records = _load_records_bytes(data_path)
        existing = next((record for record in records if record["key"] == details["key"]), None)
        if existing is None:
            action = "already_absent"
            removed_revision = None
        else:
            if args.expect_revision != existing["revision"]:
                raise WeeklyReviewError(
                    f"修订冲突：期望 revision={args.expect_revision}，"
                    f"当前 revision={existing['revision']}"
                )
            if args.expect_record_etag != _record_etag(existing):
                raise WeeklyReviewError("记录内容在删除预览后发生变化，已停止删除；请重新预览")
            removed_revision = existing["revision"]
            records.remove(existing)
            _atomic_replace_if_unchanged(data_path, original, _serialize_records(records))
            action = "purged"

    return {
        "action": action,
        **details,
        "removed_revision": removed_revision,
        "workbook_sync_required": True,
        "historical_copies_not_deleted": True,
        "journal_daily_goals_not_deleted": True,
    }


def _add_root_argument(command: argparse.ArgumentParser) -> None:
    command.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "records",
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="幂等维护自然周生活复盘，不保存对话原文")
    subparsers = parser.add_subparsers(dest="command", required=True)

    upsert_command = subparsers.add_parser("upsert", help="按自然周创建或更新唯一记录")
    _add_root_argument(upsert_command)
    upsert_command.add_argument("--week-start", required=True)
    upsert_command.add_argument("--input", required=True, choices=("-",))
    upsert_command.add_argument("--expect-revision", type=int)
    upsert_command.add_argument(
        "--clear-field",
        action="append",
        choices=ANSWER_FIELDS,
        default=[],
        help="仅在用户明确要求移除某个答案时使用；可重复",
    )

    plan_command = subparsers.add_parser("purge-plan", help="只读预览单周删除范围")
    _add_root_argument(plan_command)
    plan_command.add_argument("--week-start", required=True)

    purge_command = subparsers.add_parser("purge", help="精确删除当前项目中的单周源记录")
    _add_root_argument(purge_command)
    purge_command.add_argument("--week-start", required=True)
    purge_command.add_argument("--confirm", required=True)
    purge_command.add_argument("--acknowledge-historical-copies", action="store_true")
    purge_command.add_argument("--expect-revision", type=int, required=True)
    purge_command.add_argument("--expect-record-etag", required=True)
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        root = args.root.resolve()
        if args.command == "upsert":
            result = upsert(root, args)
        elif args.command == "purge-plan":
            result = purge_plan(root, args)
        elif args.command == "purge":
            result = purge(root, args)
        else:  # pragma: no cover - argparse 会拦截
            raise WeeklyReviewError("未知命令")
    except WeeklyReviewError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
