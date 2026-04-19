from __future__ import annotations

import json
import logging

import httpx

from agent.conversation_store import InMemoryConversationStore
from agent.prompt_builder import build_system_prompt
from config import settings
from tools.registry import ToolRegistry

logger = logging.getLogger(__name__)


class Orchestrator:
    def __init__(self, tool_registry: ToolRegistry, conversation_store: InMemoryConversationStore):
        self._registry = tool_registry
        self._store = conversation_store
        self._system_prompt = build_system_prompt()

    def process_message(
        self,
        user_message: str,
        channel_id: str,
        thread_ts: str,
    ) -> str:
        self._store.add_message(channel_id, thread_ts, {
            "role": "user",
            "content": user_message,
        })

        messages = self._store.get_history(channel_id, thread_ts)
        tools = self._registry.get_all_schemas()

        for _ in range(settings.max_tool_iterations):
            body = {
                "model": settings.model,
                "max_completion_tokens": 4096,
                "messages": [{"role": "system", "content": self._system_prompt}] + messages,
            }
            if tools:
                body["tools"] = tools

            data = self._call_api(body)
            if data is None:
                return "LLM API 호출에 실패했습니다. 잠시 후 다시 시도해주세요."

            choice = data["choices"][0]
            message = choice["message"]

            if choice["finish_reason"] == "stop":
                text = message.get("content") or ""
                self._store.add_message(channel_id, thread_ts, {
                    "role": "assistant",
                    "content": text,
                })
                return text

            if choice["finish_reason"] == "tool_calls":
                assistant_msg = {
                    "role": "assistant",
                    "content": message.get("content"),
                    "tool_calls": [
                        {
                            "id": tc["id"],
                            "type": "function",
                            "function": tc["function"],
                        }
                        for tc in message.get("tool_calls", [])
                    ],
                }
                messages.append(assistant_msg)
                self._store.add_message(channel_id, thread_ts, assistant_msg)

                for tc in message.get("tool_calls", []):
                    params = json.loads(tc["function"]["arguments"])
                    result = self._registry.execute(tc["function"]["name"], params)
                    tool_msg = {
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": result,
                    }
                    messages.append(tool_msg)
                    self._store.add_message(channel_id, thread_ts, tool_msg)

        return "죄송합니다, 처리 시간이 너무 길어졌습니다. 다시 시도해주세요."

    def _call_api(self, body: dict) -> dict | None:
        url = f"{settings.llm_base_url}chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.llm_api_key}",
        }
        try:
            resp = httpx.post(url, headers=headers, json=body, timeout=30.0)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"LLM API error: {e.response.status_code} {e.response.text}")
            return None
        except Exception as e:
            logger.error(f"LLM API request failed: {e}")
            return None
