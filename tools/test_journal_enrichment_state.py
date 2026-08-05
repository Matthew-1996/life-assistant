from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

import journal_enrichment_state as state

TOOL = Path(__file__).resolve().parent / "journal_enrichment_state.py"


class JournalEnrichmentStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temp = TemporaryDirectory()
        self.root = Path(self._temp.name)
        (self.root / "integrations").mkdir()

    def tearDown(self) -> None:
        self._temp.cleanup()

    def _config(self) -> dict:
        return json.loads((self.root / state.CONFIG_PATH).read_text(encoding="utf-8"))

    # --- default / disabled --------------------------------------------
    def test_missing_config_reads_as_disabled_and_unauthorized(self) -> None:
        self.assertEqual(state.resolve_authorization(self.root), None)
        status = state.inspect_state(self.root)
        self.assertEqual(status["state"], "disabled")
        self.assertFalse(status["authorized"])

    def test_enable_requires_external_send_acknowledgement(self) -> None:
        with self.assertRaises(state.EnrichmentStateError):
            state.enable(self.root, {"acknowledge_external_send": False})
        with self.assertRaises(state.EnrichmentStateError):
            state.enable(self.root, {"model": "deepseek-v4-flash"})

    # --- enable ---------------------------------------------------------
    def test_enable_records_authorization_and_authorizes(self) -> None:
        result = state.enable(self.root, {"acknowledge_external_send": True})
        self.assertEqual(result["state"], "active")
        version = result["authorization_version"]
        self.assertTrue(version.startswith("journal-enrichment-"))
        self.assertEqual(state.resolve_authorization(self.root), version)
        config = self._config()
        self.assertEqual(config["lifecycle_state"], "active")
        self.assertIs(config["authorization"]["acknowledged_external_send"], True)
        # Never stores a key or journal content.
        blob = json.dumps(config, ensure_ascii=False)
        self.assertNotIn("sk-", blob)
        self.assertNotIn("raw", blob)

    def test_enable_rejects_model_outside_allowlist(self) -> None:
        with self.assertRaises(state.EnrichmentStateError):
            state.enable(self.root, {"acknowledge_external_send": True, "model": "gpt-4o"})

    def test_enable_accepts_allowlisted_model(self) -> None:
        result = state.enable(
            self.root, {"acknowledge_external_send": True, "model": "deepseek-v4-pro"}
        )
        self.assertEqual(result["model"], "deepseek-v4-pro")
        self.assertEqual(state.resolve_model(self.root), "deepseek-v4-pro")

    # --- pause / re-enable ---------------------------------------------
    def test_pause_is_a_kill_switch_that_revokes_authorization(self) -> None:
        state.enable(self.root, {"acknowledge_external_send": True})
        paused = state.pause(self.root, {})
        self.assertEqual(paused["state"], "paused")
        # Paused => no authorization is returned to the Hub.
        self.assertIsNone(state.resolve_authorization(self.root))

    def test_re_enable_after_pause_mints_a_new_version(self) -> None:
        v1 = state.enable(self.root, {"acknowledge_external_send": True})["authorization_version"]
        state.pause(self.root, {})
        with mock.patch.object(state, "_now_compact", return_value="20260806T010203Z"):
            v2 = state.enable(self.root, {"acknowledge_external_send": True})["authorization_version"]
        self.assertNotEqual(v1, v2)
        self.assertEqual(state.resolve_authorization(self.root), v2)

    def test_disable_clears_authorization(self) -> None:
        state.enable(self.root, {"acknowledge_external_send": True})
        state.disable(self.root, {})
        self.assertIsNone(state.resolve_authorization(self.root))
        self.assertIsNone(self._config()["authorization"])

    def test_pause_before_enable_is_rejected(self) -> None:
        with self.assertRaises(state.EnrichmentStateError):
            state.pause(self.root, {})

    # --- optimistic concurrency ----------------------------------------
    def test_expect_state_guards_against_drift(self) -> None:
        state.enable(self.root, {"acknowledge_external_send": True})
        with self.assertRaises(state.EnrichmentStateError):
            state.pause(self.root, {"expect_state": "disabled"})

    # --- corruption is fail-safe ---------------------------------------
    def test_corrupt_config_resolves_to_no_authorization(self) -> None:
        (self.root / state.CONFIG_PATH).write_text("{not json", encoding="utf-8")
        self.assertIsNone(state.resolve_authorization(self.root))
        self.assertEqual(state.resolve_model(self.root), "deepseek-v4-flash")

    # --- config file is written 0600 -----------------------------------
    def test_config_written_with_owner_only_permissions(self) -> None:
        state.enable(self.root, {"acknowledge_external_send": True})
        mode = (self.root / state.CONFIG_PATH).stat().st_mode & 0o777
        self.assertEqual(mode, 0o600)

    # --- CLI smoke ------------------------------------------------------
    def test_cli_enable_pause_status_roundtrip(self) -> None:
        def run(command: str, payload: dict | None = None) -> dict:
            result = subprocess.run(
                [sys.executable, str(TOOL), "--root", str(self.root), command],
                input=json.dumps(payload) if payload is not None else None,
                text=True,
                capture_output=True,
                check=True,
            )
            return json.loads(result.stdout)

        self.assertEqual(run("status")["state"], "disabled")
        enabled = run("enable", {"acknowledge_external_send": True})
        self.assertEqual(enabled["state"], "active")
        self.assertEqual(run("status")["state"], "active")
        self.assertEqual(run("pause", {})["state"], "paused")
        self.assertEqual(run("status")["state"], "paused")


if __name__ == "__main__":
    unittest.main()
