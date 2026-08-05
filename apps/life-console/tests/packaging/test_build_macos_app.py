from __future__ import annotations

import plistlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


APP_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP_ROOT))

from packaging.build_macos_app import BUNDLE_IDENTIFIER, EXECUTABLE_NAME, build, bundle_info


class MacOSAppBuilderTests(unittest.TestCase):
    def test_bundle_metadata_is_dedicated_and_background_only(self) -> None:
        info = bundle_info()
        self.assertEqual(info["CFBundleIdentifier"], BUNDLE_IDENTIFIER)
        self.assertEqual(info["CFBundleExecutable"], EXECUTABLE_NAME)
        self.assertTrue(info["LSUIElement"])
        self.assertIn("iCloud", info["NSFileProviderDomainUsageDescription"])

    def test_build_creates_signed_bundle_shape(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "Life Console.app"

            def fake_run(argv: list[str], *, check: bool) -> mock.Mock:
                self.assertTrue(check)
                if "-o" in argv:
                    executable = Path(argv[argv.index("-o") + 1])
                    executable.write_bytes(b"synthetic launcher")
                return mock.Mock(returncode=0)

            with mock.patch("packaging.build_macos_app.subprocess.run", side_effect=fake_run) as run:
                result = build(output)

            info = plistlib.loads((result / "Contents/Info.plist").read_bytes())
            self.assertEqual(info["CFBundleIdentifier"], BUNDLE_IDENTIFIER)
            self.assertTrue((result / "Contents/MacOS" / EXECUTABLE_NAME).is_file())
            self.assertEqual(run.call_count, 2)

    def test_rejects_non_app_output(self) -> None:
        with self.assertRaises(ValueError):
            build(Path("Life Console"))

    def test_existing_bundle_requires_explicit_replace(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "Life Console.app"
            output.mkdir()
            with self.assertRaises(ValueError):
                build(output)


if __name__ == "__main__":
    unittest.main()
