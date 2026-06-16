import { getPool } from "./pool.js";

export type AgentName = "main-shookie" | "posthog" | "code-explorer";

export interface InvocationStart {
  agentCallId: number;
  parentInvocationId: number | null;
  agentName: AgentName;
  task: string | null;
  reasoning?: string | null;
}

export async function startInvocation(rec: InvocationStart): Promise<number | null> {
  try {
    const pool = getPool();
    const result = await pool.query(
      `INSERT INTO agent_invocations (agent_call_id, parent_invocation_id, agent_name, task, reasoning, started_at)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING id`,
      [rec.agentCallId, rec.parentInvocationId, rec.agentName, rec.task, rec.reasoning ?? null],
    );
    return result.rows[0]?.id ?? null;
  } catch (err) {
    console.error("Failed to start invocation:", err);
    return null;
  }
}

export interface InvocationCompletion {
  status: "success" | "error";
  error?: string | null;
  finishReason?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}

export async function completeInvocation(
  invocationId: number,
  comp: InvocationCompletion,
): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE agent_invocations
       SET status = $2,
           error = $3,
           finish_reason = $4,
           input_tokens = $5,
           output_tokens = $6,
           cached_input_tokens = $7,
           reasoning_tokens = $8,
           finished_at = now(),
           duration_ms = EXTRACT(EPOCH FROM (now() - started_at)) * 1000
       WHERE id = $1`,
      [
        invocationId,
        comp.status,
        comp.error ?? null,
        comp.finishReason ?? null,
        comp.inputTokens ?? 0,
        comp.outputTokens ?? 0,
        comp.cachedInputTokens ?? 0,
        comp.reasoningTokens ?? 0,
      ],
    );
  } catch (err) {
    console.error("Failed to complete invocation:", err);
  }
}

const MAX_OUTPUT_BYTES = 8 * 1024;

export interface ToolCallRecord {
  invocationId: number;
  stepIndex: number;
  toolName: string;
  input: unknown;
  output: unknown;
  durationMs?: number | null;
  error?: string | null;
}

function summarizeOutput(output: unknown): Record<string, unknown> {
  if (Array.isArray(output)) {
    return {
      _truncated: true,
      type: "array",
      row_count: output.length,
      sample: output.slice(0, 5),
    };
  }
  if (output && typeof output === "object") {
    return {
      _truncated: true,
      type: "object",
      keys: Object.keys(output as object).slice(0, 20),
      preview: JSON.stringify(output).slice(0, 2000),
    };
  }
  return {
    _truncated: true,
    type: typeof output,
    preview: String(output).slice(0, 2000),
  };
}

export async function logToolCall(rec: ToolCallRecord): Promise<void> {
  try {
    const pool = getPool();

    const inputJson = rec.input === undefined ? null : JSON.stringify(rec.input);
    const rawOutputJson = rec.output === undefined ? null : JSON.stringify(rec.output);
    const outputSizeBytes = rawOutputJson ? Buffer.byteLength(rawOutputJson) : null;
    let outputJson = rawOutputJson;
    let outputTruncated = false;

    if (rawOutputJson && Buffer.byteLength(rawOutputJson) > MAX_OUTPUT_BYTES) {
      outputJson = JSON.stringify(summarizeOutput(rec.output));
      outputTruncated = true;
    }

    await pool.query(
      `INSERT INTO tool_calls
       (invocation_id, step_index, tool_name, input, output, output_size_bytes, output_truncated, duration_ms, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        rec.invocationId,
        rec.stepIndex,
        rec.toolName,
        inputJson ? inputJson : null,
        outputJson ? outputJson : null,
        outputSizeBytes,
        outputTruncated,
        rec.durationMs ?? null,
        rec.error ?? null,
      ],
    );
  } catch (err) {
    console.error("Failed to log tool call:", err);
  }
}
