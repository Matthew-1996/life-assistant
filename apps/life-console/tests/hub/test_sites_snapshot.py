from __future__ import annotations

import copy
import unittest

from hub.sites_snapshot import redact_dashboard_for_sites


class SitesSnapshotTests(unittest.TestCase):
    def test_redacts_diaries_and_source_fingerprints_without_mutating_input(self) -> None:
        dashboard = {
            "records": {
                "recent_journals": [
                    {"id": "synthetic", "title": "private", "summary": "private"}
                ]
            },
            "source_revisions": {
                "daily": "daily-hash",
                "journal": "journal-hash",
                "goals": "goals-hash",
            },
            "system": {"hub": "ready"},
        }
        original = copy.deepcopy(dashboard)

        snapshot = redact_dashboard_for_sites(dashboard)

        self.assertEqual(snapshot["records"]["recent_journals"], [])
        self.assertEqual(
            snapshot["source_revisions"],
            {"daily": "redacted", "journal": "redacted", "goals": "redacted"},
        )
        self.assertEqual(snapshot["system"]["hub"], "unavailable")
        self.assertEqual(dashboard, original)


if __name__ == "__main__":
    unittest.main()
