"""从 iCloud 日记真相源读取一篇日记的当前有效原文与索引记录（只读）。

worker 在发送前与 amend 前都用它重新读取来源，核对 entry 仍为 active 且来源
指纹一致。这里不写文件、不联网；原文块的解析复用与月度 Markdown 相同的边界。
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .preview import source_fingerprint
from .schema import EnrichmentValidationError

_RAW_HEADING = "### 用户原话"
_NEXT_HEADING = "### 助手整理"


class SourceUnavailable(EnrichmentValidationError):
    """来源文件缺失、损坏或无法安全读取。"""

    def __init__(self, message: str):
        super().__init__(message, code="SOURCE_INVALID")


class SourceChanged(EnrichmentValidationError):
    """来源已 amend/withdraw/purge 或与预期指纹漂移。"""

    def __init__(self, message: str):
        super().__init__(message, code="SOURCE_CHANGED")


def _load_active_record(journal_root: Path, journal_id: str) -> dict[str, Any]:
    index_path = journal_root / "index.jsonl"
    try:
        text = index_path.read_text(encoding="utf-8")
    except (FileNotFoundError, NotADirectoryError) as error:
        raise SourceUnavailable("日记索引不存在") from error
    except OSError as error:
        raise SourceUnavailable("日记索引无法读取") from error
    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as error:
            raise SourceUnavailable("日记索引损坏") from error
        if isinstance(record, dict) and record.get("id") == journal_id:
            if record.get("status") != "active":
                raise SourceChanged("日记不再是 active 状态")
            return record
    raise SourceChanged("找不到目标日记（可能已删除）")


def _safe_entry_path(journal_root: Path, record: dict[str, Any]) -> Path:
    relative = record.get("file")
    if not isinstance(relative, str) or not relative:
        raise SourceUnavailable("日记来源路径缺失")
    relative_path = Path(relative)
    if (
        relative_path.is_absolute()
        or ".." in relative_path.parts
        or len(relative_path.parts) < 2
        or relative_path.parts[0] != "entries"
        or relative_path.suffix.lower() != ".md"
    ):
        raise SourceUnavailable("日记来源路径不安全")
    entry_path = (journal_root / relative_path).resolve()
    entries_root = (journal_root / "entries").resolve()
    if entries_root not in entry_path.parents:
        raise SourceUnavailable("日记来源路径越界")
    return entry_path


def _extract_raw(entry_path: Path, journal_id: str) -> str:
    if entry_path.is_symlink() or not entry_path.exists():
        raise SourceUnavailable("日记原文文件不存在")
    content = entry_path.read_text(encoding="utf-8")
    marker = f"<!-- journal-id: {journal_id} -->"
    matches = list(re.finditer(rf"(?m)^{re.escape(marker)}[ \t]*$", content))
    if len(matches) != 1:
        raise SourceUnavailable("日记原文标记数量异常")
    marker_pos = matches[0].start()
    raw_heading = content.find(f"\n{_RAW_HEADING}", marker_pos)
    if raw_heading < 0:
        raise SourceUnavailable("日记缺少原文段落")
    body_start = content.find("\n", raw_heading + 1)
    if body_start < 0:
        raise SourceUnavailable("日记原文段落损坏")
    next_heading = content.find(f"\n{_NEXT_HEADING}", body_start)
    block = content[body_start : next_heading if next_heading >= 0 else len(content)]
    lines: list[str] = []
    for line in block.splitlines():
        stripped = line.rstrip("\r")
        if stripped.startswith("> "):
            lines.append(stripped[2:])
        elif stripped == ">":
            lines.append("")
    raw = "\n".join(lines).strip("\n")
    if not raw.strip():
        raise SourceUnavailable("日记原文为空")
    return raw


def read_source(journal_root: Path, journal_id: str) -> dict[str, Any]:
    """返回 ``{"record", "raw", "fingerprint"}``；只读且不联网。"""

    record = _load_active_record(journal_root, journal_id)
    entry_path = _safe_entry_path(journal_root, record)
    raw = _extract_raw(entry_path, journal_id)
    return {"record": record, "raw": raw, "fingerprint": source_fingerprint(record)}


def assert_fingerprint(journal_root: Path, journal_id: str, expected: str) -> dict[str, Any]:
    """重新读取来源并核对指纹；漂移抛出 SourceChanged。返回最新来源。"""

    source = read_source(journal_root, journal_id)
    if source["fingerprint"] != expected:
        raise SourceChanged("来源指纹已变化，拒绝继续")
    return source
