import type { WebClient } from "@slack/web-api";
import type { KnownBlock } from "@slack/types";
import type { ShookieBlock } from "../types/block.js";
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

// task_update chunk 스키마를 한 번 성공한 것으로 고정해 재시도 낭비 방지.
// docs에 3가지 형태가 섞여 있어 첫 호출에서 확정.
let preferredSchema: "flat" | "nested" | null = null;

/**
 * chat.startStream 호출로 plan 표시 모드 스트림을 시작.
 * Bolt 4.x WebClient에 타입된 메서드가 없어 apiCall로 직접 호출.
 *
 * team_id 파라미터명이 문서화되어 있지 않지만 실제로는 team_id로는
 * 부족하고 recipient_team_id가 필요함 (Slack Connect 계열 API 규칙).
 * team_id 시도 → missing_recipient_team_id 에러 시 recipient_team_id로 폴백.
 *
 * 실패 시 예외 throw — 호출부에서 폴백(chat.postMessage) 처리.
 */
export async function startPlanStream(
  client: WebClient,
  channel: string,
  threadTs: string,
  teamId?: string,
): Promise<StreamSession> {
  const baseArgs = {
    channel,
    thread_ts: threadTs,
    task_display_mode: "plan",
  };

  // 1차: team_id
  if (teamId) {
    try {
      const res = (await client.apiCall("chat.startStream", {
        ...baseArgs,
        team_id: teamId,
      })) as StreamResponse;
      if (res.ok && res.ts) {
        return { channel, messageTs: res.ts, threadTs };
      }
      // missing_recipient_team_id 외 에러는 그대로 throw
      if (res.error !== "missing_recipient_team_id") {
        throw new Error(`chat.startStream failed: ${res.error ?? "unknown"}`);
      }
      logger.warn(
        `[${logTag}] team_id 거부됨, recipient_team_id로 재시도`,
      );
    } catch (err) {
      // missing_recipient_team_id 아니면 그대로 throw
      if (err instanceof Error && !err.message.includes("missing_recipient_team_id")) {
        throw err;
      }
      logger.warn(
        `[${logTag}] team_id 예외, recipient_team_id로 재시도:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // 2차: recipient_team_id (Slack Connect 계열 파라미터명)
  const res = (await client.apiCall("chat.startStream", {
    ...baseArgs,
    ...(teamId ? { recipient_team_id: teamId } : {}),
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
 * chunk 스키마는 첫 호출에서 확정되어 preferredSchema에 캐싱됨.
 * 이후 호출은 해당 스키마만 사용 — 불필요한 폴백 재시도 방지.
 */
export async function appendTaskUpdate(
  session: StreamSession,
  client: WebClient,
  chunk: TaskChunk,
): Promise<void> {
  if (preferredSchema === "flat") {
    return sendChunk(client, session, chunk, "flat");
  }
  if (preferredSchema === "nested") {
    return sendChunk(client, session, chunk, "nested");
  }

  // 프로브: 평면 형태 먼저 시도
  try {
    await sendChunk(client, session, chunk, "flat");
    preferredSchema = "flat";
    logger.info(`[${logTag}] chunk 스키마 확정: flat`);
    return;
  } catch (err) {
    if (!isInvalidChunksError(err)) throw err;
    logger.warn(
      `[${logTag}] 평면 chunk 형태 거부됨(invalid_chunks), 중첩 형태로 전환`,
    );
  }

  // 폴백: 중첩 형태
  await sendChunk(client, session, chunk, "nested");
  preferredSchema = "nested";
  logger.info(`[${logTag}] chunk 스키마 확정: nested`);
}

function isInvalidChunksError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message.includes("invalid_chunks");
  }
  return false;
}

async function sendChunk(
  client: WebClient,
  session: StreamSession,
  chunk: TaskChunk,
  schema: "flat" | "nested",
): Promise<void> {
  const baseArgs = {
    channel: session.channel,
    ts: session.messageTs,
    thread_ts: session.threadTs,
  };

  const taskChunk =
    schema === "flat"
      ? {
          type: "task_update" as const,
          id: chunk.id,
          title: chunk.title,
          status: chunk.status,
          ...(chunk.details ? { details: chunk.details } : {}),
        }
      : {
          type: "task_update" as const,
          task: {
            task_id: chunk.id,
            title: chunk.title,
            status: chunk.status,
            ...(chunk.details ? { details: chunk.details } : {}),
          },
        };

  const res = (await client.apiCall("chat.appendStream", {
    ...baseArgs,
    chunks: [taskChunk],
  })) as StreamResponse;

  if (!res.ok) {
    throw new Error(`chat.appendStream failed: ${res.error ?? "unknown"}`);
  }
}

/**
 * chat.stopStream으로 스트림 종료 + 최종 본문/블록 전송.
 * blocks는 stopStream에서만 허용됨 (startStream/appendStream은 불가).
 *
 * ShookieBlock 배열을 받지만 apiCall 시점에 KnownBlock[]로 캐스팅 —
 * context_actions는 런타임에 유효하나 @slack/types@2.21의 KnownBlock
 * union에 아직 포함되지 않았기 때문.
 */
export async function stopStreamWithBlocks(
  session: StreamSession,
  client: WebClient,
  text: string,
  blocks: ShookieBlock[],
): Promise<void> {
  const res = (await client.apiCall("chat.stopStream", {
    channel: session.channel,
    ts: session.messageTs,
    thread_ts: session.threadTs,
    text,
    blocks: blocks as KnownBlock[],
  })) as StreamResponse;

  if (!res.ok) {
    throw new Error(`chat.stopStream failed: ${res.error ?? "unknown"}`);
  }
}
