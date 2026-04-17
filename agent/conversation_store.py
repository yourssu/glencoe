import threading
from collections import defaultdict


class InMemoryConversationStore:
    def __init__(self, max_messages: int = 30):
        self._history: dict[str, list[dict]] = defaultdict(list)
        self._max_messages = max_messages
        self._lock = threading.Lock()

    def _key(self, channel_id: str, thread_ts: str) -> str:
        return f"{channel_id}:{thread_ts}"

    def get_history(self, channel_id: str, thread_ts: str) -> list[dict]:
        with self._lock:
            return list(self._history[self._key(channel_id, thread_ts)])

    def add_message(self, channel_id: str, thread_ts: str, message: dict) -> None:
        key = self._key(channel_id, thread_ts)
        with self._lock:
            self._history[key].append(message)
            if len(self._history[key]) > self._max_messages:
                self._history[key] = self._history[key][-self._max_messages:]

    def clear(self, channel_id: str, thread_ts: str) -> None:
        key = self._key(channel_id, thread_ts)
        with self._lock:
            self._history.pop(key, None)
