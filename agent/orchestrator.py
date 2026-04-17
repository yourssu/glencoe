import anthropic
from agent.conversation_store import InMemoryConversationStore
from agent.prompt_builder import build_system_prompt
from config import settings
from tools.registry import ToolRegistry


class Orchestrator:
    def __init__(self, tool_registry: ToolRegistry, conversation_store: InMemoryConversationStore):
        self._registry = tool_registry
        self._store = conversation_store
        self._client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
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
            response = self._client.messages.create(
                model=settings.model,
                max_tokens=4096,
                system=self._system_prompt,
                tools=tools if tools else [],
                messages=messages,
            )

            if response.stop_reason == "end_turn":
                text = self._extract_text(response.content)
                self._store.add_message(channel_id, thread_ts, {
                    "role": "assistant",
                    "content": text,
                })
                return text

            if response.stop_reason == "tool_use":
                tool_results = []
                assistant_content = []

                for block in response.content:
                    assistant_content.append(block)
                    if block.type == "tool_use":
                        result = self._registry.execute(block.name, block.input)
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": result,
                        })

                messages.append({"role": "assistant", "content": assistant_content})
                messages.append({"role": "user", "content": tool_results})

                self._store.add_message(channel_id, thread_ts, {
                    "role": "assistant",
                    "content": assistant_content,
                })
                self._store.add_message(channel_id, thread_ts, {
                    "role": "user",
                    "content": tool_results,
                })

        return "죄송합니다, 처리 시간이 너무 길어졌습니다. 다시 시도해주세요."

    def _extract_text(self, content) -> str:
        parts = []
        for block in content:
            if block.type == "text":
                parts.append(block.text)
        return "\n".join(parts)
