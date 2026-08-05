"""DeepSeek 语义整理的 HTTPS 客户端（仅生产 allowlist 域名）。

安全边界：
- 只允许 HTTPS ``https://api.deepseek.com``；任何其他 scheme/host 直接拒绝。
- 非流式 JSON 模式（``response_format={"type":"json_object"}``），固定超时。
- 只返回模型输出的 content 字符串；不保存完整响应、请求头或 Key。
- 429/5xx/超时/网络错误/空内容/非预期结构都抛出 ``ProviderError``（可重试），
  由 worker 归为通用失败码并按上限退避重试。

测试通过注入 ``transport`` 使用本地合成响应，绝不真正联网。
"""

from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.request
from typing import Any, Callable, Mapping, Sequence

from .prompt import build_messages

# 生产唯一允许的 endpoint；官方 OpenAI 兼容格式无 /v1 段。
ALLOWED_ENDPOINT = "https://api.deepseek.com/chat/completions"
DEFAULT_TIMEOUT = 30.0
# JSON 模式可能截断，给足输出上限（结构化抽取，无需推理）。
MAX_OUTPUT_TOKENS = 1024

# transport 抽象：接收规范化请求，返回 (status_code, body_dict)。
Transport = Callable[["ProviderRequest"], "ProviderResponse"]


class ProviderError(RuntimeError):
    """与 provider 交互失败；一律视为可重试的通用失败。"""


class ProviderRequest:
    __slots__ = ("url", "model", "messages", "timeout", "max_tokens")

    def __init__(
        self,
        *,
        url: str,
        model: str,
        messages: Sequence[Mapping[str, Any]],
        timeout: float,
        max_tokens: int,
    ):
        self.url = url
        self.model = model
        self.messages = list(messages)
        self.timeout = timeout
        self.max_tokens = max_tokens

    def body(self) -> dict[str, Any]:
        return {
            "model": self.model,
            "messages": self.messages,
            "response_format": {"type": "json_object"},
            "max_tokens": self.max_tokens,
            "stream": False,
            "temperature": 0,
        }


class ProviderResponse:
    __slots__ = ("status", "payload")

    def __init__(self, status: int, payload: Mapping[str, Any]):
        self.status = status
        self.payload = dict(payload)


def _assert_allowed(url: str) -> None:
    if url != ALLOWED_ENDPOINT:
        raise ProviderError("目标 endpoint 不在允许白名单内")


def _https_transport(credential: str) -> Transport:
    context = ssl.create_default_context()

    def send(request: ProviderRequest) -> ProviderResponse:
        _assert_allowed(request.url)
        data = json.dumps(request.body(), ensure_ascii=False).encode("utf-8")
        http_request = urllib.request.Request(
            request.url,
            data=data,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {credential}",
                "Accept": "application/json",
            },
        )
        if http_request.type != "https":
            raise ProviderError("仅允许 HTTPS")
        try:
            with urllib.request.urlopen(
                http_request, timeout=request.timeout, context=context
            ) as response:
                body = response.read().decode("utf-8")
                status = response.status
        except urllib.error.HTTPError as error:
            # 不读取 error body（可能含敏感或冗长内容）；只保留状态。
            raise ProviderError(f"provider 返回状态 {error.code}") from None
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise ProviderError("provider 网络错误或超时") from error
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as error:
            raise ProviderError("provider 响应不是 JSON") from error
        if not isinstance(payload, dict):
            raise ProviderError("provider 响应结构异常")
        return ProviderResponse(status, payload)

    return send


def _extract_content(response: ProviderResponse) -> str:
    if response.status == 429 or response.status >= 500:
        raise ProviderError(f"provider 返回可重试状态 {response.status}")
    if response.status != 200:
        raise ProviderError(f"provider 返回状态 {response.status}")
    choices = response.payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ProviderError("provider 响应缺少 choices")
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(message, dict):
        raise ProviderError("provider 响应缺少 message")
    content = message.get("content")
    if not isinstance(content, str):
        raise ProviderError("provider 响应缺少文本内容")
    return content


def request_enrichment(
    *,
    raw_text: str,
    model: str,
    credential: str | None = None,
    transport: Transport | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    url: str = ALLOWED_ENDPOINT,
) -> str:
    """向 DeepSeek 请求一次非流式 JSON 整理，返回模型 content 字符串。

    生产路径要求 ``credential``（来自 Keychain）；测试路径注入 ``transport`` 且
    不需要凭据。任何异常都是 ``ProviderError``，不泄露凭据或完整响应。
    """

    _assert_allowed(url)
    if transport is None:
        if not credential:
            raise ProviderError("缺少访问凭据，无法访问 provider")
        transport = _https_transport(credential)
    request = ProviderRequest(
        url=url,
        model=model,
        messages=build_messages(raw_text),
        timeout=timeout,
        max_tokens=MAX_OUTPUT_TOKENS,
    )
    response = transport(request)
    return _extract_content(response)
