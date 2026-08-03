#!/usr/bin/env python3
"""从阶段复盘派生可恢复动作，但不执行任何目标、策略、提醒或网页变更。

`plan` 只把明确回答转成严格白名单动作并维护本地执行状态；`apply-plan`
只读返回尚待执行或可重试的动作；`mark` 通过 revision + etag 精确记录结果。
公共 list/status/inspect 只返回计数和权限状态，不输出动作值、标识、日期或来源哈希。
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
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Mapping, NamedTuple

try:
    from tools import phase_review as PHASE_REVIEW
except ImportError:  # 直接运行 tools/phase_actions.py
    import phase_review as PHASE_REVIEW  # type: ignore[no-redef]


SCHEMA_VERSION = 1
DATA_FILE = "phase-actions.jsonl"
LOCK_FILE = ".phase-actions.lock"
SNAPSHOT_KEY = f"records/{DATA_FILE}"
LOCK_TIMEOUT_SECONDS = 10.0
MAX_INPUT_BYTES = 4096
MAX_LEDGER_BYTES = 4 * 1024 * 1024
MAX_RECORDS = 10_000

ACTION_CATEGORIES = (
    "goal_intent",
    "journal_cadence",
    "checkin_cadence",
    "next_track",
    "career_timing",
    "fitness_conversation",
)
ACTION_STATES = (
    "pending",
    "applied",
    "failed",
    "dismissed",
    "superseded",
)
RETRYABLE_STATES = ("pending", "failed")
MARK_STATES = ("applied", "failed", "dismissed")
APPROVAL_REQUIREMENTS = ("none", "exact_change", "schedule_details")
APPROVAL_BY_CATEGORY = {
    "goal_intent": "exact_change",
    "journal_cadence": "exact_change",
    "checkin_cadence": "schedule_details",
    "next_track": "exact_change",
    "career_timing": "schedule_details",
    "fitness_conversation": "none",
}
EXCLUDED_VALUES = {
    "goal_intent": frozenset((None, "unsure")),
    "journal_cadence": frozenset((None, "undecided")),
    "checkin_cadence": frozenset((None, "undecided")),
    "next_track": frozenset((None, "undecided", "neither")),
    "career_timing": frozenset((None, "undecided")),
    "fitness_conversation": frozenset((None, False)),
}
ALLOWED_DESIRED_VALUES = {
    category: tuple(
        value
        for value in (
            (True,) if category == "fitness_conversation"
            else PHASE_REVIEW.ENUM_VALUES[category]
        )
        if value not in EXCLUDED_VALUES[category]
    )
    for category in ACTION_CATEGORIES
}

_ACTION_ID_RE = re.compile(r"^phase-action-[0-9a-f]{64}$")
_ETAG_RE = re.compile(r"^[0-9a-f]{64}$")
_TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
_FAILURE_CODE_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


class PhaseActionError(RuntimeError):
    """安全错误：消息不得包含动作值、来源路径或底层异常文本。"""


class _LockedRoot(NamedTuple):
    root: Path
    descriptor: int
    root_identity: tuple[int, int]
    lock_identity: tuple[int, int, int]


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


def _reject_json_constant(_: str) -> None:
    raise PhaseActionError("JSON 不能包含 NaN 或 Infinity")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise PhaseActionError("JSON 包含重复字段，已停止处理")
        result[key] = value
    return result


def _strict_json_loads(text: str, context: str) -> Any:
    try:
        return json.loads(
            text,
            object_pairs_hook=_unique_object,
            parse_constant=_reject_json_constant,
        )
    except PhaseActionError:
        raise
    except json.JSONDecodeError as error:
        raise PhaseActionError(f"{context} 不是有效 JSON") from error


def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _validate_timestamp(value: Any, field: str, line_number: int) -> datetime:
    if not isinstance(value, str) or not _TIMESTAMP_RE.fullmatch(value):
        raise PhaseActionError(f"{DATA_FILE} 第 {line_number} 行的 {field} 无效")
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc
        )
    except ValueError as error:
        raise PhaseActionError(
            f"{DATA_FILE} 第 {line_number} 行的 {field} 无效"
        ) from error


def _validate_review_date(value: Any) -> str:
    try:
        return PHASE_REVIEW._validate_date(value, "--review-date")
    except Exception:
        raise PhaseActionError("--review-date 必须是有效的 YYYY-MM-DD") from None


def _stable_action_id(
    review_date: str,
    source_record_etag: str,
    category: str,
    desired_value: Any,
) -> str:
    basis = {
        "review_date": review_date,
        "source_record_etag": source_record_etag,
        "category": category,
        "desired_value": desired_value,
    }
    return "phase-action-" + hashlib.sha256(_canonical_json(basis)).hexdigest()


def _computed_action_etag(record: Mapping[str, Any]) -> str:
    payload = {key: value for key, value in record.items() if key != "etag"}
    return hashlib.sha256(_canonical_json(payload)).hexdigest()


def _refresh_action_etag(record: dict[str, Any]) -> dict[str, Any]:
    record["etag"] = _computed_action_etag(record)
    return record


def _new_action(
    review_date: str,
    source_record_etag: str,
    category: str,
    desired_value: Any,
    timestamp: str,
) -> dict[str, Any]:
    record = {
        "schema_version": SCHEMA_VERSION,
        "action_id": _stable_action_id(
            review_date, source_record_etag, category, desired_value
        ),
        "review_date": review_date,
        "source_record_etag": source_record_etag,
        "category": category,
        "desired_value": desired_value,
        "approval_requirement": APPROVAL_BY_CATEGORY[category],
        "state": "pending",
        "failure_code": None,
        "revision": 1,
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    return _refresh_action_etag(record)


def _validate_record(record: Any, line_number: int) -> dict[str, Any]:
    if not isinstance(record, dict):
        raise PhaseActionError(f"{DATA_FILE} 第 {line_number} 行必须是 JSON 对象")
    required_fields = {
        "schema_version",
        "action_id",
        "review_date",
        "source_record_etag",
        "category",
        "desired_value",
        "approval_requirement",
        "state",
        "failure_code",
        "revision",
        "created_at",
        "updated_at",
        "etag",
    }
    if set(record) != required_fields:
        raise PhaseActionError(f"{DATA_FILE} 第 {line_number} 行字段集无效")
    if type(record["schema_version"]) is not int or record["schema_version"] != 1:
        raise PhaseActionError(
            f"{DATA_FILE} 第 {line_number} 行的 schema_version 无效"
        )
    review_date = _validate_review_date(record["review_date"])
    source_record_etag = record["source_record_etag"]
    if not isinstance(source_record_etag, str) or not _ETAG_RE.fullmatch(
        source_record_etag
    ):
        raise PhaseActionError(
            f"{DATA_FILE} 第 {line_number} 行的 source_record_etag 无效"
        )
    category = record["category"]
    if category not in ACTION_CATEGORIES:
        raise PhaseActionError(f"{DATA_FILE} 第 {line_number} 行的 category 无效")
    desired_value = record["desired_value"]
    if desired_value not in ALLOWED_DESIRED_VALUES[category] or (
        category == "fitness_conversation" and type(desired_value) is not bool
    ):
        raise PhaseActionError(
            f"{DATA_FILE} 第 {line_number} 行的 desired_value 无效"
        )
    expected_action_id = _stable_action_id(
        review_date, source_record_etag, category, desired_value
    )
    if (
        not isinstance(record["action_id"], str)
        or not _ACTION_ID_RE.fullmatch(record["action_id"])
        or record["action_id"] != expected_action_id
    ):
        raise PhaseActionError(f"{DATA_FILE} 第 {line_number} 行的 action_id 无效")
    if record["approval_requirement"] != APPROVAL_BY_CATEGORY[category]:
        raise PhaseActionError(
            f"{DATA_FILE} 第 {line_number} 行的 approval_requirement 无效"
        )
    state_value = record["state"]
    if state_value not in ACTION_STATES:
        raise PhaseActionError(f"{DATA_FILE} 第 {line_number} 行的 state 无效")
    failure_code = record["failure_code"]
    if state_value == "failed":
        if not isinstance(failure_code, str) or not _FAILURE_CODE_RE.fullmatch(
            failure_code
        ):
            raise PhaseActionError(
                f"{DATA_FILE} 第 {line_number} 行的 failure_code 无效"
            )
    elif failure_code is not None:
        raise PhaseActionError(
            f"{DATA_FILE} 第 {line_number} 行的 failure_code 无效"
        )
    revision = record["revision"]
    if type(revision) is not int or revision < 1:
        raise PhaseActionError(f"{DATA_FILE} 第 {line_number} 行的 revision 无效")
    created_at = _validate_timestamp(record["created_at"], "created_at", line_number)
    updated_at = _validate_timestamp(record["updated_at"], "updated_at", line_number)
    if created_at > updated_at:
        raise PhaseActionError(f"{DATA_FILE} 第 {line_number} 行的时间顺序无效")
    if (
        not isinstance(record["etag"], str)
        or not _ETAG_RE.fullmatch(record["etag"])
        or record["etag"] != _computed_action_etag(record)
    ):
        raise PhaseActionError(f"{DATA_FILE} 第 {line_number} 行的 etag 无效")
    return record


def _parse_records_bytes(raw: bytes) -> list[dict[str, Any]]:
    if len(raw) > MAX_LEDGER_BYTES:
        raise PhaseActionError("阶段动作台账超过安全大小限制")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise PhaseActionError(f"{DATA_FILE} 不是有效 UTF-8") from error
    records: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        if len(records) >= MAX_RECORDS:
            raise PhaseActionError("阶段动作台账记录数超过安全限制")
        try:
            parsed = _strict_json_loads(line, f"{DATA_FILE} 第 {line_number} 行")
        except PhaseActionError as error:
            message = str(error)
            if message.startswith(f"{DATA_FILE} 第 {line_number} 行"):
                raise
            raise PhaseActionError(
                f"{DATA_FILE} 第 {line_number} 行包含重复或非法 JSON 字段"
            ) from error
        record = _validate_record(parsed, line_number)
        if record["action_id"] in seen_ids:
            raise PhaseActionError(f"{DATA_FILE} 存在重复 action_id")
        seen_ids.add(record["action_id"])
        records.append(record)
    return records


def _serialize_records(records: list[dict[str, Any]]) -> bytes:
    ordered = sorted(records, key=lambda item: (item["review_date"], item["action_id"]))
    return b"".join(_canonical_json(record) + b"\n" for record in ordered)


def _safe_summary(
    records: list[dict[str, Any]],
    *,
    ledger_present: bool,
    permissions_ok: bool | None,
) -> dict[str, Any]:
    state_counts = {state_value: 0 for state_value in ACTION_STATES}
    category_counts = {category: 0 for category in ACTION_CATEGORIES}
    category_state_counts = {
        category: {state_value: 0 for state_value in ACTION_STATES}
        for category in ACTION_CATEGORIES
    }
    for record in records:
        state_counts[record["state"]] += 1
        category_counts[record["category"]] += 1
        category_state_counts[record["category"]][record["state"]] += 1
    return {
        "valid": True,
        "ledger_present": ledger_present,
        "permissions_ok": permissions_ok,
        "record_count": len(records),
        "state_counts": state_counts,
        "category_counts": category_counts,
        "category_state_counts": category_state_counts,
    }


def _open_root_readonly(root: Path) -> tuple[int, tuple[int, int]] | None:
    try:
        before = root.lstat()
    except FileNotFoundError:
        return None
    except OSError as error:
        raise PhaseActionError("阶段动作台账目录无法安全检查") from error
    if stat.S_ISLNK(before.st_mode) or not stat.S_ISDIR(before.st_mode):
        raise PhaseActionError("阶段动作台账目录必须是真实目录")
    flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        flags |= os.O_DIRECTORY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = -1
    try:
        descriptor = os.open(root, flags)
        opened = os.fstat(descriptor)
        after = root.lstat()
        identity = (opened.st_dev, opened.st_ino)
        if (
            not stat.S_ISDIR(opened.st_mode)
            or stat.S_ISLNK(after.st_mode)
            or not stat.S_ISDIR(after.st_mode)
            or (before.st_dev, before.st_ino) != identity
            or (after.st_dev, after.st_ino) != identity
        ):
            raise PhaseActionError("阶段动作台账目录在读取期间发生变化")
        return descriptor, identity
    except Exception:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        raise


def _identity(metadata: os.stat_result) -> tuple[int, int, int, int, int, int]:
    return (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
        metadata.st_size,
        metadata.st_nlink,
    )


def _read_regular_file_fd(
    root_fd: int,
    filename: str,
    *,
    require_private_permissions: bool,
) -> tuple[bytes, tuple[int, int, int, int, int, int] | None, bool]:
    try:
        before = os.stat(filename, dir_fd=root_fd, follow_symlinks=False)
    except FileNotFoundError:
        return b"", None, True
    except OSError as error:
        raise PhaseActionError("阶段动作台账无法安全检查") from error
    if (
        stat.S_ISLNK(before.st_mode)
        or not stat.S_ISREG(before.st_mode)
        or before.st_nlink != 1
    ):
        raise PhaseActionError("阶段动作台账必须是唯一链接的普通文件")
    permissions_ok = stat.S_IMODE(before.st_mode) == 0o600
    if require_private_permissions and not permissions_ok:
        raise PhaseActionError("阶段动作台账权限必须是 0600")
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = -1
    try:
        descriptor = os.open(filename, flags, dir_fd=root_fd)
        opened = os.fstat(descriptor)
        after = os.stat(filename, dir_fd=root_fd, follow_symlinks=False)
        before_identity = _identity(before)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_nlink != 1
            or not stat.S_ISREG(after.st_mode)
            or after.st_nlink != 1
            or _identity(opened) != before_identity
            or _identity(after) != before_identity
        ):
            raise PhaseActionError("阶段动作台账在读取期间发生变化")
        with os.fdopen(descriptor, "rb") as handle:
            descriptor = -1
            raw = handle.read(MAX_LEDGER_BYTES + 1)
        if len(raw) > MAX_LEDGER_BYTES:
            raise PhaseActionError("阶段动作台账超过安全大小限制")
        return raw, before_identity, permissions_ok
    except PhaseActionError:
        raise
    except OSError as error:
        raise PhaseActionError("阶段动作台账无法安全读取") from error
    finally:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass


def _lock_permissions(root_fd: int) -> bool:
    try:
        metadata = os.stat(LOCK_FILE, dir_fd=root_fd, follow_symlinks=False)
    except FileNotFoundError:
        return True
    except OSError as error:
        raise PhaseActionError("阶段动作锁无法安全检查") from error
    if (
        stat.S_ISLNK(metadata.st_mode)
        or not stat.S_ISREG(metadata.st_mode)
        or metadata.st_nlink != 1
    ):
        raise PhaseActionError("阶段动作锁必须是唯一链接的普通文件")
    return stat.S_IMODE(metadata.st_mode) == 0o600


def _read_actions_readonly(
    root: Path,
) -> tuple[list[dict[str, Any]], bool, bool]:
    opened = _open_root_readonly(root)
    if opened is None:
        return [], False, True
    root_fd, _ = opened
    try:
        raw, identity, data_permissions_ok = _read_regular_file_fd(
            root_fd, DATA_FILE, require_private_permissions=False
        )
        lock_permissions_ok = _lock_permissions(root_fd)
        records = _parse_records_bytes(raw)
        return records, identity is not None, data_permissions_ok and lock_permissions_ok
    finally:
        os.close(root_fd)


def inspect_phase_actions(root: Path) -> dict[str, Any]:
    """纯只读、无内容检查；缺失目录或台账是正常空状态。"""

    try:
        records, present, permissions_ok = _read_actions_readonly(root)
        return _safe_summary(
            records, ledger_present=present, permissions_ok=permissions_ok
        )
    except Exception:
        raise PhaseActionError("阶段动作台账无法安全检查") from None


def inspect_phase_action_snapshot(snapshot: Mapping[str, bytes]) -> dict[str, Any]:
    """严格检查固定备份字节；快照不携带 POSIX 权限，因而返回 None。"""

    try:
        present = SNAPSHOT_KEY in snapshot
        raw = snapshot.get(SNAPSHOT_KEY, b"")
        if type(raw) is not bytes:
            raise PhaseActionError("阶段动作快照结构无效")
        records = _parse_records_bytes(raw)
        return _safe_summary(
            records, ledger_present=present, permissions_ok=None
        )
    except Exception:
        raise PhaseActionError("阶段动作快照结构无效") from None


def _assert_bound_paths(context: _LockedRoot) -> None:
    try:
        root_metadata = context.root.lstat()
        lock_metadata = os.stat(
            LOCK_FILE, dir_fd=context.descriptor, follow_symlinks=False
        )
    except OSError as error:
        raise PhaseActionError("阶段动作写入路径在操作期间发生变化") from error
    if (
        stat.S_ISLNK(root_metadata.st_mode)
        or not stat.S_ISDIR(root_metadata.st_mode)
        or (root_metadata.st_dev, root_metadata.st_ino) != context.root_identity
        or stat.S_ISLNK(lock_metadata.st_mode)
        or not stat.S_ISREG(lock_metadata.st_mode)
        or lock_metadata.st_nlink != 1
        or (lock_metadata.st_dev, lock_metadata.st_ino, lock_metadata.st_nlink)
        != context.lock_identity
    ):
        raise PhaseActionError("阶段动作写入路径在操作期间发生变化")


@contextmanager
def _actions_lock(root: Path) -> Iterator[_LockedRoot]:
    opened = _open_root_readonly(root)
    if opened is None:
        raise PhaseActionError("阶段动作台账目录不存在")
    root_fd, root_identity = opened
    lock_fd = -1
    try:
        try:
            before = os.stat(LOCK_FILE, dir_fd=root_fd, follow_symlinks=False)
        except FileNotFoundError:
            before = None
        if before is not None and (
            stat.S_ISLNK(before.st_mode)
            or not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
        ):
            raise PhaseActionError("阶段动作锁必须是唯一链接的普通文件")
        flags = os.O_RDWR | os.O_CREAT
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        lock_fd = os.open(LOCK_FILE, flags, 0o600, dir_fd=root_fd)
        opened_lock = os.fstat(lock_fd)
        after = os.stat(LOCK_FILE, dir_fd=root_fd, follow_symlinks=False)
        if (
            not stat.S_ISREG(opened_lock.st_mode)
            or opened_lock.st_nlink != 1
            or not stat.S_ISREG(after.st_mode)
            or after.st_nlink != 1
            or (opened_lock.st_dev, opened_lock.st_ino)
            != (after.st_dev, after.st_ino)
            or (
                before is not None
                and (before.st_dev, before.st_ino) != (opened_lock.st_dev, opened_lock.st_ino)
            )
        ):
            raise PhaseActionError("阶段动作锁在打开期间发生变化")
        os.fchmod(lock_fd, 0o600)
        deadline = time.monotonic() + LOCK_TIMEOUT_SECONDS
        while True:
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise PhaseActionError("阶段动作台账正在被另一个进程更新")
                time.sleep(0.05)
        context = _LockedRoot(
            root=root,
            descriptor=root_fd,
            root_identity=root_identity,
            lock_identity=(opened_lock.st_dev, opened_lock.st_ino, opened_lock.st_nlink),
        )
        _assert_bound_paths(context)
        yield context
    except PhaseActionError:
        raise
    except OSError as error:
        raise PhaseActionError("阶段动作锁无法安全使用") from error
    finally:
        if lock_fd >= 0:
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_UN)
            except OSError:
                pass
            try:
                os.close(lock_fd)
            except OSError:
                pass
        try:
            os.close(root_fd)
        except OSError:
            pass


def _load_actions_locked(
    context: _LockedRoot,
) -> tuple[bytes, tuple[int, int, int, int, int, int] | None, list[dict[str, Any]]]:
    _assert_bound_paths(context)
    raw, identity, _ = _read_regular_file_fd(
        context.descriptor, DATA_FILE, require_private_permissions=True
    )
    return raw, identity, _parse_records_bytes(raw)


def _atomic_replace_locked(
    context: _LockedRoot,
    expected: bytes,
    expected_identity: tuple[int, int, int, int, int, int] | None,
    content: bytes,
) -> None:
    _assert_bound_paths(context)
    current, current_identity, _ = _read_regular_file_fd(
        context.descriptor, DATA_FILE, require_private_permissions=True
    )
    if current != expected or current_identity != expected_identity:
        raise PhaseActionError("阶段动作台账在写入前发生变化，已停止覆盖")

    temp_name = (
        f".{DATA_FILE}.{os.getpid()}.{time.time_ns()}.{hashlib.sha256(content).hexdigest()[:8]}.tmp"
    )
    descriptor = -1
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(temp_name, flags, 0o600, dir_fd=context.descriptor)
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1:
            raise PhaseActionError("阶段动作临时文件类型无效")
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            descriptor = -1
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        _assert_bound_paths(context)
        current, current_identity, _ = _read_regular_file_fd(
            context.descriptor, DATA_FILE, require_private_permissions=True
        )
        if current != expected or current_identity != expected_identity:
            raise PhaseActionError("阶段动作台账在发布前发生变化，已停止覆盖")
        os.replace(
            temp_name,
            DATA_FILE,
            src_dir_fd=context.descriptor,
            dst_dir_fd=context.descriptor,
        )
        temp_name = ""
        os.fsync(context.descriptor)
    except PhaseActionError:
        raise
    except OSError as error:
        raise PhaseActionError("阶段动作台账无法安全写入") from error
    finally:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        if temp_name:
            try:
                os.unlink(temp_name, dir_fd=context.descriptor)
            except (FileNotFoundError, OSError):
                pass


def _source_records_readonly(root: Path) -> list[dict[str, Any]]:
    """复用 phase_review 的目录绑定读取，再补权限和 hardlink 检查。"""

    data_path = root / PHASE_REVIEW.DATA_FILE
    try:
        before = data_path.lstat()
    except FileNotFoundError:
        before = None
    except OSError:
        raise PhaseActionError("阶段复盘来源无法安全检查") from None
    if before is not None and (
        stat.S_ISLNK(before.st_mode)
        or not stat.S_ISREG(before.st_mode)
        or before.st_nlink != 1
        or stat.S_IMODE(before.st_mode) != 0o600
    ):
        raise PhaseActionError("阶段复盘来源必须是权限 0600 的唯一普通文件")
    try:
        raw = PHASE_REVIEW._safe_read_phase_reviews_from_root(root)
        records = PHASE_REVIEW._parse_records_bytes(raw)
    except Exception:
        raise PhaseActionError("阶段复盘来源无法安全读取") from None
    if before is not None:
        try:
            after = data_path.lstat()
        except OSError:
            raise PhaseActionError("阶段复盘来源在读取期间发生变化") from None
        if (
            stat.S_ISLNK(after.st_mode)
            or not stat.S_ISREG(after.st_mode)
            or after.st_nlink != 1
            or _identity(after) != _identity(before)
        ):
            raise PhaseActionError("阶段复盘来源在读取期间发生变化")
    return records


def _source_record(
    records: list[dict[str, Any]], review_date: str
) -> dict[str, Any] | None:
    return next(
        (record for record in records if record["review_date"] == review_date), None
    )


def _source_etag(record: dict[str, Any]) -> str:
    return PHASE_REVIEW._record_etag(record)


def _derived_actions(record: dict[str, Any]) -> list[tuple[str, Any]]:
    result: list[tuple[str, Any]] = []
    selected_track = record["answers"]["next_track"]
    for category in ACTION_CATEGORIES:
        value = record["answers"][category]
        # next_track 是互斥分支。只有用户没有回答该字段时，才允许一个单独、
        # 明确的 dependent answer 自行产生动作；一旦选定分支，另一分支不能串入。
        if category == "career_timing" and selected_track in (
            "fitness",
            "neither",
            "undecided",
        ):
            continue
        if category == "fitness_conversation" and selected_track in (
            "career",
            "neither",
            "undecided",
        ):
            continue
        if value not in EXCLUDED_VALUES[category]:
            result.append((category, value))
    return result


def _action_projection(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "action_id": record["action_id"],
        "category": record["category"],
        "desired_value": record["desired_value"],
        "approval_requirement": record["approval_requirement"],
        "state": record["state"],
        "failure_code": record["failure_code"],
        "revision": record["revision"],
        "action_etag": record["etag"],
    }


def _action_sort_key(record: dict[str, Any]) -> tuple[int, str]:
    return ACTION_CATEGORIES.index(record["category"]), record["action_id"]


def _has_action_file(root: Path) -> bool:
    try:
        metadata = (root / DATA_FILE).lstat()
    except FileNotFoundError:
        return False
    except OSError:
        raise PhaseActionError("阶段动作台账无法安全检查") from None
    if (
        stat.S_ISLNK(metadata.st_mode)
        or not stat.S_ISREG(metadata.st_mode)
        or metadata.st_nlink != 1
    ):
        raise PhaseActionError("阶段动作台账必须是唯一链接的普通文件")
    return True


def plan(root: Path, review_date_value: str) -> dict[str, Any]:
    review_date = _validate_review_date(review_date_value)
    initial_sources = _source_records_readonly(root)
    initial_source = _source_record(initial_sources, review_date)
    if initial_source is None and not _has_action_file(root):
        return {
            "action": "plan",
            "review_date": review_date,
            "source_exists": False,
            "source_revision": None,
            "source_record_etag": None,
            "ledger_action": "unchanged",
            "created_count": 0,
            "superseded_count": 0,
            "pending_count": 0,
            "actions": [],
            "external_changes_applied": False,
        }

    try:
        source_lock = PHASE_REVIEW._records_lock(root)
    except Exception:
        raise PhaseActionError("阶段复盘来源无法安全锁定") from None
    try:
        with source_lock:
            source_records = _source_records_readonly(root)
            source = _source_record(source_records, review_date)
            source_record_etag = _source_etag(source) if source is not None else None
            desired = _derived_actions(source) if source is not None else []
            if source is None and not _has_action_file(root):
                return {
                    "action": "plan",
                    "review_date": review_date,
                    "source_exists": False,
                    "source_revision": None,
                    "source_record_etag": None,
                    "ledger_action": "unchanged",
                    "created_count": 0,
                    "superseded_count": 0,
                    "pending_count": 0,
                    "actions": [],
                    "external_changes_applied": False,
                }
            if not desired and not _has_action_file(root):
                return {
                    "action": "plan",
                    "review_date": review_date,
                    "source_exists": True,
                    "source_revision": source["revision"],
                    "source_record_etag": source_record_etag,
                    "ledger_action": "unchanged",
                    "created_count": 0,
                    "superseded_count": 0,
                    "pending_count": 0,
                    "actions": [],
                    "external_changes_applied": False,
                }

            with _actions_lock(root) as context:
                original, original_identity, records = _load_actions_locked(context)
                changed = False
                created_count = 0
                superseded_count = 0
                timestamp = _utc_now()
                for record in records:
                    if (
                        record["review_date"] == review_date
                        and record["state"] != "superseded"
                        and record["source_record_etag"] != source_record_etag
                    ):
                        record["state"] = "superseded"
                        record["failure_code"] = None
                        record["revision"] += 1
                        record["updated_at"] = timestamp
                        _refresh_action_etag(record)
                        changed = True
                        superseded_count += 1

                existing_ids = {record["action_id"] for record in records}
                if source is not None and source_record_etag is not None:
                    for category, desired_value in desired:
                        candidate = _new_action(
                            review_date,
                            source_record_etag,
                            category,
                            desired_value,
                            timestamp,
                        )
                        if candidate["action_id"] not in existing_ids:
                            records.append(candidate)
                            existing_ids.add(candidate["action_id"])
                            created_count += 1
                            changed = True

                if changed:
                    _atomic_replace_locked(
                        context,
                        original,
                        original_identity,
                        _serialize_records(records),
                    )
                current_pending = [
                    record
                    for record in records
                    if record["review_date"] == review_date
                    and record["source_record_etag"] == source_record_etag
                    and record["state"] == "pending"
                ]
                current_pending.sort(key=_action_sort_key)
    except PhaseActionError:
        raise
    except Exception:
        raise PhaseActionError("阶段动作计划无法安全生成") from None

    return {
        "action": "plan",
        "review_date": review_date,
        "source_exists": source is not None,
        "source_revision": source["revision"] if source is not None else None,
        "source_record_etag": source_record_etag,
        "ledger_action": (
            "updated" if superseded_count else "created" if created_count else "unchanged"
        ),
        "created_count": created_count,
        "superseded_count": superseded_count,
        "pending_count": len(current_pending),
        "actions": [_action_projection(record) for record in current_pending],
        "external_changes_applied": False,
    }


def apply_plan(root: Path, review_date_value: str) -> dict[str, Any]:
    """真正只读：不创建目录、锁或动作记录。"""

    review_date = _validate_review_date(review_date_value)
    source_records = _source_records_readonly(root)
    source = _source_record(source_records, review_date)
    source_record_etag = _source_etag(source) if source is not None else None
    records, _, _ = _read_actions_readonly(root)
    stale_retryable = any(
        record["review_date"] == review_date
        and record["state"] in RETRYABLE_STATES
        and record["source_record_etag"] != source_record_etag
        for record in records
    )
    retryable = [
        record
        for record in records
        if source is not None
        and record["review_date"] == review_date
        and record["source_record_etag"] == source_record_etag
        and record["state"] in RETRYABLE_STATES
    ]
    retryable.sort(key=_action_sort_key)
    return {
        "action": "apply_plan",
        "review_date": review_date,
        "source_exists": source is not None,
        "source_revision": source["revision"] if source is not None else None,
        "source_record_etag": source_record_etag,
        "source_refresh_required": stale_retryable,
        "retryable_count": len(retryable),
        "actions": [_action_projection(record) for record in retryable],
        "read_only": True,
        "external_changes_applied": False,
    }


def _read_mark_input() -> dict[str, Any]:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        raise PhaseActionError(f"stdin 输入不能超过 {MAX_INPUT_BYTES} 字节")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise PhaseActionError("stdin 不是有效 UTF-8") from error
    if not text.strip():
        raise PhaseActionError("--input - 需要从 stdin 读取一个 JSON 对象")
    payload = _strict_json_loads(text, "stdin 输入")
    if not isinstance(payload, dict):
        raise PhaseActionError("stdin 输入必须是 JSON 对象")
    required = {
        "action_id",
        "expect_revision",
        "expect_action_etag",
        "state",
    }
    optional = {"failure_code"}
    if not required.issubset(payload) or set(payload) - required - optional:
        raise PhaseActionError("stdin 输入字段集无效")
    if (
        not isinstance(payload["action_id"], str)
        or not _ACTION_ID_RE.fullmatch(payload["action_id"])
    ):
        raise PhaseActionError("action_id 无效")
    if type(payload["expect_revision"]) is not int or payload["expect_revision"] < 1:
        raise PhaseActionError("expect_revision 必须是正整数")
    if (
        not isinstance(payload["expect_action_etag"], str)
        or not _ETAG_RE.fullmatch(payload["expect_action_etag"])
    ):
        raise PhaseActionError("expect_action_etag 必须是 64 位 SHA-256")
    if payload["state"] not in MARK_STATES:
        raise PhaseActionError("state 只能是 applied、failed 或 dismissed")
    failure_code = payload.get("failure_code")
    if payload["state"] == "failed":
        if not isinstance(failure_code, str) or not _FAILURE_CODE_RE.fullmatch(
            failure_code
        ):
            raise PhaseActionError("failed 状态必须提供通用 failure_code")
    elif failure_code is not None:
        raise PhaseActionError("只有 failed 状态可以提供 failure_code")
    payload["failure_code"] = failure_code
    return payload


def mark(root: Path) -> dict[str, Any]:
    payload = _read_mark_input()
    initial_records, present, _ = _read_actions_readonly(root)
    if not present:
        raise PhaseActionError("阶段动作台账不存在")
    initial = next(
        (
            record
            for record in initial_records
            if record["action_id"] == payload["action_id"]
        ),
        None,
    )
    if initial is None:
        raise PhaseActionError("阶段动作不存在")

    try:
        source_lock = PHASE_REVIEW._records_lock(root)
    except Exception:
        raise PhaseActionError("阶段复盘来源无法安全锁定") from None
    try:
        with source_lock:
            with _actions_lock(root) as context:
                original, original_identity, records = _load_actions_locked(context)
                action_record = next(
                    (
                        record
                        for record in records
                        if record["action_id"] == payload["action_id"]
                    ),
                    None,
                )
                if action_record is None:
                    raise PhaseActionError("阶段动作不存在")
                source_records = _source_records_readonly(root)
                source = _source_record(source_records, action_record["review_date"])
                if (
                    source is None
                    or _source_etag(source) != action_record["source_record_etag"]
                    or action_record["state"] == "superseded"
                ):
                    raise PhaseActionError("阶段复盘来源已变化；请重新运行 plan")

                requested_state = payload["state"]
                requested_failure = payload["failure_code"]
                if (
                    action_record["state"] == requested_state
                    and action_record["failure_code"] == requested_failure
                ):
                    action_name = "unchanged"
                else:
                    if action_record["state"] in ("applied", "dismissed"):
                        raise PhaseActionError("已完成动作不能改为另一状态")
                    if payload["expect_revision"] != action_record["revision"]:
                        raise PhaseActionError("阶段动作 revision 已变化")
                    if payload["expect_action_etag"] != action_record["etag"]:
                        raise PhaseActionError("阶段动作 etag 已变化")
                    action_record["state"] = requested_state
                    action_record["failure_code"] = requested_failure
                    action_record["revision"] += 1
                    action_record["updated_at"] = _utc_now()
                    _refresh_action_etag(action_record)
                    _atomic_replace_locked(
                        context,
                        original,
                        original_identity,
                        _serialize_records(records),
                    )
                    action_name = "marked"
    except PhaseActionError:
        raise
    except Exception:
        raise PhaseActionError("阶段动作状态无法安全记录") from None

    return {
        "action": action_name,
        "action_id": action_record["action_id"],
        "category": action_record["category"],
        "state": action_record["state"],
        "failure_code": action_record["failure_code"],
        "revision": action_record["revision"],
        "action_etag": action_record["etag"],
        "external_changes_applied_by_tool": False,
        "goals_policy_reminders_web_unchanged": True,
    }


def public_summary(root: Path, command: str) -> dict[str, Any]:
    summary = inspect_phase_actions(root)
    return {"action": command, **summary, "content_values_omitted": True}


def _add_root_argument(command: argparse.ArgumentParser) -> None:
    command.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "records",
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="维护阶段复盘动作执行状态，不执行外部变更"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    plan_command = subparsers.add_parser("plan", help="派生或刷新当前待处理动作")
    _add_root_argument(plan_command)
    plan_command.add_argument("--review-date", required=True)

    apply_plan_command = subparsers.add_parser(
        "apply-plan", help="只读返回待执行或可重试动作"
    )
    _add_root_argument(apply_plan_command)
    apply_plan_command.add_argument("--review-date", required=True)

    mark_command = subparsers.add_parser("mark", help="精确记录单个动作执行状态")
    _add_root_argument(mark_command)
    mark_command.add_argument("--input", required=True, choices=("-",))

    list_command = subparsers.add_parser("list", help="只返回安全计数")
    _add_root_argument(list_command)

    status_command = subparsers.add_parser("status", help="只返回安全状态计数")
    _add_root_argument(status_command)
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        root = args.root
        if args.command == "plan":
            result = plan(root, args.review_date)
        elif args.command == "apply-plan":
            result = apply_plan(root, args.review_date)
        elif args.command == "mark":
            result = mark(root)
        elif args.command in ("list", "status"):
            result = public_summary(root, args.command)
        else:  # pragma: no cover
            raise PhaseActionError("未知命令")
    except PhaseActionError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    except OSError:
        print("error: 阶段动作台账发生底层访问错误；本次未读写", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
