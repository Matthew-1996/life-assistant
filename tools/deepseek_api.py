#!/usr/bin/env python3
"""DeepSeek OpenAI-compatible API adapter with no third-party dependencies.

The adapter never reads project records on its own. Only JSON explicitly passed
through stdin is sent to DeepSeek. API keys come from the environment or the
macOS Keychain and are never accepted as command-line arguments.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import urllib.response
from dataclasses import dataclass
from typing import Any, Iterator, Mapping


DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-v4-flash"
DEFAULT_TIMEOUT_SECONDS = 120.0
KEYCHAIN_SERVICE = "com.codex.life-assistant.deepseek-api"
KEYCHAIN_ACCOUNT = "deepseek-api"
CREDENTIAL_ENV = "DEEPSEEK_API_KEY"
MAX_RESPONSE_BYTES = 32 * 1024 * 1024
USER_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,512}")
MODEL_PATTERN = re.compile(r"[A-Za-z0-9._-]{1,128}")
ALLOWED_REQUEST_FIELDS = {
    "logprobs",
    "max_tokens",
    "messages",
    "model",
    "reasoning_effort",
    "response_format",
    "stop",
    "stream",
    "stream_options",
    "temperature",
    "thinking",
    "tool_choice",
    "tools",
    "top_logprobs",
    "top_p",
    "user_id",
}


class DeepSeekError(RuntimeError):
    """Safe, structured error that never includes request bodies or API keys."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "deepseek_error",
        status: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status = status

    def as_dict(self) -> dict[str, Any]:
        value: dict[str, Any] = {"code": self.code, "message": str(self)}
        if self.status is not None:
            value["status"] = self.status
        return {"error": value}


class DeepSeekConfigError(DeepSeekError):
    def __init__(self, message: str) -> None:
        super().__init__(message, code="configuration_error")


@dataclass(frozen=True)
class DeepSeekConfig:
    credential: str
    base_url: str = DEFAULT_BASE_URL
    default_model: str = DEFAULT_MODEL
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS


def _normalize_base_url(value: str, *, allow_insecure_http: bool = False) -> str:
    candidate = value.strip().rstrip("/")
    parsed = urllib.parse.urlparse(candidate)
    if not parsed.netloc or parsed.query or parsed.fragment:
        raise DeepSeekConfigError("DEEPSEEK_BASE_URL 不是有效的服务地址")
    allowed_schemes = {"https"}
    if allow_insecure_http:
        allowed_schemes.add("http")
    if parsed.scheme not in allowed_schemes:
        raise DeepSeekConfigError("DeepSeek API 默认只允许 HTTPS 地址")
    return candidate


def _keychain_api_key() -> str | None:
    if platform.system() != "Darwin":
        return None
    result = subprocess.run(
        [
            "security",
            "find-generic-password",
            "-a",
            KEYCHAIN_ACCOUNT,
            "-s",
            KEYCHAIN_SERVICE,
            "-w",
        ],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    if result.returncode != 0:
        return None
    key = result.stdout.strip()
    return key or None


def load_credential(environ: Mapping[str, str] | None = None) -> str:
    env = os.environ if environ is None else environ
    key = env.get(CREDENTIAL_ENV, "").strip()
    if key:
        return key
    key = _keychain_api_key()
    if key:
        return key
    raise DeepSeekConfigError(
        "未找到 DeepSeek API Key；Mac 可运行 `python3 tools/deepseek_api.py configure`，"
        "其他环境请设置 DEEPSEEK_API_KEY"
    )


def config_from_env(
    environ: Mapping[str, str] | None = None,
    *,
    allow_insecure_http: bool = False,
) -> DeepSeekConfig:
    env = os.environ if environ is None else environ
    model = env.get("DEEPSEEK_MODEL", DEFAULT_MODEL).strip()
    if not MODEL_PATTERN.fullmatch(model):
        raise DeepSeekConfigError("DEEPSEEK_MODEL 格式无效")
    raw_timeout = env.get("DEEPSEEK_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS))
    try:
        timeout = float(raw_timeout)
    except ValueError as error:
        raise DeepSeekConfigError("DEEPSEEK_TIMEOUT_SECONDS 必须是数字") from error
    if not 1 <= timeout <= 1800:
        raise DeepSeekConfigError("DEEPSEEK_TIMEOUT_SECONDS 必须在 1–1800 秒之间")
    return DeepSeekConfig(
        credential=load_credential(env),
        base_url=_normalize_base_url(
            env.get("DEEPSEEK_BASE_URL", DEFAULT_BASE_URL),
            allow_insecure_http=allow_insecure_http,
        ),
        default_model=model,
        timeout_seconds=timeout,
    )


def configure_macos_keychain() -> None:
    """Ask macOS Keychain to prompt for the key without exposing it to Python."""

    if platform.system() != "Darwin":
        raise DeepSeekConfigError("钥匙串配置只适用于 macOS；请改用 DEEPSEEK_API_KEY")
    result = subprocess.run(
        [
            "security",
            "add-generic-password",
            "-U",
            "-a",
            KEYCHAIN_ACCOUNT,
            "-s",
            KEYCHAIN_SERVICE,
            "-l",
            "DeepSeek API Key",
            "-w",
        ],
        check=False,
    )
    if result.returncode != 0:
        raise DeepSeekConfigError("未能把 DeepSeek API Key 保存到 macOS 钥匙串")


class DeepSeekClient:
    def __init__(
        self,
        config: DeepSeekConfig,
        *,
        allow_insecure_http: bool = False,
    ) -> None:
        if not config.credential.strip():
            raise DeepSeekConfigError("DeepSeek API Key 不能为空")
        self.credential = config.credential.strip()
        self.base_url = _normalize_base_url(
            config.base_url,
            allow_insecure_http=allow_insecure_http,
        )
        self.default_model = config.default_model
        self.timeout_seconds = config.timeout_seconds

    def _request(self, path: str, payload: dict[str, Any] | None = None) -> urllib.response.addinfourl:
        url = f"{self.base_url}/{path.lstrip('/')}"
        data = None
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.credential}",
            "User-Agent": "life-assistant-deepseek-adapter/1",
        }
        method = "GET"
        if payload is not None:
            method = "POST"
            data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            return urllib.request.urlopen(request, timeout=self.timeout_seconds)
        except urllib.error.HTTPError as error:
            raise self._http_error(error) from None
        except urllib.error.URLError as error:
            reason = getattr(error, "reason", None)
            safe_reason = str(reason)[:240] if reason else "连接失败"
            raise DeepSeekError(
                f"无法连接 DeepSeek API：{safe_reason}",
                code="network_error",
            ) from None
        except TimeoutError:
            raise DeepSeekError("DeepSeek API 请求超时", code="timeout") from None

    def _http_error(self, error: urllib.error.HTTPError) -> DeepSeekError:
        body = error.read(MAX_RESPONSE_BYTES + 1)
        message = error.reason or "DeepSeek API 请求失败"
        code = "http_error"
        if len(body) <= MAX_RESPONSE_BYTES:
            try:
                value = json.loads(body.decode("utf-8"))
                detail = value.get("error") if isinstance(value, dict) else None
                if isinstance(detail, dict):
                    if isinstance(detail.get("message"), str):
                        message = detail["message"]
                    if isinstance(detail.get("code"), str):
                        code = detail["code"]
            except (UnicodeDecodeError, json.JSONDecodeError):
                pass
        safe_message = str(message).replace(self.credential, "[REDACTED]")[:500]
        return DeepSeekError(safe_message, code=code, status=error.code)

    @staticmethod
    def _read_json(response: urllib.response.addinfourl) -> dict[str, Any]:
        body = response.read(MAX_RESPONSE_BYTES + 1)
        if len(body) > MAX_RESPONSE_BYTES:
            raise DeepSeekError("DeepSeek API 响应过大", code="response_too_large")
        try:
            value = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise DeepSeekError("DeepSeek API 返回了无效 JSON", code="invalid_response") from error
        if not isinstance(value, dict):
            raise DeepSeekError("DeepSeek API 响应结构无效", code="invalid_response")
        return value

    def list_models(self) -> list[str]:
        with self._request("models") as response:
            value = self._read_json(response)
        data = value.get("data")
        if not isinstance(data, list):
            raise DeepSeekError("模型列表响应结构无效", code="invalid_response")
        models = [item.get("id") for item in data if isinstance(item, dict)]
        return [model for model in models if isinstance(model, str)]

    def _chat_payload(self, value: dict[str, Any], *, stream: bool) -> dict[str, Any]:
        unknown = set(value) - ALLOWED_REQUEST_FIELDS
        if unknown:
            raise DeepSeekConfigError(f"不支持的请求字段：{', '.join(sorted(unknown))}")
        payload = dict(value)
        messages = payload.get("messages")
        if not isinstance(messages, list) or not messages:
            raise DeepSeekConfigError("messages 必须是非空数组")
        for index, message in enumerate(messages):
            if not isinstance(message, dict):
                raise DeepSeekConfigError(f"messages[{index}] 必须是对象")
            role = message.get("role")
            if role not in {"system", "user", "assistant", "tool"}:
                raise DeepSeekConfigError(f"messages[{index}].role 无效")
            content = message.get("content")
            if role == "assistant":
                if content is not None and not isinstance(content, str):
                    raise DeepSeekConfigError(f"messages[{index}].content 必须是字符串或 null")
            elif not isinstance(content, str):
                raise DeepSeekConfigError(f"messages[{index}].content 必须是字符串")
            if role == "tool" and not isinstance(message.get("tool_call_id"), str):
                raise DeepSeekConfigError(f"messages[{index}] 缺少 tool_call_id")
        model = payload.get("model", self.default_model)
        if not isinstance(model, str) or not MODEL_PATTERN.fullmatch(model):
            raise DeepSeekConfigError("model 格式无效")
        payload["model"] = model
        thinking = payload.get("thinking")
        if thinking is not None:
            if not isinstance(thinking, dict) or thinking.get("type") not in {"enabled", "disabled"}:
                raise DeepSeekConfigError("thinking.type 只能是 enabled 或 disabled")
        effort = payload.get("reasoning_effort")
        if effort is not None and effort not in {"high", "max"}:
            raise DeepSeekConfigError("reasoning_effort 只能是 high 或 max")
        user_id = payload.get("user_id")
        if user_id is not None and (
            not isinstance(user_id, str) or not USER_ID_PATTERN.fullmatch(user_id)
        ):
            raise DeepSeekConfigError("user_id 只能包含字母、数字、连字符和下划线，且不得含个人信息")
        max_tokens = payload.get("max_tokens")
        if max_tokens is not None and (
            isinstance(max_tokens, bool) or not isinstance(max_tokens, int) or max_tokens <= 0
        ):
            raise DeepSeekConfigError("max_tokens 必须是正整数")
        temperature = payload.get("temperature")
        if temperature is not None and (
            isinstance(temperature, bool)
            or not isinstance(temperature, (int, float))
            or not 0 <= temperature <= 2
        ):
            raise DeepSeekConfigError("temperature 必须在 0–2 之间")
        top_p = payload.get("top_p")
        if top_p is not None and (
            isinstance(top_p, bool)
            or not isinstance(top_p, (int, float))
            or not 0 <= top_p <= 1
        ):
            raise DeepSeekConfigError("top_p 必须在 0–1 之间")
        payload["stream"] = stream
        if stream:
            options = payload.get("stream_options")
            if options is None:
                payload["stream_options"] = {"include_usage": True}
            elif not isinstance(options, dict):
                raise DeepSeekConfigError("stream_options 必须是对象")
        else:
            payload.pop("stream_options", None)
        return payload

    def chat(self, value: dict[str, Any]) -> dict[str, Any]:
        payload = self._chat_payload(value, stream=False)
        with self._request("chat/completions", payload) as response:
            return self._read_json(response)

    def stream_chat(self, value: dict[str, Any]) -> Iterator[dict[str, Any]]:
        payload = self._chat_payload(value, stream=True)
        response = self._request("chat/completions", payload)
        try:
            for raw_line in response:
                line = raw_line.decode("utf-8").strip()
                if not line or line.startswith(":"):
                    continue
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    return
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError as error:
                    raise DeepSeekError("DeepSeek 流式响应包含无效 JSON", code="invalid_response") from error
                if not isinstance(chunk, dict):
                    raise DeepSeekError("DeepSeek 流式响应结构无效", code="invalid_response")
                yield chunk
        finally:
            response.close()


def compact_chat_response(value: dict[str, Any]) -> dict[str, Any]:
    choices = value.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise DeepSeekError("对话响应缺少 choices", code="invalid_response")
    choice = choices[0]
    message = choice.get("message")
    if not isinstance(message, dict):
        raise DeepSeekError("对话响应缺少 message", code="invalid_response")
    result: dict[str, Any] = {
        "content": message.get("content"),
        "finish_reason": choice.get("finish_reason"),
        "model": value.get("model"),
        "usage": value.get("usage"),
    }
    if "tool_calls" in message:
        result["tool_calls"] = message["tool_calls"]
    return result


def _read_stdin_json() -> dict[str, Any]:
    try:
        value = json.load(sys.stdin)
    except json.JSONDecodeError as error:
        raise DeepSeekConfigError("stdin 不是有效 JSON") from error
    if not isinstance(value, dict):
        raise DeepSeekConfigError("stdin 顶层必须是对象")
    return value


def _exit_code(error: DeepSeekError) -> int:
    if isinstance(error, DeepSeekConfigError):
        return 2
    if error.status in {401, 402}:
        return 3
    if error.status in {429, 500, 503}:
        return 4
    return 5


def main() -> int:
    parser = argparse.ArgumentParser(description="安全调用 DeepSeek OpenAI-compatible API")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("configure", help="在 macOS 钥匙串中保存 API Key")
    subparsers.add_parser("check", help="验证凭据并列出当前可用模型")
    subparsers.add_parser("models", help="只输出当前可用模型 ID")
    chat_parser = subparsers.add_parser("chat", help="从 stdin 读取 Chat Completions JSON")
    chat_parser.add_argument("--model", help="覆盖 DEEPSEEK_MODEL")
    chat_parser.add_argument("--thinking", choices=("enabled", "disabled"))
    chat_parser.add_argument("--reasoning-effort", choices=("high", "max"))
    chat_parser.add_argument("--stream", action="store_true")
    chat_parser.add_argument("--raw", action="store_true", help="输出完整响应或原始 SSE JSON 行")
    args = parser.parse_args()

    try:
        if args.command == "configure":
            configure_macos_keychain()
            print(json.dumps({"configured": True, "storage": "macos_keychain"}, ensure_ascii=False))
            return 0

        config = config_from_env()
        client = DeepSeekClient(config)
        if args.command in {"check", "models"}:
            models = client.list_models()
            if args.command == "models":
                print(json.dumps({"models": models}, ensure_ascii=False))
            else:
                print(json.dumps({
                    "ok": True,
                    "base_url": client.base_url,
                    "default_model": client.default_model,
                    "default_model_available": client.default_model in models,
                    "models": models,
                }, ensure_ascii=False))
            return 0

        value = _read_stdin_json()
        if args.model:
            value["model"] = args.model
        if args.thinking:
            value["thinking"] = {"type": args.thinking}
        if args.reasoning_effort:
            value["reasoning_effort"] = args.reasoning_effort
        if args.stream:
            for chunk in client.stream_chat(value):
                if args.raw:
                    print(json.dumps(chunk, ensure_ascii=False, separators=(",", ":")))
                    continue
                choices = chunk.get("choices")
                if isinstance(choices, list) and choices and isinstance(choices[0], dict):
                    delta = choices[0].get("delta")
                    if isinstance(delta, dict) and isinstance(delta.get("content"), str):
                        print(delta["content"], end="", flush=True)
            if not args.raw:
                print()
            return 0

        response = client.chat(value)
        output = response if args.raw else compact_chat_response(response)
        print(json.dumps(output, ensure_ascii=False))
        return 0
    except DeepSeekError as error:
        print(json.dumps(error.as_dict(), ensure_ascii=False), file=sys.stderr)
        return _exit_code(error)


if __name__ == "__main__":
    raise SystemExit(main())
