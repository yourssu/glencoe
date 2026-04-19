import logging
import re
import traceback

from agent.orchestrator import Orchestrator
from slack_bolt import App

logger = logging.getLogger(__name__)

THINKING_TEXT = "생각하는 중..."


def register_handlers(app: App, orchestrator: Orchestrator) -> None:

    @app.event("app_mention")
    def handle_app_mention(event, say, client):
        if event.get("bot_id"):
            return
        text = re.sub(r"<@[A-Z0-9]+>", "", event.get("text", "")).strip()
        logger.info(f"app_mention: user={event.get('user')}, text={text}")
        if not text:
            say("네, 무엇을 도워드릴까요?", thread_ts=event.get("thread_ts", event["ts"]))
            return
        thread_ts = event.get("thread_ts", event["ts"])
        _respond(orchestrator, app, text, event["channel"], thread_ts)

    @app.event("message")
    def handle_dm(event, say, client):
        if event.get("bot_id"):
            return
        if event.get("channel_type") != "im":
            return
        text = event.get("text", "").strip()
        if not text:
            return
        logger.info(f"dm: user={event.get('user')}, text={text}")
        thread_ts = event.get("thread_ts", event["ts"])
        _respond(orchestrator, app, text, event["channel"], thread_ts)


def _respond(orchestrator: Orchestrator, app: App, query: str, channel: str, thread_ts: str) -> None:
    try:
        thinking = app.client.chat_postMessage(
            channel=channel, text=THINKING_TEXT, thread_ts=thread_ts
        )
        answer = orchestrator.process_message(query, channel, thread_ts)
        app.client.chat_update(
            channel=channel, ts=thinking["message"]["ts"], text=answer
        )
    except Exception as e:
        logger.error(f"Error processing message: {e}\n{traceback.format_exc()}")
        app.client.chat_postMessage(
            channel=channel,
            text="일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
            thread_ts=thread_ts,
        )
