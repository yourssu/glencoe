import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

from agent.conversation_store import InMemoryConversationStore
from agent.orchestrator import Orchestrator
from config import settings
from handlers.mention import register_handlers
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler
from tools.posthog.client import PostHogClient
from tools.posthog.tool import PostHogTool
from tools.registry import ToolRegistry


def create_app() -> App:
    app = App(token=settings.slack_bot_token)

    registry = ToolRegistry()

    if settings.posthog_api_key and settings.posthog_project_id:
        ph_client = PostHogClient(settings.posthog_api_key, settings.posthog_project_id)
        registry.register(PostHogTool(ph_client))

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
