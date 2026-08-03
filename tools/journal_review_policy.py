#!/usr/bin/env python3
"""Safely inspect or update the portable journal review cadence policy."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import sys
import tempfile
import time
from contextlib import contextmanager
from datetime import date
from pathlib import Path
from typing import Any, Iterator


SCHEMA_VERSION = 1
POLICY_FILE = "review-policy.json"
LOCK_FILE = ".journal.lock"
TIMEZONE = "Asia/Shanghai"
TRIAL_START = "2026-08-02"
TRIAL_END = "2026-08-14"
CADENCES = {
    "pending_user_choice",
    "weekly",
    "monthly",
    "on_demand",
    "paused",
}
SELECTED_CADENCES = CADENCES - {"pending_user_choice"}
POLICY_FIELDS = {
    "schema_version",
    "timezone",
    "trial_weekly_start",
    "trial_weekly_end",
    "long_term_cadence",
    "long_term_effective_from",
    "decided_on",
}
LOCK_TIMEOUT_SECONDS = 10.0


class PolicyError(RuntimeError):
    """A content-free policy error safe to display."""


def _reject_constant(_: str) -> None:
    raise ValueError("invalid JSON constant")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _canonical_date(value: Any) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.isoformat() == value else None


def _validate_policy(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or set(payload) != POLICY_FIELDS:
        raise PolicyError("日记整理节奏策略字段集无效")
    cadence = payload.get("long_term_cadence")
    if (
        type(payload.get("schema_version")) is not int
        or payload["schema_version"] != SCHEMA_VERSION
        or payload.get("timezone") != TIMEZONE
        or payload.get("trial_weekly_start") != TRIAL_START
        or payload.get("trial_weekly_end") != TRIAL_END
        or cadence not in CADENCES
    ):
        raise PolicyError("日记整理节奏策略字段值无效")
    effective = _canonical_date(payload.get("long_term_effective_from"))
    decided = _canonical_date(payload.get("decided_on"))
    if cadence == "pending_user_choice":
        if effective is not None or decided is not None:
            raise PolicyError("待选择状态不能预填长期生效或决定日期")
    elif (
        effective is None
        or decided is None
        or decided > effective
        or effective <= date.fromisoformat(TRIAL_END)
    ):
        raise PolicyError("已选择的长期节奏日期无效")
    return payload


def _read_policy(path: Path) -> tuple[bytes, dict[str, Any]]:
    if path.is_symlink() or not path.is_file():
        raise PolicyError("日记整理节奏策略缺失或不是普通项目文件")
    try:
        raw = path.read_bytes()
        payload = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
        raise PolicyError("日记整理节奏策略无法安全读取") from None
    return raw, _validate_policy(payload)


@contextmanager
def _policy_lock(root: Path) -> Iterator[None]:
    if root.is_symlink() or not root.is_dir():
        raise PolicyError("日记目录缺失或不是安全的项目目录")
    lock_path = root / LOCK_FILE
    if lock_path.is_symlink() or (lock_path.exists() and not lock_path.is_file()):
        raise PolicyError("日记写锁不是安全的普通文件")
    try:
        lock_file = lock_path.open("a+b")
        os.chmod(lock_path, 0o600)
    except OSError:
        raise PolicyError("无法安全打开日记写锁") from None
    with lock_file:
        deadline = time.monotonic() + LOCK_TIMEOUT_SECONDS
        while True:
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise PolicyError("日记策略正在被另一个进程更新，请稍后重试")
                time.sleep(0.05)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _atomic_replace(path: Path, expected: bytes, payload: dict[str, Any]) -> None:
    try:
        if path.is_symlink() or not path.is_file() or path.read_bytes() != expected:
            raise PolicyError("日记整理节奏策略在本次更新期间发生变化，请重试")
    except OSError:
        raise PolicyError("日记整理节奏策略无法安全重验") from None
    content = (
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=False) + "\n"
    ).encode("utf-8")
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except OSError:
        raise PolicyError("日记整理节奏策略无法安全写入") from None
    finally:
        temporary.unlink(missing_ok=True)


def _show(root: Path) -> dict[str, Any]:
    _, policy = _read_policy(root / POLICY_FILE)
    return {"action": "show", "policy": policy}


def _set_policy(root: Path, args: argparse.Namespace) -> dict[str, Any]:
    effective = _canonical_date(args.effective_from)
    decided = _canonical_date(args.decided_on)
    if (
        effective is None
        or decided is None
        or decided > effective
        or effective <= date.fromisoformat(TRIAL_END)
    ):
        raise PolicyError("长期节奏的决定或生效日期无效")
    with _policy_lock(root):
        path = root / POLICY_FILE
        original, policy = _read_policy(path)
        current = policy["long_term_cadence"]
        if current != args.expect_current:
            raise PolicyError("日记整理节奏已发生变化；请重新读取后再确认")
        desired = dict(policy)
        desired["long_term_cadence"] = args.cadence
        desired["long_term_effective_from"] = args.effective_from
        desired["decided_on"] = args.decided_on
        _validate_policy(desired)
        if desired == policy:
            action = "unchanged"
        else:
            _atomic_replace(path, original, desired)
            action = "updated"
    return {
        "action": action,
        "previous_cadence": current,
        "long_term_cadence": args.cadence,
        "long_term_effective_from": args.effective_from,
        "decided_on": args.decided_on,
        "reminder_runtime_not_changed": True,
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="查看或更新可迁移的日记整理节奏")
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "journal",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("show", help="只读显示当前节奏策略")
    update = subparsers.add_parser("set", help="保存用户明确选择的长期节奏")
    update.add_argument("--cadence", required=True, choices=sorted(SELECTED_CADENCES))
    update.add_argument("--effective-from", required=True)
    update.add_argument("--decided-on", required=True)
    update.add_argument("--expect-current", required=True, choices=sorted(CADENCES))
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    root = args.root
    try:
        result = _show(root) if args.command == "show" else _set_policy(root, args)
    except PolicyError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
