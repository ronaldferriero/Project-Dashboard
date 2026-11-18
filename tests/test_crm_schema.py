import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import crm_schema  # noqa: E402

STRING_CONSTANTS = (
    "ITEM_ENTITY_SET",
    "ITEM_ACTIVE_FILTER",
    "ITEM_AMOUNT_FIELD",
    "ITEM_DIVISION_FIELD",
    "ITEM_ACCOUNT_FIELD",
    "ITEM_MODIFIED_FIELD",
    "ACCOUNT_NUMBER_FIELD",
    "ACCOUNT_PARENT_FIELD",
)


class CrmSchemaTests(unittest.TestCase):
    def test_schema_constants_are_filled(self):
        for name in STRING_CONSTANTS:
            value = getattr(crm_schema, name)
            self.assertIsInstance(value, str, name)
            self.assertTrue(value.strip(), name)
            self.assertNotIn("TODO", value, name)
            self.assertNotIn("<", value, name)
            self.assertRegex(value, r"^[A-Za-z_][A-Za-z0-9_./ ]*$", name)
        self.assertIsInstance(crm_schema.SUPPORTS_AGGREGATE, bool)
        self.assertIsInstance(crm_schema.SUPPORTS_CHANGE_DETECTION, bool)

    def test_lookup_fields_use_the_value_form(self):
        # Lookups must be selected as _<name>_value; their labels come from the formatted annotation.
        for name in ("ITEM_DIVISION_FIELD", "ITEM_ACCOUNT_FIELD", "ACCOUNT_PARENT_FIELD"):
            self.assertRegex(getattr(crm_schema, name), r"^_[a-z0-9_]+_value$", name)


if __name__ == "__main__":
    unittest.main()
