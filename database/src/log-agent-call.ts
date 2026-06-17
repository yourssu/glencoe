import { getPool } from "./pool.js";

export interface AgentCallRecord {
  userId: string;
  channel: string;
  threadTs: string;
  question: string;
  answer: string;
  toolsUsed: string[];
  inputTokens: number;
  outputTokens: number;
}

export interface AgentCallResult {
  agentCallId: number;
  sessionId: number;
}

function buildSessionKey(channel: string, threadTs: string): string {
  return `${channel}:${threadTs}`;
}

const TITLE_MAX_LENGTH = 80;

function truncateForTitle(text: string): string {
  const firstLine = text.split(/\r?\n/)[0]?.trim() ?? "";
  if (firstLine.length <= TITLE_MAX_LENGTH) return firstLine;
  return `${firstLine.slice(0, TITLE_MAX_LENGTH)}...`;
}

export async function upsertSession(rec: {
  userId: string;
  channel: string;
  threadTs: string;
  title?: string;
}): Promise<number | null> {
  const pool = getPool();
  const sessionKey = buildSessionKey(rec.channel, rec.threadTs);
  try {
    const result = await pool.query(
      `INSERT INTO sessions (session_key, user_id, channel, thread_ts, title, created_at, last_active_at, message_count)
       VALUES ($1, $2, $3, $4, $5, now(), now(), 1)
       ON CONFLICT (session_key) DO UPDATE
       SET last_active_at = now(),
           message_count = sessions.message_count + 1
       RETURNING id`,
      [sessionKey, rec.userId, rec.channel, rec.threadTs, rec.title ?? null],
    );
    return result.rows[0]?.id ?? null;
  } catch (err) {
    console.error("Failed to upsert session:", err);
    return null;
  }
}

export async function logAgentCall(record: AgentCallRecord): Promise<AgentCallResult | null> {
  try {
    const titleText = truncateForTitle(record.question);
    const sessionId = await upsertSession({
      userId: record.userId,
      channel: record.channel,
      threadTs: record.threadTs,
      title: titleText.length > 0 ? titleText : undefined,
    });
    if (!sessionId) return null;

    const pool = getPool();
    const result = await pool.query(
      `INSERT INTO agent_calls (user_id, channel, thread_ts, session_id, question, answer, tools_used, input_tokens, output_tokens)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        record.userId,
        record.channel,
        record.threadTs,
        sessionId,
        record.question,
        record.answer,
        record.toolsUsed,
        record.inputTokens,
        record.outputTokens,
      ],
    );
    const agentCallId = result.rows[0]?.id;
    if (!agentCallId) return null;
    return { agentCallId, sessionId };
  } catch (err) {
    console.error("Failed to log agent call:", err);
    return null;
  }
}

export interface PendingAgentCall {
  userId: string;
  channel: string;
  threadTs: string;
  question: string;
}

export interface AgentCallCompletion {
  answer: string;
  toolsUsed: string[];
  inputTokens: number;
  outputTokens: number;
}

export async function startAgentCall(rec: PendingAgentCall): Promise<AgentCallResult | null> {
  try {
    const titleText = truncateForTitle(rec.question);
    const sessionId = await upsertSession({
      userId: rec.userId,
      channel: rec.channel,
      threadTs: rec.threadTs,
      title: titleText.length > 0 ? titleText : undefined,
    });
    if (!sessionId) return null;

    const pool = getPool();
    const result = await pool.query(
      `INSERT INTO agent_calls (user_id, channel, thread_ts, session_id, question)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [rec.userId, rec.channel, rec.threadTs, sessionId, rec.question],
    );
    const agentCallId = result.rows[0]?.id;
    if (!agentCallId) return null;
    return { agentCallId, sessionId };
  } catch (err) {
    console.error("Failed to start agent call:", err);
    return null;
  }
}

export async function completeAgentCall(agentCallId: number, comp: AgentCallCompletion): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE agent_calls
       SET answer = $2, tools_used = $3, input_tokens = $4, output_tokens = $5
       WHERE id = $1`,
      [agentCallId, comp.answer, comp.toolsUsed, comp.inputTokens, comp.outputTokens],
    );
  } catch (err) {
    console.error("Failed to complete agent call:", err);
  }
}
