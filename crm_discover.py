#!/usr/bin/env python3
"""One-off, read-only lookups used to find the Dynamics names behind CRM ARR.

Each subcommand sends the Foundry agent exactly one read query and prints the JSON it returns.
Findings are recorded in docs/superpowers/notes/2026-11-04-crm-discovery.md and crm_schema.py.
"""

from __future__ import annotations

import argparse
import json
import re
import sys

from crm_agent import AGENT_READ_ONLY, AgentClient, assert_account_number, assert_guid, read_config

ONE_CALL = "Do not call any other tool."
JSON_ONLY = "Reply with ONLY one fenced ```json block. No prose."
_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def odata_prompt(entity_set: str, filter_: str, select: str | None, top: int, reply_shape: str) -> str:
    if not _NAME.match(entity_set):
        raise ValueError(f"Invalid entity set: {entity_set!r}")
    select_part = f', select "{select}"' if select else ", no select (return all attributes)"
    return "\n".join(
        [
            AGENT_READ_ONLY,
            f'Make exactly ONE tool call: dynamic_odata_query with entitySet "{entity_set}", filter "{filter_}"'
            f"{select_part}, top {top}, and include formatted values. {ONE_CALL}",
            f"{JSON_ONLY} Shape: {reply_shape}",
        ]
    )


def tool_params_prompt() -> str:
    return "\n".join(
        [
            AGENT_READ_ONLY,
            "Do not call any tool. From your own tool definitions, list every parameter the dynamic_odata_query "
            "tool accepts, with its type and a one-line description.",
            f'{JSON_ONLY} Shape: [["parameter name", "type", "description"], ...]',
        ]
    )


ROWS_VERBATIM = 'an array of objects, one per record, with every returned attribute copied verbatim ' \
    '(include "@OData.Community.Display.V1.FormattedValue" annotations as "<attr>@formatted").'


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("tool-params")
    view = sub.add_parser("view")
    view.add_argument("--name", default="Active Customer Product Items")
    view.add_argument("--user", action="store_true", help="look in userqueries (personal views)")
    account = sub.add_parser("account")
    account.add_argument("number")
    query = sub.add_parser("query", help="any single read query (entity set, filter, select)")
    query.add_argument("entity_set")
    query.add_argument("filter")
    query.add_argument("--select")
    query.add_argument("--top", type=int, default=5)
    query.add_argument("--account", help="GUID substituted for {account} in the filter")
    args = parser.parse_args(argv)

    if args.command == "tool-params":
        prompt = tool_params_prompt()
    elif args.command == "view":
        name = args.name.replace("'", "''")
        prompt = odata_prompt(
            "userqueries" if args.user else "savedqueries",
            f"name eq '{name}'",
            "name,returnedtypecode,fetchxml,layoutxml",
            5,
            '[[name, returnedtypecode, fetchxml, layoutxml], ...] with fetchxml and layoutxml copied verbatim.',
        )
    elif args.command == "account":
        number = assert_account_number(args.number)
        prompt = odata_prompt(
            "accounts",
            f"accountnumber eq '{number}'",
            "accountid,accountnumber,name,statecode",
            10,
            "[[accountid, accountnumber, name, statecode formatted label], ...]",
        )
    else:
        filter_ = args.filter
        if args.account:
            filter_ = filter_.replace("{account}", assert_guid(args.account))
        prompt = odata_prompt(args.entity_set, filter_, args.select, args.top, ROWS_VERBATIM)

    client = AgentClient(read_config())
    result = client.run_json(prompt, f"discover-{args.command}")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
