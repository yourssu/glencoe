import type { WebClient } from "@slack/web-api";
import type { KnownBlock } from "@slack/types";
import { logger } from "../logger.js";

export interface StreamSession {
  channel: string;
  messageTs: string;
  threadTs: string;
}

export type TaskStatus = "pending" | "in_progress" | "complete" | "error";

export interface TaskChunk {
  id: string;
  title: string;
  status: TaskStatus;
  details?: string;
}

interface StreamResponse {
  ok: boolean;
  error?: string;
  channel?: string;
  ts?: string;
}

const logTag = "streaming";

/**
 * chat.startStream 호출로 plan 표시 모드 스트림을 시작.
 * Bolt 4.x WebClient에 타입된 메서드가 없어 apiCall로 직접 호출.
 *
 * 실패 시 예외 throw — 호출부에서 폴백(chat.postMessage) 처리.
 */
export async function startPlanStream(
  client: WebClient,
  channel: string,
  threadTs: string,
): Promise<StreamSession> {
  const res = (await client.apiCall("chat.startStream", {
    channel,
    thread_ts: threadTs,
    task_display_mode: "plan",
  })) as StreamResponse;

  if (!res.ok || !res.ts) {
    throw new Error(`chat.startStream failed: ${res.error ?? "unknown"}`);
  }

  return { channel, messageTs: res.ts, threadTs };
}

/**
 * chat.appendStream으로 task_update chunk 전송.
 * 도구 시작/완료 시각을 plan 블록에 반영.
 *
 * chunk 스키마: docs에 3가지 형태가 섞여 있어 평면 형태 우선,
 * 실패 시 중첩 형태로 폴백. 어느 쪽이 실제 동작하는지 런타임에 확정됨.
 */
export async function appendTaskUpdate(
  session: StreamSession,
  client: WebClient,
  chunk: TaskChunk,
): Promise<void> {
  const baseArgs = {
    channel: session.channel,
    ts: session.messageTs,
    thread_ts: session.threadTs,
  };

  // 1차 시도: 평면 형태 (appendStream 메서드 doc 기준)
  try {
    const res = (await client.apiCall("chat.appendStream", {
      ...baseArgs,
      chunks: [
        {
          type: "task_update",
          id: chunk.id,
          title: chunk.title,
          status: chunk.status,
          ...(chunk.details ? { details: chunk.details } : {}),
        },
      ],
    })) as StreamResponse;

    if (res.ok) return;
    // invalid_chunks 가 아니면 재시도해봤자 의미 없음 — 그대로 throw
    if (res.error !== "invalid_chunks") {
      throw new Error(`chat.appendStream failed: ${res.error ?? "unknown"}`);
    }
    logger.warn(
      `[${logTag}] 평면 chunk 형태 거부됨(invalid_chunks), 중첩 형태로 재시도`,
    );
  } catch (err) {
    // apiCall 자체 예외 (네트워크 등) — 일단 중첩 형태로 재시도
    logger.warn(
      `[${logTag}] appendStream 평면 형태 예외, 중첩 형태로 재시도:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // 2차 시도: 중첩 형태 (developing-agents doc 예제 기준)
  const res2 = (await client.apiCall("chat.appendStream", {
    ...baseArgs,
    chunks: [
      {
        type: "task_update",
        task: {
          task_id: chunk.id,
          title: chunk.title,
          status: chunk.status,
          ...(chunk.details ? { details: chunk.details } : {}),
        },
      },
    ],
  })) as StreamResponse;

  if (!res2.ok) {
    throw new Error(`chat.appendStream failed: ${res2.error ?? "unknown"}`);
  }
}

/**
 * chat.stopStream으로 스트림 종료 + 최종 본문/블록 전송.
 * blocks는 stopStream에서만 허용됨 (startStream/appendStream은 불가).
 */
export async function stopStreamWithBlocks(
  session: StreamSession,
  client: WebClient,
  text: string,
  blocks: KnownBlock[],
): Promise<void> {
  const res = (await client.apiCall("chat.stopStream", {
    channel: session.channel,
    ts: session.messageTs,
    thread_ts: session.threadTs,
    text,
    blocks,
  })) as StreamResponse;

  if (!res.ok) {
    throw new Error(`chat.stopStream failed: ${res.error ?? "unknown"}`);
  }
}
