#!/usr/bin/env python3
"""生活日记“候选长期认识”确认台账。

该工具只从受管日记回顾中提取已归纳的候选文本，不读取日记原文，
也不会修改 USER.md、MEMORY.md 或 GOALS.md。所有可能含个人信息的
JSON 输入都只从非 PTY stdin 读取。
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import date, datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys
import time
from typing import Any, Iterable, Iterator, Mapping


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ROOT = PROJECT_ROOT / "journal"
LEDGER_NAME = "insight-decisions.jsonl"
LOCK_NAME = ".journal.lock"
MAX_STDIN_BYTES = 64 * 1024
MAX_REVIEW_BYTES = 2 * 1024 * 1024
MAX_LEDGER_BYTES = 8 * 1024 * 1024
MAX_CANDIDATE_SOURCE_CHARS = 10_000
MAX_SUMMARY_CHARS = 160
MAX_PROPOSAL_BYTES = 48 * 1024
MAX_TARGET_BYTES = 8 * 1024 * 1024
PLAN_LIMIT = 3
STALE_REVIEW_WARNINGS = (
    "⚠️ 来源日记已撤回，本回顾需刷新后再用于规划。",
    "⚠️ 来源日记已更正，本回顾需刷新后再用于规划。",
)

KINDS = {"candidate_memory", "planning_implication"}
STATUSES = {
    "pending",
    "awaiting_proposal",
    "proposed",
    "applied",
    "rejected",
    "superseded",
}
ACTIONABLE_STATUSES = {"pending", "awaiting_proposal", "proposed"}
DECISIONS = {"accept": "awaiting_proposal", "reject": "rejected"}
TARGET_FILES = frozenset({"USER.md", "MEMORY.md", "GOALS.md"})
CANDIDATE_ID_PATTERN = re.compile(r"^insight-[0-9a-f]{64}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
ENTRY_ID_PATTERN = re.compile(
    r"(?<![0-9A-Za-z])\d{8}-(?:\d{4}|unknown)-[0-9a-f]{12}(?![0-9A-Za-z])"
)
YEAR_PATTERN = re.compile(r"^\d{4}$")
WEEKLY_FILE_PATTERN = re.compile(r"^reviews/(\d{4})/\1-W(\d{2})\.md$")
MONTHLY_FILE_PATTERN = re.compile(r"^reviews/(\d{4})/\1-(\d{2})\.md$")
REVIEW_MARKER_PATTERN = re.compile(
    r"(?m)^<!-- journal-review: (weekly|monthly) ([^>\r\n]+) -->[ \t]*\r?$"
)
SECTION_PATTERN = re.compile(r"(?m)^## ([^\r\n]+?)[ \t]*\r?$")
FORBIDDEN_SOURCE_LABEL = re.compile(
    r"(?:^|[\s（(;；,，。])(?:raw|original(?:\s+text)?|原文|用户原话)\s*[:：]",
    re.IGNORECASE,
)

LEDGER_FIELDS = frozenset(
    {
        "candidate_id",
        "kind",
        "review_file",
        "review_sha256",
        "summary",
        "status",
        "decided_at",
        "proposal_target",
        "proposal_text",
        "proposal_sha256",
        "proposed_at",
        "applied_at",
        "recorded_at",
        "revision",
    }
)
LEGACY_LEDGER_FIELDS = frozenset(
    {
        "candidate_id",
        "kind",
        "review_file",
        "review_sha256",
        "summary",
        "status",
        "decided_at",
        "recorded_at",
        "revision",
    }
)
DECIDE_FIELDS = frozenset(
    {"candidate_id", "decision", "expect_revision", "expect_candidate_etag"}
)
PROPOSE_FIELDS = frozenset(
    {
        "candidate_id",
        "target_file",
        "proposal_text",
        "expect_revision",
        "expect_candidate_etag",
    }
)
APPLY_PLAN_FIELDS = frozenset(
    {"candidate_id", "expect_revision", "expect_candidate_etag"}
)
MARK_APPLIED_FIELDS = frozenset(
    {
        "candidate_id",
        "expect_revision",
        "expect_candidate_etag",
        "expect_proposal_sha256",
    }
)


class InsightError(ValueError):
    """可安全显示且不包含候选原文的错误。"""


def _reject_constant(_value: str) -> Any:
    raise InsightError("JSON 不得包含 NaN 或 Infinity")


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise InsightError("JSON 含重复字段")
        result[key] = value
    return result


def _decode_json(raw: bytes, *, source: str) -> Any:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise InsightError(f"{source} 必须是 UTF-8 JSON") from None
    try:
        return json.loads(
            text,
            object_pairs_hook=_strict_object,
            parse_constant=_reject_constant,
        )
    except InsightError:
        raise
    except (json.JSONDecodeError, ValueError):
        raise InsightError(f"{source} JSON 无效") from None


def _read_stdin_payload() -> Any:
    if sys.stdin.isatty():
        raise InsightError("为避免终端回显，请通过非 PTY stdin 传入 JSON")
    raw = sys.stdin.buffer.read(MAX_STDIN_BYTES + 1)
    if len(raw) > MAX_STDIN_BYTES:
        raise InsightError("输入 JSON 过大")
    if not raw.strip():
        raise InsightError("缺少 stdin JSON")
    return _decode_json(raw, source="stdin")


def _require_object(payload: Any, allowed: frozenset[str], required: frozenset[str]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise InsightError("输入 JSON 顶层必须是对象")
    fields = set(payload)
    if not required.issubset(fields) or not fields.issubset(allowed):
        raise InsightError("输入 JSON 字段不符合命令契约")
    return payload


def _normalize_space(value: str) -> str:
    return " ".join(value.split())


SECRET_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(
            r"-----BEGIN (?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY-----.*?(?:"
            r"-----END (?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY-----|\Z)",
            re.IGNORECASE | re.DOTALL,
        ),
        "[私钥已省略]",
    ),
    (
        re.compile(
            r"-----BEGIN PGP "
            r"PRIVATE KEY BLOCK-----.*?(?:-----END PGP "
            r"PRIVATE KEY BLOCK-----|\Z)",
            re.IGNORECASE | re.DOTALL,
        ),
        "[私钥已省略]",
    ),
    (
        re.compile(r"\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b"),
        "[访问令牌已省略]",
    ),
    (re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"), "[云访问密钥已省略]"),
    (
        re.compile(
            r"(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\."
            r"[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])"
        ),
        "[JWT 已省略]",
    ),
    (
        re.compile(
            r"((?:恢复码|恢复代码|恢复密钥|备用码|backup\s+code|recovery\s+code)"
            r"\s*(?:是|为|[:：=])?\s*)(?:[A-Za-z0-9]{2,}(?:[ -]+[A-Za-z0-9]{2,})+|[A-Za-z0-9]{8,})",
            re.IGNORECASE,
        ),
        r"\1[已省略]",
    ),
    (
        re.compile(r"((?:验证码|动态码|短信码|OTP)\s*(?:是|为|[:：])?\s*)\d{4,8}", re.IGNORECASE),
        r"\1[已省略]",
    ),
    (
        re.compile(
            r"((?:password|passwd|pwd|secret|token|api[_ -]?key|access[_ -]?key|"
            r"access\s+token|client[_ -]?secret|访问令牌|令牌|API\s*密钥|"
            r"接口密钥|访问密钥|客户端密钥)\s*[:：=]\s*)"
            r'(?:"[^\r\n]*?"|\'[^\r\n]*?\'|[^\s,，。;；]+)',
            re.IGNORECASE,
        ),
        r"\1[已省略]",
    ),
    (
        re.compile(
            r'((?:密码|口令|PIN)\s*[:：=]\s*)(?:"[^\r\n]*?"|\'[^\r\n]*?\'|[^\s,，。;；]+)',
            re.IGNORECASE,
        ),
        r"\1[已省略]",
    ),
    (
        re.compile(
            r"((?:密码|口令|PIN)\s*(?:是|为)\s*)"
            r"[A-Za-z0-9!@#$%^&*()_+={}\[\]:<>,.?/~`|\\-]{4,}",
            re.IGNORECASE,
        ),
        r"\1[已省略]",
    ),
    (re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"), "[手机号已省略]"),
    (
        re.compile(r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![A-Za-z0-9.-])"),
        "[邮箱已省略]",
    ),
    (re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)"), "[完整号码已省略]"),
    (ENTRY_ID_PATTERN, "[来源标识已省略]"),
)


def _redact_summary(value: str) -> str:
    redacted = value
    for pattern, replacement in SECRET_PATTERNS:
        redacted = pattern.sub(replacement, redacted)
    redacted = _normalize_space(redacted)
    if len(redacted) > MAX_SUMMARY_CHARS:
        redacted = redacted[: MAX_SUMMARY_CHARS - 1].rstrip() + "…"
    return redacted


def _normalize_candidate_text(value: str) -> str:
    if not isinstance(value, str):
        raise InsightError("受管回顾的候选字段结构无效")
    normalized = _normalize_space(value)
    if not normalized or len(normalized) > MAX_CANDIDATE_SOURCE_CHARS:
        raise InsightError("受管回顾的候选字段结构无效")
    if FORBIDDEN_SOURCE_LABEL.match(normalized):
        raise InsightError("受管回顾不得把原文字段注入候选认识")
    return normalized


def _normalize_target_file(value: Any) -> str:
    if not isinstance(value, str) or value not in TARGET_FILES:
        raise InsightError("目标文件只能是 USER.md、MEMORY.md 或 GOALS.md")
    return value


def _normalize_proposal_text(value: Any) -> str:
    if not isinstance(value, str) or not value.strip() or "\x00" in value:
        raise InsightError("拟写文字无效")
    try:
        encoded = value.encode("utf-8")
    except UnicodeError:
        raise InsightError("拟写文字必须是有效 UTF-8") from None
    if len(encoded) > MAX_PROPOSAL_BYTES:
        raise InsightError("拟写文字过大")
    if any(pattern.search(value) for pattern, _replacement in SECRET_PATTERNS):
        raise InsightError("拟写文字含不应写入长期文件的敏感信息")
    return value


def _proposal_sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _normalize_candidate_reference(
    data: dict[str, Any],
) -> tuple[str, int, str]:
    candidate_id = data.get("candidate_id")
    revision = data.get("expect_revision")
    etag = data.get("expect_candidate_etag")
    if not isinstance(candidate_id, str) or not CANDIDATE_ID_PATTERN.fullmatch(candidate_id):
        raise InsightError("candidate_id 无效")
    if type(revision) is not int or revision < 1:
        raise InsightError("expect_revision 必须是正整数")
    if not isinstance(etag, str) or not SHA256_PATTERN.fullmatch(etag):
        raise InsightError("expect_candidate_etag 必须是 64 位小写 SHA-256")
    return candidate_id, revision, etag


def _valid_timestamp(value: Any, *, nullable: bool = False) -> str | None:
    if value is None and nullable:
        return None
    if not isinstance(value, str) or not value or value != _normalize_space(value):
        raise InsightError("候选确认台账结构无效")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise InsightError("候选确认台账结构无效") from None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise InsightError("候选确认台账结构无效")
    return value


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _nofollow_flags() -> int:
    """该工具依赖 POSIX 文件锁，因此也要求 O_NOFOLLOW。"""

    if not hasattr(os, "O_NOFOLLOW"):
        raise InsightError("当前系统不支持安全的 no-follow 文件访问")
    return os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)


def _safe_close(descriptor: int) -> None:
    if descriptor < 0:
        return
    try:
        os.close(descriptor)
    except OSError:
        pass


def _open_root_directory(root: Path) -> int:
    descriptor = -1
    try:
        descriptor = os.open(
            root,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | _nofollow_flags(),
        )
        info = os.fstat(descriptor)
        if not stat.S_ISDIR(info.st_mode):
            _safe_close(descriptor)
            raise InsightError("日记目录必须是普通目录")
        return descriptor
    except InsightError:
        _safe_close(descriptor)
        raise
    except OSError:
        _safe_close(descriptor)
        raise InsightError("日记目录无法安全打开") from None


def _same_identity(first: os.stat_result, second: os.stat_result) -> bool:
    return (first.st_dev, first.st_ino) == (second.st_dev, second.st_ino)


def _open_directory_at(
    parent_fd: int,
    name: str,
    *,
    optional: bool = False,
) -> int | None:
    try:
        before = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    except FileNotFoundError:
        if optional:
            return None
        raise InsightError("受管目录缺失") from None
    except OSError:
        raise InsightError("受管目录无法安全检查") from None
    if stat.S_ISLNK(before.st_mode) or not stat.S_ISDIR(before.st_mode):
        raise InsightError("受管目录不是安全的普通目录")

    descriptor = -1
    try:
        descriptor = os.open(
            name,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | _nofollow_flags(),
            dir_fd=parent_fd,
        )
        after = os.fstat(descriptor)
        if not stat.S_ISDIR(after.st_mode) or not _same_identity(before, after):
            raise InsightError("受管目录在打开期间发生变化")
        return descriptor
    except InsightError:
        if descriptor >= 0:
            _safe_close(descriptor)
        raise
    except OSError:
        if descriptor >= 0:
            _safe_close(descriptor)
        raise InsightError("受管目录无法安全打开") from None


def _open_regular_at(
    parent_fd: int,
    name: str,
    *,
    optional: bool = False,
) -> int | None:
    try:
        before = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    except FileNotFoundError:
        if optional:
            return None
        raise InsightError("受管文件缺失") from None
    except OSError:
        raise InsightError("受管文件无法安全检查") from None
    if (
        stat.S_ISLNK(before.st_mode)
        or not stat.S_ISREG(before.st_mode)
        or before.st_nlink != 1
    ):
        raise InsightError("受管文件不是安全的普通文件")

    descriptor = -1
    try:
        descriptor = os.open(
            name,
            os.O_RDONLY | _nofollow_flags(),
            dir_fd=parent_fd,
        )
        after = os.fstat(descriptor)
        if (
            not stat.S_ISREG(after.st_mode)
            or after.st_nlink != 1
            or not _same_identity(before, after)
        ):
            raise InsightError("受管文件在打开期间发生变化")
        return descriptor
    except InsightError:
        if descriptor >= 0:
            _safe_close(descriptor)
        raise
    except OSError:
        if descriptor >= 0:
            _safe_close(descriptor)
        raise InsightError("受管文件无法安全打开") from None


def _open_project_directory(root_fd: int) -> int:
    """从已验证 journal 目录打开其项目根，不重新解析外部路径。"""

    descriptor = -1
    try:
        descriptor = os.open(
            "..",
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | _nofollow_flags(),
            dir_fd=root_fd,
        )
        info = os.fstat(descriptor)
        if not stat.S_ISDIR(info.st_mode):
            raise InsightError("项目目录无法安全打开")
        return descriptor
    except InsightError:
        _safe_close(descriptor)
        raise
    except OSError:
        _safe_close(descriptor)
        raise InsightError("项目目录无法安全打开") from None


def _open_target_file(root_fd: int, target_file: str) -> int:
    project_fd = _open_project_directory(root_fd)
    try:
        descriptor = _open_regular_at(project_fd, target_file)
        assert descriptor is not None
        try:
            if os.fstat(descriptor).st_size > MAX_TARGET_BYTES:
                _safe_close(descriptor)
                raise InsightError("长期目标文件过大")
        except OSError:
            _safe_close(descriptor)
            raise InsightError("长期目标文件无法安全检查") from None
        return descriptor
    finally:
        _safe_close(project_fd)


def _assert_target_safe(root_fd: int, target_file: str) -> None:
    descriptor = _open_target_file(root_fd, target_file)
    _safe_close(descriptor)


def _target_contains_proposal(root_fd: int, record: dict[str, Any]) -> bool:
    target_file = record.get("proposal_target")
    proposal_text = record.get("proposal_text")
    if not isinstance(target_file, str) or not isinstance(proposal_text, str):
        raise InsightError("候选提案状态无效")
    descriptor = _open_target_file(root_fd, target_file)
    try:
        content = _read_stable_bytes(
            descriptor,
            limit=MAX_TARGET_BYTES,
            label="长期目标文件",
        )
    finally:
        _safe_close(descriptor)
    return proposal_text.encode("utf-8") in content


def _stable_stat_fingerprint(info: os.stat_result) -> tuple[int, ...]:
    return (
        info.st_dev,
        info.st_ino,
        info.st_mode,
        info.st_nlink,
        info.st_size,
        getattr(info, "st_mtime_ns", int(info.st_mtime * 1_000_000_000)),
        getattr(info, "st_ctime_ns", int(info.st_ctime * 1_000_000_000)),
    )


def _read_stable_bytes(descriptor: int, *, limit: int, label: str) -> bytes:
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise InsightError(f"{label}过大或不是普通文件")
        os.lseek(descriptor, 0, os.SEEK_SET)
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(descriptor, min(64 * 1024, limit + 1 - total))
            if not chunk:
                break
            total += len(chunk)
            if total > limit:
                raise InsightError(f"{label}过大")
            chunks.append(chunk)
        after = os.fstat(descriptor)
        data = b"".join(chunks)
        if (
            _stable_stat_fingerprint(before) != _stable_stat_fingerprint(after)
            or len(data) != after.st_size
        ):
            raise InsightError(f"{label}在读取期间发生变化")
        return data
    except InsightError:
        raise
    except OSError:
        raise InsightError(f"{label}无法安全读取") from None


def _open_lock_at(root_fd: int) -> int:
    descriptor = -1
    try:
        descriptor = os.open(
            LOCK_NAME,
            os.O_RDWR | os.O_CREAT | _nofollow_flags(),
            0o600,
            dir_fd=root_fd,
        )
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise InsightError("日记锁不是安全的普通文件")
        os.fchmod(descriptor, 0o600)
        return descriptor
    except InsightError:
        if descriptor >= 0:
            _safe_close(descriptor)
        raise
    except OSError:
        if descriptor >= 0:
            _safe_close(descriptor)
        raise InsightError("日记锁无法安全打开") from None


def _assert_lock_identity(root_fd: int, descriptor: int) -> None:
    try:
        current = os.stat(LOCK_NAME, dir_fd=root_fd, follow_symlinks=False)
        opened = os.fstat(descriptor)
    except OSError:
        raise InsightError("日记锁路径无法安全复核") from None
    if (
        not stat.S_ISREG(current.st_mode)
        or current.st_nlink != 1
        or not stat.S_ISREG(opened.st_mode)
        or opened.st_nlink != 1
        or not _same_identity(current, opened)
    ):
        raise InsightError("日记锁路径在获取期间发生变化")


@contextmanager
def _journal_lock(root: Path, *, timeout_seconds: float = 10.0) -> Iterator[int]:
    root_fd = _open_root_directory(root)
    descriptor = -1
    try:
        descriptor = _open_lock_at(root_fd)
        deadline = time.monotonic() + timeout_seconds
        while True:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise InsightError("日记库正由另一个操作更新；本次未写入") from None
                time.sleep(0.05)
            except OSError:
                raise InsightError("日记锁无法安全获取") from None
        _assert_lock_identity(root_fd, descriptor)
        try:
            yield root_fd
        finally:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
            except OSError:
                pass
    finally:
        if descriptor >= 0:
            _safe_close(descriptor)
        _safe_close(root_fd)


def _valid_review_relative(value: Any, expected_type: str | None = None) -> str:
    if not isinstance(value, str) or value != _normalize_space(value):
        raise InsightError("受管回顾路径无效")
    weekly = WEEKLY_FILE_PATTERN.fullmatch(value)
    monthly = MONTHLY_FILE_PATTERN.fullmatch(value)
    if weekly:
        year, week = int(weekly.group(1)), int(weekly.group(2))
        try:
            date.fromisocalendar(year, week, 1)
        except ValueError:
            raise InsightError("受管回顾路径无效") from None
        if expected_type not in (None, "weekly"):
            raise InsightError("受管回顾类型与路径不一致")
        return value
    if monthly:
        year, month = int(monthly.group(1)), int(monthly.group(2))
        if not 1 <= year <= 9999 or not 1 <= month <= 12 or expected_type not in (None, "monthly"):
            raise InsightError("受管回顾路径无效")
        return value
    raise InsightError("受管回顾路径无效")


def _candidate_id(review_file: str, review_sha256: str, kind: str, normalized_text: str) -> str:
    identity = {
        "kind": kind,
        "review_file": review_file,
        "review_sha256": review_sha256,
        "text": normalized_text,
    }
    serialized = json.dumps(
        identity, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    )
    return "insight-" + hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _candidate_etag(record: dict[str, Any]) -> str:
    identity = {
        "candidate_id": record["candidate_id"],
        "kind": record["kind"],
        "review_file": record["review_file"],
        "review_sha256": record["review_sha256"],
        "summary": record["summary"],
        "status": record["status"],
        "decided_at": record["decided_at"],
        "proposal_target": record["proposal_target"],
        "proposal_sha256": record["proposal_sha256"],
        "proposed_at": record["proposed_at"],
        "applied_at": record["applied_at"],
        "revision": record["revision"],
    }
    serialized = json.dumps(
        identity, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _section_body(text: str, title: str) -> str:
    headings = list(SECTION_PATTERN.finditer(text))
    matches = [index for index, match in enumerate(headings) if match.group(1) == title]
    if len(matches) != 1:
        raise InsightError("受管回顾候选章节结构无效")
    index = matches[0]
    start = headings[index].end()
    end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
    return text[start:end]


def _parse_candidate_section(body: str, *, kind: str) -> list[str]:
    result: list[str] = []
    saw_placeholder = False
    for raw_line in body.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw_line.strip()
        if not line or line.startswith(">"):
            continue
        if kind == "candidate_memory":
            if line == "- 暂无候选认识":
                if result or saw_placeholder:
                    raise InsightError("受管回顾候选章节结构无效")
                saw_placeholder = True
                continue
            prefix = "- 待用户确认："
        else:
            if line == "- 暂无记录":
                if result or saw_placeholder:
                    raise InsightError("受管回顾候选章节结构无效")
                saw_placeholder = True
                continue
            prefix = "- "
        if not line.startswith(prefix):
            raise InsightError("受管回顾候选章节结构无效")
        if saw_placeholder:
            raise InsightError("受管回顾候选章节结构无效")
        result.append(_normalize_candidate_text(line[len(prefix) :]))
    if len(result) != len(set(result)):
        raise InsightError("受管回顾含重复候选")
    if not result and not saw_placeholder:
        raise InsightError("受管回顾候选章节结构无效")
    return result


def _read_review(descriptor: int, relative_file: str) -> tuple[str, list[dict[str, Any]]]:
    raw = _read_stable_bytes(descriptor, limit=MAX_REVIEW_BYTES, label="受管回顾文件")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise InsightError("受管回顾必须是 UTF-8") from None
    markers = list(REVIEW_MARKER_PATTERN.finditer(text))
    if len(markers) != 1:
        raise InsightError("受管回顾标记结构无效")
    review_type, marker_file = markers[0].groups()
    marker_file = _valid_review_relative(marker_file, review_type)
    if marker_file != relative_file:
        raise InsightError("受管回顾标记与实际路径不一致")

    review_sha256 = hashlib.sha256(raw).hexdigest()
    if any(warning in text for warning in STALE_REVIEW_WARNINGS):
        return review_sha256, []
    extracted: list[tuple[str, str]] = []
    for kind, title in (
        ("candidate_memory", "候选长期认识（待用户确认）"),
        ("planning_implication", "对后续规划有用的启示"),
    ):
        for normalized_text in _parse_candidate_section(_section_body(text, title), kind=kind):
            extracted.append((kind, normalized_text))

    candidates: list[dict[str, Any]] = []
    for ordinal, (kind, normalized_text) in enumerate(extracted):
        summary = _redact_summary(normalized_text)
        if not summary:
            raise InsightError("受管回顾候选摘要为空")
        candidates.append(
            {
                "candidate_id": _candidate_id(relative_file, review_sha256, kind, normalized_text),
                "kind": kind,
                "review_file": relative_file,
                "review_sha256": review_sha256,
                "summary": summary,
                "ordinal": ordinal,
            }
        )
    return review_sha256, candidates


def _scan_reviews(root_fd: int) -> tuple[dict[str, str], list[dict[str, Any]]]:
    review_fd = _open_directory_at(root_fd, "reviews", optional=True)
    if review_fd is None:
        return {}, []
    file_shas: dict[str, str] = {}
    candidates: list[dict[str, Any]] = []
    try:
        try:
            year_names = sorted(os.listdir(review_fd))
        except OSError:
            raise InsightError("回顾目录无法安全遍历") from None
        for year_name in year_names:
            if year_name.startswith("."):
                continue
            if not YEAR_PATTERN.fullmatch(year_name):
                raise InsightError("回顾目录含非受管路径")
            year_fd = _open_directory_at(review_fd, year_name)
            assert year_fd is not None
            try:
                try:
                    file_names = sorted(os.listdir(year_fd))
                except OSError:
                    raise InsightError("回顾年度目录无法安全遍历") from None
                for file_name in file_names:
                    if file_name.startswith("."):
                        continue
                    relative_file = f"reviews/{year_name}/{file_name}"
                    _valid_review_relative(relative_file)
                    review_file_fd = _open_regular_at(year_fd, file_name)
                    assert review_file_fd is not None
                    try:
                        review_sha256, file_candidates = _read_review(
                            review_file_fd, relative_file
                        )
                    finally:
                        _safe_close(review_file_fd)
                    file_shas[relative_file] = review_sha256
                    candidates.extend(file_candidates)
            finally:
                _safe_close(year_fd)
    finally:
        _safe_close(review_fd)

    identifiers = [candidate["candidate_id"] for candidate in candidates]
    if len(identifiers) != len(set(identifiers)):
        raise InsightError("受管回顾生成了重复候选标识")
    candidates.sort(
        key=lambda item: (
            item["review_file"],
            1 if item["kind"] == "candidate_memory" else 0,
            -int(item["ordinal"]),
        ),
        reverse=True,
    )
    return file_shas, candidates


def _validate_ledger_record(record: Any, line_number: int) -> dict[str, Any]:
    error = InsightError(f"候选确认台账第 {line_number} 行结构无效")
    fields = frozenset(record) if isinstance(record, dict) else frozenset()
    if not isinstance(record, dict) or fields not in {
        LEDGER_FIELDS,
        LEGACY_LEDGER_FIELDS,
    }:
        raise error
    if fields == LEGACY_LEDGER_FIELDS:
        record = dict(record)
        record.update(
            {
                "proposal_target": None,
                "proposal_text": None,
                "proposal_sha256": None,
                "proposed_at": None,
                "applied_at": None,
            }
        )
        if record.get("status") == "accepted":
            record["status"] = "awaiting_proposal"
    candidate_id = record.get("candidate_id")
    if not isinstance(candidate_id, str) or not CANDIDATE_ID_PATTERN.fullmatch(candidate_id):
        raise error
    if record.get("kind") not in KINDS or record.get("status") not in STATUSES:
        raise error
    try:
        _valid_review_relative(record.get("review_file"))
    except InsightError:
        raise error from None
    review_sha256 = record.get("review_sha256")
    if not isinstance(review_sha256, str) or not SHA256_PATTERN.fullmatch(review_sha256):
        raise error
    summary = record.get("summary")
    if (
        not isinstance(summary, str)
        or not summary
        or len(summary) > MAX_SUMMARY_CHARS
        or summary != _redact_summary(summary)
    ):
        raise error
    revision = record.get("revision")
    if type(revision) is not int or revision < 1:
        raise error
    try:
        recorded_at = _valid_timestamp(record.get("recorded_at"))
        decided_at = _valid_timestamp(record.get("decided_at"), nullable=True)
        proposed_at = _valid_timestamp(record.get("proposed_at"), nullable=True)
        applied_at = _valid_timestamp(record.get("applied_at"), nullable=True)
    except InsightError:
        raise error from None

    proposal_target = record.get("proposal_target")
    proposal_text = record.get("proposal_text")
    proposal_sha256 = record.get("proposal_sha256")
    proposal_present = any(
        value is not None
        for value in (proposal_target, proposal_text, proposal_sha256, proposed_at)
    )
    if proposal_present:
        try:
            _normalize_target_file(proposal_target)
            normalized_proposal = _normalize_proposal_text(proposal_text)
        except InsightError:
            raise error from None
        if (
            proposed_at is None
            or not isinstance(proposal_sha256, str)
            or not SHA256_PATTERN.fullmatch(proposal_sha256)
            or proposal_sha256 != _proposal_sha256(normalized_proposal)
        ):
            raise error
    elif any(
        value is not None
        for value in (proposal_target, proposal_text, proposal_sha256, proposed_at)
    ):
        raise error

    status = record["status"]
    if status == "pending":
        valid_state = decided_at is None and not proposal_present and applied_at is None
    elif status in {"awaiting_proposal", "rejected"}:
        valid_state = decided_at is not None and not proposal_present and applied_at is None
    elif status == "proposed":
        valid_state = decided_at is not None and proposal_present and applied_at is None
    elif status == "applied":
        valid_state = decided_at is not None and proposal_present and applied_at is not None
    else:  # superseded 保留发生前的决策与提案快照。
        valid_state = (
            (decided_at is not None or not proposal_present)
            and (applied_at is None or proposal_present)
        )
    if not valid_state:
        raise error

    assert isinstance(recorded_at, str)
    recorded_time = datetime.fromisoformat(recorded_at)
    for timestamp in (decided_at, proposed_at, applied_at):
        if timestamp is not None and datetime.fromisoformat(timestamp) > recorded_time:
            raise error
    if status in {"awaiting_proposal", "rejected"} and decided_at != recorded_at:
        raise error
    if status == "proposed" and proposed_at != recorded_at:
        raise error
    if status == "applied" and applied_at != recorded_at:
        raise error
    return record


def _validate_history(records: list[dict[str, Any]]) -> None:
    histories: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        histories.setdefault(record["candidate_id"], []).append(record)
    for history in histories.values():
        revisions = [record["revision"] for record in history]
        if revisions != list(range(1, len(history) + 1)):
            raise InsightError("候选确认台账修订链无效")
        first = history[0]
        if first["status"] != "pending":
            raise InsightError("候选确认台账初始状态无效")
        for record in history[1:]:
            for field in (
                "candidate_id",
                "kind",
                "review_file",
                "review_sha256",
                "summary",
            ):
                if record[field] != first[field]:
                    raise InsightError("候选确认台账不可变字段漂移")
        for previous, current in zip(history, history[1:]):
            allowed = {
                "pending": {"awaiting_proposal", "rejected", "superseded"},
                "awaiting_proposal": {"proposed", "superseded"},
                "proposed": {"proposed", "applied", "superseded"},
                "applied": {"superseded"},
                "rejected": {"superseded"},
                "superseded": set(),
            }[previous["status"]]
            if current["status"] not in allowed:
                raise InsightError("候选确认台账状态迁移无效")
            if datetime.fromisoformat(current["recorded_at"]) < datetime.fromisoformat(
                previous["recorded_at"]
            ):
                raise InsightError("候选确认台账时间顺序无效")
            application_fields = (
                "decided_at",
                "proposal_target",
                "proposal_text",
                "proposal_sha256",
                "proposed_at",
                "applied_at",
            )
            if current["status"] == "superseded":
                if any(current[field] != previous[field] for field in application_fields):
                    raise InsightError("候选确认台账失效快照漂移")
            elif previous["status"] == "awaiting_proposal" and current["status"] == "proposed":
                if current["decided_at"] != previous["decided_at"]:
                    raise InsightError("候选确认台账决策时间漂移")
            elif previous["status"] == "proposed" and current["status"] == "proposed":
                if current["decided_at"] != previous["decided_at"] or all(
                    current[field] == previous[field]
                    for field in (
                        "proposal_target",
                        "proposal_text",
                        "proposal_sha256",
                    )
                ):
                    raise InsightError("候选确认台账修订提案无效")
            elif previous["status"] == "proposed" and current["status"] == "applied":
                if any(
                    current[field] != previous[field]
                    for field in (
                        "decided_at",
                        "proposal_target",
                        "proposal_text",
                        "proposal_sha256",
                        "proposed_at",
                    )
                ):
                    raise InsightError("候选确认台账应用提案漂移")


def _parse_ledger_bytes(raw: bytes) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for line_number, raw_line in enumerate(raw.splitlines(), start=1):
        if not raw_line.strip():
            continue
        record = _decode_json(raw_line, source=f"台账第 {line_number} 行")
        records.append(_validate_ledger_record(record, line_number))
    _validate_history(records)
    return records


def _load_ledger(
    root_fd: int,
    *,
    harden_permissions: bool,
) -> tuple[list[dict[str, Any]], bool, bool]:
    descriptor = _open_regular_at(root_fd, LEDGER_NAME, optional=True)
    if descriptor is None:
        return [], False, True
    try:
        original_mode = stat.S_IMODE(os.fstat(descriptor).st_mode)
        permissions_private = original_mode == 0o600
        if harden_permissions:
            try:
                os.fchmod(descriptor, 0o600)
            except OSError:
                raise InsightError("候选确认台账权限无法安全收紧") from None
            permissions_private = True
        raw = _read_stable_bytes(
            descriptor,
            limit=MAX_LEDGER_BYTES,
            label="候选确认台账",
        )
    except InsightError:
        raise
    except OSError:
        raise InsightError("候选确认台账无法安全检查") from None
    finally:
        _safe_close(descriptor)
    return _parse_ledger_bytes(raw), True, permissions_private


def _atomic_write_ledger(root_fd: int, records: Iterable[dict[str, Any]]) -> None:
    content = "".join(
        json.dumps(
            record,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
        + "\n"
        for record in records
    ).encode("utf-8")
    if len(content) > MAX_LEDGER_BYTES:
        raise InsightError("候选确认台账超出安全大小限制")

    try:
        destination = os.stat(LEDGER_NAME, dir_fd=root_fd, follow_symlinks=False)
    except FileNotFoundError:
        destination = None
    except OSError:
        raise InsightError("候选确认台账目标无法安全检查") from None
    if destination is not None and (
        not stat.S_ISREG(destination.st_mode) or destination.st_nlink != 1
    ):
        raise InsightError("候选确认台账目标不是安全的普通文件")

    temporary_name: str | None = None
    descriptor = -1
    try:
        for _attempt in range(128):
            try:
                candidate_name = f".{LEDGER_NAME}.{secrets.token_hex(16)}.tmp"
            except OSError:
                raise InsightError("候选确认台账临时文件名无法安全生成") from None
            try:
                descriptor = os.open(
                    candidate_name,
                    os.O_WRONLY
                    | os.O_CREAT
                    | os.O_EXCL
                    | _nofollow_flags(),
                    0o600,
                    dir_fd=root_fd,
                )
                temporary_name = candidate_name
                break
            except FileExistsError:
                continue
            except OSError:
                raise InsightError("候选确认台账临时文件无法安全创建") from None
        if descriptor < 0 or temporary_name is None:
            raise InsightError("候选确认台账临时文件无法唯一创建")

        try:
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise InsightError("候选确认台账临时文件结构无效")
            os.fchmod(descriptor, 0o600)
            view = memoryview(content)
            offset = 0
            while offset < len(view):
                written = os.write(descriptor, view[offset:])
                if written <= 0:
                    raise OSError("short write")
                offset += written
            os.fsync(descriptor)
        except InsightError:
            raise
        except OSError:
            raise InsightError("候选确认台账临时文件无法安全写入") from None
        finally:
            _safe_close(descriptor)
            descriptor = -1

        try:
            os.replace(
                temporary_name,
                LEDGER_NAME,
                src_dir_fd=root_fd,
                dst_dir_fd=root_fd,
            )
            temporary_name = None
        except OSError:
            raise InsightError("候选确认台账无法原子替换") from None
        try:
            os.fsync(root_fd)
        except OSError:
            raise InsightError("候选确认台账已替换，但目录同步状态不确定") from None
    finally:
        if descriptor >= 0:
            _safe_close(descriptor)
        if temporary_name is not None:
            try:
                os.unlink(temporary_name, dir_fd=root_fd)
            except FileNotFoundError:
                pass
            except OSError:
                pass


def _latest(records: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for record in records:
        result[record["candidate_id"]] = record
    return result


def _initial_record(candidate: dict[str, Any], now: str) -> dict[str, Any]:
    return {
        "candidate_id": candidate["candidate_id"],
        "kind": candidate["kind"],
        "review_file": candidate["review_file"],
        "review_sha256": candidate["review_sha256"],
        "summary": candidate["summary"],
        "status": "pending",
        "decided_at": None,
        "proposal_target": None,
        "proposal_text": None,
        "proposal_sha256": None,
        "proposed_at": None,
        "applied_at": None,
        "recorded_at": now,
        "revision": 1,
    }


def _transition_record(
    current: dict[str, Any],
    status: str,
    now: str,
    *,
    proposal_target: str | None = None,
    proposal_text: str | None = None,
) -> dict[str, Any]:
    updated = dict(current)
    updated["status"] = status
    updated["revision"] = current["revision"] + 1
    updated["recorded_at"] = now
    if status in {"awaiting_proposal", "rejected"}:
        updated["decided_at"] = now
    elif status == "proposed":
        if proposal_target is None or proposal_text is None:
            raise InsightError("候选提案结构无效")
        updated["proposal_target"] = proposal_target
        updated["proposal_text"] = proposal_text
        updated["proposal_sha256"] = _proposal_sha256(proposal_text)
        updated["proposed_at"] = now
        updated["applied_at"] = None
    elif status == "applied":
        updated["applied_at"] = now
    elif status != "superseded":
        raise InsightError("候选确认台账状态迁移无效")
    return updated


def _reconcile(
    records: list[dict[str, Any]],
    file_shas: dict[str, str],
    candidates: list[dict[str, Any]],
) -> bool:
    changed = False
    current_ids = {candidate["candidate_id"] for candidate in candidates}
    latest = _latest(records)
    now = _now()

    for candidate_id in sorted(latest):
        record = latest[candidate_id]
        current_sha = file_shas.get(record["review_file"])
        stale = (
            current_sha != record["review_sha256"]
            or candidate_id not in current_ids
        )
        if stale and record["status"] != "superseded":
            superseded = _transition_record(record, "superseded", now)
            records.append(superseded)
            latest[candidate_id] = superseded
            changed = True

    for candidate in candidates:
        if candidate["candidate_id"] not in latest:
            pending = _initial_record(candidate, now)
            records.append(pending)
            latest[candidate["candidate_id"]] = pending
            changed = True
    return changed


def _public_candidate(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "candidate_id": record["candidate_id"],
        "kind": record["kind"],
        "summary": record["summary"],
        "revision": record["revision"],
        "candidate_etag": _candidate_etag(record),
    }


def plan(root: Path) -> dict[str, Any]:
    with _journal_lock(root) as root_fd:
        records, _present, _private = _load_ledger(
            root_fd, harden_permissions=True
        )
        file_shas, candidates = _scan_reviews(root_fd)
        if _reconcile(records, file_shas, candidates):
            _validate_history(records)
            _atomic_write_ledger(root_fd, records)
        latest = _latest(records)
        pending = [
            latest[candidate["candidate_id"]]
            for candidate in candidates
            if latest[candidate["candidate_id"]]["status"] == "pending"
        ]
        selected = pending[:PLAN_LIMIT]
        return {
            "status": "ok",
            "candidates": [_public_candidate(record) for record in selected],
            "pending_count": len(pending),
            "returned": len(selected),
            "action_required": bool(selected),
            "writes_long_term_files": False,
        }


def _normalize_decision(payload: Any) -> dict[str, Any]:
    data = _require_object(payload, DECIDE_FIELDS, DECIDE_FIELDS)
    candidate_id, revision, etag = _normalize_candidate_reference(data)
    decision = data.get("decision")
    if decision not in DECISIONS:
        raise InsightError("decision 只能是 accept 或 reject")
    return {
        "candidate_id": candidate_id,
        "decision": decision,
        "expect_revision": revision,
        "expect_candidate_etag": etag,
    }


def decide(root: Path, payload: Any) -> dict[str, Any]:
    request = _normalize_decision(payload)
    with _journal_lock(root) as root_fd:
        records, _present, _private = _load_ledger(
            root_fd, harden_permissions=True
        )
        file_shas, candidates = _scan_reviews(root_fd)
        if _reconcile(records, file_shas, candidates):
            _validate_history(records)
            _atomic_write_ledger(root_fd, records)
        current = _latest(records).get(request["candidate_id"])
        if current is None:
            raise InsightError("候选不存在或已不可决策")
        if (
            current["revision"] != request["expect_revision"]
            or _candidate_etag(current) != request["expect_candidate_etag"]
            or current["status"] != "pending"
        ):
            raise InsightError("候选状态已变化；本次未写入，请重新运行 plan")
        new_status = DECISIONS[request["decision"]]
        updated = _transition_record(current, new_status, _now())
        records.append(updated)
        _validate_history(records)
        _atomic_write_ledger(root_fd, records)
        result = _public_candidate(updated)
        result.update(
            {
                "status": new_status,
                "action_required": new_status == "awaiting_proposal",
                "writes_long_term_files": False,
            }
        )
        return result


def _record_matches_reference(
    record: dict[str, Any], revision: int, etag: str
) -> bool:
    return record["revision"] == revision and _candidate_etag(record) == etag


def _proposal_matches(
    record: dict[str, Any], target_file: str, proposal_text: str
) -> bool:
    return (
        record.get("proposal_target") == target_file
        and record.get("proposal_text") == proposal_text
        and record.get("proposal_sha256") == _proposal_sha256(proposal_text)
    )


def _candidate_revision(
    records: Iterable[dict[str, Any]], candidate_id: str, revision: int
) -> dict[str, Any] | None:
    for record in records:
        if record["candidate_id"] == candidate_id and record["revision"] == revision:
            return record
    return None


def _application_result(record: dict[str, Any], *, action: str) -> dict[str, Any]:
    return {
        "status": record["status"],
        "action": action,
        "candidate_id": record["candidate_id"],
        "revision": record["revision"],
        "candidate_etag": _candidate_etag(record),
        "proposal_sha256": record["proposal_sha256"],
        "action_required": record["status"] in {"awaiting_proposal", "proposed"},
        "writes_long_term_files": False,
    }


def _normalize_proposal(payload: Any) -> dict[str, Any]:
    data = _require_object(payload, PROPOSE_FIELDS, PROPOSE_FIELDS)
    candidate_id, revision, etag = _normalize_candidate_reference(data)
    target_file = _normalize_target_file(data.get("target_file"))
    proposal_text = _normalize_proposal_text(data.get("proposal_text"))
    return {
        "candidate_id": candidate_id,
        "target_file": target_file,
        "proposal_text": proposal_text,
        "expect_revision": revision,
        "expect_candidate_etag": etag,
    }


def propose(root: Path, payload: Any) -> dict[str, Any]:
    request = _normalize_proposal(payload)
    with _journal_lock(root) as root_fd:
        records, _present, _private = _load_ledger(
            root_fd, harden_permissions=True
        )
        file_shas, candidates = _scan_reviews(root_fd)
        if _reconcile(records, file_shas, candidates):
            _validate_history(records)
            _atomic_write_ledger(root_fd, records)
        current = _latest(records).get(request["candidate_id"])
        if current is None:
            raise InsightError("候选不存在或已不可提案")

        direct = _record_matches_reference(
            current,
            request["expect_revision"],
            request["expect_candidate_etag"],
        )
        if direct and current["status"] in {"awaiting_proposal", "proposed"}:
            _assert_target_safe(root_fd, request["target_file"])
            if current["status"] == "proposed" and _proposal_matches(
                current, request["target_file"], request["proposal_text"]
            ):
                return _application_result(current, action="unchanged")
            updated = _transition_record(
                current,
                "proposed",
                _now(),
                proposal_target=request["target_file"],
                proposal_text=request["proposal_text"],
            )
            records.append(updated)
            _validate_history(records)
            _atomic_write_ledger(root_fd, records)
            return _application_result(
                updated,
                action="created" if current["status"] == "awaiting_proposal" else "updated",
            )

        previous = _candidate_revision(
            records, request["candidate_id"], request["expect_revision"]
        )
        retry = (
            current["status"] == "proposed"
            and current["revision"] == request["expect_revision"] + 1
            and previous is not None
            and previous["status"] in {"awaiting_proposal", "proposed"}
            and _record_matches_reference(
                previous,
                request["expect_revision"],
                request["expect_candidate_etag"],
            )
            and _proposal_matches(
                current, request["target_file"], request["proposal_text"]
            )
        )
        if retry:
            _assert_target_safe(root_fd, request["target_file"])
            return _application_result(current, action="unchanged")
        raise InsightError("候选或提案状态已变化；本次未写入，请重新获取状态")


def _normalize_apply_plan(payload: Any) -> dict[str, Any]:
    data = _require_object(payload, APPLY_PLAN_FIELDS, APPLY_PLAN_FIELDS)
    candidate_id, revision, etag = _normalize_candidate_reference(data)
    return {
        "candidate_id": candidate_id,
        "expect_revision": revision,
        "expect_candidate_etag": etag,
    }


def _source_is_current(
    record: dict[str, Any],
    file_shas: dict[str, str],
    candidates: Iterable[dict[str, Any]],
) -> bool:
    return (
        file_shas.get(record["review_file"]) == record["review_sha256"]
        and any(candidate["candidate_id"] == record["candidate_id"] for candidate in candidates)
    )


def apply_plan(root: Path, payload: Any) -> dict[str, Any]:
    """只读返回一份已保存提案；不收紧权限、不创建锁或写入文件。"""

    request = _normalize_apply_plan(payload)
    root_fd = _open_root_directory(root)
    try:
        records, present, permissions_private = _load_ledger(
            root_fd, harden_permissions=False
        )
        if not present or not permissions_private:
            raise InsightError("候选提案台账缺失或权限不安全")
        current = _latest(records).get(request["candidate_id"])
        if (
            current is None
            or current["status"] != "proposed"
            or not _record_matches_reference(
                current,
                request["expect_revision"],
                request["expect_candidate_etag"],
            )
        ):
            raise InsightError("候选提案状态已变化；本次未返回提案")
        file_shas, candidates = _scan_reviews(root_fd)
        if not _source_is_current(current, file_shas, candidates):
            raise InsightError("候选来源已变化；本次未返回提案")
        _assert_target_safe(root_fd, current["proposal_target"])

        # 无锁只读路径在返回私密文字前重读台账与来源，拒绝混合快照。
        repeated, repeated_present, repeated_private = _load_ledger(
            root_fd, harden_permissions=False
        )
        repeated_shas, repeated_candidates = _scan_reviews(root_fd)
        if (
            not repeated_present
            or not repeated_private
            or repeated != records
            or not _source_is_current(current, repeated_shas, repeated_candidates)
        ):
            raise InsightError("候选提案在读取期间发生变化；本次未返回提案")
        return {
            "status": "proposed",
            "candidate_id": current["candidate_id"],
            "target_file": current["proposal_target"],
            "proposal_text": current["proposal_text"],
            "proposal_sha256": current["proposal_sha256"],
            "revision": current["revision"],
            "candidate_etag": _candidate_etag(current),
            "read_only": True,
            "writes_long_term_files": False,
            "action_required": True,
        }
    finally:
        _safe_close(root_fd)


def _normalize_mark_applied(payload: Any) -> dict[str, Any]:
    data = _require_object(payload, MARK_APPLIED_FIELDS, MARK_APPLIED_FIELDS)
    candidate_id, revision, etag = _normalize_candidate_reference(data)
    proposal_sha256 = data.get("expect_proposal_sha256")
    if not isinstance(proposal_sha256, str) or not SHA256_PATTERN.fullmatch(proposal_sha256):
        raise InsightError("expect_proposal_sha256 必须是 64 位小写 SHA-256")
    return {
        "candidate_id": candidate_id,
        "expect_revision": revision,
        "expect_candidate_etag": etag,
        "expect_proposal_sha256": proposal_sha256,
    }


def mark_applied(root: Path, payload: Any) -> dict[str, Any]:
    request = _normalize_mark_applied(payload)
    with _journal_lock(root) as root_fd:
        records, _present, _private = _load_ledger(
            root_fd, harden_permissions=True
        )
        file_shas, candidates = _scan_reviews(root_fd)
        if _reconcile(records, file_shas, candidates):
            _validate_history(records)
            _atomic_write_ledger(root_fd, records)
        current = _latest(records).get(request["candidate_id"])
        if current is None:
            raise InsightError("候选提案不存在或已不可应用")

        direct = _record_matches_reference(
            current,
            request["expect_revision"],
            request["expect_candidate_etag"],
        )
        selected: dict[str, Any] | None = None
        action = "unchanged"
        if direct and current["status"] in {"proposed", "applied"}:
            selected = current
        else:
            previous = _candidate_revision(
                records, request["candidate_id"], request["expect_revision"]
            )
            if (
                current["status"] == "applied"
                and current["revision"] == request["expect_revision"] + 1
                and previous is not None
                and previous["status"] == "proposed"
                and _record_matches_reference(
                    previous,
                    request["expect_revision"],
                    request["expect_candidate_etag"],
                )
                and current["proposal_sha256"] == previous["proposal_sha256"]
            ):
                selected = current
        if (
            selected is None
            or selected["proposal_sha256"] != request["expect_proposal_sha256"]
            or _proposal_sha256(selected["proposal_text"]) != request["expect_proposal_sha256"]
        ):
            raise InsightError("候选提案状态、修订或哈希已变化；本次未标记")
        if not _target_contains_proposal(root_fd, selected):
            raise InsightError("目标文件尚未包含该精确提案；本次未标记")

        if current["status"] == "proposed":
            updated = _transition_record(current, "applied", _now())
            records.append(updated)
            _validate_history(records)
            _atomic_write_ledger(root_fd, records)
            selected = updated
            action = "updated"
        return _application_result(selected, action=action)


def list_candidates(root: Path) -> dict[str, Any]:
    report = inspect_insight_ledger(root)
    return {
        "status": "ok",
        "record_versions": report["record_versions"],
        "total_candidates": report["total_candidates"],
        "counts": report["counts"],
        "action_required": report["action_required"],
    }


def _safe_counts(records: list[dict[str, Any]]) -> dict[str, Any]:
    latest = _latest(records)
    counts = {name: 0 for name in sorted(STATUSES)}
    for record in latest.values():
        counts[record["status"]] += 1
    return {
        "record_versions": len(records),
        "total_candidates": len(latest),
        "counts": counts,
        "action_required": any(counts[name] > 0 for name in ACTIONABLE_STATUSES),
    }


def inspect_insight_ledger(root: Path = DEFAULT_ROOT) -> dict[str, Any]:
    """只读返回台账结构与计数；结构错误时 fail closed。

    返回值永不包含候选文本、候选 ID、回顾路径、回顾哈希
    或日记来源 ID，可供运行状态和项目验证器直接调用。
    """

    root_fd = _open_root_directory(root)
    try:
        records, present, permissions_private = _load_ledger(
            root_fd, harden_permissions=False
        )
    finally:
        _safe_close(root_fd)
    return {
        "valid": permissions_private,
        "ledger_present": present,
        "permissions_private": permissions_private,
        **_safe_counts(records),
    }


def inspect_insight_snapshot(snapshot: Mapping[str, bytes]) -> dict[str, Any]:
    """严格校验固定备份字节；缺失或空台账等价于无候选。"""

    try:
        raw = snapshot.get(f"journal/{LEDGER_NAME}", b"")
        if type(raw) is not bytes:
            raise InsightError("候选确认快照结构无效")
        records = _parse_ledger_bytes(raw)
    except Exception:
        raise InsightError("候选确认快照结构无效") from None
    return {"valid": True, **_safe_counts(records)}


def status(root: Path) -> dict[str, Any]:
    report = inspect_insight_ledger(root)
    return {"status": "ok", **report}


def _empty_payload(payload: Any) -> None:
    _require_object(payload, frozenset(), frozenset())


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="管理日记候选长期认识确认台账")
    parser.add_argument(
        "command",
        choices=(
            "plan",
            "decide",
            "propose",
            "apply-plan",
            "mark-applied",
            "list",
            "status",
        ),
    )
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="journal 目录")
    parser.add_argument("--input", choices=("-",), default="-", help="只允许从 stdin 读取 JSON")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        payload = _read_stdin_payload()
        if args.command == "decide":
            result = decide(args.root, payload)
        elif args.command == "propose":
            result = propose(args.root, payload)
        elif args.command == "apply-plan":
            result = apply_plan(args.root, payload)
        elif args.command == "mark-applied":
            result = mark_applied(args.root, payload)
        else:
            _empty_payload(payload)
            if args.command == "plan":
                result = plan(args.root)
            elif args.command == "list":
                result = list_candidates(args.root)
            else:
                result = status(args.root)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False))
        return 0
    except InsightError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2
    except (OSError, UnicodeError):
        print("错误：候选确认台账操作失败；本次未完成", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
