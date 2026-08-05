#!/usr/bin/env python3
"""维护 Google 表格派生展示的最小可迁移配置和同步收据。"""

from __future__ import annotations

import argparse
import hashlib
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
CONFIG_PATH = Path("integrations/google-sheets.json")
RECEIPT_PATH = Path("integrations/google-sheets.sync-state.json")
SOURCE_PATHS = {
    "journal": (Path("journal/index.jsonl"), "journal-index-jsonl"),
    "daily": (Path("records/daily-checkins.jsonl"), "daily-checkins-jsonl"),
    "weekly": (Path("records/weekly-reviews.jsonl"), "weekly-reviews-jsonl"),
}
CONFIG_FIELDS = {
    "schema_version", "display_backend", "lifecycle_state", "account_scope", "access",
    "direction", "sync_cadence", "title", "folder_name", "spreadsheet_id",
    "spreadsheet_url", "view_schema_version", "managed_sheets", "external_scope",
}
RECEIPT_FIELDS = {
    "schema_version", "spreadsheet_id", "payload_sha256", "sources", "synced_at",
}
SOURCE_FIELDS = {"path_category", "present", "sha256"}
SHA_PATTERN = re.compile(r"[0-9a-f]{64}")
ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{10,200}")
URL_PATTERN = re.compile(r"https://docs\.google\.com/spreadsheets/d/[A-Za-z0-9_-]+(?:/[^\s]*)?")


class GoogleSheetsStateError(ValueError):
    pass


def _read_json(path: Path, *, required: bool) -> dict[str, Any] | None:
    try:
        info = path.lstat()
    except FileNotFoundError:
        if required:
            raise GoogleSheetsStateError(f"缺少 {path.name}") from None
        return None
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise GoogleSheetsStateError(f"{path.name} 必须是唯一链接的普通文件")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GoogleSheetsStateError(f"{path.name} 不是有效 JSON") from error
    if not isinstance(value, dict):
        raise GoogleSheetsStateError(f"{path.name} 顶层必须是对象")
    return value


def _validate_config(value: dict[str, Any]) -> dict[str, Any]:
    if set(value) != CONFIG_FIELDS:
        raise GoogleSheetsStateError("Google 表格配置字段集无效")
    if value["schema_version"] != 1 or value["view_schema_version"] != 1:
        raise GoogleSheetsStateError("Google 表格配置版本无效")
    expected = {
        "display_backend": "google_sheets",
        "account_scope": "personal",
        "access": "private_owner_only",
        "direction": "icloud_to_google_only",
        "external_scope": "full_existing_views_without_raw_sources",
        "title": "生活计划表",
        "folder_name": "生活助手",
    }
    if any(value[key] != expected_value for key, expected_value in expected.items()):
        raise GoogleSheetsStateError("Google 表格配置策略与已确认选择不一致")
    if value["lifecycle_state"] not in {"pending_connection", "active", "paused"}:
        raise GoogleSheetsStateError("Google 表格生命周期状态无效")
    if value["sync_cadence"] not in {"every_record", "on_demand"}:
        raise GoogleSheetsStateError("Google 表格同步节奏无效")
    expected_sheets = ["总览", "阶段路线", "两周行动", "每日记录", "每周复盘", "使用说明", "扩展规划", "日记索引"]
    if value["managed_sheets"] != expected_sheets:
        raise GoogleSheetsStateError("Google 表格受管页面集合无效")
    if value["lifecycle_state"] == "pending_connection":
        if value["spreadsheet_id"] is not None or value["spreadsheet_url"] is not None:
            raise GoogleSheetsStateError("尚未连接时不得保存表格标识")
    else:
        if not isinstance(value["spreadsheet_id"], str) or not ID_PATTERN.fullmatch(value["spreadsheet_id"]):
            raise GoogleSheetsStateError("Google 表格 ID 无效")
        if not isinstance(value["spreadsheet_url"], str) or not URL_PATTERN.fullmatch(value["spreadsheet_url"]):
            raise GoogleSheetsStateError("Google 表格链接无效")
    return value


def _source_snapshots(root: Path) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for key, (relative, category) in SOURCE_PATHS.items():
        path = root / relative
        try:
            info = path.lstat()
        except FileNotFoundError:
            result[key] = {"path_category": category, "present": False, "sha256": None}
            continue
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise GoogleSheetsStateError("Google 表格同步源必须是项目内普通文件")
        data = path.read_bytes()
        result[key] = {
            "path_category": category,
            "present": True,
            "sha256": hashlib.sha256(data).hexdigest(),
        }
    return result


def _validate_receipt(value: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    if set(value) != RECEIPT_FIELDS or value["schema_version"] != 1:
        raise GoogleSheetsStateError("Google 表格同步收据字段或版本无效")
    if value["spreadsheet_id"] != config["spreadsheet_id"]:
        raise GoogleSheetsStateError("Google 表格同步收据绑定了其他表格")
    if not isinstance(value["payload_sha256"], str) or not SHA_PATTERN.fullmatch(value["payload_sha256"]):
        raise GoogleSheetsStateError("Google 表格载荷哈希无效")
    if not isinstance(value["sources"], dict) or set(value["sources"]) != set(SOURCE_PATHS):
        raise GoogleSheetsStateError("Google 表格同步收据源集合无效")
    for key, source in value["sources"].items():
        if not isinstance(source, dict) or set(source) != SOURCE_FIELDS:
            raise GoogleSheetsStateError("Google 表格同步收据源字段无效")
        if source["path_category"] != SOURCE_PATHS[key][1]:
            raise GoogleSheetsStateError("Google 表格同步收据源类别无效")
        if not isinstance(source["present"], bool):
            raise GoogleSheetsStateError("Google 表格同步收据源存在性无效")
        if source["present"]:
            if not isinstance(source["sha256"], str) or not SHA_PATTERN.fullmatch(source["sha256"]):
                raise GoogleSheetsStateError("Google 表格同步收据源哈希无效")
        elif source["sha256"] is not None:
            raise GoogleSheetsStateError("缺失的 Google 表格同步源不得含哈希")
    try:
        timestamp = datetime.fromisoformat(value["synced_at"].replace("Z", "+00:00"))
    except (AttributeError, ValueError) as error:
        raise GoogleSheetsStateError("Google 表格同步时间无效") from error
    if timestamp.tzinfo is None:
        raise GoogleSheetsStateError("Google 表格同步时间缺少时区")
    return value


def inspect_state(root: Path = DEFAULT_ROOT) -> dict[str, Any]:
    config = _validate_config(_read_json(root / CONFIG_PATH, required=True) or {})
    if config["lifecycle_state"] != "active":
        if config["lifecycle_state"] == "pending_connection":
            return {"state": "pending_connection", "configured": True, "current": False, "receipt_present": False}
        receipt_value = _read_json(root / RECEIPT_PATH, required=False)
        receipt = _validate_receipt(receipt_value, config) if receipt_value is not None else None
        result = {
            "state": "paused", "configured": True, "current": False,
            "receipt_present": receipt is not None,
        }
        if receipt is not None:
            result["synced_at"] = receipt["synced_at"]
        return result
    current_sources = _source_snapshots(root)
    receipt_value = _read_json(root / RECEIPT_PATH, required=False)
    if receipt_value is None:
        return {"state": "pending_initial_sync", "configured": True, "current": False, "receipt_present": False}
    receipt = _validate_receipt(receipt_value, config)
    current = receipt["sources"] == current_sources
    return {
        "state": "current" if current else "stale",
        "configured": True,
        "current": current,
        "receipt_present": True,
        "synced_at": receipt["synced_at"],
    }


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
        raise GoogleSheetsStateError("stdin 不是有效 JSON") from error
    if not isinstance(value, dict):
        raise GoogleSheetsStateError("stdin 顶层必须是对象")
    return value


def activate(root: Path, payload: dict[str, Any]) -> dict[str, Any]:
    if set(payload) != {"spreadsheet_id", "spreadsheet_url"}:
        raise GoogleSheetsStateError("activate 输入字段集无效")
    config = _validate_config(_read_json(root / CONFIG_PATH, required=True) or {})
    candidate = dict(config)
    candidate.update(payload)
    candidate["lifecycle_state"] = "active"
    _validate_config(candidate)
    _atomic_json(root / CONFIG_PATH, candidate)
    return {"action": "activated", "display_backend": "google_sheets", "access": candidate["access"]}


def set_mode(root: Path, payload: dict[str, Any]) -> dict[str, Any]:
    required = {
        "lifecycle_state", "sync_cadence",
        "expect_lifecycle_state", "expect_sync_cadence",
    }
    if set(payload) != required:
        raise GoogleSheetsStateError("set-mode 输入字段集无效")
    target = (payload["lifecycle_state"], payload["sync_cadence"])
    if target not in {("active", "every_record"), ("paused", "on_demand")}:
        raise GoogleSheetsStateError("Google 表格目标模式无效")
    config = _validate_config(_read_json(root / CONFIG_PATH, required=True) or {})
    current = (config["lifecycle_state"], config["sync_cadence"])
    expected = (payload["expect_lifecycle_state"], payload["expect_sync_cadence"])
    if current != expected:
        raise GoogleSheetsStateError("Google 表格模式已变化；请重新读取后再试")
    candidate = dict(config)
    candidate["lifecycle_state"], candidate["sync_cadence"] = target
    _validate_config(candidate)
    _atomic_json(root / CONFIG_PATH, candidate)
    return {
        "action": "mode_updated" if current != target else "unchanged",
        "lifecycle_state": candidate["lifecycle_state"],
        "sync_cadence": candidate["sync_cadence"],
    }


def mark_success(root: Path, payload: dict[str, Any]) -> dict[str, Any]:
    if set(payload) != {"spreadsheet_id", "payload_sha256", "sources"}:
        raise GoogleSheetsStateError("mark-success 输入字段集无效")
    config = _validate_config(_read_json(root / CONFIG_PATH, required=True) or {})
    if config["lifecycle_state"] != "active" or payload["spreadsheet_id"] != config["spreadsheet_id"]:
        raise GoogleSheetsStateError("Google 表格尚未激活或标识不匹配")
    if not isinstance(payload["payload_sha256"], str) or not SHA_PATTERN.fullmatch(payload["payload_sha256"]):
        raise GoogleSheetsStateError("载荷哈希无效")
    current_sources = _source_snapshots(root)
    if payload["sources"] != current_sources:
        raise GoogleSheetsStateError("Google 表格同步期间本地源已变化；不得发布陈旧收据")
    receipt = {
        "schema_version": 1,
        "spreadsheet_id": config["spreadsheet_id"],
        "payload_sha256": payload["payload_sha256"],
        "sources": current_sources,
        "synced_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    }
    _validate_receipt(receipt, config)
    _atomic_json(root / RECEIPT_PATH, receipt)
    return {"action": "marked_current", "state": "current"}


def main() -> int:
    parser = argparse.ArgumentParser(description="维护 Google 表格派生展示状态，不保存凭据或生活内容")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("status")
    subparsers.add_parser("activate")
    subparsers.add_parser("set-mode")
    subparsers.add_parser("mark-success")
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        if args.command == "status":
            result = inspect_state(root)
        elif args.command == "activate":
            result = activate(root, _stdin_json())
        elif args.command == "set-mode":
            result = set_mode(root, _stdin_json())
        else:
            result = mark_success(root, _stdin_json())
    except (GoogleSheetsStateError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
