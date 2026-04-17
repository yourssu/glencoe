from agent.conversation_store import InMemoryConversationStore
from agent.orchestrator import Orchestrator
from config import settings
from handlers.mention import register_handlers
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler
from tools.registry import ToolRegistry


def create_app() -> App:
    app = App(token=settings.slack_bot_token)

    registry = ToolRegistry()

    # 도구 등록: if settings.xxx_key: registry.register(XxxTool(...))

    conversation_store = InMemoryConversationStore(
        max_messages=settings.max_history_messages,
    )
    orchestrator = Orchestrator(registry, conversation_store)

    register_handlers(app, orchestrator)
    return app


if __name__ == "__main__":
    app = create_app()
    handler = SocketModeHandler(app, settings.slack_app_token)
    handler.start()
