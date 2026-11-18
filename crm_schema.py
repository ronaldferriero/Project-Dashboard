"""Dynamics names behind CRM ARR, found by read-only discovery on 2026-11-04.

See docs/superpowers/notes/2026-11-04-crm-discovery.md for how each was confirmed.
"""

# "Active Customer Product Items" view (savedquery 7de049d8-f839-4475-a750-330852cfe4c5) is on this entity.
ITEM_ENTITY_SET = "tyl_customerproductitems"
# The view's only filter condition: statecode eq 0.
ITEM_ACTIVE_FILTER = "statecode eq 0"
# The view's "Product ARR" column (money).
ITEM_AMOUNT_FIELD = "tyl_productarr"
# Division lookup (business unit); the label comes from the formatted-value annotation.
ITEM_DIVISION_FIELD = "_tyl_divisionbusinessunitid_value"
# Items link straight to their account.
ITEM_ACCOUNT_FIELD = "_tyl_accountid_value"
ITEM_MODIFIED_FIELD = "modifiedon"

ACCOUNT_NUMBER_FIELD = "accountnumber"
# One Account Number covers a family: a top-level account plus child (department) accounts.
ACCOUNT_PARENT_FIELD = "_parentaccountid_value"

# dynamic_odata_query accepts entitySet, select, filter, orderby, top, skip, expand, count: no $apply.
SUPPORTS_AGGREGATE = False
# A "modifiedon gt <ISO timestamp>" filter on items returns only later rows, inactive items included.
SUPPORTS_CHANGE_DETECTION = True
