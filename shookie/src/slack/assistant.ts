import type { App } from "@slack/bolt";
import { logger } from "../logger.js";

const logTag = "assistant";

// assistant_thread_context_changed 이벤트로 수집한 "현재 사용자가 보고 있는 채널" 매핑.
// key: threadTs, value: channelId. 서버 재시작 시 휘발됨 (MVP).
const MAX_CHANNEL_CONTEXT = 1000;
const channelContext = new Map<string, string>();

function setChannel(threadTs: string, channelId: string): void {
  // Map은 삽입 순서를 보존하므로, 초과 시 가장 오래된 항목부터 제거 (FIFO/LRU).
  if (channelContext.size >= MAX_CHANNEL_CONTEXT && !channelContext.has(threadTs)) {
    const oldest = channelContext.keys().next().value;
    if (oldest !== undefined) channelContext.delete(oldest);
  }
  channelContext.set(threadTs, channelId);
}

/**
 * 특정 스레드의 현재 컨텍스트 채널 ID 반환.
 * handleConversation에서 prompt에 "현재 보고 있는 채널: #X" 주입에 사용.
 */
export function getCurrentChannel(threadTs: string): string | undefined {
  return channelContext.get(threadTs);
}

/**
 * Agents & AI Apps 기능 관련 핸들러 등록.
 * - assistant_thread_started: 환영 로깅만 (suggested prompts 미표시 — 사용자 결정)
 * - assistant_thread_context_changed: 채널 ID를 세션 Map에 저장 (사용자 결정)
 * - shookie_feedback action: 피드백 로깅만 (DB 없이 logger.info — 사용자 결정)
 */
export function registerAssistantHandlers(app: App): void {
  app.event("assistant_thread_started", async ({ event }) => {
    const ev = event as { thread_ts?: string; channel_id?: string };
    logger.info(
      `[${logTag}] thread started: thread=${ev.thread_ts ?? "?"} channel=${ev.channel_id ?? "?"}`,
    );
    // setSuggestedPrompts는 호출하지 않음 — 사용자가 추천 질문 미표시로 결정.
  });

  app.event("assistant_thread_context_changed", async ({ event }) => {
    const ev = event as { thread_ts?: string; channel_id?: string };
    if (ev.thread_ts && ev.channel_id) {
      setChannel(ev.thread_ts, ev.channel_id);
      logger.info(
        `[${logTag}] context changed: thread=${ev.thread_ts} → ${ev.channel_id}`,
      );
    }
  });

  app.action("shookie_feedback", async ({ action, body, ack }) => {
    await ack();
    const value = (action as { value?: string }).value;
    const userId = (body as { user?: { id?: string } }).user?.id;
    const msg = (body as { message?: { thread_ts?: string; ts?: string } }).message;
    const threadTs = msg?.thread_ts ?? msg?.ts;
    logger.info(
      `[${logTag}] feedback: user=${userId ?? "?"} thread=${threadTs ?? "?"} value=${value ?? "?"}`,
    );
  });
}
