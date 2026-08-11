from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from zipfile import ZIP_DEFLATED, ZipFile

from life_console_loopback_poc import (
    INTENT_HEADER,
    LoopbackPocHandler,
    LoopbackPocServer,
    origin_digest,
)


ORIGIN = "https://synthetic.example"


def synthetic_zip() -> bytes:
    target = BytesIO()
    with ZipFile(target, "w", ZIP_DEFLATED) as archive:
        archive.writestr(
            "manifest.json",
            json.dumps({"format_version": "life-console-poc/1", "synthetic": True}),
        )
        archive.writestr("data/synthetic.ndjson", '{"id":"synthetic"}\n')
    return target.getvalue()


class LoopbackPocTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.server = LoopbackPocServer(
            ("127.0.0.1", 0),
            LoopbackPocHandler,
            allowed_origin_sha256=origin_digest(ORIGIN),
            output_dir=Path(self.temporary.name),
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary.cleanup()

    def request(self, path: str, *, method: str = "GET", headers=None, data=None):
        return urlopen(
            Request(self.base_url + path, method=method, headers=headers or {}, data=data),
            timeout=2,
        )

    def test_health_requires_allowlisted_origin(self) -> None:
        with self.request("/v1/health", headers={"Origin": ORIGIN}) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], ORIGIN)
        with self.assertRaises(HTTPError) as rejected:
            self.request("/v1/health", headers={"Origin": "https://foreign.example"})
        self.assertEqual(rejected.exception.code, 403)

    def test_preflight_requires_method_and_custom_headers(self) -> None:
        headers = {
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type, x-life-console-intent",
        }
        with self.request("/v1/backups", method="OPTIONS", headers=headers) as response:
            self.assertEqual(response.status, 204)
            self.assertEqual(response.headers["Access-Control-Allow-Private-Network"], "true")

    def test_post_rejects_missing_intent_and_accepts_synthetic_zip(self) -> None:
        payload = synthetic_zip()
        base_headers = {"Origin": ORIGIN, "Content-Type": "application/zip"}
        with self.assertRaises(HTTPError) as rejected:
            self.request("/v1/backups", method="POST", headers=base_headers, data=payload)
        self.assertEqual(rejected.exception.code, 403)

        with self.request(
            "/v1/backups",
            method="POST",
            headers={**base_headers, INTENT_HEADER: "synthetic-backup"},
            data=payload,
        ) as response:
            self.assertEqual(response.status, 201)
        target = Path(self.temporary.name) / "synthetic-latest.zip"
        self.assertTrue(target.exists())
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_server_rejects_non_loopback_bind(self) -> None:
        with self.assertRaisesRegex(ValueError, "loopback"):
            LoopbackPocServer(
                ("0.0.0.0", 0),
                LoopbackPocHandler,
                allowed_origin_sha256=origin_digest(ORIGIN),
                output_dir=Path(self.temporary.name),
            )


if __name__ == "__main__":
    unittest.main()
