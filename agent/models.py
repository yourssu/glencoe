from __future__ import annotations

from dataclasses import dataclass


@dataclass
class SlackEvent:
    channel: str
    thread_ts: str | None
    ts: str
    user: str
    text: str
    bot_id: str | None = None

    @property
    def conversation_thread_ts(self) -> str:
        return self.thread_ts or self.ts
