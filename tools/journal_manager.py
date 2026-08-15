#!/usr/bin/env python3
"""对话式生活日记的当前项目归档工具。

仅使用 Python 标准库。日记默认保存到项目根目录的 journal/ 下，
并且只接受 local-only 隐私范围。
"""

from __future__ import annotations

import argparse
from calendar import monthrange
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
import re
import sys
import tempfile
import time
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ROOT = PROJECT_ROOT / "journal"
ONLINE_PRIMARY_MARKER = ".life-console-online-primary"
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_PATTERN = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
ALLOWED_SOURCES = {"explicit", "implicit"}
TIME_PRECISIONS = {"exact", "approximate", "unknown"}
ENTRY_LIST_FIELDS = (
    "facts",
    "feelings",
    "people",
    "places",
    "themes",
    "tags",
    "planning_clues",
    "inferences",
)
INDEX_REQUIRED_FIELDS = frozenset(
    {
        "id",
        "date",
        "time",
        "time_precision",
        "title",
        "summary",
        *ENTRY_LIST_FIELDS,
        "source",
        "privacy",
        "file",
        "status",
        "weekly_reviews",
        "monthly_reviews",
        "amendments",
        "invalidated_reviews",
        "recorded_at",
    }
)
INDEX_OPTIONAL_FIELDS = frozenset(
    {
        "withdrawn_at",
        "original_date",
        "original_time",
        "original_time_precision",
    }
)
INDEX_ALLOWED_FIELDS = INDEX_REQUIRED_FIELDS | INDEX_OPTIONAL_FIELDS
# `list` 是给助手消费的轻量投影，即使读取层未来被改动，也不应
# 将未知字段或原文原样透传到 CLI。
LIST_SAFE_FIELDS = (
    "id",
    "date",
    "time",
    "time_precision",
    "title",
    "summary",
    *ENTRY_LIST_FIELDS,
    "source",
    "privacy",
    "file",
    "status",
    "weekly_reviews",
    "monthly_reviews",
    "amendments",
    "invalidated_reviews",
    "recorded_at",
    "original_date",
    "original_time",
    "original_time_precision",
)
REVIEW_LIST_FIELDS = (
    "events",
    "replenishing",
    "draining",
    "recurring",
    "open_threads",
    "planning_implications",
    "candidate_memories",
)
REVIEW_TYPES = {"weekly", "monthly"}
SOURCE_SET_ETAG_PATTERN = re.compile(r"^[0-9a-f]{64}$")
WITHDRAWN_REVIEW_WARNING = "⚠️ 来源日记已撤回，本回顾需刷新后再用于规划。"
AMENDED_REVIEW_WARNING = "⚠️ 来源日记已更正，本回顾需刷新后再用于规划。"
WITHDRAWN_STATE_LINE = "> 状态：已撤回；原文仍保留，但不再用于可读索引、回顾或长期记忆。"
LEGACY_WITHDRAWN_STATE_LINE = "> 状态：已撤回；不再用于索引、回顾或长期记忆。"
AMENDMENT_ALLOWED_FIELDS = frozenset(
    {
        "id",
        "note",
        "privacy",
        "date",
        "time",
        "time_precision",
        "title",
        "summary",
        *ENTRY_LIST_FIELDS,
    }
)
AMENDMENT_FORBIDDEN_FIELDS = frozenset({"raw"})
REINDEX_FIELDS = frozenset({"title", "summary", *ENTRY_LIST_FIELDS})
SECRET_PATTERNS = (
    (
        "private_key",
        re.compile(
            r"(?:"
            r"-----BEGIN (?P<private_key_kind>(?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY)-----.*?"
            r"(?:-----END (?P=private_key_kind)-----|\Z)"
            r"|"
            r"-----BEGIN PGP "
            r"PRIVATE KEY BLOCK-----.*?"
            r"(?:-----END PGP "
            r"PRIVATE KEY BLOCK-----|\Z)"
            r")",
            re.DOTALL,
        ),
        "[私钥已省略]",
    ),
    ("api_token", re.compile(r"\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b"), "[访问令牌已省略]"),
    (
        "cloud_access_key",
        re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
        "[云访问密钥已省略]",
    ),
    (
        "jwt",
        re.compile(
            r"(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\."
            r"[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])"
        ),
        "[JWT 已省略]",
    ),
    (
        "recovery_code",
        re.compile(
            r"((?:恢复码|恢复代码|恢复密钥|备用码|backup\s+code|recovery\s+code)"
            r"\s*(?:是|为|[:：=])?\s*)"
            r"(?:[A-Za-z0-9]{2,}(?:[ -]+[A-Za-z0-9]{2,})+|[A-Za-z0-9]{8,})",
            re.IGNORECASE,
        ),
        r"\1[已省略]",
    ),
    (
        "verification_code",
        re.compile(r"((?:验证码|动态码|短信码|OTP)\s*(?:是|为|[:：])?\s*)\d{4,8}", re.IGNORECASE),
        r"\1[已省略]",
    ),
    (
        "credential_assignment",
        re.compile(
            r"((?:password|passwd|pwd|secret|token|api[_ -]?key|access[_ -]?key|"
            r"access\s+token|client[_ -]?secret|访问令牌|令牌|API\s*密钥|"
            r"接口密钥|访问密钥|客户端密钥)\s*[:：=]\s*)"
            r"(?P<credential_quote>[\"'])[^\r\n]*?(?P=credential_quote)",
            re.IGNORECASE,
        ),
        r"\1[已省略]",
    ),
    (
        "credential_assignment",
        re.compile(
            r"((?:password|passwd|pwd|secret|token|api[_ -]?key|access[_ -]?key|"
            r"access\s+token|client[_ -]?secret|访问令牌|令牌|API\s*密钥|"
            r"接口密钥|访问密钥|客户端密钥)\s*[:：=]\s*)"
            r"(?!\[)[^\s,，。;；\"']+",
            re.IGNORECASE,
        ),
        r"\1[已省略]",
    ),
    (
        "password",
        re.compile(
            r"((?:密码|口令|PIN)\s*[:：=]\s*)"
            r"(?P<password_quote>[\"'])[^\r\n]*?(?P=password_quote)",
            re.IGNORECASE,
        ),
        r"\1[已省略]",
    ),
    (
        "password",
        re.compile(
            r"((?:密码|口令|PIN)\s*[:：=]\s*)(?!\[)[^\s,，。;；\"']+",
            re.IGNORECASE,
        ),
        r"\1[已省略]",
    ),
    (
        "password",
        re.compile(
            r"((?:密码|口令|PIN)\s*(?:是|为)\s*)"
            r"[A-Za-z0-9!@#$%^&*()_+={}\[\]:<>,.?/~`|\\-]{4,}",
            re.IGNORECASE,
        ),
        r"\1[已省略]",
    ),
    (
        "long_number",
        re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)"),
        "[完整号码已省略]",
    ),
)


class JournalError(ValueError):
    """可向用户展示的输入或存储错误。"""


@contextmanager
def _journal_lock(root: Path, *, timeout_seconds: float = 10.0) -> Iterable[None]:
    """串行化整个日记库的读改写区间，避免并发成功却静默丢数据。"""

    root.mkdir(parents=True, exist_ok=True)
    lock_path = root / ".journal.lock"
    with lock_path.open("a+", encoding="utf-8") as handle:
        deadline = time.monotonic() + timeout_seconds
        while True:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError as exc:
                if time.monotonic() >= deadline:
                    raise JournalError(
                        "日记库正由另一个操作更新；本次未写入，请稍后安全重试"
                    ) from exc
                time.sleep(0.05)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _single_line(value: Any, field: str, *, required: bool = False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise JournalError(f"{field} 必须是字符串")
    normalized = " ".join(value.split())
    if required and not normalized:
        raise JournalError(f"缺少必填字段：{field}")
    return normalized


def _text(value: Any, field: str, *, required: bool = False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise JournalError(f"{field} 必须是字符串")
    normalized = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    if required and not normalized:
        raise JournalError(f"缺少必填字段：{field}")
    return normalized


def _string_list(value: Any, field: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise JournalError(f"{field} 必须是字符串数组")
    result: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise JournalError(f"{field} 必须是字符串数组")
        normalized = " ".join(item.split())
        if normalized and normalized not in result:
            result.append(normalized)
    return result


def _redact_secrets(value: str) -> tuple[str, list[str]]:
    redacted = value
    reasons: list[str] = []
    for label, pattern, replacement in SECRET_PATTERNS:
        redacted, count = pattern.subn(replacement, redacted)
        if count and label not in reasons:
            reasons.append(label)
    return redacted, reasons


def _valid_date(value: Any, field: str = "date") -> str:
    normalized = _single_line(value, field, required=True)
    if not DATE_PATTERN.fullmatch(normalized):
        raise JournalError(f"{field} 必须使用 YYYY-MM-DD 格式")
    try:
        date.fromisoformat(normalized)
    except ValueError as exc:
        raise JournalError(f"{field} 不是有效日期：{normalized}") from exc
    return normalized


def _valid_time(value: Any) -> str:
    normalized = _single_line(value, "time", required=True)
    if not TIME_PATTERN.fullmatch(normalized):
        raise JournalError("time 必须使用 24 小时 HH:MM 格式")
    return normalized


def _normalized_event_time(
    value: Any,
    precision_value: Any = None,
) -> tuple[str | None, str]:
    """返回可检索时间与精度，不为用户制造未表达的分钟数。"""

    has_time = value is not None and _single_line(value, "time") != ""
    default_precision = "exact" if has_time else "unknown"
    precision = _single_line(
        precision_value if precision_value is not None else default_precision,
        "time_precision",
        required=True,
    )
    if precision not in TIME_PRECISIONS:
        allowed = ", ".join(sorted(TIME_PRECISIONS))
        raise JournalError(f"time_precision 只能是：{allowed}")
    if precision == "unknown":
        if has_time:
            raise JournalError("time_precision=unknown 时不得提供 time")
        return None, precision
    if not has_time:
        raise JournalError(f"time_precision={precision} 时必须提供 time")
    return _valid_time(value), precision


def normalize_entry(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise JournalError("输入 JSON 顶层必须是对象")

    source = _single_line(payload.get("source", "explicit"), "source", required=True)
    if source not in ALLOWED_SOURCES:
        allowed = ", ".join(sorted(ALLOWED_SOURCES))
        raise JournalError(f"source 只能是：{allowed}")

    privacy = _single_line(payload.get("privacy", "local-only"), "privacy", required=True)
    if privacy != "local-only":
        raise JournalError("当前只允许 privacy=local-only；日记不会由本工具公开或共享")

    event_time, time_precision = _normalized_event_time(
        payload.get("time"), payload.get("time_precision")
    )
    entry: dict[str, Any] = {
        "date": _valid_date(payload.get("date")),
        "time": event_time,
        "time_precision": time_precision,
        "title": _single_line(payload.get("title"), "title", required=True),
        "source": source,
        "privacy": privacy,
        "raw": _text(payload.get("raw"), "raw", required=True),
        "summary": _single_line(payload.get("summary", ""), "summary"),
    }
    for field in ENTRY_LIST_FIELDS:
        entry[field] = _string_list(payload.get(field), field)
    redactions: list[str] = []
    for field in ("title", "raw", "summary"):
        entry[field], reasons = _redact_secrets(entry[field])
        redactions.extend(reason for reason in reasons if reason not in redactions)
    for field in ENTRY_LIST_FIELDS:
        cleaned: list[str] = []
        for item in entry[field]:
            redacted_item, reasons = _redact_secrets(item)
            cleaned.append(redacted_item)
            redactions.extend(reason for reason in reasons if reason not in redactions)
        entry[field] = cleaned
    entry["redactions"] = redactions
    return entry


def normalize_amendment(payload: Any) -> dict[str, Any]:
    """校验并遮蔽一次可审计更正。

    raw 永远不覆盖；date/time 作为可检索的有效时间可以更正，原始值和
    原文文件位置仍保留。可变的轻量字段仅在输入明确包含时才更新。
    """
    if not isinstance(payload, dict):
        raise JournalError("更正 JSON 顶层必须是对象")

    forbidden = sorted(AMENDMENT_FORBIDDEN_FIELDS.intersection(payload))
    if forbidden:
        raise JournalError("更正不得覆盖 raw；请用 note 保留新的明确说法")
    unsupported = sorted(set(payload).difference(AMENDMENT_ALLOWED_FIELDS))
    if unsupported:
        raise JournalError(f"更正包含不支持的字段：{', '.join(unsupported)}")

    privacy = _single_line(payload.get("privacy"), "privacy", required=True)
    if privacy != "local-only":
        raise JournalError("当前只允许 privacy=local-only；日记更正不会由本工具公开或共享")

    amendment: dict[str, Any] = {
        "id": _single_line(payload.get("id"), "id", required=True),
        "note": _text(payload.get("note"), "note", required=True),
        "privacy": privacy,
        "updates": {},
    }
    if "date" in payload:
        amendment["updates"]["date"] = _valid_date(payload.get("date"))
    if "time" in payload or "time_precision" in payload:
        event_time, time_precision = _normalized_event_time(
            payload.get("time"), payload.get("time_precision")
        )
        amendment["updates"]["time"] = event_time
        amendment["updates"]["time_precision"] = time_precision
    if "title" in payload:
        amendment["updates"]["title"] = _single_line(
            payload.get("title"), "title", required=True
        )
    if "summary" in payload:
        amendment["updates"]["summary"] = _single_line(payload.get("summary"), "summary")
    for field in ENTRY_LIST_FIELDS:
        if field in payload:
            amendment["updates"][field] = _string_list(payload.get(field), field)

    content_fields = REINDEX_FIELDS.intersection(payload)
    if content_fields and content_fields != REINDEX_FIELDS:
        missing = ", ".join(sorted(REINDEX_FIELDS.difference(content_fields)))
        raise JournalError(
            "内容更正必须同时重建完整轻量索引，避免旧说法继续进入工作簿或回顾；"
            f"缺少：{missing}"
        )
    if not amendment["updates"]:
        raise JournalError(
            "更正不能只保存说明；请同时提供完整轻量索引，或明确更正 date/time"
        )

    redactions: list[str] = []
    amendment["note"], reasons = _redact_secrets(amendment["note"])
    redactions.extend(reasons)
    for field in ("title", "summary"):
        if field not in amendment["updates"]:
            continue
        amendment["updates"][field], reasons = _redact_secrets(amendment["updates"][field])
        redactions.extend(reason for reason in reasons if reason not in redactions)
    for field in ENTRY_LIST_FIELDS:
        if field not in amendment["updates"]:
            continue
        cleaned: list[str] = []
        for item in amendment["updates"][field]:
            redacted_item, reasons = _redact_secrets(item)
            cleaned.append(redacted_item)
            redactions.extend(reason for reason in reasons if reason not in redactions)
        amendment["updates"][field] = cleaned
    amendment["redactions"] = redactions
    return amendment


def entry_id(entry: dict[str, Any]) -> str:
    identity = {
        "date": entry["date"],
        "time": entry["time"],
        "title": entry["title"],
        "raw": entry["raw"],
    }
    if entry["time_precision"] != "exact":
        identity["time_precision"] = entry["time_precision"]
    serialized = json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(serialized.encode("utf-8")).hexdigest()[:12]
    time_key = entry["time"].replace(":", "") if entry["time"] else "unknown"
    return f"{entry['date'].replace('-', '')}-{time_key}-{digest}"


def amendment_id(amendment: dict[str, Any]) -> str:
    identity = {
        "entry_id": amendment["id"],
        "note": amendment["note"],
        "privacy": amendment["privacy"],
        "updates": amendment["updates"],
    }
    serialized = json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(serialized.encode("utf-8")).hexdigest()[:16]
    return f"amend-{digest}"


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
            temporary_name = handle.name
        os.replace(temporary_name, path)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)


def _valid_index_timestamp(value: Any) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return False
    return parsed.tzinfo is not None


def _valid_index_string_list(value: Any) -> bool:
    return (
        isinstance(value, list)
        and all(isinstance(item, str) and item == " ".join(item.split()) and item for item in value)
        and len(value) == len(set(value))
    )


def _validate_index_record(record: Any, line_number: int) -> dict[str, Any]:
    """Fail closed on the machine-index schema without echoing stored content."""

    error = JournalError(f"index.jsonl 第 {line_number} 行结构无效")
    if not isinstance(record, dict):
        raise error
    fields = set(record)
    if not INDEX_REQUIRED_FIELDS.issubset(fields) or not fields.issubset(
        INDEX_ALLOWED_FIELDS
    ):
        raise error

    identifier = record.get("id")
    if (
        not isinstance(identifier, str)
        or not identifier
        or identifier != " ".join(identifier.split())
    ):
        raise error
    if record.get("source") not in ALLOWED_SOURCES:
        raise error
    if record.get("privacy") != "local-only":
        raise error
    if record.get("status") not in {"active", "withdrawn"}:
        raise error
    if (record.get("status") == "withdrawn") != ("withdrawn_at" in fields):
        raise error
    if not isinstance(record.get("file"), str) or not record["file"].strip():
        raise error
    if not isinstance(record.get("title"), str) or not record["title"].strip():
        raise error
    if not isinstance(record.get("summary"), str):
        raise error

    entry_date = record.get("date")
    if not isinstance(entry_date, str) or not DATE_PATTERN.fullmatch(entry_date):
        raise error
    try:
        date.fromisoformat(entry_date)
        normalized_time = _normalized_event_time(
            record.get("time"), record.get("time_precision")
        )
    except (JournalError, ValueError):
        raise error from None
    if normalized_time != (record.get("time"), record.get("time_precision")):
        raise error

    for field in (*ENTRY_LIST_FIELDS, "weekly_reviews", "monthly_reviews", "invalidated_reviews"):
        if not _valid_index_string_list(record.get(field)):
            raise error

    amendments = record.get("amendments")
    if not isinstance(amendments, list):
        raise error
    amendment_ids: set[str] = set()
    for amendment in amendments:
        if not isinstance(amendment, dict) or set(amendment) != {"id", "timestamp"}:
            raise error
        amendment_id_value = amendment.get("id")
        if (
            not isinstance(amendment_id_value, str)
            or not amendment_id_value
            or amendment_id_value in amendment_ids
            or not _valid_index_timestamp(amendment.get("timestamp"))
        ):
            raise error
        amendment_ids.add(amendment_id_value)

    if not _valid_index_timestamp(record.get("recorded_at")):
        raise error
    if "withdrawn_at" in record and not _valid_index_timestamp(record.get("withdrawn_at")):
        raise error
    if "original_date" in record:
        original_date = record.get("original_date")
        if not isinstance(original_date, str) or not DATE_PATTERN.fullmatch(original_date):
            raise error
        try:
            date.fromisoformat(original_date)
        except ValueError:
            raise error from None
    original_time_fields = {"original_time", "original_time_precision"}.intersection(fields)
    if original_time_fields and original_time_fields != {
        "original_time",
        "original_time_precision",
    }:
        raise error
    if original_time_fields:
        try:
            normalized_original_time = _normalized_event_time(
                record.get("original_time"), record.get("original_time_precision")
            )
        except JournalError:
            raise error from None
        if normalized_original_time != (
            record.get("original_time"),
            record.get("original_time_precision"),
        ):
            raise error
    return record


def _load_records(index_path: Path) -> list[dict[str, Any]]:
    if not index_path.exists():
        return []
    records: list[dict[str, Any]] = []
    for line_number, line in enumerate(index_path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise JournalError(f"index.jsonl 第 {line_number} 行损坏") from exc
        records.append(_validate_index_record(record, line_number))
    identifiers = [record["id"] for record in records]
    if len(identifiers) != len(set(identifiers)):
        raise JournalError("index.jsonl 含重复日记 ID")
    return records


def _write_records(index_path: Path, records: Iterable[dict[str, Any]]) -> None:
    content = "".join(
        json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
        for record in records
    )
    _atomic_write(index_path, content)


def _md_cell(value: Any) -> str:
    if isinstance(value, list):
        text = "、".join(str(item) for item in value)
    else:
        text = str(value or "")
    return text.replace("|", "\\|").replace("\n", " ").strip() or "—"


def _render_readable_index(records: list[dict[str, Any]]) -> str:
    active_records = [
        record for record in records if record.get("status") == "active"
    ]
    lines = [
        "# 生活日记索引",
        "",
        "> 由 `tools/journal_manager.py` 自动生成，请勿手工编辑。原文归档在当前 iCloud 项目的月度日记中；日记工具不自动发布到网页。完整数据边界见 `journal/PRIVACY.md`。",
        "",
    ]
    if not active_records:
        lines.extend(["暂无日记。", ""])
        return "\n".join(lines)

    lines.extend(
        [
            "| 日期 | 时间 | 标题 | 一句话摘要 | 感受 | 标签 | 来源文件 | ID |",
            "|---|---|---|---|---|---|---|---|",
        ]
    )
    for record in sorted(
        active_records,
        key=lambda item: (
            str(item.get("date", "")),
            str(item.get("time") or ""),
            str(item.get("id", "")),
        ),
        reverse=True,
    ):
        relative_file = str(record.get("file", ""))
        file_cell = f"[{Path(relative_file).name}]({relative_file})" if relative_file else "—"
        lines.append(
            "| "
            + " | ".join(
                [
                    _md_cell(record.get("date")),
                    _md_cell(_display_time(record.get("time"), record.get("time_precision"))),
                    _md_cell(record.get("title")),
                    _md_cell(record.get("summary")),
                    _md_cell(record.get("feelings", [])),
                    _md_cell(record.get("tags", [])),
                    file_cell,
                    _md_cell(record.get("id")),
                ]
            )
            + " |"
        )
    lines.append("")
    return "\n".join(lines)


def _source_label(source: str) -> str:
    return {"explicit": "明确触发", "implicit": "清晰生活叙事"}[source]


def _blockquote(text: str) -> str:
    return "\n".join(">" if not line else f"> {line}" for line in text.splitlines())


def _bullet_section(label: str, values: list[str]) -> str:
    if not values:
        return f"- {label}：未记录"
    return f"- {label}：" + "；".join(values)


def _display_time(value: Any, precision_value: Any = None) -> str:
    if value in (None, ""):
        return "时间未知"
    normalized = _valid_time(value)
    precision = precision_value or "exact"
    if precision not in TIME_PRECISIONS:
        raise JournalError(f"日记时间精度损坏：{precision}")
    if precision == "unknown":
        raise JournalError("time_precision=unknown 的日记不得含 time")
    return f"约 {normalized}" if precision == "approximate" else normalized


def _entry_markdown(entry: dict[str, Any], identifier: str) -> str:
    tags = "、".join(entry["tags"]) if entry["tags"] else "未标注"
    summary = entry["summary"] or "未单独摘要"
    return "\n".join(
        [
            f"## {entry['date']} {_display_time(entry['time'], entry['time_precision'])}｜{entry['title']}",
            "",
            f"<!-- journal-id: {identifier} -->",
            f"- 来源：{_source_label(entry['source'])}",
            f"- 隐私：{entry['privacy']}",
            f"- 标签：{tags}",
            "",
            "### 用户原话",
            "",
            _blockquote(entry["raw"]),
            "",
            "### 助手整理",
            "",
            f"- 摘要：{summary}",
            _bullet_section("明确事实", entry["facts"]),
            _bullet_section("明确感受", entry["feelings"]),
            _bullet_section("人物", entry["people"]),
            _bullet_section("地点或场景", entry["places"]),
            _bullet_section("生活主题", entry["themes"]),
            _bullet_section("可能的规划线索", entry["planning_clues"]),
            _bullet_section("待用户确认的推测", entry["inferences"]),
            "",
        ]
    )


def _month_header(entry_date: str) -> str:
    year, month, _ = entry_date.split("-")
    return "\n".join(
        [
            f"# {year} 年 {month} 月生活日记",
            "",
            "> 私密范围：local-only。该文件保留用户原话，不得未经当次明确同意对外发布或共享。",
            "",
        ]
    )


def _record_for(entry: dict[str, Any], identifier: str, relative_file: str) -> dict[str, Any]:
    return {
        "id": identifier,
        "date": entry["date"],
        "time": entry["time"],
        "time_precision": entry["time_precision"],
        "title": entry["title"],
        "summary": entry["summary"],
        "facts": entry["facts"],
        "feelings": entry["feelings"],
        "people": entry["people"],
        "places": entry["places"],
        "themes": entry["themes"],
        "tags": entry["tags"],
        "planning_clues": entry["planning_clues"],
        "inferences": entry["inferences"],
        "source": entry["source"],
        "privacy": entry["privacy"],
        "file": relative_file,
        "status": "active",
        "weekly_reviews": [],
        "monthly_reviews": [],
        "amendments": [],
        "invalidated_reviews": [],
        "recorded_at": datetime.now().astimezone().isoformat(timespec="microseconds"),
    }


def add_entry(root: Path, payload: Any) -> dict[str, Any]:
    _assert_no_pending_purge(root)
    entry = normalize_entry(payload)
    identifier = entry_id(entry)
    year = entry["date"][:4]
    month = entry["date"][:7]
    relative_file = f"entries/{year}/{month}.md"
    month_path = root / relative_file
    index_path = root / "index.jsonl"
    readable_index_path = root / "INDEX.md"

    records = _load_records(index_path)
    record_by_id = {str(record["id"]): record for record in records}
    existing_record = record_by_id.get(identifier)
    month_content = month_path.read_text(encoding="utf-8") if month_path.exists() else ""
    marker = f"<!-- journal-id: {identifier} -->"
    in_month = marker in month_content
    in_index = existing_record is not None

    changed_month = False
    changed_index = False

    if not in_month:
        if not month_content.strip():
            month_content = _month_header(entry["date"])
        elif not month_content.endswith("\n"):
            month_content += "\n"
        month_content += _entry_markdown(entry, identifier)
        _atomic_write(month_path, month_content)
        changed_month = True

    if not in_index:
        existing_record = _record_for(entry, identifier, relative_file)
        records.append(existing_record)
        _write_records(index_path, records)
        changed_index = True

    # 可读索引每次都重建，使得手工损坏或中断后也能自愈。
    _atomic_write(readable_index_path, _render_readable_index(records))

    if changed_month and changed_index:
        status = "added"
    elif changed_month or changed_index:
        status = "repaired"
    else:
        status = "exists"
    return {
        "status": status,
        "id": identifier,
        "date": entry["date"],
        "time": entry["time"],
        "time_precision": entry["time_precision"],
        "title": entry["title"],
        "file": relative_file,
        "privacy": "local-only",
        "redactions": entry["redactions"],
    }


def _validated_entry_path(
    root: Path,
    target: dict[str, Any],
    identifier: str,
    *,
    must_exist: bool = True,
) -> Path:
    relative_file = _single_line(target.get("file"), "file", required=True)
    relative_path = Path(relative_file)
    if (
        relative_path.is_absolute()
        or ".." in relative_path.parts
        or len(relative_path.parts) < 2
        or relative_path.parts[0] != "entries"
        or relative_path.suffix.lower() != ".md"
    ):
        raise JournalError(f"日记 {identifier} 的来源路径不安全：{relative_file}")
    entry_path = (root / relative_path).resolve()
    entries_root = (root / "entries").resolve()
    if entries_root not in entry_path.parents:
        raise JournalError(f"日记 {identifier} 的来源路径越界：{relative_file}")
    if must_exist and not entry_path.exists():
        raise JournalError(f"日记 {identifier} 的来源文件不存在：{relative_file}")
    return entry_path


def _entry_block_bounds(content: str, identifier: str) -> tuple[int, int]:
    marker = f"<!-- journal-id: {identifier} -->"
    marker_matches = list(
        re.finditer(rf"(?m)^{re.escape(marker)}[ \t]*$", content)
    )
    if len(marker_matches) != 1:
        raise JournalError(
            f"日记 {identifier} 的原文标记数量异常：期望 1，实际 {len(marker_matches)}"
        )
    marker_position = marker_matches[0].start()
    heading_position = content.rfind("\n## ", 0, marker_position)
    if heading_position < 0:
        heading_position = 0 if content.startswith("## ") else -1
    else:
        heading_position += 1
    if heading_position < 0:
        raise JournalError(f"日记 {identifier} 的条目标题缺失")
    next_heading = content.find("\n## ", marker_position + len(marker))
    block_end = len(content) if next_heading < 0 else next_heading
    return heading_position, block_end


def _withdrawal_state_lines(block: str) -> list[str]:
    managed_lines = {WITHDRAWN_STATE_LINE, LEGACY_WITHDRAWN_STATE_LINE}
    return [
        line.rstrip("\r\n").rstrip(" \t")
        for line in block.splitlines(keepends=True)
        if line.rstrip("\r\n").rstrip(" \t") in managed_lines
    ]


def _replace_entry_block(
    content: str,
    block_start: int,
    block_end: int,
    replacement: str,
) -> str:
    return content[:block_start] + replacement + content[block_end:]


def _mark_entry_withdrawn(content: str, identifier: str) -> str:
    block_start, block_end = _entry_block_bounds(content, identifier)
    block = content[block_start:block_end]
    state_lines = _withdrawal_state_lines(block)
    if len(state_lines) > 1:
        raise JournalError(f"日记 {identifier} 的撤回状态标记数量异常")
    if state_lines == [WITHDRAWN_STATE_LINE]:
        return content
    if state_lines == [LEGACY_WITHDRAWN_STATE_LINE]:
        updated_block, replacements = re.subn(
            rf"(?m)^{re.escape(LEGACY_WITHDRAWN_STATE_LINE)}[ \t]*$",
            WITHDRAWN_STATE_LINE,
            block,
            count=1,
        )
        if replacements != 1:
            raise JournalError(f"日记 {identifier} 的撤回状态标记无法升级")
        return _replace_entry_block(content, block_start, block_end, updated_block)

    marker = f"<!-- journal-id: {identifier} -->"
    updated_block, replacements = re.subn(
        rf"(?m)^({re.escape(marker)}[ \t]*)$",
        rf"\1\n{WITHDRAWN_STATE_LINE}",
        block,
        count=1,
    )
    if replacements != 1:
        raise JournalError(f"日记 {identifier} 的原文标记无法定位")
    return _replace_entry_block(content, block_start, block_end, updated_block)


def _unmark_entry_withdrawn(content: str, identifier: str) -> str:
    block_start, block_end = _entry_block_bounds(content, identifier)
    block = content[block_start:block_end]
    state_lines = _withdrawal_state_lines(block)
    if len(state_lines) > 1:
        raise JournalError(f"日记 {identifier} 的撤回状态标记数量异常")
    if not state_lines:
        return content

    managed_line = state_lines[0]
    kept_lines = [
        line
        for line in block.splitlines(keepends=True)
        if line.rstrip("\r\n").rstrip(" \t") != managed_line
    ]
    return _replace_entry_block(content, block_start, block_end, "".join(kept_lines))


def _remove_entry_block(content: str, block_start: int, block_end: int) -> str:
    before = content[:block_start].rstrip()
    after = content[block_end:].lstrip("\n")
    if after:
        return f"{before}\n\n{after.rstrip()}\n"
    return f"{before}\n"


def _amendment_history(target: dict[str, Any], identifier: str) -> list[dict[str, str]]:
    value = target.get("amendments", [])
    if not isinstance(value, list):
        raise JournalError(f"日记 {identifier} 的 amendments 索引损坏")
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, dict) or set(item) != {"id", "timestamp"}:
            raise JournalError(
                f"日记 {identifier} 的 amendments 只能保存 id 和 timestamp"
            )
        item_id = item.get("id")
        timestamp = item.get("timestamp")
        if not isinstance(item_id, str) or not item_id or not isinstance(timestamp, str):
            raise JournalError(f"日记 {identifier} 的 amendments 索引损坏")
        try:
            datetime.fromisoformat(timestamp)
        except ValueError as exc:
            raise JournalError(f"日记 {identifier} 的更正时间损坏：{timestamp}") from exc
        if item_id in seen:
            raise JournalError(f"日记 {identifier} 的更正 ID 重复：{item_id}")
        seen.add(item_id)
        result.append({"id": item_id, "timestamp": timestamp})
    return result


def _string_references(target: dict[str, Any], field: str, identifier: str) -> list[str]:
    value = target.get(field, [])
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise JournalError(f"日记 {identifier} 的 {field} 索引损坏")
    return list(dict.fromkeys(value))


def _invalidate_review_references(
    records: list[dict[str, Any]], references: list[str]
) -> bool:
    """一个共享回顾失效时，所有来源记录都停止把它显示为有效。"""

    affected = set(references)
    if not affected:
        return False
    changed = False
    for record in records:
        identifier = str(record.get("id", "未知"))
        invalidated = _string_references(record, "invalidated_reviews", identifier)
        was_linked = False
        for field in ("weekly_reviews", "monthly_reviews"):
            current = _string_references(record, field, identifier)
            filtered = [value for value in current if value not in affected]
            if filtered != current:
                was_linked = True
                changed = True
            record[field] = filtered
        if was_linked or any(value in affected for value in invalidated):
            updated_invalidated = list(
                dict.fromkeys(invalidated + sorted(affected))
            )
            if updated_invalidated != invalidated or "invalidated_reviews" not in record:
                changed = True
            record["invalidated_reviews"] = updated_invalidated
    return changed


def _amendment_markdown(
    amendment: dict[str, Any], identifier: str, timestamp: str
) -> str:
    labels = {
        "date": "有效日期",
        "time": "有效时间",
        "time_precision": "时间精度",
        "title": "标题",
        "summary": "一句话摘要",
        "facts": "明确事实",
        "feelings": "明确感受",
        "people": "人物",
        "places": "地点或场景",
        "themes": "生活主题",
        "tags": "标签",
        "planning_clues": "可能的规划线索",
        "inferences": "待用户确认的推测",
    }
    lines = [
        "### 更正记录",
        "",
        f"<!-- journal-amendment: {identifier} -->",
        f"- 更正时间：{timestamp}",
        f"- 隐私：{amendment['privacy']}",
        "- 更正说明：",
        "",
        _blockquote(amendment["note"]),
    ]
    if amendment["updates"]:
        lines.extend(["", "- 更正后的轻量索引："])
        for field, value in amendment["updates"].items():
            rendered = "、".join(value) if isinstance(value, list) else value
            lines.append(f"  - {labels[field]}：{rendered or '未记录'}")
    return "\n".join(lines)


def _amendment_timestamp_in_block(block: str, identifier: str) -> str | None:
    marker = f"<!-- journal-amendment: {identifier} -->"
    count = block.count(marker)
    if count == 0:
        return None
    if count != 1:
        raise JournalError(f"更正标记数量异常：{identifier}")
    match = re.search(
        rf"{re.escape(marker)}\n- 更正时间：([^\n]+)",
        block,
    )
    if match is None:
        raise JournalError(f"更正记录缺少可审计时间：{identifier}")
    timestamp = match.group(1).strip()
    try:
        datetime.fromisoformat(timestamp)
    except ValueError as exc:
        raise JournalError(f"更正记录的时间损坏：{identifier}") from exc
    return timestamp


def _append_to_entry_block(content: str, block_end: int, block: str) -> str:
    before = content[:block_end].rstrip()
    after = content[block_end:]
    if after:
        return f"{before}\n\n{block.rstrip()}\n{after}"
    return f"{before}\n\n{block.rstrip()}\n"


def _review_warning_updates(
    root: Path, identifier: str, references: list[str], warning: str
) -> list[tuple[Path, str]]:
    updates: list[tuple[Path, str]] = []
    reviews_root = (root / "reviews").resolve()
    for relative_review in references:
        relative_path = Path(relative_review)
        if (
            relative_path.is_absolute()
            or ".." in relative_path.parts
            or len(relative_path.parts) < 2
            or relative_path.parts[0] != "reviews"
            or relative_path.suffix.lower() != ".md"
        ):
            raise JournalError(f"日记 {identifier} 的回顾路径不安全：{relative_review}")
        review_path = (root / relative_path).resolve()
        if reviews_root not in review_path.parents:
            raise JournalError(f"日记 {identifier} 的回顾路径越界：{relative_review}")
        if not review_path.exists():
            continue
        review_content = review_path.read_text(encoding="utf-8")
        if warning in review_content:
            continue
        first_line, separator, remainder = review_content.partition("\n")
        warning_block = f"> [!WARNING]\n> {warning}"
        if separator:
            warned_content = f"{first_line}\n\n{warning_block}\n\n{remainder.lstrip()}"
        else:
            warned_content = f"{first_line}\n\n{warning_block}\n"
        updates.append((review_path, warned_content))
    return updates


def _known_backup_copies(
    root: Path,
    relative_file: str,
    identifier: str,
) -> tuple[list[str], list[str]]:
    """Return known ZIP copies and ZIPs that could not be inspected.

    The scan only searches for the stable journal marker and never emits entry text.
    Cloud-provider history and platform-side conversation retention are outside this
    project and therefore remain unknown even when both lists are empty.
    """
    backup_dir = root.parent / "backups"
    if not backup_dir.is_dir():
        return [], []
    marker = f"<!-- journal-id: {identifier} -->".encode("utf-8")
    member_suffix = f"/journal/{relative_file}"
    copies: list[str] = []
    unreadable: list[str] = []
    for archive_path in sorted(backup_dir.glob("生活助手-完整备份-*.zip")):
        label = f"backups/{archive_path.name}"
        try:
            with zipfile.ZipFile(archive_path) as archive:
                members = [
                    info
                    for info in archive.infolist()
                    if not info.is_dir() and info.filename.endswith(member_suffix)
                ]
                if len(members) > 1:
                    unreadable.append(label)
                    continue
                if not members:
                    continue
                found = False
                carry = b""
                with archive.open(members[0]) as handle:
                    while True:
                        chunk = handle.read(1024 * 1024)
                        if not chunk:
                            break
                        combined = carry + chunk
                        if marker in combined:
                            found = True
                            break
                        carry = combined[-max(len(marker) - 1, 0) :]
                if found:
                    copies.append(label)
        except (OSError, RuntimeError, zipfile.BadZipFile):
            unreadable.append(label)
    return copies, unreadable


def amend_entry(root: Path, payload: Any) -> dict[str, Any]:
    _assert_no_pending_purge(root)
    amendment = normalize_amendment(payload)
    identifier = amendment["id"]
    correction_id = amendment_id(amendment)
    index_path = root / "index.jsonl"
    records = _load_records(index_path)
    target = next((record for record in records if record.get("id") == identifier), None)
    if target is None:
        raise JournalError(f"找不到日记：{identifier}")
    if target.get("status") != "active":
        raise JournalError(f"只能更正 active 日记：{identifier}")

    entry_path = _validated_entry_path(root, target, identifier)
    month_content = entry_path.read_text(encoding="utf-8")
    block_start, block_end = _entry_block_bounds(month_content, identifier)
    entry_block = month_content[block_start:block_end]
    file_timestamp = _amendment_timestamp_in_block(entry_block, correction_id)

    history = _amendment_history(target, identifier)
    history_item = next((item for item in history if item["id"] == correction_id), None)
    if history_item is not None and file_timestamp is not None:
        if history_item["timestamp"] != file_timestamp:
            raise JournalError(f"更正 {correction_id} 的文件与索引时间不一致")
    timestamp = (
        history_item["timestamp"]
        if history_item is not None
        else file_timestamp or datetime.now().astimezone().isoformat(timespec="seconds")
    )

    # 只有索引尚未记录这次更正时，才应用元数据更新并使旧回顾失效。
    # 这保证重放一条旧 amend 不会覆盖后来的更正或新回顾。
    affected_reviews: list[str] = []
    invalidated_reviews = _string_references(target, "invalidated_reviews", identifier)
    if history_item is None:
        weekly_reviews = _string_references(target, "weekly_reviews", identifier)
        monthly_reviews = _string_references(target, "monthly_reviews", identifier)
        affected_reviews = sorted(set(weekly_reviews + monthly_reviews))
        invalidated_reviews = list(dict.fromkeys(invalidated_reviews + affected_reviews))
        time_changed = any(
            amendment["updates"].get(field, target.get(field))
            != target.get(field, "exact" if field == "time_precision" and target.get("time") else "unknown")
            for field in ("time", "time_precision")
            if field in amendment["updates"]
        )
        if time_changed and "original_time" not in target:
            original_time, original_precision = _normalized_event_time(
                target.get("time"), target.get("time_precision")
            )
            target["original_time"] = original_time
            target["original_time_precision"] = original_precision
        for field, value in amendment["updates"].items():
            if field == "date" and value != target.get(field):
                original_field = f"original_{field}"
                if original_field not in target:
                    target[original_field] = _valid_date(
                        target.get(field), f"日记 {identifier} 的 date"
                    )
            target[field] = value
        target["weekly_reviews"] = []
        target["monthly_reviews"] = []
        target["invalidated_reviews"] = invalidated_reviews
        history.append({"id": correction_id, "timestamp": timestamp})
        target["amendments"] = history

    # 回顾文件本身已失效，因此所有共享来源都必须停止把它显示为有效。
    references_changed = _invalidate_review_references(records, invalidated_reviews)

    review_updates = _review_warning_updates(
        root, identifier, affected_reviews, AMENDED_REVIEW_WARNING
    )
    changed_month = file_timestamp is None
    if changed_month:
        month_content = _append_to_entry_block(
            month_content,
            block_end,
            _amendment_markdown(amendment, correction_id, timestamp),
        )

    # 所有路径、索引和原文标记均通过校验后再开始落盘。
    for review_path, warned_content in review_updates:
        _atomic_write(review_path, warned_content)
    if changed_month:
        _atomic_write(entry_path, month_content)
    if history_item is None or references_changed:
        _write_records(index_path, records)
    # 可读索引是派生视图；即使更正历史已经提交，重试也必须能修复
    # “index.jsonl 已更新、INDEX.md 写入中断”的部分状态。
    readable = _render_readable_index(records)
    readable_path = root / "INDEX.md"
    readable_changed = (
        not readable_path.exists()
        or readable_path.read_text(encoding="utf-8") != readable
    )
    if readable_changed:
        _atomic_write(readable_path, readable)

    if history_item is None and file_timestamp is None:
        status = "amended"
    elif (
        changed_month
        or history_item is None
        or review_updates
        or references_changed
        or readable_changed
    ):
        status = "repaired"
    else:
        status = "exists"
    return {
        "status": status,
        "id": identifier,
        "amendment_id": correction_id,
        "timestamp": timestamp,
        "date": target.get("date"),
        "time": target.get("time"),
        "time_precision": target.get(
            "time_precision", "exact" if target.get("time") else "unknown"
        ),
        "title": target.get("title"),
        "privacy": "local-only",
        "affected_reviews": affected_reviews,
        "invalidated_reviews": invalidated_reviews,
        "redactions": amendment["redactions"],
    }


def withdraw_entry(root: Path, identifier: str) -> dict[str, Any]:
    _assert_no_pending_purge(root)
    identifier = _single_line(identifier, "id", required=True)
    index_path = root / "index.jsonl"
    records = _load_records(index_path)
    target = next((record for record in records if record.get("id") == identifier), None)
    if target is None:
        raise JournalError(f"找不到日记：{identifier}")
    if target.get("status") not in {"active", "withdrawn"}:
        raise JournalError(f"只能撤回 active 日记：{identifier}")

    entry_path = _validated_entry_path(root, target, identifier)
    month_content = entry_path.read_text(encoding="utf-8")
    updated_month_content = _mark_entry_withdrawn(month_content, identifier)
    weekly_reviews = _string_references(target, "weekly_reviews", identifier)
    monthly_reviews = _string_references(target, "monthly_reviews", identifier)
    affected_reviews = sorted(set(weekly_reviews + monthly_reviews))
    invalidated_reviews = _string_references(target, "invalidated_reviews", identifier)
    invalidated_reviews = list(dict.fromkeys(invalidated_reviews + affected_reviews))
    review_updates = _review_warning_updates(
        root, identifier, affected_reviews, WITHDRAWN_REVIEW_WARNING
    )

    was_withdrawn = target.get("status") == "withdrawn"
    target["status"] = "withdrawn"
    if not was_withdrawn:
        target["withdrawn_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    target["weekly_reviews"] = []
    target["monthly_reviews"] = []
    target["invalidated_reviews"] = invalidated_reviews
    _invalidate_review_references(records, invalidated_reviews)

    # 先给旧回顾加入明显警告，再清空索引引用。同一警告不重复插入。
    for review_path, warned_content in review_updates:
        _atomic_write(review_path, warned_content)
    if updated_month_content != month_content:
        _atomic_write(entry_path, updated_month_content)
    _atomic_write(root / "INDEX.md", _render_readable_index(records))
    _write_records(index_path, records)
    return {
        "status": "already_withdrawn" if was_withdrawn else "withdrawn",
        "id": identifier,
        "date": target.get("date"),
        "title": target.get("title"),
        "affected_reviews": affected_reviews,
        "invalidated_reviews": invalidated_reviews,
        "content_retained": True,
    }


def restore_entry(root: Path, identifier: str) -> dict[str, Any]:
    _assert_no_pending_purge(root)
    identifier = _single_line(identifier, "id", required=True)
    index_path = root / "index.jsonl"
    records = _load_records(index_path)
    target = next((record for record in records if record.get("id") == identifier), None)
    if target is None:
        raise JournalError(f"找不到日记：{identifier}")
    if target.get("status") not in {"active", "withdrawn"}:
        raise JournalError(f"只能恢复 withdrawn 日记：{identifier}")

    entry_path = _validated_entry_path(root, target, identifier)
    month_content = entry_path.read_text(encoding="utf-8")
    repaired_content = _unmark_entry_withdrawn(month_content, identifier)
    was_active = target.get("status") == "active"
    target["status"] = "active"
    target.pop("withdrawn_at", None)
    invalidated_reviews = _string_references(target, "invalidated_reviews", identifier)

    if repaired_content != month_content:
        _atomic_write(entry_path, repaired_content)
    readable = _render_readable_index(records)
    readable_path = root / "INDEX.md"
    if not readable_path.exists() or readable_path.read_text(encoding="utf-8") != readable:
        _atomic_write(readable_path, readable)
    if not was_active:
        _write_records(index_path, records)
    return {
        "status": "already_active" if was_active else "restored",
        "id": identifier,
        "date": target.get("date"),
        "title": target.get("title"),
        "invalidated_reviews": invalidated_reviews,
        "reviews_require_refresh": bool(invalidated_reviews),
    }


def _review_reference_strings(target: dict[str, Any], identifier: str) -> list[str]:
    references: list[str] = []
    for field in ("weekly_reviews", "monthly_reviews", "invalidated_reviews"):
        references.extend(_string_references(target, field, identifier))
    return sorted(set(references))


def _validated_review_paths(
    root: Path,
    identifier: str,
    references: Iterable[str],
) -> list[Path]:
    paths: list[Path] = []
    reviews_root = (root / "reviews").resolve()
    for relative_review in sorted(set(references)):
        relative_path = Path(relative_review)
        if (
            relative_path.is_absolute()
            or ".." in relative_path.parts
            or len(relative_path.parts) < 2
            or relative_path.parts[0] != "reviews"
            or relative_path.suffix.lower() != ".md"
        ):
            raise JournalError(f"日记 {identifier} 的回顾路径不安全：{relative_review}")
        review_path = (root / relative_path).resolve()
        if reviews_root not in review_path.parents:
            raise JournalError(f"日记 {identifier} 的回顾路径越界：{relative_review}")
        paths.append(review_path)
    return paths


def _purge_operation_path(root: Path, identifier: str) -> Path:
    digest = hashlib.sha256(identifier.encode("utf-8")).hexdigest()[:20]
    return root / ".operations" / f"purge-{digest}.json"


def _pending_purge_operation_paths(root: Path) -> list[Path]:
    operations_root = root / ".operations"
    if not operations_root.is_dir():
        return []
    return sorted(operations_root.glob("purge-*.json"))


def _assert_no_pending_purge(
    root: Path, *, allowed_identifier: str | None = None
) -> None:
    pending = _pending_purge_operation_paths(root)
    if not pending:
        return
    allowed_path = (
        _purge_operation_path(root, allowed_identifier)
        if allowed_identifier is not None
        else None
    )
    if allowed_path is not None and pending == [allowed_path]:
        return
    raise JournalError(
        "有永久删除操作在中断后等待安全收敛；"
        "完成原 purge 前已阻止其他写操作"
    )


def _review_source_ids(content: str, relative_file: str) -> list[str]:
    headings = list(re.finditer(r"(?m)^## 来源日记[ \t]*$", content))
    if len(headings) != 1:
        raise JournalError(f"回顾来源清单结构异常：{relative_file}")
    section_start = headings[0].end()
    next_heading = re.search(r"(?m)^## ", content[section_start:])
    section_end = (
        len(content)
        if next_heading is None
        else section_start + next_heading.start()
    )
    section = content[section_start:section_end]
    identifiers = re.findall(r"（`([^`\n]+)`）[ \t]*$", section, re.MULTILINE)
    if not identifiers or len(identifiers) != len(set(identifiers)):
        raise JournalError(f"回顾来源 ID 结构异常：{relative_file}")
    return identifiers


def _managed_review_contract(
    root: Path,
    review_path: Path,
    identifier: str,
) -> dict[str, str]:
    relative_file = review_path.relative_to(root.resolve()).as_posix()
    if not review_path.is_file():
        raise JournalError(f"受影响回顾文件不存在：{relative_file}")
    try:
        content = review_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise JournalError(f"回顾文件无法安全检查：{relative_file}") from exc
    markers = re.findall(
        r"(?m)^<!-- journal-review: (weekly|monthly) ([^>\n]+) -->[ \t]*$",
        content,
    )
    if len(markers) != 1 or markers[0][1] != relative_file:
        raise JournalError(f"回顾缺少唯一且匹配路径的受管标记：{relative_file}")
    source_ids = _review_source_ids(content, relative_file)
    if source_ids.count(identifier) != 1:
        raise JournalError(f"回顾未精确引用待删除日记：{relative_file}")
    return {
        "path": relative_file,
        "sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
    }


def _discover_managed_reviews_for_entry(root: Path, identifier: str) -> list[Path]:
    review_root = root / "reviews"
    if not review_root.is_dir():
        return []
    exact_source_token = f"（`{identifier}`）"
    discovered: list[Path] = []
    for candidate in sorted(review_root.rglob("*.md")):
        try:
            content = candidate.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            raise JournalError("有回顾文件无法安全检查，永久删除已停止") from exc
        if exact_source_token not in content:
            continue
        paths = _validated_review_paths(
            root, identifier, [candidate.relative_to(root).as_posix()]
        )
        review_path = paths[0]
        _managed_review_contract(root, review_path, identifier)
        discovered.append(review_path)
    return list(
        {
            path.relative_to(root).as_posix(): path for path in discovered
        }.values()
    )


def _review_files_for_purge(
    root: Path,
    target: dict[str, Any],
    identifier: str,
) -> list[Path]:
    references = _review_reference_strings(target, identifier)
    referenced_paths = _validated_review_paths(root, identifier, references)
    for review_path in referenced_paths:
        _managed_review_contract(root, review_path, identifier)
    discovered_paths = _discover_managed_reviews_for_entry(root, identifier)
    return list(
        {
            path.relative_to(root).as_posix(): path
            for path in [*referenced_paths, *discovered_paths]
        }.values()
    )


def _load_purge_operation(
    root: Path,
    identifier: str,
) -> tuple[dict[str, Any], Path, Path, list[dict[str, str]]] | None:
    operation_path = _purge_operation_path(root, identifier)
    if not operation_path.exists():
        return None
    try:
        payload = json.loads(operation_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise JournalError("永久删除恢复记录损坏；已停止以避免扩大删除范围") from exc
    expected_fields = {
        "schema_version",
        "operation",
        "id",
        "source_file",
        "source_block_sha256",
        "reviews",
        "index_references",
        "created_at",
    }
    if (
        not isinstance(payload, dict)
        or set(payload) != expected_fields
        or payload.get("schema_version") != 2
        or payload.get("operation") != "purge"
        or payload.get("id") != identifier
        or not isinstance(payload.get("source_file"), str)
        or "source_block_sha256" not in payload
        or not isinstance(payload.get("reviews"), list)
        or not isinstance(payload.get("index_references"), list)
        or any(not isinstance(value, str) for value in payload["index_references"])
        or (
            payload.get("source_block_sha256") is not None
            and (
                not isinstance(payload.get("source_block_sha256"), str)
                or re.fullmatch(r"[0-9a-f]{64}", payload["source_block_sha256"])
                is None
            )
        )
    ):
        raise JournalError("永久删除恢复记录结构无效；已停止以避免扩大删除范围")
    try:
        created_at = datetime.fromisoformat(payload["created_at"])
    except (TypeError, ValueError) as exc:
        raise JournalError("永久删除恢复记录的操作时间无效；已停止") from exc
    if created_at.tzinfo is None:
        raise JournalError("永久删除恢复记录的操作时间缺少时区；已停止")
    if payload["index_references"] != sorted(set(payload["index_references"])):
        raise JournalError("永久删除恢复记录的索引引用无效；已停止")
    review_contracts: list[dict[str, str]] = []
    for item in payload["reviews"]:
        if (
            not isinstance(item, dict)
            or set(item) != {"path", "sha256"}
            or not isinstance(item.get("path"), str)
            or not isinstance(item.get("sha256"), str)
            or re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) is None
        ):
            raise JournalError("永久删除恢复记录的回顾契约无效；已停止")
        review_contracts.append({"path": item["path"], "sha256": item["sha256"]})
    if len({item["path"] for item in review_contracts}) != len(review_contracts):
        raise JournalError("永久删除恢复记录的回顾路径重复；已停止")
    entry_path = _validated_entry_path(
        root,
        {"file": payload["source_file"]},
        identifier,
        must_exist=False,
    )
    _validated_review_paths(
        root, identifier, [item["path"] for item in review_contracts]
    )
    _validated_review_paths(root, identifier, payload["index_references"])
    return payload, operation_path, entry_path, review_contracts


def _write_purge_operation(
    root: Path,
    identifier: str,
    relative_file: str,
    review_paths: list[Path],
    *,
    index_references: list[str],
    source_block_sha256: str | None,
    created_at: str | None = None,
) -> tuple[dict[str, Any], Path]:
    review_contracts = [
        _managed_review_contract(root, path, identifier) for path in review_paths
    ]
    payload = {
        "schema_version": 2,
        "operation": "purge",
        "id": identifier,
        "source_file": relative_file,
        "source_block_sha256": source_block_sha256,
        "reviews": review_contracts,
        "index_references": sorted(set(index_references)),
        "created_at": created_at
        or datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    operation_path = _purge_operation_path(root, identifier)
    _atomic_write(
        operation_path,
        json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
    )
    return payload, operation_path


def _validate_frozen_purge_reviews(
    root: Path,
    identifier: str,
    operation_payload: dict[str, Any],
    review_contracts: list[dict[str, str]],
    target: dict[str, Any] | None,
) -> list[Path]:
    frozen = {item["path"]: item for item in review_contracts}
    review_paths = _validated_review_paths(root, identifier, frozen)
    existing_frozen: set[str] = set()
    for review_path in review_paths:
        relative_file = review_path.relative_to(root).as_posix()
        if not review_path.exists():
            continue
        current = _managed_review_contract(root, review_path, identifier)
        if current["sha256"] != frozen[relative_file]["sha256"]:
            raise JournalError(
                f"受影响回顾在永久删除中断后已变化：{relative_file}；"
                "操作保持冻结，需人工核对并恢复原契约后重试"
            )
        existing_frozen.add(relative_file)

    discovered = {
        path.relative_to(root).as_posix()
        for path in _discover_managed_reviews_for_entry(root, identifier)
    }
    if discovered != existing_frozen:
        raise JournalError(
            "永久删除恢复前发现回顾范围漂移；"
            "操作保持冻结且不会自动扩大范围，需人工核对后恢复原契约"
        )

    if target is not None:
        current_references = _review_reference_strings(target, identifier)
        if current_references != operation_payload["index_references"]:
            raise JournalError(
                "永久删除恢复前发现索引回顾引用漂移；"
                "操作保持冻结且不会自动扩大范围，需人工核对后恢复原契约"
            )
    return review_paths


def _source_purge_update(
    entry_path: Path,
    identifier: str,
    *,
    allow_marker_absent: bool,
) -> tuple[str | None, bool, str | None]:
    if not entry_path.exists():
        return None, True, None
    month_content = entry_path.read_text(encoding="utf-8")
    marker = f"<!-- journal-id: {identifier} -->"
    marker_count = len(
        list(re.finditer(rf"(?m)^{re.escape(marker)}[ \t]*$", month_content))
    )
    if marker_count == 0 and allow_marker_absent:
        return None, True, None
    if marker_count != 1:
        raise JournalError(
            f"日记 {identifier} 的原文标记数量异常：期望 1，实际 {marker_count}"
        )
    block_start, block_end = _entry_block_bounds(month_content, identifier)
    source_block = month_content[block_start:block_end]
    source_block_sha256 = hashlib.sha256(source_block.encode("utf-8")).hexdigest()
    return (
        _remove_entry_block(month_content, block_start, block_end),
        False,
        source_block_sha256,
    )


def _validate_frozen_source_block(
    operation_payload: dict[str, Any],
    *,
    source_already_absent: bool,
    source_block_sha256: str | None,
) -> None:
    if source_already_absent:
        return
    if source_block_sha256 != operation_payload.get("source_block_sha256"):
        raise JournalError(
            "待删除日记原文块在永久删除中断后已变化；"
            "操作保持冻结，需人工核对并恢复原契约后重试"
        )


def purge_plan(root: Path, identifier: str) -> dict[str, Any]:
    identifier = _single_line(identifier, "id", required=True)
    records = _load_records(root / "index.jsonl")
    target = next((record for record in records if record.get("id") == identifier), None)
    operation = _load_purge_operation(root, identifier)
    if target is None and operation is None:
        raise JournalError(f"找不到日记：{identifier}")
    if operation is not None:
        operation_payload, _, operation_entry_path, operation_review_contracts = operation
    else:
        operation_payload = None
        operation_entry_path = None
        operation_review_contracts = []
    if target is not None:
        entry_path = _validated_entry_path(root, target, identifier, must_exist=False)
        if operation_entry_path is not None and operation_entry_path != entry_path:
            raise JournalError("永久删除恢复记录与日记来源路径不一致；已停止")
        if operation_payload is not None:
            review_paths = _validate_frozen_purge_reviews(
                root,
                identifier,
                operation_payload,
                operation_review_contracts,
                target,
            )
        else:
            review_paths = _review_files_for_purge(root, target, identifier)
    else:
        entry_path = operation_entry_path
        assert operation_payload is not None
        review_paths = _validate_frozen_purge_reviews(
            root,
            identifier,
            operation_payload,
            operation_review_contracts,
            None,
        )
    assert entry_path is not None
    relative_file = entry_path.relative_to(root.resolve()).as_posix()
    _, source_already_absent, source_block_sha256 = _source_purge_update(
        entry_path,
        identifier,
        allow_marker_absent=operation is not None,
    )
    if operation_payload is not None:
        _validate_frozen_source_block(
            operation_payload,
            source_already_absent=source_already_absent,
            source_block_sha256=source_block_sha256,
        )
    known_copies, unreadable_backups = _known_backup_copies(
        root, relative_file, identifier
    )
    if target is None or operation is not None:
        status = "resume"
    elif target.get("status") == "withdrawn":
        status = "ready"
    else:
        status = "withdraw-first"
    return {
        "status": status,
        "id": identifier,
        "date": target.get("date") if target is not None else None,
        "title": target.get("title") if target is not None else None,
        "scope": "current-project-only",
        "source_present": not source_already_absent,
        "affected_reviews": [path.relative_to(root).as_posix() for path in review_paths],
        "known_backup_copies": known_copies,
        "unreadable_backups": unreadable_backups,
        "historical_copies_outside_project_unknown": True,
        "operation_pending": operation is not None,
    }


def purge_entry(
    root: Path,
    identifier: str,
    confirmation: str,
    *,
    acknowledge_historical_copies: bool,
) -> dict[str, Any]:
    identifier = _single_line(identifier, "id", required=True)
    confirmation = _single_line(confirmation, "confirm", required=True)
    if confirmation != identifier:
        raise JournalError("永久删除确认不匹配；--confirm 必须与 --id 完全一致")
    if not acknowledge_historical_copies:
        raise JournalError(
            "永久删除只覆盖当前项目；历史 ZIP、聊天记录、iCloud 或设备备份可能仍保留副本。"
            "理解此范围后需显式使用 --acknowledge-historical-copies"
        )

    _assert_no_pending_purge(root, allowed_identifier=identifier)
    index_path = root / "index.jsonl"
    records = _load_records(index_path)
    target = next((record for record in records if record.get("id") == identifier), None)
    operation = _load_purge_operation(root, identifier)
    if target is None and operation is None:
        raise JournalError(f"找不到日记：{identifier}")
    if target is not None and target.get("status") != "withdrawn":
        raise JournalError(f"永久删除前必须先 withdraw：{identifier}")
    had_operation = operation is not None
    if operation is not None:
        operation_payload, operation_path, operation_entry_path, operation_review_contracts = operation
    else:
        operation_payload = None
        operation_path = _purge_operation_path(root, identifier)
        operation_entry_path = None
        operation_review_contracts = []

    if target is not None:
        current_entry_path = _validated_entry_path(root, target, identifier, must_exist=False)
        if operation_entry_path is not None and operation_entry_path != current_entry_path:
            raise JournalError("永久删除恢复记录与日记来源路径不一致；已停止")
        entry_path = operation_entry_path or current_entry_path
        if operation_payload is not None:
            review_paths = _validate_frozen_purge_reviews(
                root,
                identifier,
                operation_payload,
                operation_review_contracts,
                target,
            )
        else:
            review_paths = _review_files_for_purge(root, target, identifier)
    else:
        assert operation_entry_path is not None
        assert operation_payload is not None
        entry_path = operation_entry_path
        review_paths = _validate_frozen_purge_reviews(
            root,
            identifier,
            operation_payload,
            operation_review_contracts,
            None,
        )

    relative_file = entry_path.relative_to(root.resolve()).as_posix()
    new_month_content, source_already_absent, source_block_sha256 = _source_purge_update(
        entry_path,
        identifier,
        allow_marker_absent=had_operation,
    )
    if operation_payload is not None:
        _validate_frozen_source_block(
            operation_payload,
            source_already_absent=source_already_absent,
            source_block_sha256=source_block_sha256,
        )
    if operation_payload is None:
        operation_payload, operation_path = _write_purge_operation(
            root,
            identifier,
            relative_file,
            review_paths,
            index_references=_review_reference_strings(target, identifier),
            source_block_sha256=source_block_sha256,
        )

    deleted_review_relatives = [
        item["path"] for item in operation_payload["reviews"]
    ]
    deleted_review_set = set(deleted_review_relatives)
    remaining_records = [record for record in records if record.get("id") != identifier]
    for record in remaining_records:
        record_id = str(record.get("id", "未知"))
        for field in ("weekly_reviews", "monthly_reviews", "invalidated_reviews"):
            references = _string_references(record, field, record_id)
            record[field] = [
                value for value in references if value not in deleted_review_set
            ]

    known_copies, unreadable_backups = _known_backup_copies(
        root, relative_file, identifier
    )

    # 备份扫描可能耗时；在第一个破坏性写入前再读一次冻结契约，
    # 避免手工编辑或云同步在 operation 持久化后修改了待删内容。
    operation_review_contracts = [
        {"path": item["path"], "sha256": item["sha256"]}
        for item in operation_payload["reviews"]
    ]
    review_paths = _validate_frozen_purge_reviews(
        root,
        identifier,
        operation_payload,
        operation_review_contracts,
        target,
    )
    new_month_content, source_already_absent, source_block_sha256 = _source_purge_update(
        entry_path,
        identifier,
        allow_marker_absent=True,
    )
    _validate_frozen_source_block(
        operation_payload,
        source_already_absent=source_already_absent,
        source_block_sha256=source_block_sha256,
    )

    # 删除当前项目中的原文块、机器索引和可能含有衍生内容的整份回顾。
    # 旧 ZIP 和云服务版本不在本命令权限范围内，且已由参数显式确认知情。
    if new_month_content is not None:
        _atomic_write(entry_path, new_month_content)
    for review_path in review_paths:
        if review_path.exists():
            current_contract = _managed_review_contract(root, review_path, identifier)
            expected_contract = next(
                item
                for item in operation_review_contracts
                if item["path"] == current_contract["path"]
            )
            if current_contract["sha256"] != expected_contract["sha256"]:
                raise JournalError(
                    f"受影响回顾在删除前发生变化：{current_contract['path']}；"
                    "操作保持冻结，未继续删除该回顾"
                )
        review_path.unlink(missing_ok=True)
    _atomic_write(root / "INDEX.md", _render_readable_index(remaining_records))
    _write_records(index_path, remaining_records)
    operation_path.unlink(missing_ok=True)
    return {
        "status": "recovered" if had_operation else "purged",
        "id": identifier,
        "scope": "current-project-only",
        "source_already_absent": source_already_absent,
        "deleted_reviews": deleted_review_relatives,
        "known_backup_copies": known_copies,
        "unreadable_backups": unreadable_backups,
        "historical_copies_acknowledged": True,
        "resumed_operation": had_operation,
    }


def _review_source_set_etag(
    review_type: str,
    start: str,
    end: str,
    entry_ids: Iterable[str],
) -> str:
    """为回顾周期和完整来源 ID 集合生成不含原文的稳定契约。"""

    contract = {
        "schema_version": 1,
        "type": review_type,
        "start": start,
        "end": end,
        "entry_ids": sorted(set(entry_ids)),
    }
    canonical = json.dumps(
        contract,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def normalize_review(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise JournalError("回顾 JSON 顶层必须是对象")

    review_type = _single_line(payload.get("type"), "type", required=True)
    if review_type not in REVIEW_TYPES:
        allowed = ", ".join(sorted(REVIEW_TYPES))
        raise JournalError(f"type 只能是：{allowed}")

    privacy = _single_line(payload.get("privacy", "local-only"), "privacy", required=True)
    if privacy != "local-only":
        raise JournalError("当前只允许 privacy=local-only；日记回顾不会由本工具公开或共享")

    start = _valid_date(payload.get("start"), "start")
    end = _valid_date(payload.get("end"), "end")
    if start > end:
        raise JournalError("start 不能晚于 end")

    start_date = date.fromisoformat(start)
    end_date = date.fromisoformat(end)
    if review_type == "weekly" and (
        (end_date - start_date).days != 6
        or start_date.weekday() != 0
        or end_date.weekday() != 6
        or start_date.isocalendar()[:2] != end_date.isocalendar()[:2]
    ):
        raise JournalError("weekly 回顾必须覆盖同一 ISO 自然周的周一至周日")
    if review_type == "monthly" and start[:7] != end[:7]:
        raise JournalError("monthly 回顾的 start 和 end 必须在同一自然月")
    if review_type == "monthly":
        final_day = monthrange(start_date.year, start_date.month)[1]
        if start_date.day != 1 or end_date.day != final_day:
            raise JournalError("monthly 回顾必须覆盖完整自然月（首日至末日）")

    entry_ids = _string_list(payload.get("entry_ids"), "entry_ids")
    if not entry_ids:
        raise JournalError("回顾至少需要一个 entry_ids 条目")
    source_set_etag = _single_line(
        payload.get("source_set_etag"), "source_set_etag", required=True
    )
    if not SOURCE_SET_ETAG_PATTERN.fullmatch(source_set_etag):
        raise JournalError("source_set_etag 必须是 64 位小写 SHA-256")

    review: dict[str, Any] = {
        "type": review_type,
        "start": start,
        "end": end,
        "title": _single_line(payload.get("title"), "title", required=True),
        "entry_ids": entry_ids,
        "source_set_etag": source_set_etag,
        "privacy": privacy,
    }
    for field in REVIEW_LIST_FIELDS:
        review[field] = _string_list(payload.get(field), field)

    redactions: list[str] = []
    review["title"], reasons = _redact_secrets(review["title"])
    redactions.extend(reasons)
    for field in REVIEW_LIST_FIELDS:
        cleaned: list[str] = []
        for item in review[field]:
            redacted_item, reasons = _redact_secrets(item)
            cleaned.append(redacted_item)
            redactions.extend(reason for reason in reasons if reason not in redactions)
        review[field] = cleaned
    review["redactions"] = redactions
    return review


def _review_relative_file(review: dict[str, Any]) -> str:
    if review["type"] == "weekly":
        iso_year, iso_week, _ = date.fromisoformat(review["start"]).isocalendar()
        return f"reviews/{iso_year}/{iso_year}-W{iso_week:02d}.md"
    year_month = review["start"][:7]
    return f"reviews/{year_month[:4]}/{year_month}.md"


def _review_section(title: str, values: list[str], *, prefix: str = "") -> list[str]:
    lines = [f"## {title}", ""]
    if values:
        lines.extend(f"- {prefix}{value}" for value in values)
    else:
        lines.append("- 暂无记录")
    lines.append("")
    return lines


def _markdown_link_label(value: Any) -> str:
    return str(value or "未命名").replace("[", "［").replace("]", "］").replace("\n", " ")


def _review_markdown(review: dict[str, Any], entries: list[dict[str, Any]], relative_file: str) -> str:
    label = "每周轻回顾" if review["type"] == "weekly" else "每月生活回顾"
    lines = [
        f"# {review['title']}",
        "",
        f"<!-- journal-review: {review['type']} {relative_file} -->",
        f"- 类型：{label}",
        f"- 范围：{review['start']} 至 {review['end']}",
        f"- 隐私：{review['privacy']}",
        f"- 来源日记：{len(entries)} 篇",
        "",
    ]
    lines.extend(_review_section("本期生活片段", review["events"]))
    lines.extend(_review_section("带来补充的事", review["replenishing"]))
    lines.extend(_review_section("带来消耗的事", review["draining"]))
    lines.extend(_review_section("反复出现的线索", review["recurring"]))
    lines.extend(_review_section("尚未结束的事", review["open_threads"]))
    lines.extend(_review_section("对后续规划有用的启示", review["planning_implications"]))
    lines.extend(
        [
            "## 候选长期认识（待用户确认）",
            "",
            "> 以下只是从本期日记归纳的候选线索。未经用户确认，不得写入 USER.md、MEMORY.md 或 GOALS.md。",
            "",
        ]
    )
    if review["candidate_memories"]:
        lines.extend(f"- 待用户确认：{value}" for value in review["candidate_memories"])
    else:
        lines.append("- 暂无候选认识")
    lines.extend(["", "## 来源日记", ""])
    for entry in sorted(entries, key=lambda item: (str(item.get("date", "")), str(item.get("time", "")))):
        source_file = str(entry.get("file", ""))
        link_target = f"../../{source_file}" if source_file else ""
        title = _markdown_link_label(entry.get("title"))
        title_cell = f"[{title}]({link_target})" if link_target else title
        display_time = _display_time(
            entry.get("time"), entry.get("time_precision")
        )
        lines.append(
            f"- {entry.get('date', '—')} {display_time}｜{title_cell}（`{entry.get('id', '')}`）"
        )
    lines.append("")
    return "\n".join(lines)


def _review_records(
    records: list[dict[str, Any]], review: dict[str, Any]
) -> list[dict[str, Any]]:
    by_id = {str(record.get("id", "")): record for record in records}
    selected: list[dict[str, Any]] = []
    for identifier in review["entry_ids"]:
        record = by_id.get(identifier)
        if record is None:
            raise JournalError(f"回顾引用了不存在的日记：{identifier}")
        if record.get("status") != "active":
            raise JournalError(f"回顾只能引用 active 日记：{identifier}")
        record_date = _valid_date(record.get("date"), f"日记 {identifier} 的 date")
        if not review["start"] <= record_date <= review["end"]:
            raise JournalError(
                f"日记 {identifier} 的日期 {record_date} 不在回顾范围 "
                f"{review['start']} 至 {review['end']} 内"
            )
        selected.append(record)
    return selected


def create_review(root: Path, payload: Any) -> dict[str, Any]:
    _assert_no_pending_purge(root)
    review = normalize_review(payload)
    index_path = root / "index.jsonl"
    records = _load_records(index_path)
    selected = _review_records(records, review)
    current_period_ids = sorted(
        str(record["id"])
        for record in records
        if record.get("status") == "active"
        and review["start"] <= str(record.get("date", "")) <= review["end"]
    )
    expected_source_set_etag = _review_source_set_etag(
        review["type"],
        review["start"],
        review["end"],
        current_period_ids,
    )
    if (
        set(review["entry_ids"]) != set(current_period_ids)
        or len(review["entry_ids"]) != len(current_period_ids)
        or review["source_set_etag"] != expected_source_set_etag
    ):
        raise JournalError(
            "回顾来源集合已变化或不完整；"
            "本次未写入，请重新运行 review-plan 后使用最新 source_set_etag"
        )
    safe_selected: list[dict[str, Any]] = []
    for record in selected:
        safe_record = dict(record)
        safe_record["title"], reasons = _redact_secrets(str(record.get("title", "")))
        review["redactions"].extend(
            reason for reason in reasons if reason not in review["redactions"]
        )
        safe_selected.append(safe_record)
    selected_ids = {str(record["id"]) for record in selected}
    relative_file = _review_relative_file(review)
    review_path = root / relative_file
    rendered = _review_markdown(review, safe_selected, relative_file)

    file_existed = review_path.exists()
    existing_content = review_path.read_text(encoding="utf-8") if file_existed else ""
    if file_existed:
        ownership_markers = re.findall(
            r"(?m)^<!-- journal-review: (weekly|monthly) ([^>\n]+) -->[ \t]*$",
            existing_content,
        )
        expected_marker = (review["type"], relative_file)
        if ownership_markers != [expected_marker]:
            raise JournalError(
                f"同一周期路径已存在非本工具管理的文件：{relative_file}；"
                "已停止以避免静默覆盖"
            )
        period_match = re.search(
            r"(?m)^- 范围：(\d{4}-\d{2}-\d{2}) 至 (\d{4}-\d{2}-\d{2})$",
            existing_content,
        )
        if period_match is None:
            raise JournalError(f"已有回顾缺少可审计日期范围：{relative_file}")
        existing_period = (period_match.group(1), period_match.group(2))
        requested_period = (review["start"], review["end"])
        if existing_period != requested_period:
            raise JournalError(
                f"同一周期已有不同日期范围的回顾：{relative_file}；"
                "请刷新原范围或先明确处理旧回顾"
            )
    file_changed = existing_content != rendered

    reference_field = "weekly_reviews" if review["type"] == "weekly" else "monthly_reviews"
    index_changed = False
    for record in records:
        for field in ("weekly_reviews", "monthly_reviews"):
            current = record.get(field, [])
            if not isinstance(current, list) or any(not isinstance(value, str) for value in current):
                raise JournalError(f"日记 {record.get('id', '未知')} 的 {field} 索引损坏")
            normalized = list(dict.fromkeys(current))
            if normalized != current or field not in record:
                record[field] = normalized
                index_changed = True

        invalidated = _string_references(
            record, "invalidated_reviews", str(record.get("id", "未知"))
        )
        refreshed_invalidated = [
            value for value in invalidated if value != relative_file
        ]
        if refreshed_invalidated != invalidated or "invalidated_reviews" not in record:
            record["invalidated_reviews"] = refreshed_invalidated
            index_changed = True

        current_references = [
            value for value in record[reference_field] if value != relative_file
        ]
        if str(record.get("id")) in selected_ids:
            current_references.append(relative_file)
        if current_references != record[reference_field]:
            record[reference_field] = current_references
            index_changed = True

    # 先完成全部校验和索引计算，再开始任何落盘。
    if file_changed:
        _atomic_write(review_path, rendered)
    if index_changed:
        _write_records(index_path, records)

    if not file_existed:
        status = "added"
    elif file_changed or index_changed:
        status = "updated"
    else:
        status = "exists"
    return {
        "status": status,
        "type": review["type"],
        "start": review["start"],
        "end": review["end"],
        "title": review["title"],
        "entry_count": len(selected),
        "entry_ids": review["entry_ids"],
        "file": relative_file,
        "privacy": "local-only",
        "redactions": review["redactions"],
    }


def list_entries(
    root: Path,
    *,
    start: str | None = None,
    end: str | None = None,
    tag: str | None = None,
    limit: int | None = None,
    order: str = "desc",
) -> list[dict[str, Any]]:
    if start is not None:
        start = _valid_date(start, "start")
    if end is not None:
        end = _valid_date(end, "end")
    if start and end and start > end:
        raise JournalError("start 不能晚于 end")
    if limit is not None and limit < 1:
        raise JournalError("limit 必须大于 0")

    normalized_tag = _single_line(tag, "tag") if tag is not None else None
    records = [
        record
        for record in _load_records(root / "index.jsonl")
        if record.get("status") == "active"
    ]
    filtered = [
        record
        for record in records
        if (start is None or str(record.get("date", "")) >= start)
        and (end is None or str(record.get("date", "")) <= end)
        and (normalized_tag is None or normalized_tag in record.get("tags", []))
    ]
    filtered.sort(
        key=lambda item: (str(item.get("date", "")), str(item.get("time", "")), str(item.get("id", ""))),
        reverse=order == "desc",
    )
    selected = filtered[:limit] if limit is not None else filtered
    return [
        {field: record[field] for field in LIST_SAFE_FIELDS if field in record}
        for record in selected
    ]


def _recorded_at_key(record: dict[str, Any]) -> tuple[float, str]:
    value = record.get("recorded_at")
    if not isinstance(value, str):
        raise JournalError(f"日记 {record.get('id', '未知')} 缺少有效 recorded_at")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise JournalError(
            f"日记 {record.get('id', '未知')} 的 recorded_at 损坏"
        ) from exc
    if parsed.tzinfo is None:
        raise JournalError(f"日记 {record.get('id', '未知')} 的 recorded_at 缺少时区")
    return parsed.timestamp(), str(record.get("id", ""))


def withdraw_latest_implicit(root: Path) -> dict[str, Any]:
    """原子解析并撤回最近记录的 active 隐式日记，而非事件日期最新者。"""

    _assert_no_pending_purge(root)
    candidates = [
        record
        for record in _load_records(root / "index.jsonl")
        if record.get("status") == "active" and record.get("source") == "implicit"
    ]
    if not candidates:
        raise JournalError("没有可撤回的 active 隐式日记")
    target = max(candidates, key=_recorded_at_key)
    result = withdraw_entry(root, str(target["id"]))
    result["resolved_by"] = "latest_recorded_implicit"
    return result


def _review_period_for_date(review_type: str, entry_date: str) -> tuple[str, str]:
    parsed = date.fromisoformat(_valid_date(entry_date, "日记 date"))
    if review_type == "weekly":
        start_date = parsed - timedelta(days=parsed.weekday())
        end_date = start_date + timedelta(days=6)
    else:
        start_date = parsed.replace(day=1)
        end_date = parsed.replace(day=monthrange(parsed.year, parsed.month)[1])
    return start_date.isoformat(), end_date.isoformat()


def _review_plan_file(review_type: str, start: str) -> str:
    return _review_relative_file({"type": review_type, "start": start})


def _review_file_source_ids(
    root: Path,
    review_type: str,
    relative_file: str,
) -> list[str] | None:
    relative_path = Path(relative_file)
    if (
        relative_path.is_absolute()
        or ".." in relative_path.parts
        or len(relative_path.parts) < 2
        or relative_path.parts[0] != "reviews"
        or relative_path.suffix.lower() != ".md"
    ):
        raise JournalError(f"回顾计划路径不安全：{relative_file}")
    review_path = (root / relative_path).resolve()
    reviews_root = (root / "reviews").resolve()
    if reviews_root not in review_path.parents:
        raise JournalError(f"回顾计划路径越界：{relative_file}")
    if not review_path.exists():
        return None
    if not review_path.is_file():
        raise JournalError(f"回顾路径不是普通文件：{relative_file}")
    try:
        content = review_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise JournalError(f"回顾文件无法安全检查：{relative_file}") from exc
    markers = re.findall(
        r"(?m)^<!-- journal-review: (weekly|monthly) ([^>\n]+) -->[ \t]*$",
        content,
    )
    if markers != [(review_type, relative_file)]:
        raise JournalError(f"回顾缺少唯一且匹配路径的受管标记：{relative_file}")
    return _review_source_ids(content, relative_file)


def review_plan(
    root: Path,
    review_type: str,
    as_of: str,
) -> dict[str, Any]:
    """列出截至当地日期已经闭合、且需要生成或刷新的周期。"""

    review_type = _single_line(review_type, "type", required=True)
    if review_type not in REVIEW_TYPES:
        allowed = ", ".join(sorted(REVIEW_TYPES))
        raise JournalError(f"type 只能是：{allowed}")
    as_of = _valid_date(as_of, "as_of")
    records = [
        record
        for record in _load_records(root / "index.jsonl")
        if record.get("status") == "active"
    ]
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for record in records:
        start, end = _review_period_for_date(review_type, record.get("date"))
        if end >= as_of:
            continue
        grouped.setdefault((start, end), []).append(record)

    reference_field = "weekly_reviews" if review_type == "weekly" else "monthly_reviews"
    due: list[dict[str, Any]] = []
    for (start, end), period_records in sorted(grouped.items()):
        period_records.sort(
            key=lambda item: (
                str(item.get("date", "")),
                str(item.get("time") or ""),
                str(item.get("id", "")),
            )
        )
        entry_ids = [str(record.get("id", "")) for record in period_records]
        if any(not identifier for identifier in entry_ids):
            raise JournalError(f"{start} 至 {end} 的日记缺少有效 id")
        relative_file = _review_plan_file(review_type, start)
        file_source_ids = _review_file_source_ids(
            root, review_type, relative_file
        )
        references_current = all(
            relative_file in _string_references(record, reference_field, str(record["id"]))
            and relative_file
            not in _string_references(record, "invalidated_reviews", str(record["id"]))
            for record in period_records
        )
        file_current = (
            file_source_ids is not None
            and len(file_source_ids) == len(entry_ids)
            and set(file_source_ids) == set(entry_ids)
        )
        if references_current and file_current:
            continue
        if file_source_ids is None:
            reason = "missing_review"
        elif not file_current:
            reason = "source_set_changed"
        else:
            reason = "index_or_invalidation_drift"
        due.append(
            {
                "type": review_type,
                "start": start,
                "end": end,
                "entry_ids": entry_ids,
                "entry_count": len(entry_ids),
                "source_set_etag": _review_source_set_etag(
                    review_type, start, end, entry_ids
                ),
                "file": relative_file,
                "reason": reason,
            }
        )
    return {"type": review_type, "as_of": as_of, "due": due}


def _read_payload(input_path: str) -> Any:
    try:
        if input_path == "-":
            return json.load(sys.stdin)
        with Path(input_path).open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except json.JSONDecodeError as exc:
        raise JournalError(f"输入不是有效 JSON：{exc.msg}") from exc


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="当前项目内的私密对话式生活日记归档工具")
    subparsers = parser.add_subparsers(dest="command", required=True)

    add_parser = subparsers.add_parser("add", help="从 JSON 文件新增一篇日记")
    add_parser.add_argument("--input", required=True, help="JSON 文件路径；- 表示从 stdin 读取")
    add_parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="日记根目录")

    amend_parser = subparsers.add_parser("amend", help="追加可审计的日记更正")
    amend_parser.add_argument("--input", required=True, help="更正 JSON 文件路径；- 表示从 stdin 读取")
    amend_parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="日记根目录")

    list_parser = subparsers.add_parser("list", help="从机器索引列出日记元数据")
    list_parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="日记根目录")
    list_parser.add_argument("--start", help="起始日期（YYYY-MM-DD，含）")
    list_parser.add_argument("--end", help="结束日期（YYYY-MM-DD，含）")
    list_parser.add_argument("--tag", help="精确匹配一个标签")
    list_parser.add_argument("--limit", type=int, help="最多返回的条数")
    list_parser.add_argument("--order", choices=("asc", "desc"), default="desc", help="排序方向")

    withdraw_parser = subparsers.add_parser("withdraw", help="撤回一篇日记，使其不再进入索引与回顾")
    withdraw_parser.add_argument("--id", required=True, help="要撤回的稳定日记 ID")
    withdraw_parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="日记根目录")

    latest_implicit_parser = subparsers.add_parser(
        "withdraw-latest-implicit",
        help="按记录时间原子撤回最近一次 active 隐式日记",
    )
    latest_implicit_parser.add_argument(
        "--root", type=Path, default=DEFAULT_ROOT, help="日记根目录"
    )

    restore_parser = subparsers.add_parser("restore", help="恢复一篇已撤回但尚未永久删除的日记")
    restore_parser.add_argument("--id", required=True, help="要恢复的稳定日记 ID")
    restore_parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="日记根目录")

    purge_plan_parser = subparsers.add_parser(
        "purge-plan", help="只读预览永久删除范围、受影响回顾和已知 ZIP 副本"
    )
    purge_plan_parser.add_argument("--id", required=True, help="要预览的稳定日记 ID")
    purge_plan_parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="日记根目录")

    purge_parser = subparsers.add_parser("purge", help="从当前项目永久删除一篇已撤回日记")
    purge_parser.add_argument("--id", required=True, help="要永久删除的稳定日记 ID")
    purge_parser.add_argument(
        "--confirm",
        required=True,
        help="必须与 --id 完全一致的二次确认",
    )
    purge_parser.add_argument(
        "--acknowledge-historical-copies",
        action="store_true",
        help="确认历史 ZIP、聊天、iCloud 或设备备份可能仍保留副本",
    )
    purge_parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="日记根目录")

    review_parser = subparsers.add_parser("review", help="生成或刷新每周/每月日记回顾")
    review_parser.add_argument("--input", required=True, help="回顾 JSON 文件路径；- 表示从 stdin 读取")
    review_parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="日记根目录")

    review_plan_parser = subparsers.add_parser(
        "review-plan", help="只读列出已经闭合且待生成或刷新的周/月周期"
    )
    review_plan_parser.add_argument("--type", choices=sorted(REVIEW_TYPES), required=True)
    review_plan_parser.add_argument("--as-of", required=True, help="当地检查日期 YYYY-MM-DD")
    review_plan_parser.add_argument(
        "--root", type=Path, default=DEFAULT_ROOT, help="日记根目录"
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        root = args.root.resolve()
        if args.command == "add" and (root.parent / ONLINE_PRIMARY_MARKER).is_file():
            raise JournalError(
                "本地活跃写入已停用；请使用 tools/life_console_cloud.py 写入线上唯一真相源"
            )
        with _journal_lock(root):
            if args.command == "add":
                result: Any = add_entry(root, _read_payload(args.input))
            elif args.command == "amend":
                result = amend_entry(root, _read_payload(args.input))
            elif args.command == "list":
                result = list_entries(
                    root,
                    start=args.start,
                    end=args.end,
                    tag=args.tag,
                    limit=args.limit,
                    order=args.order,
                )
            elif args.command == "withdraw":
                result = withdraw_entry(root, args.id)
            elif args.command == "withdraw-latest-implicit":
                result = withdraw_latest_implicit(root)
            elif args.command == "restore":
                result = restore_entry(root, args.id)
            elif args.command == "purge-plan":
                result = purge_plan(root, args.id)
            elif args.command == "purge":
                result = purge_entry(
                    root,
                    args.id,
                    args.confirm,
                    acknowledge_historical_copies=args.acknowledge_historical_copies,
                )
            elif args.command == "review-plan":
                result = review_plan(root, args.type, args.as_of)
            else:
                result = create_review(root, _read_payload(args.input))
    except (JournalError, OSError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
