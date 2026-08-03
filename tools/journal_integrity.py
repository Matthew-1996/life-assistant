#!/usr/bin/env python3
"""只读核对日记机器索引与月度原文文件的双向完整性。

报告只包含计数和结构错误，不输出日记 ID、标题、摘要或原文。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Mapping


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_JOURNAL_ROOT = PROJECT_ROOT / "journal"
ENTRY_FILE_RE = re.compile(r"^entries/(\d{4})/(\d{4})-(\d{2})\.md$")
JOURNAL_ID_RE = re.compile(r"^\d{8}-(?:\d{4}|unknown)-[0-9a-f]{12}$")
MARKER_RE = re.compile(
    r"^<!-- journal-id: (\d{8}-(?:\d{4}|unknown)-[0-9a-f]{12}) -->[ \t]*$",
    re.MULTILINE,
)
MARKER_LINE_RE = re.compile(r"^<!-- journal-id: .*?-->[ \t]*$", re.MULTILINE)


class JournalIntegrityError(ValueError):
    """日记图谱不能安全建立；消息不得包含生活内容。"""


def _reject_json_constant(_: str) -> None:
    raise ValueError("invalid JSON constant")


def _unique_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _safe_entry_path(value: Any) -> str | None:
    if not isinstance(value, str) or not ENTRY_FILE_RE.fullmatch(value):
        return None
    parts = value.split("/")
    if parts[1] != parts[2][:4]:
        return None
    month = int(parts[2][5:7])
    if month < 1 or month > 12:
        return None
    return value


def _parse_index_lines(lines: list[str]) -> dict[str, str]:
    records: dict[str, str] = {}
    for line in lines:
        if not line.strip():
            continue
        try:
            payload = json.loads(
                line,
                object_pairs_hook=_unique_json_object,
                parse_constant=_reject_json_constant,
            )
        except (json.JSONDecodeError, ValueError):
            raise JournalIntegrityError("日记机器索引无法安全解析。") from None
        if not isinstance(payload, dict):
            raise JournalIntegrityError("日记机器索引记录结构无效。")
        identifier = payload.get("id")
        relative_file = _safe_entry_path(payload.get("file"))
        if (
            not isinstance(identifier, str)
            or JOURNAL_ID_RE.fullmatch(identifier) is None
            or relative_file is None
            or identifier in records
        ):
            raise JournalIntegrityError("日记机器索引的稳定标识或来源路径无效。")
        records[identifier] = relative_file
    return records


def _load_index(index_path: Path) -> tuple[dict[str, str], bool]:
    if index_path.is_symlink() or (index_path.exists() and not index_path.is_file()):
        raise JournalIntegrityError("日记机器索引不是安全的普通文件。")
    if not index_path.exists():
        return {}, False
    try:
        lines = index_path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        raise JournalIntegrityError("日记机器索引无法安全读取。") from None
    return _parse_index_lines(lines), True


def _source_markers(content: str, relative: str) -> dict[str, str]:
    marker_lines = list(MARKER_LINE_RE.finditer(content))
    valid_markers = list(MARKER_RE.finditer(content))
    if len(marker_lines) != len(valid_markers):
        raise JournalIntegrityError("日记原文中存在格式无效的稳定标识。")
    result: dict[str, str] = {}
    for match in valid_markers:
        identifier = match.group(1)
        if identifier in result:
            raise JournalIntegrityError("日记原文中存在重复的稳定标识。")
        result[identifier] = relative
    return result


def _scan_sources(journal_root: Path) -> tuple[dict[str, str], int]:
    entries_root = journal_root / "entries"
    if entries_root.is_symlink() or (
        entries_root.exists() and not entries_root.is_dir()
    ):
        raise JournalIntegrityError("日记原文目录不是安全的项目目录。")
    if not entries_root.exists():
        return {}, 0

    markers: dict[str, str] = {}
    source_files = 0
    def fail_walk(_: OSError) -> None:
        raise JournalIntegrityError("日记原文目录无法安全遍历。")

    for current, directory_names, file_names in os.walk(
        entries_root,
        topdown=True,
        onerror=fail_walk,
        followlinks=False,
    ):
        directory_names.sort()
        current_path = Path(current)
        for directory_name in list(directory_names):
            directory_path = current_path / directory_name
            if directory_path.is_symlink():
                raise JournalIntegrityError("日记原文目录中存在不可移植的符号链接。")
        for file_name in sorted(file_names):
            path = current_path / file_name
            if path.is_symlink() or not path.is_file():
                raise JournalIntegrityError("日记原文目录中存在非普通文件。")
            relative = path.relative_to(journal_root).as_posix()
            if _safe_entry_path(relative) is None:
                raise JournalIntegrityError("日记原文目录中存在不符合约定的文件路径。")
            try:
                content = path.read_text(encoding="utf-8")
            except (OSError, UnicodeError):
                raise JournalIntegrityError("日记原文文件无法安全读取。") from None
            source_files += 1
            for identifier, marker_path in _source_markers(content, relative).items():
                if identifier in markers:
                    raise JournalIntegrityError("日记原文中存在重复的稳定标识。")
                markers[identifier] = marker_path
    return markers, source_files


def _graph_report(
    indexed: dict[str, str],
    sourced: dict[str, str],
    *,
    index_present: bool,
    source_files: int,
) -> dict[str, Any]:
    index_ids = set(indexed)
    source_ids = set(sourced)
    orphan_sources = source_ids - index_ids
    missing_sources = index_ids - source_ids
    wrong_paths = {
        identifier
        for identifier in index_ids & source_ids
        if indexed[identifier] != sourced[identifier]
    }
    if orphan_sources or missing_sources or wrong_paths:
        raise JournalIntegrityError(
            "日记机器索引与月度原文的双向对应关系不完整。"
        )

    return {
        "valid": True,
        "index_present": index_present,
        "indexed_entries": len(indexed),
        "source_entries": len(sourced),
        "source_files": source_files,
    }


def inspect_journal_graph(journal_root: Path = DEFAULT_JOURNAL_ROOT) -> dict[str, Any]:
    """返回不含生活内容的双向完整性摘要；结构错误时 fail closed。"""

    if journal_root.is_symlink() or not journal_root.is_dir():
        raise JournalIntegrityError("日记根目录缺失或不是安全的项目目录。")
    indexed, index_present = _load_index(journal_root / "index.jsonl")
    sourced, source_files = _scan_sources(journal_root)

    return _graph_report(
        indexed,
        sourced,
        index_present=index_present,
        source_files=source_files,
    )


def inspect_journal_snapshot(members: Mapping[str, bytes]) -> dict[str, Any]:
    """核对备份的精确内存字节，不把日记原文落到临时目录。"""

    index_key = "journal/index.jsonl"
    index_present = index_key in members
    try:
        indexed = (
            _parse_index_lines(members[index_key].decode("utf-8").splitlines())
            if index_present
            else {}
        )
    except (UnicodeError, JournalIntegrityError):
        raise JournalIntegrityError("备份中的日记机器索引无法安全读取。") from None

    sourced: dict[str, str] = {}
    source_files = 0
    for archive_relative in sorted(members):
        if not archive_relative.startswith("journal/entries/"):
            continue
        relative = archive_relative.removeprefix("journal/")
        if _safe_entry_path(relative) is None:
            raise JournalIntegrityError("备份中的日记原文路径无效。")
        try:
            content = members[archive_relative].decode("utf-8")
        except UnicodeError:
            raise JournalIntegrityError("备份中的日记原文无法安全读取。") from None
        source_files += 1
        for identifier, marker_path in _source_markers(content, relative).items():
            if identifier in sourced:
                raise JournalIntegrityError("备份中的日记原文存在重复稳定标识。")
            sourced[identifier] = marker_path
    return _graph_report(
        indexed,
        sourced,
        index_present=index_present,
        source_files=source_files,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="只读核对日记索引与原文完整性")
    parser.add_argument(
        "--root",
        type=Path,
        default=DEFAULT_JOURNAL_ROOT,
        help="journal/ 目录；默认使用当前项目",
    )
    parser.add_argument("--json", action="store_true", help="输出机器可读摘要")
    args = parser.parse_args(argv)
    try:
        report = inspect_journal_graph(args.root)
    except JournalIntegrityError as exc:
        if args.json:
            print(
                json.dumps(
                    {"valid": False, "error": str(exc)},
                    ensure_ascii=False,
                    sort_keys=True,
                )
            )
        else:
            print(f"FAIL: {exc}")
        return 2
    if args.json:
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    else:
        print(
            "PASS: 日记索引与原文双向对应完整"
            f"（{report['indexed_entries']} 条，{report['source_files']} 个原文文件）。"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
