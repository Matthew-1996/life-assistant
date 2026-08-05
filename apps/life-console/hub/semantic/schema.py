"""模型输出的本机 Schema 校验与合并规则（离线、纯逻辑）。

DeepSeek 的 JSON 模式只辅助格式；真正的字段白名单、数组数量、文本长度和
合并优先级都在这里用本机校验强制。任何越界都抛出
``EnrichmentValidationError``，由后续 worker 归为通用失败码，不覆盖本地记录。
"""

from __future__ import annotations

import json
import re
from typing import Any, Iterable, Mapping, Sequence

# 模型只允许生成这八个候选字段；其余一律拒绝（含 raw、entry_id、
# 事件日期/时间、privacy、planning_clues、inferences 及任何诊断/建议字段）。
ENRICHMENT_LINE_FIELDS: dict[str, int] = {"title": 120, "summary": 240}
ENRICHMENT_LIST_FIELDS: tuple[str, ...] = (
    "facts",
    "feelings",
    "people",
    "places",
    "themes",
    "tags",
)
ENRICHMENT_FIELDS: tuple[str, ...] = (*ENRICHMENT_LINE_FIELDS, *ENRICHMENT_LIST_FIELDS)
LIST_MAX_ITEMS = 12
LIST_ITEM_MAX = 180
# 本功能里始终为空；不接受模型生成，也不接受用户改写。
FORCED_EMPTY_FIELDS: tuple[str, ...] = ("planning_clues", "inferences")

_WHITESPACE = re.compile(r"\s+")
# 归一化去重键：忽略首尾常见标点与全部空白、大小写，
# 使“开心。”与“开心”“ 开心 ”视为同一项，避免近重复堆叠。
_EDGE_PUNCTUATION = " \t\r\n。．.，,、；;：:！!？?…·「」『』\"'（）()《》〈〉"


def _dedup_key(value: str) -> str:
    collapsed = _WHITESPACE.sub("", value)
    return collapsed.strip(_EDGE_PUNCTUATION).casefold()


class EnrichmentValidationError(ValueError):
    """模型输出或合并结果不满足本机契约。

    ``code`` 供上层映射为通用失败码；默认 ``MODEL_OUTPUT_INVALID``。错误信息
    只描述结构问题，绝不回显日记原文或模型完整响应。
    """

    def __init__(self, message: str, *, code: str = "MODEL_OUTPUT_INVALID"):
        super().__init__(message)
        self.code = code


def _single_line(value: Any, field: str, maximum: int) -> str:
    if not isinstance(value, str):
        raise EnrichmentValidationError(f"字段 {field} 必须是字符串")
    collapsed = _WHITESPACE.sub(" ", value).strip()
    if len(collapsed) > maximum:
        raise EnrichmentValidationError(f"字段 {field} 超过 {maximum} 字符上限")
    return collapsed


def _string_list(value: Any, field: str) -> list[str]:
    if not isinstance(value, list):
        raise EnrichmentValidationError(f"字段 {field} 必须是数组")
    if len(value) > LIST_MAX_ITEMS:
        raise EnrichmentValidationError(
            f"字段 {field} 最多 {LIST_MAX_ITEMS} 项"
        )
    cleaned: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise EnrichmentValidationError(f"字段 {field} 的元素必须是字符串")
        normalized = _WHITESPACE.sub(" ", item).strip()
        if not normalized:
            continue
        if len(normalized) > LIST_ITEM_MAX:
            raise EnrichmentValidationError(
                f"字段 {field} 的元素超过 {LIST_ITEM_MAX} 字符上限"
            )
        if normalized not in cleaned:
            cleaned.append(normalized)
    return cleaned


def parse_model_output(content: Any) -> dict[str, Any]:
    """严格解析并校验模型返回的单个 JSON 对象。

    只接受八个白名单字段的子集；缺失字段视为未提供。空内容、非 JSON、
    多余字段、错误类型、超长文本或超量数组都抛出 ``EnrichmentValidationError``。
    """

    if not isinstance(content, str):
        raise EnrichmentValidationError("模型响应必须是字符串")
    text = content.strip()
    if not text:
        # DeepSeek 官方文档说明 JSON 模式可能偶发空内容；这里视为可重试失败，
        # 绝不当作对索引的空覆盖。
        raise EnrichmentValidationError("模型返回空内容")
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as error:
        raise EnrichmentValidationError("模型响应不是有效 JSON") from error
    if not isinstance(parsed, dict):
        raise EnrichmentValidationError("模型响应顶层必须是 JSON 对象")
    unexpected = sorted(set(parsed).difference(ENRICHMENT_FIELDS))
    if unexpected:
        raise EnrichmentValidationError(
            f"模型返回了不允许的字段：{', '.join(unexpected)}"
        )

    candidate: dict[str, Any] = {}
    for field, maximum in ENRICHMENT_LINE_FIELDS.items():
        if field in parsed:
            normalized = _single_line(parsed[field], field, maximum)
            if normalized:
                candidate[field] = normalized
    for field in ENRICHMENT_LIST_FIELDS:
        if field in parsed:
            candidate[field] = _string_list(parsed[field], field)
    return candidate


def _canonicalize_people(
    people: Sequence[str], aliases: Mapping[str, str] | None
) -> list[str]:
    """按显式 1:1 别名表把别名归一为规范名并去重。

    别名表只合并明确列出的别名；不同人物不会被误合并。
    """

    mapping = aliases or {}
    result: list[str] = []
    for person in people:
        canonical = mapping.get(person, person)
        if canonical not in result:
            result.append(canonical)
    return result


def merge_enrichment(
    existing: Mapping[str, Any],
    candidate: Mapping[str, Any],
    *,
    user_locked_fields: Iterable[str] = (),
    aliases: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """把模型候选与现有轻量索引合并成可传给 ``amend`` 的完整索引。

    - 用户在表单明确填写的字段（``user_locked_fields``）保持现有值，模型既
      不能删除也不能覆盖。
    - 未锁定的标题/摘要：模型有非空值时采用其更自然的版本，否则保留现有值。
    - 未锁定的列表字段：模型只做补充（并集去重），不删除现有条目。
    - 人物按显式别名表归一化，仅合并明确列出的别名。
    - ``planning_clues`` 与 ``inferences`` 恒为空数组。
    - raw、entry_id、日期/时间、privacy 不在本函数范围内，调用方另行保留。
    """

    locked = set(user_locked_fields)
    unknown_locked = sorted(locked.difference(ENRICHMENT_FIELDS))
    if unknown_locked:
        raise EnrichmentValidationError(
            f"用户锁定字段超出白名单：{', '.join(unknown_locked)}",
            code="INVALID_REQUEST",
        )

    merged: dict[str, Any] = {}

    for field, maximum in ENRICHMENT_LINE_FIELDS.items():
        base = _single_line(existing.get(field, ""), field, maximum)
        if field in locked or field not in candidate:
            merged[field] = base
        else:
            merged[field] = candidate.get(field, "") or base

    for field in ENRICHMENT_LIST_FIELDS:
        base_items = _string_list(list(existing.get(field, []) or []), field)
        # 先对已有条目做一次规范化去重，修复历史上遗留的近重复；
        # 保留先出现的写法。
        items: list[str] = []
        seen: set[str] = set()
        for item in base_items:
            key = _dedup_key(item)
            if key and key not in seen:
                items.append(item)
                seen.add(key)
        if field not in locked and field in candidate:
            # 未锁定字段允许模型补充；同样按规范化键去重，只补不覆盖。
            for item in candidate.get(field, []):
                key = _dedup_key(item)
                if key and key not in seen:
                    items.append(item)
                    seen.add(key)
        if field == "people":
            items = _canonicalize_people(items, aliases)
        merged[field] = items[:LIST_MAX_ITEMS]

    if not merged["title"]:
        raise EnrichmentValidationError("合并后标题为空，无法安全写回")

    for field in FORCED_EMPTY_FIELDS:
        merged[field] = []
    return merged
