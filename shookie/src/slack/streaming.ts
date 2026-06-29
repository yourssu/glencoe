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
  details?: string;  // 요약 — 최대 256자
  output?: string;   // 결과 본문 — rich_text로 감싸져 전송, 최대 ~3000자
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
 * chat.startStream은 Slack Connect 계열 API라 recipient_team_id와
 * recipient_user_id를 시리즈로 요구. 같은 워크스페이스여도 필요.
 *   - recipient_team_id: 이벤트 team 필드
 *   - recipient_user_id: 메시지 보낸 사용자 ID
 *
 * 실패 시 예외 throw — 호출부에서 폴백(chat.postMessage) 처리.
 */
export async function startPlanStream(
  client: WebClient,
  channel: string,
  threadTs: string,
  teamId?: string,
  userId?: string,
): Promise<StreamSession> {
  const res = (await client.apiCall("chat.startStream", {
    channel,
    thread_ts: threadTs,
    task_display_mode: "plan",
    ...(teamId ? { recipient_team_id: teamId } : {}),
    ...(userId ? { recipient_user_id: userId } : {}),
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

  // output 필드는 rich_text 객체로 감싸서 전송 (Slack 스펙).
  // details는 string 그대로.
  const outputRichText = chunk.output
    ? {
        output: {
          type: "rich_text" as const,
          elements: [
            {
              type: "rich_text_section" as const,
              elements: [{ type: "text" as const, text: chunk.output }],
            },
          ],
        },
      }
    : {};

  const taskChunk =
    schema === "flat"
      ? {
          type: "task_update" as const,
          id: chunk.id,
          title: chunk.title,
          status: chunk.status,
          ...(chunk.details ? { details: chunk.details } : {}),
          ...outputRichText,
        }
      : {
          type: "task_update" as const,
          task: {
            task_id: chunk.id,
            title: chunk.title,
            status: chunk.status,
            ...(chunk.details ? { details: chunk.details } : {}),
            ...outputRichText,
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
