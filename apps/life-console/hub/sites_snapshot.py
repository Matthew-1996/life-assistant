from __future__ import annotations

from copy import deepcopy
from typing import Any


def redact_dashboard_for_sites(dashboard: dict[str, Any]) -> dict[str, Any]:
    """Return the approved private Sites projection without diary content."""

    snapshot = deepcopy(dashboard)
    snapshot.setdefault("records", {})["recent_journals"] = []
    snapshot["source_revisions"] = {
        "daily": "redacted",
        "journal": "redacted",
        "goals": "redacted",
    }
    snapshot["system"] = {
        "hub": "unavailable",
        "icloud": "readable",
        "automation": "unknown",
        "backup": "unknown",
        "google": "paused",
        "mobile": "pending",
    }
    return snapshot
