#!/usr/bin/env python3
"""Strict loader for the public product-surface lifecycle contract."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


SURFACES_PATH = "docs/operations/product-surfaces.json"
EXPECTED_SURFACES: dict[str, dict[str, str]] = {
    "life-console": {
        "lifecycle_state": "active",
        "role": "primary",
        "sync_cadence": "on_demand",
        "writeback": "local-tools-only",
    },
    "google-sheets": {
        "lifecycle_state": "derived",
        "role": "secondary",
        "sync_cadence": "on_demand",
        "writeback": "none",
    },
    "xlsx": {
        "lifecycle_state": "derived",
        "role": "secondary",
        "sync_cadence": "on_demand",
        "writeback": "none",
    },
    "life-dashboard": {
        "lifecycle_state": "archived",
        "role": "retired",
        "sync_cadence": "none",
        "writeback": "none",
        "deployment_policy": "no_new_deployments",
        "live_instance_policy": "preserve_owner_only",
    },
}


class ProductSurfaceError(ValueError):
    """Raised when the lifecycle contract is missing or unsafe."""


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ProductSurfaceError("duplicate JSON key")
        result[key] = value
    return result


def _reject_constant(_: str) -> None:
    raise ProductSurfaceError("non-finite JSON value")


def load_product_surfaces(root: Path) -> dict[str, dict[str, str]]:
    path = root / SURFACES_PATH
    if path.is_symlink() or not path.is_file():
        raise ProductSurfaceError("product surface contract is missing")
    try:
        payload = json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ProductSurfaceError("product surface contract is unreadable") from exc

    if not isinstance(payload, dict) or set(payload) != {
        "schema_version",
        "truth_source",
        "surfaces",
    }:
        raise ProductSurfaceError("product surface contract has invalid fields")
    if payload.get("schema_version") != 1 or isinstance(
        payload.get("schema_version"), bool
    ):
        raise ProductSurfaceError("product surface contract has invalid version")
    if payload.get("truth_source") != "icloud-private-workspace":
        raise ProductSurfaceError("product surface truth source is invalid")
    if not isinstance(payload.get("surfaces"), list):
        raise ProductSurfaceError("product surface list is invalid")

    actual: dict[str, dict[str, str]] = {}
    for item in payload["surfaces"]:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            raise ProductSurfaceError("product surface item is invalid")
        surface_id = item["id"]
        if surface_id in actual:
            raise ProductSurfaceError("product surface id is duplicated")
        fields = {key: value for key, value in item.items() if key != "id"}
        if not all(isinstance(key, str) and isinstance(value, str) for key, value in fields.items()):
            raise ProductSurfaceError("product surface values are invalid")
        actual[surface_id] = fields

    if actual != EXPECTED_SURFACES:
        raise ProductSurfaceError("product surface lifecycle is not canonical")
    return actual
