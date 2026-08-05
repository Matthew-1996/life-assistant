from __future__ import annotations

import plistlib
import stat
import sys
import tempfile
import unittest
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP_ROOT))

from packaging.generate_launch_agent import generate


class LaunchAgentGeneratorTests(unittest.TestCase):
    def test_generates_rebuildable_local_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "runtime"
            plist_path, launcher_path = generate(output, root=APP_ROOT)
            plist = plistlib.loads(plist_path.read_bytes())
            self.assertEqual(plist["WorkingDirectory"], str(APP_ROOT.resolve()))
            self.assertIn("127.0.0.1", plist["ProgramArguments"])
            self.assertNotIn("0.0.0.0", plist["ProgramArguments"])
            self.assertIn("--root", plist["ProgramArguments"])
            self.assertEqual(
                plist["ProgramArguments"][plist["ProgramArguments"].index("--root") + 1],
                str(APP_ROOT.parents[1].resolve()),
            )
            self.assertTrue(plist["RunAtLoad"])
            self.assertFalse(plist["KeepAlive"])
            self.assertEqual(Path(plist["StandardOutPath"]).parent, output / "logs")
            self.assertTrue((output / "logs").is_dir())
            self.assertTrue(launcher_path.stat().st_mode & stat.S_IXUSR)
            self.assertIn("http://127.0.0.1:47321/", launcher_path.read_text())

    def test_rejects_unrelated_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ValueError):
                generate(Path(temp) / "output", root=Path(temp))


if __name__ == "__main__":
    unittest.main()
