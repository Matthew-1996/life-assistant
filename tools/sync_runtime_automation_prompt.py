#!/usr/bin/env python3
"""把项目规范提示词原子同步到一个已存在的本机自动化配置。

只允许替换顶层 prompt 行；名称、状态、调度、截止日和目标任务保持逐字节不变。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path


PROMPT_LINE = re.compile(r"^prompt = .*?$", re.MULTILINE)
PROTECTED_KEYS = ("id", "kind", "name", "status", "rrule", "target_thread_id")


def _regular_file(path: Path) -> bytes:
    stat = path.lstat()
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("同步源和目标都必须是普通文件")
    return path.read_bytes()


def _scalar_line(text: str, key: str) -> str | None:
    match = re.search(rf"^{re.escape(key)} = .*?$", text, re.MULTILINE)
    return match.group(0) if match else None


def sync(runtime_path: Path, prompt_path: Path) -> dict[str, object]:
    runtime_bytes = _regular_file(runtime_path)
    prompt_bytes = _regular_file(prompt_path)
    runtime_text = runtime_bytes.decode("utf-8")
    prompt_text = prompt_bytes.decode("utf-8").rstrip("\r\n")
    matches = list(PROMPT_LINE.finditer(runtime_text))
    if len(matches) != 1:
        raise RuntimeError("运行时配置必须恰好包含一个顶层 prompt")
    protected_before = {key: _scalar_line(runtime_text, key) for key in PROTECTED_KEYS}
    if any(value is None for value in protected_before.values()):
        raise RuntimeError("运行时配置缺少受保护字段")

    replacement = f"prompt = {json.dumps(prompt_text, ensure_ascii=False)}"
    updated_text = PROMPT_LINE.sub(lambda _match: replacement, runtime_text, count=1)
    protected_after = {key: _scalar_line(updated_text, key) for key in PROTECTED_KEYS}
    if protected_after != protected_before:
        raise RuntimeError("受保护的自动化字段发生变化，已停止同步")
    if updated_text == runtime_text:
        action = "unchanged"
    else:
        descriptor, temp_name = tempfile.mkstemp(
            prefix=f".{runtime_path.name}.", suffix=".tmp", dir=runtime_path.parent
        )
        temp_path = Path(temp_name)
        try:
            os.fchmod(descriptor, runtime_path.stat().st_mode & 0o777)
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as handle:
                handle.write(updated_text)
                handle.flush()
                os.fsync(handle.fileno())
            if runtime_path.read_bytes() != runtime_bytes:
                raise RuntimeError("运行时配置在同步期间发生变化，已停止覆盖")
            os.replace(temp_path, runtime_path)
        finally:
            try:
                temp_path.unlink()
            except FileNotFoundError:
                pass
        action = "updated"
    return {
        "action": action,
        "prompt_sha256": hashlib.sha256(prompt_bytes).hexdigest(),
        "protected_fields_unchanged": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="同步当前设备的生活回访规范提示词")
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--prompt", type=Path, required=True)
    args = parser.parse_args()
    result = sync(args.runtime.resolve(), args.prompt.resolve())
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
