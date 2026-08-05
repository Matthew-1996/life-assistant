"""按篇语义整理的离线发送预览构建（不联网）。

预览只根据一篇日记的当前索引快照生成范围说明和一个短时 ``preview_token``，
token 内绑定：journal_id、来源指纹（etag/hash）、provider、model、字段白名单、
提示词版本、授权版本和重试上限。它不读取原文块、不联网、不创建作业。

真正的签名/持久化与来源漂移复核在 Hub 路由与 worker（D2/D3）实现；本模块提供
可独立测试的确定性纯逻辑。
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping, Sequence

from .prompt import PROMPT_VERSION
from .schema import ENRICHMENT_FIELDS, EnrichmentValidationError

PROVIDER = "deepseek"
DEFAULT_MODEL = "deepseek-v4-flash"
# 生产模型必须通过配置白名单选择；模型 ID 会随官方文档变化，不在别处硬编码。
ALLOWED_MODELS: tuple[str, ...] = ("deepseek-v4-flash", "deepseek-v4-pro")
MAX_RETRIES = 2

# 逐条向用户展示本次发送范围；文案通用、不含个人数据。
DISCLOSURES: tuple[str, ...] = (
    "仅发送当前这一篇日记的原文、发生日期与可选时间，以及别名统一所需的最小人物别名表。",
    "不发送其他日记、苹果健康数据、每日/每周/阶段状态、目标、聊天历史、备份或 API Key。",
    "接收方为 DeepSeek API，仅通过 HTTPS 访问 api.deepseek.com。",
    "可写回字段仅限：title、summary、facts、feelings、people、places、themes、tags。",
    "不修改原文、事件日期/时间、隐私级别、目标、状态、回顾或自动化。",
    "这是向第三方服务商传输个人日记，不同于本地 local-only；已发送的数据无法通过本地撤回从服务商侧收回。",
    f"最多重试 {MAX_RETRIES} 次；取消、撤回、来源变化或授权过期时不再发送。",
)


def resolve_model(model: Any) -> str:
    """校验请求的模型是否在允许白名单内，未指定时用默认模型。"""

    if model is None:
        return DEFAULT_MODEL
    if model not in ALLOWED_MODELS:
        raise EnrichmentValidationError(
            "请求的模型不在允许白名单内", code="INVALID_REQUEST"
        )
    return model


def source_fingerprint(record: Mapping[str, Any]) -> str:
    """从一篇 active 日记的机器索引记录派生稳定来源指纹。

    指纹绑定影响整理结果与来源身份的字段（id/日期/时间/原文位置/状态/更正历史/
    可变轻量字段）。任何 amend、withdraw、purge 或并发漂移都会改变它，从而在
    commit 前触发 SOURCE_CHANGED。指纹不含日记原文。
    """

    identity = {
        "id": record.get("id"),
        "date": record.get("date"),
        "time": record.get("time"),
        "time_precision": record.get("time_precision"),
        "status": record.get("status"),
        "file": record.get("file"),
        "amendments": [
            item.get("id")
            for item in record.get("amendments", [])
            if isinstance(item, dict)
        ],
        "fields": {field: record.get(field) for field in ENRICHMENT_FIELDS},
    }
    serialized = json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def build_preview(
    record: Mapping[str, Any],
    *,
    model: Any = None,
    authorization_version: str,
    writable_fields: Sequence[str] = ENRICHMENT_FIELDS,
) -> dict[str, Any]:
    """构造离线预览的载荷主体（不含 token 与过期时间，由 Hub 补全）。

    只接受 active 日记；非 active 直接拒绝，避免对已撤回或已删除的日记生成预览。
    """

    if record.get("status") != "active":
        raise EnrichmentValidationError(
            "只能对 active 日记生成整理预览", code="SOURCE_CHANGED"
        )
    journal_id = record.get("id")
    if not isinstance(journal_id, str) or not journal_id:
        raise EnrichmentValidationError("日记缺少有效 id", code="SOURCE_INVALID")
    resolved_model = resolve_model(model)
    fields = list(writable_fields)
    if not fields or set(fields).difference(ENRICHMENT_FIELDS):
        raise EnrichmentValidationError("可写回字段越界", code="INVALID_REQUEST")
    return {
        "schema_version": 1,
        "journal_id": journal_id,
        "provider": PROVIDER,
        "model": resolved_model,
        "prompt_version": PROMPT_VERSION,
        "authorization_version": authorization_version,
        "max_retries": MAX_RETRIES,
        "writable_fields": fields,
        "source_fingerprint": source_fingerprint(record),
        "disclosures": list(DISCLOSURES),
    }
