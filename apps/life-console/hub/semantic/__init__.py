"""按篇主动触发的日记语义整理（本地逻辑层）。

本包只包含离线、可测试的纯逻辑：版本化抽取提示词、模型输出 Schema、
字段白名单与合并规则。它不联网、不读取 macOS Keychain、不启动作业，也
不调用 ``journal_manager.py``；这些属于后续 D2/D3 工作包。

约束（见 outputs/生活助手工作台-融合方案/DeepSeek按篇主动语义整理-产品与技术方案.md）：

- 模型只是候选生成器；它只能补充 ``title``、``summary``、``facts``、
  ``feelings``、``people``、``places``、``themes``、``tags`` 八个字段。
- 用户在表单中明确填写的字段优先，模型不能删除或覆盖。
- ``planning_clues`` 与 ``inferences`` 在本功能中始终保持空数组。
- 通用代码、Prompt、fixture 与 Git 中不出现真实人物姓名；别名映射来自
  iCloud 私有配置（D2 引入），本层只接收调用方传入的规范化映射。
"""

from __future__ import annotations

from . import jobs
from .aliases import load_aliases
from .deepseek_client import (
    ALLOWED_ENDPOINT,
    ProviderError,
    ProviderRequest,
    ProviderResponse,
    request_enrichment,
)
from .keychain import KeyUnavailable, load_api_key
from .preview import (
    ALLOWED_MODELS,
    DEFAULT_MODEL,
    DISCLOSURES,
    MAX_RETRIES,
    PROVIDER,
    build_preview,
    resolve_model,
    source_fingerprint,
)
from .prompt import PROMPT_VERSION, build_messages, system_prompt
from .schema import (
    ENRICHMENT_FIELDS,
    EnrichmentValidationError,
    merge_enrichment,
    parse_model_output,
)
from .source import SourceChanged, SourceUnavailable, assert_fingerprint, read_source
from .worker import SingleConcurrencyWorker, process_once, run_with_retry

__all__ = [
    "PROMPT_VERSION",
    "build_messages",
    "system_prompt",
    "ENRICHMENT_FIELDS",
    "EnrichmentValidationError",
    "merge_enrichment",
    "parse_model_output",
    "ALLOWED_MODELS",
    "DEFAULT_MODEL",
    "DISCLOSURES",
    "MAX_RETRIES",
    "PROVIDER",
    "build_preview",
    "resolve_model",
    "source_fingerprint",
    "jobs",
    "load_aliases",
    "ALLOWED_ENDPOINT",
    "ProviderError",
    "ProviderRequest",
    "ProviderResponse",
    "request_enrichment",
    "KeyUnavailable",
    "load_api_key",
    "SourceChanged",
    "SourceUnavailable",
    "assert_fingerprint",
    "read_source",
    "SingleConcurrencyWorker",
    "process_once",
    "run_with_retry",
]
