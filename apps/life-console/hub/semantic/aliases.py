"""读取 iCloud 私有人物别名配置（不进 Git、不含 API Key）。

别名表是显式的 1:1 映射：``{"别名": "规范名"}``。通用代码、Prompt、fixture 与
Git 中不出现真实人物姓名；本模块只从数据根下的 ``people-aliases.json`` 读取
用户自己维护的映射，缺失或损坏时安全地返回空映射（视为“无别名”，绝不猜测或
合并不同人物）。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ALIAS_FILENAME = "people-aliases.json"
MAX_ENTRIES = 500
MAX_NAME_LENGTH = 120


def load_aliases(journal_root: Path) -> dict[str, str]:
    """加载别名映射；文件缺失或结构异常时返回空映射（fail safe）。

    只接受顶层 JSON 对象、键值均为非空短字符串；任何越界都被忽略而不是抛出，
    因为别名缺失不应阻塞本地记录，也不应把不确定的合并强加给用户。
    """

    path = journal_root / ALIAS_FILENAME
    try:
        raw = path.read_text(encoding="utf-8")
    except (FileNotFoundError, NotADirectoryError):
        return {}
    except OSError:
        return {}
    try:
        parsed: Any = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    mapping: dict[str, str] = {}
    for alias, canonical in parsed.items():
        if not isinstance(alias, str) or not isinstance(canonical, str):
            continue
        alias_clean = alias.strip()
        canonical_clean = canonical.strip()
        if not alias_clean or not canonical_clean:
            continue
        if len(alias_clean) > MAX_NAME_LENGTH or len(canonical_clean) > MAX_NAME_LENGTH:
            continue
        mapping[alias_clean] = canonical_clean
        if len(mapping) >= MAX_ENTRIES:
            break
    return mapping
