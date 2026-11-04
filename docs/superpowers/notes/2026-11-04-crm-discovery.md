# CRM ARR discovery (2026-11-04)

Read-only lookups through the Foundry "EPL Support Agent (Test)" (dev tenant), using `crm_discover.py`.
Tested against one client's Account Number. No ARR amounts, account names or other customer values are recorded here.

## Query tool

`dynamic_odata_query` parameters: `entitySet`, `select`, `filter`, `orderby`, `top`, `skip`, `expand`,
`count`. There is no `$apply`, so totals cannot be aggregated in Dynamics. **Totals are summed in code from
item rows** (`SUPPORTS_AGGREGATE = False`).

## The view

`savedqueries` name `Active Customer Product Items` (savedqueryid `7de049d8-f839-4475-a750-330852cfe4c5`):

- Entity: `tyl_customerproductitem` (entity set `tyl_customerproductitems`).
- Filter: a single condition, `statecode eq 0`.
- Layout columns, in order: product suite, parent product (via product), product module, product version,
  hosting type, supported-by account, support end date, **division** (`tyl_divisionbusinessunitid`),
  solution type (via product), quantity, **`tyl_productarr`**, direct customer (via the parent customer
  product, `sla_directcustomerid`).

The user's truncated "Product…" column, confirmed as the ARR, is **`tyl_productarr`** ("Product ARR", money,
with `_base` and formatted values). The "Direct Customer…" column is `sla_directcustomerid` on the parent
customer product and is not used.

## Item attributes used

| Purpose | Attribute |
| --- | --- |
| ARR amount | `tyl_productarr` |
| Division | `_tyl_divisionbusinessunitid_value` (lookup to business unit; label from `@formatted`, for example `Enterprise Permitting & Licensing`) |
| Account | `_tyl_accountid_value` (direct lookup to account; no need to go through the customer product) |
| Change detection | `modifiedon` |

## Accounts

`accounts.accountnumber` holds the Account Number. **One Account Number usually covers several active
accounts**: in a sample of 8 project account numbers, 6 had 2 to 4 active accounts. In every multi-account
case there was exactly one top-level account, and every other account's `_parentaccountid_value` pointed to an
account in the same group (a parent with department child accounts).

For the test client: several active accounts (one top-level, the rest its children), with active
items on more than one of them, some without ARR.

This contradicts the design's matching rule (more than one active match -> `ambiguous` / n/a), which would blank
out most clients. Raised with the user before Task 3.

## Change detection

`modifiedon gt <ISO timestamp>` works on `tyl_customerproductitems`: a cutoff after the newest change returned
0 rows, and an earlier cutoff returned only rows modified after it, including inactive (deactivated) items.
`SUPPORTS_CHANGE_DETECTION = True`.
