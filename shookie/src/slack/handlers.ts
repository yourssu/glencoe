import type { App } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import type { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { InMemoryConversationStore, type Message } from "../services/memory/in-memory.js";
import { buildSessionId, extractText } from "./thread-context.js";
import { convertMarkdownToBlocks } from "./markdown-to-blocks.js";
import {
  startPlanStream,
  appendTaskUpdate,
  stopStreamWithBlocks,
  type StreamSession,
} from "./streaming.js";
import { getCurrentChannel } from "./assistant.js";
import type { ShookieBlock } from "../types/block.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { ensureThreadCapacity } from "../tools/code-explorer/workspace-manager.js";
import {
  logAgentCall,
  startAgentCall,
  completeAgentCall,
  startInvocation,
  completeInvocation,
  logToolCall,
} from "database";
import { invocationStorage } from "../agent/invocation-context.js";

const store = new InMemoryConversationStore();

const TOOL_PROGRESS_MESSAGES: Record<string, string> = {
  posthog_agent: "🔍 PostHog 데이터 분석 중...",
  code_explorer_agent: "🔬 코드 탐색 중...",
};

/**
 * chat.postMessage 래퍼 — 스트리밍 실패 시 폴백 등 여러 곳에서 중복 사용.
 * ShookieBlock[]은 context_actions를 포함할 수 있어 KnownBlock[]로 캐스팅.
 */
async function postToThread(
  app: App,
  channel: string,
  threadTs: string,
  text: string,
  blocks?: ShookieBlock[],
): Promise<void> {
  await app.client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text,
    ...(blocks ? { blocks: blocks as KnownBlock[] } : {}),
  });
}

export function registerHandlers(app: App, agent: Agent): void {
  app.event("app_mention", async ({ event, client }) => {
    if ("bot_id" in event && event.bot_id) return;

    const text = extractText(event.text);
    if (!text) {
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.thread_ts ?? event.ts,
        text: "네, 무엇을 도와드릴까요?",
      });
      return;
    }

    const team = (event as { team?: string }).team;
    await handleConversation(app, agent, text, event.channel, event.thread_ts ?? event.ts, event.user ?? "unknown", team);
  });

  app.event("message", async ({ event, client }) => {
    if ("bot_id" in event && event.bot_id) return;
    if ("channel_type" in event && event.channel_type !== "im") return;

    const text = extractText((event as { text?: string }).text);
    if (!text) return;

    const msgEvent = event as { channel: string; thread_ts?: string; ts: string; user?: string; team?: string };
    await handleConversation(app, agent, text, msgEvent.channel, msgEvent.thread_ts ?? msgEvent.ts, msgEvent.user ?? "unknown", msgEvent.team);
  });
}

async function handleConversation(
  app: App,
  agent: Agent,
  userText: string,
  channel: string,
  threadTs: string,
  userId: string,
  teamId?: string,
): Promise<void> {
  const sessionId = buildSessionId(channel, threadTs);
  let mainInvocationId: number | null = null;
  let streamSession: StreamSession | null = null;

  try {
    logger.info(`📩 메시지 수신: "${userText.slice(0, 100)}"`);

    await ensureThreadCapacity(config.THREAD_WORKSPACE_BASE_PATH, config.THREAD_WORKSPACE_MAX_GB);

    store.add(sessionId, { role: "user", content: userText });

    const history = store.buildMessages(sessionId);
    const currentChannel = getCurrentChannel(threadTs);
    const channelContextPrefix = currentChannel
      ? `[사용자가 현재 보고 있는 채널 ID: ${currentChannel}]\n\n`
      : "";
    const prompt =
      channelContextPrefix +
      history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");

    const callCtx = await startAgentCall({ userId, channel, threadTs, question: userText });
    mainInvocationId = callCtx
      ? await startInvocation({
          agentCallId: callCtx.agentCallId,
          parentInvocationId: null,
          agentName: "main-shookie",
          task: userText,
        })
      : null;

    // Slack plan 스트림 열기 (실패 시 폴백: 이후 도구/최종 응답은 chat.postMessage로)
    try {
      streamSession = await startPlanStream(app.client, channel, threadTs, teamId);
      logger.info(`[streaming] plan 스트림 열림: ts=${streamSession.messageTs}`);
    } catch (err) {
      logger.warn(
        "[streaming] startPlanStream 실패, postMessage 폴백 모드:",
        err instanceof Error ? err.message : String(err),
      );
      streamSession = null;
    }

    const runConversation = async () => {
      logger.info("🤖 응답 스트리밍 시작...");
      const requestContext = new RequestContext([
        ["channel", channel],
        ["threadTs", threadTs],
      ]);
      const streamResult = await agent.stream([{ role: "user", content: prompt }], {
        maxSteps: config.MAX_TOOL_ITERATIONS,
        requestContext,
      });

      const toolNamesSeen: string[] = [];

      const reader = streamResult.fullStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (value.type === "tool-call") {
            const payload = (value as {
              payload: { toolName: string; id?: string; toolCallId?: string; args?: unknown };
            }).payload;
            const toolName = payload.toolName;
            // tool-call과 tool-result가 같은 taskId로 매핑되려면 안정적 ID 필수.
            // Date.now() fallback은 두 이벤트가 다른 ID를 만들어 plan 블록이 깨짐.
            const taskId = payload.id ?? payload.toolCallId;
            if (!toolNamesSeen.includes(toolName)) {
              toolNamesSeen.push(toolName);
            }

            if (streamSession && taskId) {
              const argsSummary = payload.args
                ? JSON.stringify(payload.args).slice(0, 200)
                : undefined;
              try {
                await appendTaskUpdate(streamSession, app.client, {
                  id: taskId,
                  title: TOOL_PROGRESS_MESSAGES[toolName] ?? toolName,
                  status: "in_progress",
                  details: argsSummary,
                });
              } catch (err) {
                logger.warn(
                  `[streaming] appendTaskUpdate(in_progress) 실패 (${toolName}):`,
                  err instanceof Error ? err.message : String(err),
                );
              }
            } else if (streamSession && !taskId) {
              logger.warn(
                `[streaming] tool-call 이벤트에 id/toolCallId 없음 — task_update 스킵 (${toolName})`,
              );
            }
          } else if (value.type === "tool-result") {
            const payload = (value as {
              payload: { toolName: string; id?: string; toolCallId?: string };
            }).payload;
            const toolName = payload.toolName;
            const taskId = payload.id ?? payload.toolCallId;

            if (streamSession && taskId) {
              try {
                await appendTaskUpdate(streamSession, app.client, {
                  id: taskId,
                  title: TOOL_PROGRESS_MESSAGES[toolName] ?? toolName,
                  status: "complete",
                });
              } catch (err) {
                logger.warn(
                  `[streaming] appendTaskUpdate(complete) 실패 (${toolName}):`,
                  err instanceof Error ? err.message : String(err),
                );
              }
            } else if (streamSession && !taskId) {
              logger.warn(
                `[streaming] tool-result 이벤트에 id/toolCallId 없음 — task_update 스킵 (${toolName})`,
              );
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      logger.info("🤖 응답 스트리밍 완료");

      const responseText = (await streamResult.text) || "응답을 생성하지 못했습니다.";
      const usage = await streamResult.usage;
      const steps = await streamResult.steps;
      const finishReason = await streamResult.finishReason;

      return { streamResult, responseText, usage, steps, finishReason, toolNamesSeen };
    };

    const alsCtx = callCtx && mainInvocationId
      ? { agentCallId: callCtx.agentCallId, parentInvocationId: mainInvocationId }
      : undefined;

    const conv = alsCtx
      ? await invocationStorage.run(alsCtx, runConversation)
      : await runConversation();

    const { responseText, usage, steps, finishReason, toolNamesSeen } = conv;
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;

    logger.info(`📤 응답 전송: "${responseText.slice(0, 150)}..."`);
    logger.debug("result.usage:", JSON.stringify(usage));
    logger.debug("result.steps count:", steps.length);
    logger.debug("result.text length:", responseText.length);
    logger.debug("result.finishReason:", finishReason);

    for (const [i, step] of steps.entries()) {
      logger.debug(`--- step[${i}] ---`);
      logger.debug(`step[${i}] text length:`, step.text?.length ?? 0);

      for (const tc of step.toolCalls ?? []) {
        logger.debug(`step[${i}] toolCall: ${tc.payload.toolName}`, JSON.stringify(tc.payload.args));
      }
      for (const tr of step.toolResults ?? []) {
        const r = typeof tr.payload.result === "string" ? tr.payload.result : JSON.stringify(tr.payload.result);
        logger.debug(`step[${i}] toolResult:`, r.slice(0, 500));
      }
    }

    if (callCtx && mainInvocationId) {
      for (const [i, step] of steps.entries()) {
        const toolCalls = step.toolCalls ?? [];
        const toolResults = step.toolResults ?? [];
        const resultsById = new Map<string, unknown>();
        for (const tr of toolResults) {
          const id = (tr.payload as { id?: string; toolCallId?: string }).id
            ?? (tr.payload as { toolCallId?: string }).toolCallId;
          if (id) resultsById.set(id, tr.payload.result);
        }
        for (const tc of toolCalls) {
          const id = (tc.payload as { id?: string; toolCallId?: string }).id
            ?? (tc.payload as { toolCallId?: string }).toolCallId;
          const toolName = tc.payload.toolName;
          const input = (tc.payload as { args?: unknown }).args;
          const output = id ? resultsById.get(id) : undefined;
          await logToolCall({
            invocationId: mainInvocationId,
            stepIndex: i,
            toolName,
            input,
            output,
          });
        }
      }

      await completeInvocation(mainInvocationId, {
        status: "success",
        inputTokens,
        outputTokens,
        cachedInputTokens: usage?.cachedInputTokens ?? 0,
        reasoningTokens: usage?.reasoningTokens ?? 0,
        finishReason: typeof finishReason === "string" ? finishReason : String(finishReason ?? ""),
      });

      await completeAgentCall(callCtx.agentCallId, {
        answer: responseText,
        toolsUsed: [...new Set(toolNamesSeen)],
        inputTokens,
        outputTokens,
      });
    } else {
      await logAgentCall({
        userId,
        channel,
        threadTs,
        question: userText,
        answer: responseText,
        toolsUsed: [...new Set(toolNamesSeen)],
        inputTokens,
        outputTokens,
      });
    }

    const debugFooter = [
      `🔧 사용 도구: ${toolNamesSeen.length > 0 ? [...new Set(toolNamesSeen)].join(", ") : "없음"}`,
      `💰 토큰: 입력 ${inputTokens.toLocaleString()} / 출력 ${outputTokens.toLocaleString()}`,
      `💵 비용: $${((inputTokens * 0.435 + outputTokens * 0.87) / 1_000_000).toFixed(4)}`,
    ].join("\n");

    const { blocks, fallbackText } = convertMarkdownToBlocks(responseText, debugFooter, {
      withFeedback: true,
    });

    store.add(sessionId, { role: "assistant", content: responseText });

    if (streamSession) {
      try {
        await stopStreamWithBlocks(streamSession, app.client, fallbackText, blocks);
      } catch (err) {
        logger.warn(
          "[streaming] stopStreamWithBlocks 실패, postMessage로 폴백:",
          err instanceof Error ? err.message : String(err),
        );
        await postToThread(app, channel, threadTs, fallbackText, blocks);
      }
    } else {
      // 폴백 모드 (startPlanStream 실패)
      await postToThread(app, channel, threadTs, fallbackText, blocks);
    }
  } catch (error) {
    logger.error("Error processing message:", error);
    if (error instanceof Error) {
      logger.error("Error message:", error.message);
      logger.error("Error stack:", error.stack);
      if ("cause" in error) {
        logger.error("Error cause:", JSON.stringify(error.cause, null, 2));
      }
    }
    if (mainInvocationId) {
      await completeInvocation(mainInvocationId, {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        finishReason: "error",
      });
    }
    const errorText = "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
    if (streamSession) {
      try {
        await stopStreamWithBlocks(streamSession, app.client, errorText, []);
      } catch {
        await postToThread(app, channel, threadTs, errorText);
      }
    } else {
      await postToThread(app, channel, threadTs, errorText);
    }
  }
}
