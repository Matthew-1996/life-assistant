#!/usr/bin/env python3
"""幂等维护低暴露的阶段复盘回答。

本工具只保存助手从用户明确回答中提取的固定枚举、布尔值和去敏短摘要。
它不从日记、每日状态或周复盘推断答案，也不修改目标、长期记忆或自动化。
输入通过 stdin 传递；列表和删除预览都不会输出答案内容。
"""

from __future__ import annotations

import argparse
import copy
import fcntl
import hashlib
import json
import os
import re
import stat
import sys
import tempfile
import time
from contextlib import contextmanager
from datetime import date as Date
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Mapping


SCHEMA_VERSION = 1
DATA_FILE = "phase-reviews.jsonl"
LOCK_FILE = ".phase-reviews.lock"
LOCK_TIMEOUT_SECONDS = 10.0
MAX_INPUT_BYTES = 8192
MAX_SUMMARY_LENGTH = 160

SUMMARY_FIELDS = (
    "recovery_change",
    "main_friction",
    "life_experience_signal",
)
ENUM_VALUES = {
    "goal_intent": (
        "continue",
        "adjust",
        "downgrade",
        "pause",
        "complete",
        "replace",
        "unsure",
    ),
    "journal_cadence": (
        "weekly",
        "monthly",
        "on_demand",
        "paused",
        "undecided",
    ),
    "checkin_cadence": (
        "daily",
        "weekly",
        "on_demand",
        "paused",
        "undecided",
    ),
    "checkin_experience": (
        "helpful",
        "neutral",
        "disruptive",
        "undecided",
    ),
    "next_track": (
        "fitness",
        "career",
        "neither",
        "undecided",
    ),
    "career_timing": (
        "now",
        "2026-08-31",
        "later",
        "undecided",
    ),
}
BOOLEAN_FIELDS = ("fitness_conversation",)
ANSWER_FIELDS = (*SUMMARY_FIELDS, *ENUM_VALUES.keys(), *BOOLEAN_FIELDS)

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


class PhaseReviewError(RuntimeError):
    """可以安全展示、且不包含阶段复盘内容的错误。"""


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _validate_date(value: Any, option_name: str) -> str:
    if not isinstance(value, str):
        raise PhaseReviewError(f"{option_name} 必须是有效的 YYYY-MM-DD")
    try:
        parsed = Date.fromisoformat(value)
    except ValueError as error:
        raise PhaseReviewError(f"{option_name} 必须是有效的 YYYY-MM-DD") from error
    if parsed.isoformat() != value:
        raise PhaseReviewError(f"{option_name} 必须是有效的 YYYY-MM-DD")
    return value


def _review_details(review_date: Any) -> dict[str, str]:
    normalized = _validate_date(review_date, "--review-date")
    return {
        "key": f"phase-review:{normalized}",
        "review_date": normalized,
    }


def _validate_timestamp(value: Any, field: str, line_number: int) -> datetime:
    if not isinstance(value, str) or not _TIMESTAMP_RE.fullmatch(value):
        raise PhaseReviewError(f"{DATA_FILE} 第 {line_number} 行的 {field} 无效")
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError as error:
        raise PhaseReviewError(f"{DATA_FILE} 第 {line_number} 行的 {field} 无效") from error


def _redact_summary(value: str) -> str:
    summary = _WHITESPACE_RE.sub(" ", value).strip()
    if not summary:
        raise PhaseReviewError("阶段复盘摘要规范化后不能为空；未回答的字段请直接省略")
    for pattern in _SENSITIVE_PATTERNS:
        summary = pattern.sub("[敏感信息已省略]", summary)
    if len(summary) > MAX_SUMMARY_LENGTH:
        raise PhaseReviewError(
            f"每个阶段复盘摘要必须在 {MAX_SUMMARY_LENGTH} 字符以内，不要传入整段回复"
        )
    return summary


def _reject_json_constant(_: str) -> None:
    raise PhaseReviewError("JSON 不能包含 NaN 或 Infinity")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise PhaseReviewError("JSON 包含重复字段，已停止处理")
        result[key] = value
    return result


def _strict_json_loads(text: str, context: str) -> Any:
    try:
        return json.loads(
            text,
            object_pairs_hook=_unique_object,
            parse_constant=_reject_json_constant,
        )
    except PhaseReviewError:
        raise
    except json.JSONDecodeError as error:
        raise PhaseReviewError(f"{context} 不是有效 JSON") from error


def _read_upsert_input() -> dict[str, Any]:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        raise PhaseReviewError(
            f"stdin 输入不能超过 {MAX_INPUT_BYTES} 字节；只传结构化短摘要，不要传整段回复"
        )
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise PhaseReviewError("stdin 不是有效 UTF-8") from error
    if not text.strip():
        raise PhaseReviewError("--input - 需要从 stdin 读取一个 JSON 对象")
    payload = _strict_json_loads(text, "stdin 输入")
    if not isinstance(payload, dict):
        raise PhaseReviewError("stdin 输入必须是 JSON 对象")
    if set(payload) - set(ANSWER_FIELDS):
        raise PhaseReviewError("stdin 输入字段集无效；未知字段不会被保存")
    if not payload:
        raise PhaseReviewError("至少提供一个明确的阶段复盘回答；缺项请直接省略")

    normalized: dict[str, Any] = {}
    for field, value in payload.items():
        if field in SUMMARY_FIELDS:
            if not isinstance(value, str):
                raise PhaseReviewError(
                    f"{field} 必须是字符串；未知字段请省略，null 不是清空指令"
                )
            normalized[field] = _redact_summary(value)
        elif field in ENUM_VALUES:
            if not isinstance(value, str) or value not in ENUM_VALUES[field]:
                raise PhaseReviewError(f"{field} 必须是明确枚举值；未知状态请省略")
            normalized[field] = value
        elif field in BOOLEAN_FIELDS:
            if type(value) is not bool:
                raise PhaseReviewError(
                    f"{field} 必须是 JSON true 或 false；未知状态请省略"
                )
            normalized[field] = value
    return normalized


def _empty_record(details: dict[str, str], timestamp: str) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "key": details["key"],
        "review_date": details["review_date"],
        "answers": {field: None for field in ANSWER_FIELDS},
        "revision": 0,
        "created_at": timestamp,
        "updated_at": timestamp,
    }


def _validate_record(record: Any, line_number: int) -> dict[str, Any]:
    if not isinstance(record, dict):
        raise PhaseReviewError(f"{DATA_FILE} 第 {line_number} 行必须是 JSON 对象")
    required_fields = {
        "schema_version",
        "key",
        "review_date",
        "answers",
        "revision",
        "created_at",
        "updated_at",
    }
    if set(record) != required_fields:
        raise PhaseReviewError(
            f"{DATA_FILE} 第 {line_number} 行字段集无效；未知字段不会被保留"
        )
    if type(record.get("schema_version")) is not int or record["schema_version"] != SCHEMA_VERSION:
        raise PhaseReviewError(f"{DATA_FILE} 第 {line_number} 行的 schema_version 无效")

    details = _review_details(record.get("review_date"))
    if record.get("key") != details["key"]:
        raise PhaseReviewError(f"{DATA_FILE} 第 {line_number} 行的日期或稳定键无效")

    revision = record.get("revision")
    if type(revision) is not int or revision < 1:
        raise PhaseReviewError(f"{DATA_FILE} 第 {line_number} 行的 revision 无效")
    created_at = _validate_timestamp(record.get("created_at"), "created_at", line_number)
    updated_at = _validate_timestamp(record.get("updated_at"), "updated_at", line_number)
    if created_at > updated_at:
        raise PhaseReviewError(f"{DATA_FILE} 第 {line_number} 行的时间顺序无效")

    answers = record.get("answers")
    if not isinstance(answers, dict) or set(answers) != set(ANSWER_FIELDS):
        raise PhaseReviewError(f"{DATA_FILE} 第 {line_number} 行的 answers 结构无效")
    for field in SUMMARY_FIELDS:
        value = answers[field]
        if value is not None and (
            not isinstance(value, str) or _redact_summary(value) != value
        ):
            raise PhaseReviewError(
                f"{DATA_FILE} 第 {line_number} 行的 answers.{field} 未通过去敏校验"
            )
    for field, values in ENUM_VALUES.items():
        if answers[field] not in (*values, None):
            raise PhaseReviewError(
                f"{DATA_FILE} 第 {line_number} 行的 answers.{field} 无效"
            )
    if answers["fitness_conversation"] is not None and type(
        answers["fitness_conversation"]
    ) is not bool:
        raise PhaseReviewError(
            f"{DATA_FILE} 第 {line_number} 行的 answers.fitness_conversation 无效"
        )
    if all(answers[field] is None for field in ANSWER_FIELDS):
        raise PhaseReviewError(f"{DATA_FILE} 第 {line_number} 行不能是全空阶段复盘")
    return record


def _safe_read_optional_regular_file(data_path: Path) -> bytes:
    """不跟随符号链接读取可选台账，并核对打开前后的文件身份。"""

    try:
        before = data_path.lstat()
    except FileNotFoundError:
        return b""
    except OSError as error:
        raise PhaseReviewError("阶段复盘台账无法安全检查；本次未读取") from error
    if stat.S_ISLNK(before.st_mode) or not stat.S_ISREG(before.st_mode):
        raise PhaseReviewError("阶段复盘台账路径必须是普通文件，不能是链接或目录")

    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = -1
    try:
        descriptor = os.open(data_path, flags)
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode):
            raise PhaseReviewError("阶段复盘台账路径必须是普通文件，不能是链接或目录")
        after = data_path.lstat()
        if (
            stat.S_ISLNK(after.st_mode)
            or not stat.S_ISREG(after.st_mode)
            or (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino)
            or (after.st_dev, after.st_ino) != (opened.st_dev, opened.st_ino)
        ):
            raise PhaseReviewError("阶段复盘台账路径在读取期间发生变化；本次未读取")
        with os.fdopen(descriptor, "rb") as data_file:
            descriptor = -1
            return data_file.read()
    except PhaseReviewError:
        raise
    except OSError as error:
        raise PhaseReviewError("阶段复盘台账无法安全读取；本次未读取") from error
    finally:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass


def _parse_records_bytes(raw: bytes) -> list[dict[str, Any]]:
    """严格解析固定字节；错误只包含结构位置，不包含任何答案值。"""

    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise PhaseReviewError(f"{DATA_FILE} 不是有效 UTF-8") from error

    records: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    seen_dates: set[str] = set()
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = _strict_json_loads(line, f"{DATA_FILE} 第 {line_number} 行")
        except PhaseReviewError as error:
            message = str(error)
            if message.startswith(f"{DATA_FILE} 第 {line_number} 行"):
                raise
            raise PhaseReviewError(
                f"{DATA_FILE} 第 {line_number} 行包含重复或非法 JSON 字段"
            ) from error
        validated = _validate_record(record, line_number)
        if validated["key"] in seen_keys or validated["review_date"] in seen_dates:
            raise PhaseReviewError(f"{DATA_FILE} 存在重复日期或稳定键，已停止写入")
        seen_keys.add(validated["key"])
        seen_dates.add(validated["review_date"])
        records.append(validated)
    return records


def _load_records_bytes(data_path: Path) -> tuple[bytes, list[dict[str, Any]]]:
    raw = _safe_read_optional_regular_file(data_path)
    return raw, _parse_records_bytes(raw)


def _serialize_records(records: list[dict[str, Any]]) -> bytes:
    ordered = sorted(records, key=lambda record: record["review_date"])
    text = "".join(
        json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
        for record in ordered
    )
    return text.encode("utf-8")


def _record_etag(record: dict[str, Any]) -> str:
    return hashlib.sha256(_serialize_records([record])).hexdigest()


def _inspection_summary(records: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "valid": True,
        "count": len(records),
        "dates_unique": len({record["review_date"] for record in records}) == len(records),
    }


def _safe_read_phase_reviews_from_root(root: Path) -> bytes:
    """纯只读地绑定 records 目录，再相对该目录读取可选台账。"""

    try:
        before_root = root.lstat()
    except FileNotFoundError:
        return b""
    except OSError as error:
        raise PhaseReviewError("阶段复盘台账目录无法安全检查；本次未读取") from error
    if stat.S_ISLNK(before_root.st_mode) or not stat.S_ISDIR(before_root.st_mode):
        raise PhaseReviewError("阶段复盘台账目录必须是真实目录；本次未读取")

    root_flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        root_flags |= os.O_DIRECTORY
    if hasattr(os, "O_NOFOLLOW"):
        root_flags |= os.O_NOFOLLOW
    root_descriptor = -1
    try:
        root_descriptor = os.open(root, root_flags)
        opened_root = os.fstat(root_descriptor)
        after_root = root.lstat()
        if (
            not stat.S_ISDIR(opened_root.st_mode)
            or stat.S_ISLNK(after_root.st_mode)
            or not stat.S_ISDIR(after_root.st_mode)
            or (before_root.st_dev, before_root.st_ino)
            != (opened_root.st_dev, opened_root.st_ino)
            or (after_root.st_dev, after_root.st_ino)
            != (opened_root.st_dev, opened_root.st_ino)
        ):
            raise PhaseReviewError("阶段复盘台账目录在读取期间发生变化；本次未读取")

        try:
            before_file = os.stat(DATA_FILE, dir_fd=root_descriptor, follow_symlinks=False)
        except FileNotFoundError:
            return b""
        if stat.S_ISLNK(before_file.st_mode) or not stat.S_ISREG(before_file.st_mode):
            raise PhaseReviewError("阶段复盘台账必须是普通文件；本次未读取")

        file_flags = os.O_RDONLY
        if hasattr(os, "O_NOFOLLOW"):
            file_flags |= os.O_NOFOLLOW
        file_descriptor = -1
        try:
            file_descriptor = os.open(DATA_FILE, file_flags, dir_fd=root_descriptor)
            opened_file = os.fstat(file_descriptor)
            after_file = os.stat(DATA_FILE, dir_fd=root_descriptor, follow_symlinks=False)
            if (
                not stat.S_ISREG(opened_file.st_mode)
                or stat.S_ISLNK(after_file.st_mode)
                or not stat.S_ISREG(after_file.st_mode)
                or (before_file.st_dev, before_file.st_ino)
                != (opened_file.st_dev, opened_file.st_ino)
                or (after_file.st_dev, after_file.st_ino)
                != (opened_file.st_dev, opened_file.st_ino)
            ):
                raise PhaseReviewError("阶段复盘台账在读取期间发生变化；本次未读取")
            with os.fdopen(file_descriptor, "rb") as data_file:
                file_descriptor = -1
                return data_file.read()
        finally:
            if file_descriptor >= 0:
                try:
                    os.close(file_descriptor)
                except OSError:
                    pass
    except PhaseReviewError:
        raise
    except OSError as error:
        raise PhaseReviewError("阶段复盘台账无法安全读取；本次未读取") from error
    finally:
        if root_descriptor >= 0:
            try:
                os.close(root_descriptor)
            except OSError:
                pass


def inspect_phase_reviews(root: Path) -> dict[str, Any]:
    """纯只读返回无内容计数；缺失 records 目录或台账等价于空台账。"""

    try:
        raw = _safe_read_phase_reviews_from_root(root)
    except Exception:
        # 公共只读边界不保留可能携带系统路径的底层异常链。
        raise PhaseReviewError("阶段复盘台账无法安全读取") from None
    try:
        records = _parse_records_bytes(raw)
    except Exception:
        raise PhaseReviewError("阶段复盘台账结构无效") from None
    return _inspection_summary(records)


def inspect_phase_review_snapshot(snapshot: Mapping[str, bytes]) -> dict[str, Any]:
    """严格校验固定备份字节中的可选阶段台账，不输出答案或来源路径。"""

    try:
        raw = snapshot.get("records/phase-reviews.jsonl", b"")
        if type(raw) is not bytes:
            raise PhaseReviewError("阶段复盘快照结构无效")
        records = _parse_records_bytes(raw)
    except Exception:
        # snapshot 是外部边界；无论 Mapping 实现或字节校验如何失败，
        # 都不能把答案、来源路径或底层异常文本带给调用方。
        raise PhaseReviewError("阶段复盘快照结构无效") from None
    return _inspection_summary(records)


def _assert_records_root(root: Path) -> None:
    """确保 records root 是调用者指定的真实目录，而不是链接或普通文件。"""

    try:
        metadata = root.lstat()
    except FileNotFoundError:
        try:
            root.mkdir(parents=True, exist_ok=False)
        except FileExistsError:
            pass
        except OSError as error:
            raise PhaseReviewError("阶段复盘台账目录无法安全创建；本次未读写") from error
        try:
            metadata = root.lstat()
        except OSError as error:
            raise PhaseReviewError("阶段复盘台账目录无法安全检查；本次未读写") from error
    except OSError as error:
        raise PhaseReviewError("阶段复盘台账目录无法安全检查；本次未读写") from error
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise PhaseReviewError("阶段复盘台账目录必须是真实目录，不能是链接或普通文件")


@contextmanager
def _records_lock(root: Path) -> Iterator[None]:
    _assert_records_root(root)
    lock_path = root / LOCK_FILE
    try:
        lock_metadata = lock_path.lstat()
    except FileNotFoundError:
        lock_metadata = None
    except OSError as error:
        raise PhaseReviewError("阶段复盘锁路径无法安全检查；本次未读写") from error
    if lock_metadata is not None and (
        stat.S_ISLNK(lock_metadata.st_mode) or not stat.S_ISREG(lock_metadata.st_mode)
    ):
        raise PhaseReviewError("阶段复盘锁路径必须是普通文件，不能是链接或目录")

    flags = os.O_RDWR | os.O_CREAT
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = -1
    try:
        descriptor = os.open(lock_path, flags, 0o600)
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode):
            raise PhaseReviewError("阶段复盘锁路径必须是普通文件，不能是链接或目录")
        after = lock_path.lstat()
        if (
            stat.S_ISLNK(after.st_mode)
            or not stat.S_ISREG(after.st_mode)
            or (after.st_dev, after.st_ino) != (opened.st_dev, opened.st_ino)
        ):
            raise PhaseReviewError("阶段复盘锁路径在打开期间发生变化；本次未读写")
        os.fchmod(descriptor, 0o600)
    except PhaseReviewError:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        raise
    except OSError as error:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        raise PhaseReviewError("阶段复盘锁无法安全打开；本次未读写") from error

    with os.fdopen(descriptor, "a+b") as lock_file:
        descriptor = -1
        try:
            deadline = time.monotonic() + LOCK_TIMEOUT_SECONDS
            while True:
                try:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise PhaseReviewError("阶段复盘台账正在被另一个进程更新，请稍后重试")
                    time.sleep(0.05)
                except OSError as error:
                    raise PhaseReviewError("阶段复盘锁无法安全获取；本次未读写") from error
            try:
                _assert_records_root(root)
                yield
            finally:
                try:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
                except OSError as error:
                    raise PhaseReviewError("阶段复盘锁无法安全释放；请先检查台账") from error
        except PhaseReviewError:
            raise
        except OSError as error:
            raise PhaseReviewError("阶段复盘锁访问失败；本次未读写") from error


def _atomic_replace_if_unchanged(data_path: Path, expected: bytes, content: bytes) -> None:
    current = _safe_read_optional_regular_file(data_path)
    if current != expected:
        raise PhaseReviewError("阶段复盘台账在本次更新期间发生了变化，已停止覆盖；请重试")

    _assert_records_root(data_path.parent)
    descriptor = -1
    temp_path: Path | None = None
    try:
        descriptor, temp_name = tempfile.mkstemp(
            prefix=f".{data_path.name}.", suffix=".tmp", dir=data_path.parent
        )
        temp_path = Path(temp_name)
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as temp_file:
            descriptor = -1
            temp_file.write(content)
            temp_file.flush()
            os.fsync(temp_file.fileno())
        _assert_records_root(data_path.parent)
        current = _safe_read_optional_regular_file(data_path)
        if current != expected:
            raise PhaseReviewError(
                "阶段复盘台账在本次更新期间发生了变化，已停止覆盖；请重试"
            )
        os.replace(temp_path, data_path)
        temp_path = None
        try:
            directory_fd = os.open(data_path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError as error:
            raise PhaseReviewError("阶段复盘台账写入后无法安全同步；请先检查台账") from error
    except PhaseReviewError:
        raise
    except OSError as error:
        raise PhaseReviewError("阶段复盘台账无法安全写入；本次未完成") from error
    finally:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        try:
            if temp_path is not None:
                temp_path.unlink()
        except (FileNotFoundError, OSError):
            pass


def upsert(root: Path, args: argparse.Namespace) -> dict[str, Any]:
    details = _review_details(args.review_date)
    updates = _read_upsert_input()
    if args.expect_revision is not None and args.expect_revision < 0:
        raise PhaseReviewError("--expect-revision 必须是非负整数")

    with _records_lock(root):
        data_path = root / DATA_FILE
        original, records = _load_records_bytes(data_path)
        existing = next((record for record in records if record["key"] == details["key"]), None)
        timestamp = _utc_now()
        base_record = existing if existing is not None else _empty_record(details, timestamp)
        current_revision = int(base_record["revision"])
        if args.expect_revision is not None and args.expect_revision != current_revision:
            raise PhaseReviewError(
                f"修订冲突：期望 revision={args.expect_revision}，当前 revision={current_revision}"
            )

        record = copy.deepcopy(base_record)
        updated_fields: list[str] = []
        for field, value in updates.items():
            if record["answers"][field] != value:
                record["answers"][field] = value
                updated_fields.append(f"answers.{field}")

        if not updated_fields:
            if existing is None:
                raise PhaseReviewError("所有输入规范化后均为空，未创建阶段复盘")
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
        "planning_changes_not_applied": True,
    }


def list_records(root: Path, args: argparse.Namespace) -> dict[str, Any]:
    """只列出安全元数据，不输出摘要、枚举或布尔回答。"""

    requested_date = None
    if args.review_date is not None:
        requested_date = _validate_date(args.review_date, "--review-date")
    with _records_lock(root):
        _, records = _load_records_bytes(root / DATA_FILE)
    if requested_date is not None:
        records = [record for record in records if record["review_date"] == requested_date]
    projection = [
        {
            "key": record["key"],
            "review_date": record["review_date"],
            "revision": record["revision"],
            "fields_present": sorted(
                field for field, value in record["answers"].items() if value is not None
            ),
            "created_at": record["created_at"],
            "updated_at": record["updated_at"],
        }
        for record in records
    ]
    return {
        "action": "list",
        "count": len(projection),
        "records": projection,
        "answer_values_omitted": True,
    }


def purge_plan(root: Path, args: argparse.Namespace) -> dict[str, Any]:
    """只读预览单日阶段复盘删除范围，不输出回答内容。"""

    details = _review_details(args.review_date)
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
    }


def purge(root: Path, args: argparse.Namespace) -> dict[str, Any]:
    """删除当前项目中的单日阶段复盘；历史副本和其他数据层不在范围内。"""

    details = _review_details(args.review_date)
    if args.confirm != details["key"]:
        raise PhaseReviewError(f"--confirm 必须与稳定键完全一致：{details['key']}")
    if not args.acknowledge_historical_copies:
        raise PhaseReviewError(
            "永久删除前必须确认：旧 ZIP、聊天、iCloud/设备历史可能仍保留副本"
        )
    if args.expect_revision < 1:
        raise PhaseReviewError("--expect-revision 必须是正整数")
    if not _ETAG_RE.fullmatch(args.expect_record_etag):
        raise PhaseReviewError("--expect-record-etag 必须是 purge-plan 返回的 SHA-256")

    with _records_lock(root):
        data_path = root / DATA_FILE
        original, records = _load_records_bytes(data_path)
        existing = next((record for record in records if record["key"] == details["key"]), None)
        if existing is None:
            action = "already_absent"
            removed_revision = None
        else:
            if args.expect_revision != existing["revision"]:
                raise PhaseReviewError(
                    f"修订冲突：期望 revision={args.expect_revision}，"
                    f"当前 revision={existing['revision']}"
                )
            if args.expect_record_etag != _record_etag(existing):
                raise PhaseReviewError("记录内容在删除预览后发生变化，已停止删除；请重新预览")
            removed_revision = existing["revision"]
            records.remove(existing)
            _atomic_replace_if_unchanged(data_path, original, _serialize_records(records))
            action = "purged"

    return {
        "action": action,
        **details,
        "removed_revision": removed_revision,
        "historical_copies_not_deleted": True,
        "journals_checkins_goals_memory_automations_not_deleted": True,
    }


def _add_root_argument(command: argparse.ArgumentParser) -> None:
    command.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "records",
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="幂等维护阶段复盘回答，不保存对话原文")
    subparsers = parser.add_subparsers(dest="command", required=True)

    upsert_command = subparsers.add_parser("upsert", help="按复盘日期创建或更新唯一记录")
    _add_root_argument(upsert_command)
    upsert_command.add_argument("--review-date", required=True)
    upsert_command.add_argument("--input", required=True, choices=("-",))
    upsert_command.add_argument("--expect-revision", type=int)

    list_command = subparsers.add_parser("list", help="列出复盘元数据，不输出回答值")
    _add_root_argument(list_command)
    list_command.add_argument("--review-date")

    plan_command = subparsers.add_parser("purge-plan", help="只读预览单日删除范围")
    _add_root_argument(plan_command)
    plan_command.add_argument("--review-date", required=True)

    purge_command = subparsers.add_parser("purge", help="精确删除当前项目中的单日源记录")
    _add_root_argument(purge_command)
    purge_command.add_argument("--review-date", required=True)
    purge_command.add_argument("--confirm", required=True)
    purge_command.add_argument("--acknowledge-historical-copies", action="store_true")
    purge_command.add_argument("--expect-revision", type=int, required=True)
    purge_command.add_argument("--expect-record-etag", required=True)
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        # 不使用 resolve()：必须由安全检查看到调用者给出的 records root 符号链接。
        root = args.root
        if args.command == "upsert":
            result = upsert(root, args)
        elif args.command == "list":
            result = list_records(root, args)
        elif args.command == "purge-plan":
            result = purge_plan(root, args)
        elif args.command == "purge":
            result = purge(root, args)
        else:  # pragma: no cover - argparse 会拦截
            raise PhaseReviewError("未知命令")
    except PhaseReviewError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    except OSError:
        # 最后一层防护：不把文件路径、系统错误或任何台账内容带入输出。
        print("error: 阶段复盘台账发生底层访问错误；本次未读写", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
