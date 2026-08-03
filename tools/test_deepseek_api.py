import json
import platform
import subprocess
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

from tools.deepseek_api import (
    CREDENTIAL_ENV,
    DEFAULT_MODEL,
    DeepSeekClient,
    DeepSeekConfig,
    DeepSeekConfigError,
    DeepSeekError,
    compact_chat_response,
    configure_macos_keychain,
    config_from_env,
)


class MockDeepSeekHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, _format, *args):
        return

    def _json_response(self, status, value):
        body = json.dumps(value).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.server.requests.append({
            "method": "GET",
            "path": self.path,
            "authorization": self.headers.get("Authorization"),
        })
        self._json_response(200, {
            "object": "list",
            "data": [
                {"id": "deepseek-v4-flash", "object": "model", "owned_by": "deepseek"},
                {"id": "deepseek-v4-pro", "object": "model", "owned_by": "deepseek"},
            ],
        })

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length))
        self.server.requests.append({
            "method": "POST",
            "path": self.path,
            "authorization": self.headers.get("Authorization"),
            "payload": payload,
        })
        if self.server.error_status:
            self._json_response(self.server.error_status, {
                "error": {
                    "code": "authentication_error",
                    "message": f"rejected {self.server.test_key}",
                }
            })
            return
        if payload.get("stream"):
            chunks = [
                ": keep-alive\n\n",
                'data: {"choices":[{"delta":{"content":"你"},"finish_reason":null,"index":0}]}\n\n',
                'data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop","index":0}]}\n\n',
                "data: [DONE]\n\n",
            ]
            body = "".join(chunks).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self._json_response(200, {
            "id": "completion-test",
            "object": "chat.completion",
            "model": payload["model"],
            "choices": [{
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": "你好"},
            }],
            "usage": {"prompt_tokens": 2, "completion_tokens": 2, "total_tokens": 4},
        })


class DeepSeekAPITests(unittest.TestCase):
    def setUp(self):
        self.key = "unit-test-deepseek-key"
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), MockDeepSeekHandler)
        self.server.requests = []
        self.server.error_status = None
        self.server.test_key = self.key
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        host, port = self.server.server_address
        self.client = DeepSeekClient(
            DeepSeekConfig(
                credential=self.key,
                base_url=f"http://{host}:{port}",
                timeout_seconds=5,
            ),
            allow_insecure_http=True,
        )

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def test_config_defaults_and_requires_key(self):
        config = config_from_env({CREDENTIAL_ENV: self.key})
        self.assertEqual(config.default_model, DEFAULT_MODEL)
        self.assertEqual(config.base_url, "https://api.deepseek.com")
        with mock.patch.object(platform, "system", return_value="Linux"):
            with self.assertRaises(DeepSeekConfigError):
                config_from_env({})

    def test_lists_models_and_sends_bearer_auth(self):
        self.assertEqual(self.client.list_models(), ["deepseek-v4-flash", "deepseek-v4-pro"])
        request = self.server.requests[-1]
        self.assertEqual(request["path"], "/models")
        self.assertEqual(request["authorization"], f"Bearer {self.key}")

    def test_chat_uses_default_model_and_compacts_response(self):
        response = self.client.chat({"messages": [{"role": "user", "content": "你好"}]})
        request = self.server.requests[-1]
        self.assertEqual(request["path"], "/chat/completions")
        self.assertEqual(request["payload"]["model"], DEFAULT_MODEL)
        self.assertFalse(request["payload"]["stream"])
        self.assertEqual(compact_chat_response(response), {
            "content": "你好",
            "finish_reason": "stop",
            "model": DEFAULT_MODEL,
            "usage": {"prompt_tokens": 2, "completion_tokens": 2, "total_tokens": 4},
        })

    def test_stream_ignores_keep_alive_comments(self):
        chunks = list(self.client.stream_chat({
            "messages": [{"role": "user", "content": "你好"}],
        }))
        content = "".join(chunk["choices"][0]["delta"]["content"] for chunk in chunks)
        self.assertEqual(content, "你好")
        request = self.server.requests[-1]
        self.assertTrue(request["payload"]["stream"])
        self.assertEqual(request["payload"]["stream_options"], {"include_usage": True})

    def test_http_error_redacts_api_key(self):
        self.server.error_status = 401
        with self.assertRaises(DeepSeekError) as context:
            self.client.chat({"messages": [{"role": "user", "content": "你好"}]})
        self.assertEqual(context.exception.status, 401)
        self.assertNotIn(self.key, str(context.exception))
        self.assertIn("[REDACTED]", str(context.exception))

    def test_rejects_unknown_fields_and_private_user_id_shape(self):
        with self.assertRaises(DeepSeekConfigError):
            self.client.chat({
                "messages": [{"role": "user", "content": "你好"}],
                "unknown": True,
            })
        with self.assertRaises(DeepSeekConfigError):
            self.client.chat({
                "messages": [{"role": "user", "content": "你好"}],
                "user_id": "person@example.com",
            })

    def test_keychain_configuration_prompts_inside_security(self):
        completed = subprocess.CompletedProcess(args=[], returncode=0)
        with mock.patch.object(platform, "system", return_value="Darwin"), mock.patch(
            "tools.deepseek_api.subprocess.run", return_value=completed
        ) as run:
            configure_macos_keychain()
        args = run.call_args.args[0]
        self.assertEqual(args[-1], "-w")
        self.assertNotIn(self.key, args)


if __name__ == "__main__":
    unittest.main()
