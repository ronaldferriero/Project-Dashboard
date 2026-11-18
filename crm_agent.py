#!/usr/bin/env python3
"""Read-only client for Dynamics CRM data through a Tyler Foundry agent.

Ported from Analyst CoPilot (app/server/crm/agentCrmClient.ts, foundryClient.ts, sse.ts,
agentPrompts.ts). The dev-tenant "EPL Support Agent (Test)" has the Dynamics MCP tools, so we
send it one exact read query per prompt and parse the fenced JSON in its streamed reply.

The agent also has write tools. Every prompt must start with AGENT_READ_ONLY and name a single
read tool call; nothing in this module asks for a write.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Iterator, Mapping

import requests

AGENT_READ_ONLY = (
    "READ-ONLY REQUEST. Use only read tools. Never call any create, update, resolve, escalate, assign, "
    "publish, or note tool, and never send communication."
)

DEFAULT_BASE_URL = "https://foundry.tylertechai.com"
DEFAULT_TENANT = "dev"
# EPL Support Agent (Test), the agent Analyst CoPilot reads Dynamics through.
DEFAULT_AGENT_ID = "754773e3-5009-4a52-851d-14a1688c2a90"
DEFAULT_COPILOT_ENV = Path.home() / "Tyler_Codex_Projects" / "Analyst CoPilot" / ".env"

_PLACEHOLDER = re.compile(r"^(replace-me|<.*>)$")
_GUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
_ACCOUNT_NUMBER = re.compile(r"^[0-9]{3,7}$")


class AgentError(Exception):
    """Anything that went wrong talking to the Foundry agent."""


class AgentReplyError(AgentError):
    """The agent answered, but not with the JSON we asked for."""


class AgentHttpError(AgentError):
    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.status = status


@dataclass
class FoundryConfig:
    base_url: str
    tenant: str
    agent_id: str
    api_key: str | None


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value or _PLACEHOLDER.match(value):
        return None
    return value


def _read_env_value(path: Path, key: str) -> str | None:
    """Reads a single KEY=VALUE from a dotenv-style file. Nothing else from the file is kept."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        if name.strip() == key:
            return value.strip().strip('"').strip("'")
    return None


def read_config(env: Mapping[str, str] = os.environ, copilot_env_path: Path | None = None) -> FoundryConfig:
    """Foundry settings from env, with the API key falling back to Analyst CoPilot's .env."""
    api_key = _clean(env.get("FOUNDRY_API_KEY"))
    if api_key is None:
        path = copilot_env_path or Path(env.get("ANALYST_COPILOT_ENV") or DEFAULT_COPILOT_ENV).expanduser()
        api_key = _clean(_read_env_value(path, "FoundryAPIKey"))
    return FoundryConfig(
        base_url=(_clean(env.get("FOUNDRY_BASE_URL")) or DEFAULT_BASE_URL).rstrip("/"),
        tenant=_clean(env.get("FOUNDRY_TENANT")) or DEFAULT_TENANT,
        agent_id=_clean(env.get("CRM_AGENT_ID")) or DEFAULT_AGENT_ID,
        api_key=api_key,
    )


def has_key(config: FoundryConfig) -> bool:
    return bool(config.api_key)


def iter_sse(lines: Iterable[str]) -> Iterator[tuple[str | None, str]]:
    """Parses Server-Sent Events lines into (event, data) pairs."""
    event: str | None = None
    data: list[str] = []
    for line in lines:
        if line is None:
            continue
        if isinstance(line, bytes):
            line = line.decode("utf-8")
        line = line.rstrip("\r")
        if line == "":
            if data:
                yield event, "\n".join(data)
            event, data = None, []
            continue
        if line.startswith(":"):
            continue
        field, _, value = line.partition(":")
        if value.startswith(" "):
            value = value[1:]
        if field == "data":
            data.append(value)
        elif field == "event":
            event = value
    if data:
        yield event, "\n".join(data)


def text_from_event(event: str | None, data: str) -> str | None:
    """Text from a `text-delta` event; every other event type is ignored."""
    if not data or data == "[DONE]":
        return None
    try:
        parsed = json.loads(data)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    if (parsed.get("type") or event) != "text-delta":
        return None
    payload = parsed.get("payload")
    text = payload.get("text") if isinstance(payload, dict) else None
    if text is None:
        text = parsed.get("text")
    return text if isinstance(text, str) else None


_FENCE = re.compile(r"```(?:json)?\s*([\s\S]*?)```")


def extract_json(text: str) -> Any:
    """The JSON payload of an agent reply: the last ```json fence, else the first bare JSON value."""
    fences = _FENCE.findall(text)
    if fences:
        candidate = fences[-1]
    else:
        match = re.search(r"[\[{]|null", text)
        if not match:
            raise AgentReplyError(f"Agent reply had no JSON: {text[:300] or '(empty reply)'}")
        candidate = text[match.start():]
    candidate = candidate.strip()
    try:
        if fences:
            return json.loads(candidate)
        # A bare value may be followed by prose: take the first complete JSON value.
        return json.JSONDecoder().raw_decode(candidate)[0]
    except json.JSONDecodeError:
        raise AgentReplyError(f"Could not parse the agent reply as JSON: {text[:300] or '(empty reply)'}") from None


def _thread_id(purpose: str) -> str:
    raw = f"dashboard-{purpose}-{uuid.uuid4()}"
    return re.sub(r"[^A-Za-z0-9_-]", "-", raw)[:100]


class AgentClient:
    def __init__(self, config: FoundryConfig, session: requests.Session | None = None, timeout: float = 300):
        self.config = config
        self.session = session or requests.Session()
        self.timeout = timeout

    def run_json(self, prompt: str, purpose: str) -> Any:
        """Sends one prompt in a fresh thread and returns the JSON from the agent's reply."""
        if not has_key(self.config):
            raise AgentError("No Foundry API key configured. Set FOUNDRY_API_KEY or FoundryAPIKey in Analyst CoPilot's .env.")
        headers = {
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "X-API-Key": self.config.api_key,
            "X-Tenant-Slug": self.config.tenant,
        }
        body = {"threadId": _thread_id(purpose), "messages": [{"role": "user", "content": prompt}]}
        url = f"{self.config.base_url}/api/agents/{self.config.agent_id}/stream"
        try:
            response = self.session.post(url, headers=headers, json=body, stream=True, timeout=self.timeout)
        except requests.RequestException as error:
            raise AgentError(f"CRM agent request failed: {type(error).__name__}") from None
        try:
            if response.status_code != 200:
                if response.status_code in (401, 403):
                    hint = "Check FOUNDRY_API_KEY and FOUNDRY_TENANT."
                else:
                    hint = (response.text or "")[:300].replace(self.config.api_key or "\0", "***")
                raise AgentHttpError(f"CRM agent request failed (HTTP {response.status_code}). {hint}", response.status_code)
            text = "".join(
                chunk
                for event, data in iter_sse(response.iter_lines(decode_unicode=True))
                if (chunk := text_from_event(event, data))
            )
        except requests.RequestException as error:
            raise AgentError(f"CRM agent stream failed: {type(error).__name__}") from None
        finally:
            response.close()
        return extract_json(text)


def assert_account_number(value: str) -> str:
    cleaned = (value or "").strip()
    if not _ACCOUNT_NUMBER.match(cleaned):
        raise ValueError(f"Invalid CRM account number: {value[:40]!r}")
    return cleaned


def assert_guid(value: str) -> str:
    cleaned = (value or "").strip()
    if not _GUID.match(cleaned):
        raise ValueError(f"Invalid Dynamics GUID: {value[:60]!r}")
    return cleaned.lower()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--has-key", action="store_true", help="exit 0 when a Foundry API key is configured")
    args = parser.parse_args(argv)
    if args.has_key:
        return 0 if has_key(read_config()) else 1
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
