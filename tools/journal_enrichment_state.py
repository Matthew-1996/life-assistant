#!/usr/bin/env python3
"""维护按篇 DeepSeek 语义整理的启动授权配置（可迁移，不含凭据或日记内容）。

这份配置是"云端整理是否启用"的唯一持久真相：默认 ``disabled``，绝不外发；
只有用户当次明确确认外发后才转为 ``active`` 并记录一条授权（版本、时间戳、
外发确认标志）。它保存 provider 与生产模型白名单选择，但**不保存 API Key**
（Key 仍只在 macOS Keychain）、不保存任何日记原文或摘要。

Life Hub 启动时读取本文件决定 ``enrichment_authorization``：
- ``active`` 且授权完整 → 返回授权版本字符串，commit/retry 才可能发送；
- ``disabled`` / ``paused`` / 缺失 / 损坏 → 返回 None（fail-safe，不发送）。

暂停（``pause``）是随时可用的关闭开关；恢复用 ``enable`` 重新授权并生成新版本，
使暂停期间遗留的旧预览无法再提交。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = Path("integrations/journal-enrichment.json")

PROVIDER = "deepseek"
ALLOWED_MODELS = ("deepseek-v4-flash", "deepseek-v4-pro")
LIFECYCLE_STATES = {"disabled", "active", "paused"}

CONFIG_FIELDS = {
    "schema_version",
    "feature",
    "provider",
    "lifecycle_state",
    "model",
    "authorization",
}
AUTHORIZATION_FIELDS = {
    "version",
    "acknowledged_external_send",
    "authorized_at",
}
VERSION_PATTERN = re.compile(r"journal-enrichment-[0-9]{8}T[0-9]{6}Z")


class EnrichmentStateError(ValueError):
    pass


def _now_compact() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _default_config() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "feature": "journal_enrichment",
        "provider": PROVIDER,
        "lifecycle_state": "disabled",
        "model": "deepseek-v4-flash",
        "authorization": None,
    }


def _read_config(root: Path, *, required: bool = False) -> dict[str, Any] | None:
    path = root / CONFIG_PATH
    try:
        info = path.lstat()
    except FileNotFoundError:
        if required:
            raise EnrichmentStateError("缺少 journal-enrichment.json") from None
        return None
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise EnrichmentStateError("journal-enrichment.json 必须是唯一链接的普通文件")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise EnrichmentStateError("journal-enrichment.json 不是有效 JSON") from error
    if not isinstance(value, dict):
        raise EnrichmentStateError("journal-enrichment.json 顶层必须是对象")
    return value


def _validate_config(value: dict[str, Any]) -> dict[str, Any]:
    if set(value) != CONFIG_FIELDS:
        raise EnrichmentStateError("语义整理配置字段集无效")
    if value["schema_version"] != 1:
        raise EnrichmentStateError("语义整理配置版本无效")
    if value["feature"] != "journal_enrichment":
        raise EnrichmentStateError("语义整理配置 feature 无效")
    if value["provider"] != PROVIDER:
        raise EnrichmentStateError("语义整理配置 provider 无效")
    if value["lifecycle_state"] not in LIFECYCLE_STATES:
        raise EnrichmentStateError("语义整理生命周期状态无效")
    if value["model"] not in ALLOWED_MODELS:
        raise EnrichmentStateError("语义整理模型不在允许白名单内")
    authorization = value["authorization"]
    if value["lifecycle_state"] == "disabled":
        if authorization is not None:
            raise EnrichmentStateError("disabled 状态不得保存授权记录")
    else:
        _validate_authorization(authorization)
    return value


def _validate_authorization(authorization: Any) -> dict[str, Any]:
    if not isinstance(authorization, dict) or set(authorization) != AUTHORIZATION_FIELDS:
        raise EnrichmentStateError("语义整理授权记录字段集无效")
    if authorization["acknowledged_external_send"] is not True:
        raise EnrichmentStateError("授权记录必须确认外发")
    version = authorization["version"]
    if not isinstance(version, str) or VERSION_PATTERN.fullmatch(version) is None:
        raise EnrichmentStateError("语义整理授权版本无效")
    try:
        parsed = datetime.fromisoformat(str(authorization["authorized_at"]).replace("Z", "+00:00"))
    except (AttributeError, ValueError) as error:
        raise EnrichmentStateError("语义整理授权时间无效") from error
    if parsed.tzinfo is None:
        raise EnrichmentStateError("语义整理授权时间缺少时区")
    return authorization


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
        os.chmod(path, 0o600)
    except Exception:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def _stdin_json() -> dict[str, Any]:
    try:
        value = json.load(sys.stdin)
    except json.JSONDecodeError as error:
        raise EnrichmentStateError("stdin 不是有效 JSON") from error
    if not isinstance(value, dict):
        raise EnrichmentStateError("stdin 顶层必须是对象")
    return value


def resolve_authorization(root: Path = DEFAULT_ROOT) -> str | None:
    """供 Hub 启动读取：仅当 active 且授权完整时返回授权版本，否则 None。

    任何缺失、损坏、暂停或禁用都安全地返回 None（不发送）。
    """

    try:
        value = _read_config(root)
        if value is None:
            return None
        config = _validate_config(value)
    except EnrichmentStateError:
        return None
    if config["lifecycle_state"] != "active":
        return None
    return config["authorization"]["version"]


def resolve_model(root: Path = DEFAULT_ROOT) -> str:
    try:
        value = _read_config(root)
        if value is not None:
            return _validate_config(value)["model"]
    except EnrichmentStateError:
        pass
    return "deepseek-v4-flash"


def inspect_state(root: Path = DEFAULT_ROOT) -> dict[str, Any]:
    value = _read_config(root)
    if value is None:
        return {
            "state": "disabled",
            "configured": False,
            "authorized": False,
            "provider": PROVIDER,
            "model": "deepseek-v4-flash",
        }
    config = _validate_config(value)
    authorized = config["lifecycle_state"] == "active"
    result = {
        "state": config["lifecycle_state"],
        "configured": True,
        "authorized": authorized,
        "provider": config["provider"],
        "model": config["model"],
    }
    if config["authorization"] is not None:
        result["authorization_version"] = config["authorization"]["version"]
        result["authorized_at"] = config["authorization"]["authorized_at"]
    return result


def enable(root: Path, payload: dict[str, Any]) -> dict[str, Any]:
    allowed = {"acknowledge_external_send", "model", "expect_state"}
    if set(payload) - allowed or "acknowledge_external_send" not in payload:
        raise EnrichmentStateError("enable 输入字段集无效")
    if payload["acknowledge_external_send"] is not True:
        raise EnrichmentStateError("启用云端整理必须确认外发（acknowledge_external_send=true）")
    model = payload.get("model", None)
    existing = _read_config(root)
    config = _validate_config(existing) if existing is not None else _default_config()
    if "expect_state" in payload and payload["expect_state"] != config["lifecycle_state"]:
        raise EnrichmentStateError("语义整理状态已变化；请重新读取后再试")
    if model is None:
        model = config["model"]
    if model not in ALLOWED_MODELS:
        raise EnrichmentStateError("语义整理模型不在允许白名单内")
    candidate = dict(config)
    candidate["model"] = model
    candidate["lifecycle_state"] = "active"
    candidate["authorization"] = {
        "version": f"journal-enrichment-{_now_compact()}",
        "acknowledged_external_send": True,
        "authorized_at": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
    }
    _validate_config(candidate)
    _atomic_json(root / CONFIG_PATH, candidate)
    return {
        "action": "enabled",
        "state": "active",
        "model": candidate["model"],
        "authorization_version": candidate["authorization"]["version"],
    }


def pause(root: Path, payload: dict[str, Any]) -> dict[str, Any]:
    if set(payload) - {"expect_state"}:
        raise EnrichmentStateError("pause 输入字段集无效")
    config = _validate_config(_read_config(root, required=True) or {})
    if "expect_state" in payload and payload["expect_state"] != config["lifecycle_state"]:
        raise EnrichmentStateError("语义整理状态已变化；请重新读取后再试")
    if config["lifecycle_state"] == "disabled":
        raise EnrichmentStateError("尚未授权，无需暂停；如需彻底关闭已是 disabled")
    candidate = dict(config)
    candidate["lifecycle_state"] = "paused"
    _validate_config(candidate)
    _atomic_json(root / CONFIG_PATH, candidate)
    return {"action": "paused", "state": "paused"}


def disable(root: Path, payload: dict[str, Any]) -> dict[str, Any]:
    if set(payload) - {"expect_state"}:
        raise EnrichmentStateError("disable 输入字段集无效")
    existing = _read_config(root)
    config = _validate_config(existing) if existing is not None else _default_config()
    if "expect_state" in payload and payload["expect_state"] != config["lifecycle_state"]:
        raise EnrichmentStateError("语义整理状态已变化；请重新读取后再试")
    candidate = dict(config)
    candidate["lifecycle_state"] = "disabled"
    candidate["authorization"] = None
    _validate_config(candidate)
    _atomic_json(root / CONFIG_PATH, candidate)
    return {"action": "disabled", "state": "disabled"}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="维护按篇 DeepSeek 语义整理的启动授权配置，不保存凭据或日记内容"
    )
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("status")
    subparsers.add_parser("enable")
    subparsers.add_parser("pause")
    subparsers.add_parser("disable")
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        if args.command == "status":
            result = inspect_state(root)
        elif args.command == "enable":
            result = enable(root, _stdin_json())
        elif args.command == "pause":
            result = pause(root, _stdin_json())
        else:
            result = disable(root, _stdin_json())
    except (EnrichmentStateError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
