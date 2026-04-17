import re

from agent.orchestrator import Orchestrator
from slack_bolt import App


def register_handlers(app: App, orchestrator: Orchestrator) -> None:

    @app.event("app_mention")
    def handle_app_mention(event, say):
        if event.get("bot_id"):
            return
        text = re.sub(r"<@[A-Z0-9]+>", "", event.get("text", "")).strip()
        if not text:
            say("네, 무엇을 도와드릴까요?", thread_ts=event.get("thread_ts", event["ts"]))
            return
        thread_ts = event.get("thread_ts", event["ts"])
        _respond(orchestrator, text, event["channel"], thread_ts, say)

    @app.event("message")
    def handle_message(event, say):
        if event.get("bot_id"):
            return
        text = event.get("text", "")
        if "glen" not in text:
            return
        query = text.replace("glen", "").strip()
        if not query:
            say("네, 무엇을 도와드릴까요?", thread_ts=event.get("thread_ts", event["ts"]))
            return
        thread_ts = event.get("thread_ts", event["ts"])
        _respond(orchestrator, query, event["channel"], thread_ts, say)


def _respond(orchestrator: Orchestrator, query: str, channel: str, thread_ts: str, say) -> None:
    try:
        answer = orchestrator.process_message(query, channel, thread_ts)
        say(answer, thread_ts=thread_ts)
    except Exception:
        say("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.", thread_ts=thread_ts)
