import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import crm_agent  # noqa: E402
from crm_agent import (  # noqa: E402
    AGENT_READ_ONLY,
    AgentClient,
    AgentHttpError,
    AgentReplyError,
    assert_account_number,
    extract_json,
    has_key,
    iter_sse,
    read_config,
    text_from_event,
)

MISSING = Path("/nonexistent/analyst-copilot/.env")


class FakeResponse:
    def __init__(self, status_code=200, lines=(), text=""):
        self.status_code = status_code
        self._lines = list(lines)
        self.text = text
        self.closed = False

    def iter_lines(self, decode_unicode=False):
        yield from self._lines

    def close(self):
        self.closed = True


class FakeSession:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.response


def sse_lines(*chunks):
    lines = []
    for chunk in chunks:
        lines.append("data: " + json.dumps({"type": "text-delta", "payload": {"text": chunk}}))
        lines.append("")
    lines.append("data: " + json.dumps({"type": "finish"}))
    lines.append("")
    return lines


class ReadConfigTests(unittest.TestCase):
    def test_read_config_defaults(self):
        config = read_config({}, copilot_env_path=MISSING)
        self.assertEqual(config.base_url, "https://foundry.tylertechai.com")
        self.assertEqual(config.tenant, "dev")
        self.assertEqual(config.agent_id, "754773e3-5009-4a52-851d-14a1688c2a90")
        self.assertIsNone(config.api_key)
        self.assertFalse(has_key(config))

    def test_env_overrides_defaults(self):
        config = read_config(
            {
                "FOUNDRY_BASE_URL": "https://example.test/",
                "FOUNDRY_TENANT": "other",
                "CRM_AGENT_ID": "agent-1",
                "FOUNDRY_API_KEY": "k1",
            },
            copilot_env_path=MISSING,
        )
        self.assertEqual(config.base_url, "https://example.test")
        self.assertEqual(config.tenant, "other")
        self.assertEqual(config.agent_id, "agent-1")
        self.assertEqual(config.api_key, "k1")

    def test_placeholder_key_is_unset(self):
        for placeholder in ("<your key>", "replace-me", "   "):
            config = read_config({"FOUNDRY_API_KEY": placeholder}, copilot_env_path=MISSING)
            self.assertFalse(has_key(config), placeholder)

    def test_key_falls_back_to_copilot_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / ".env"
            env_file.write_text(
                "# comment\nDYNAMICS_MCP_TOKEN=secret-token\nDYNAMICS_MCP_URL=https://mcp.test\nFoundryAPIKey=abc123\n",
                encoding="utf-8",
            )
            config = read_config({}, copilot_env_path=env_file)
        self.assertEqual(config.api_key, "abc123")
        values = json.dumps(vars(config))
        self.assertNotIn("secret-token", values)
        self.assertNotIn("mcp.test", values)

    def test_fallback_path_comes_from_env_var(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / ".env"
            env_file.write_text('FoundryAPIKey="quoted-key"\n', encoding="utf-8")
            config = read_config({"ANALYST_COPILOT_ENV": str(env_file)})
        self.assertEqual(config.api_key, "quoted-key")

    def test_env_key_wins_over_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / ".env"
            env_file.write_text("FoundryAPIKey=from-file\n", encoding="utf-8")
            config = read_config({"FOUNDRY_API_KEY": "from-env"}, copilot_env_path=env_file)
        self.assertEqual(config.api_key, "from-env")


class StreamParsingTests(unittest.TestCase):
    def test_iter_sse_handles_multiline_and_comments(self):
        lines = [": ping", "event: message", 'data: {"type":"text-delta",', 'data: "payload":{"text":"Hi"}}', ""]
        self.assertEqual(
            list(iter_sse(lines)),
            [("message", '{"type":"text-delta",\n"payload":{"text":"Hi"}}')],
        )

    def test_iter_sse_flushes_trailing_message_without_blank_line(self):
        self.assertEqual(list(iter_sse(["data: tail"])), [(None, "tail")])

    def test_text_from_event_ignores_other_types(self):
        self.assertIsNone(text_from_event(None, '{"type":"tool-call","payload":{"text":"x"}}'))
        self.assertIsNone(text_from_event(None, "[DONE]"))
        self.assertIsNone(text_from_event(None, "not json"))
        self.assertEqual(text_from_event(None, '{"type":"text-delta","payload":{"text":"a"}}'), "a")
        self.assertEqual(text_from_event("text-delta", '{"text":"b"}'), "b")

    def test_extract_json_takes_last_fence(self):
        self.assertEqual(extract_json('x ```json\n[1]\n``` y ```json\n{"a":2}\n```'), {"a": 2})
        self.assertEqual(extract_json("Here: [3, 4]"), [3, 4])
        self.assertIsNone(extract_json("```json\nnull\n```"))
        with self.assertRaises(AgentReplyError):
            extract_json("no json")
        with self.assertRaises(AgentReplyError):
            extract_json("```json\n[1, 2\n```")


class RunJsonTests(unittest.TestCase):
    def config(self):
        return read_config({"FOUNDRY_API_KEY": "test-key-123"}, copilot_env_path=MISSING)

    def test_run_json_posts_expected_request(self):
        session = FakeSession(FakeResponse(lines=sse_lines("```json\n[[1, ", '"a"]]\n```')))
        client = AgentClient(self.config(), session=session, timeout=12)
        prompt = AGENT_READ_ONLY + "\nDo something."

        result = client.run_json(prompt, "account lookup")

        self.assertEqual(result, [[1, "a"]])
        self.assertEqual(len(session.calls), 1)
        url, kwargs = session.calls[0]
        self.assertEqual(url, "https://foundry.tylertechai.com/api/agents/754773e3-5009-4a52-851d-14a1688c2a90/stream")
        self.assertEqual(kwargs["headers"]["X-API-Key"], "test-key-123")
        self.assertEqual(kwargs["headers"]["X-Tenant-Slug"], "dev")
        self.assertEqual(kwargs["headers"]["Accept"], "text/event-stream")
        self.assertTrue(kwargs["stream"])
        self.assertEqual(kwargs["timeout"], 12)
        body = kwargs["json"]
        self.assertRegex(body["threadId"], r"^[A-Za-z0-9_-]{1,100}$")
        self.assertEqual(body["messages"], [{"role": "user", "content": prompt}])
        self.assertTrue(session.response.closed)

    def test_each_call_gets_a_new_thread(self):
        session = FakeSession(FakeResponse(lines=sse_lines("[1]")))
        client = AgentClient(self.config(), session=session)
        client.run_json("p", "x")
        session.response = FakeResponse(lines=sse_lines("[2]"))
        client.run_json("p", "x")
        self.assertNotEqual(session.calls[0][1]["json"]["threadId"], session.calls[1][1]["json"]["threadId"])

    def test_run_json_http_401_raises_with_hint(self):
        session = FakeSession(FakeResponse(status_code=401, text="unauthorized test-key-123"))
        client = AgentClient(self.config(), session=session)
        with self.assertRaises(AgentHttpError) as ctx:
            client.run_json("p", "x")
        self.assertEqual(ctx.exception.status, 401)
        self.assertIn("FOUNDRY_API_KEY", str(ctx.exception))
        self.assertNotIn("test-key-123", str(ctx.exception))

    def test_run_json_without_key_raises_before_any_call(self):
        session = FakeSession(FakeResponse(lines=sse_lines("[1]")))
        client = AgentClient(read_config({}, copilot_env_path=MISSING), session=session)
        with self.assertRaises(crm_agent.AgentError):
            client.run_json("p", "x")
        self.assertEqual(session.calls, [])

    def test_run_json_empty_reply_raises_reply_error(self):
        session = FakeSession(FakeResponse(lines=sse_lines()))
        client = AgentClient(self.config(), session=session)
        with self.assertRaises(AgentReplyError):
            client.run_json("p", "x")


class ValidationTests(unittest.TestCase):
    def test_assert_account_number(self):
        self.assertEqual(assert_account_number("42004"), "42004")
        self.assertEqual(assert_account_number(" 1007 "), "1007")
        for bad in ("42004 or 1 eq 1", "abc", "12", "", "12345678", "42'004"):
            with self.assertRaises(ValueError, msg=bad):
                assert_account_number(bad)

    def test_assert_guid(self):
        self.assertEqual(
            crm_agent.assert_guid("F8A3BAD0-18F1-47B1-BE14-E0127687C8D4"),
            "f8a3bad0-18f1-47b1-be14-e0127687c8d4",
        )
        with self.assertRaises(ValueError):
            crm_agent.assert_guid("f8a3bad0' or 1 eq 1")


class HasKeyCliTests(unittest.TestCase):
    def run_cli(self, extra_env):
        env = {k: v for k, v in os.environ.items() if k not in ("FOUNDRY_API_KEY", "ANALYST_COPILOT_ENV")}
        env.update(extra_env)
        return subprocess.run(
            [sys.executable, str(ROOT / "crm_agent.py"), "--has-key"],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )

    def test_has_key_cli_exit_codes(self):
        with_key = self.run_cli({"FOUNDRY_API_KEY": "cli-secret-key", "ANALYST_COPILOT_ENV": str(MISSING)})
        self.assertEqual(with_key.returncode, 0)
        self.assertNotIn("cli-secret-key", with_key.stdout + with_key.stderr)

        without_key = self.run_cli({"ANALYST_COPILOT_ENV": str(MISSING)})
        self.assertEqual(without_key.returncode, 1)


if __name__ == "__main__":
    unittest.main()
