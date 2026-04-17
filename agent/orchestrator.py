from openai import OpenAI

from agent.conversation_store import InMemoryConversationStore
from agent.prompt_builder import build_system_prompt
from config import settings
from tools.registry import ToolRegistry


class Orchestrator:
    def __init__(self, tool_registry: ToolRegistry, conversation_store: InMemoryConversationStore):
        self._registry = tool_registry
        self._store = conversation_store
        self._client = OpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
        )
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
            kwargs = {
                "model": settings.model,
                "max_tokens": 4096,
                "messages": [{"role": "system", "content": self._system_prompt}] + messages,
            }
            if tools:
                kwargs["tools"] = tools

            response = self._client.chat.completions.create(**kwargs)
            choice = response.choices[0]
            message = choice.message

            if choice.finish_reason == "stop":
                self._store.add_message(channel_id, thread_ts, {
                    "role": "assistant",
                    "content": message.content or "",
                })
                return message.content or ""

            if choice.finish_reason == "tool_calls":
                assistant_msg = {
                    "role": "assistant",
                    "content": message.content,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            },
                        }
                        for tc in message.tool_calls
                    ],
                }
                messages.append(assistant_msg)
                self._store.add_message(channel_id, thread_ts, assistant_msg)

                for tc in message.tool_calls:
                    import json
                    params = json.loads(tc.function.arguments)
                    result = self._registry.execute(tc.function.name, params)
                    tool_msg = {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": result,
                    }
                    messages.append(tool_msg)
                    self._store.add_message(channel_id, thread_ts, tool_msg)

        return "죄송합니다, 처리 시간이 너무 길어졌습니다. 다시 시도해주세요."
