from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tools.product_surfaces import (
    EXPECTED_SURFACES,
    SURFACES_PATH,
    ProductSurfaceError,
    load_product_surfaces,
)


class ProductSurfaceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        path = self.root / SURFACES_PATH
        path.parent.mkdir(parents=True)
        path.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "truth_source": "icloud-private-workspace",
                    "surfaces": [
                        {"id": surface_id, **fields}
                        for surface_id, fields in EXPECTED_SURFACES.items()
                    ],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_canonical_contract_passes(self) -> None:
        self.assertEqual(load_product_surfaces(self.root), EXPECTED_SURFACES)

    def test_replaced_dashboard_cannot_be_reactivated_silently(self) -> None:
        path = self.root / SURFACES_PATH
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload["surfaces"][-1]["lifecycle_state"] = "active"
        path.write_text(json.dumps(payload), encoding="utf-8")
        with self.assertRaises(ProductSurfaceError):
            load_product_surfaces(self.root)

    def test_duplicate_surface_ids_fail_closed(self) -> None:
        path = self.root / SURFACES_PATH
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload["surfaces"].append(dict(payload["surfaces"][0]))
        path.write_text(json.dumps(payload), encoding="utf-8")
        with self.assertRaises(ProductSurfaceError):
            load_product_surfaces(self.root)


if __name__ == "__main__":
    unittest.main()
