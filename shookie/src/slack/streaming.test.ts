import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WebClient } from "@slack/web-api";
import type { StreamSession } from "./streaming.js";

// preferredSchema (module-level state)가 테스트 간 공유되지 않도록
// 각 테스트마다 모듈을 fresh import.
function createMockClient(
  responses: Array<{ ok: boolean; error?: string; ts?: string }>,
): WebClient {
  let i = 0;
  const apiCall = vi.fn(async () => responses[i++] ?? { ok: true });
  return { apiCall } as unknown as WebClient;
}

const SESSION: StreamSession = {
  channel: "C1",
  messageTs: "1234567890.123456",
  threadTs: "1234567890.000000",
};

describe("appendTaskUpdate", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("첫 호출에서 평면 스키마 성공 시 한 번만 apiCall", async () => {
    const { appendTaskUpdate } = await import("./streaming.js");
    const client = createMockClient([{ ok: true }]);

    await appendTaskUpdate(SESSION, client, {
      id: "task_1",
      title: "Test",
      status: "in_progress",
    });

    expect((client as unknown as { apiCall: { mock: { calls: unknown[][] } } }).apiCall.mock.calls).toHaveLength(1);
    const args = (client as unknown as { apiCall: { mock: { calls: unknown[][] } } })
      .apiCall.mock.calls[0][1] as { chunks: Array<Record<string, unknown>> };
    expect(args.chunks[0]).toMatchObject({
      type: "task_update",
      id: "task_1",
      title: "Test",
      status: "in_progress",
    });
    // 평면 형태 — task 중첩 없음
    expect(args.chunks[0].task).toBeUndefined();
  });

  it("invalid_chunks 시 중첩 스키마로 폴백", async () => {
    const { appendTaskUpdate } = await import("./streaming.js");
    const client = createMockClient([
      { ok: false, error: "invalid_chunks" },
      { ok: true },
    ]);

    await appendTaskUpdate(SESSION, client, {
      id: "task_1",
      title: "Test",
      status: "in_progress",
    });

    const mockCalls = (client as unknown as { apiCall: { mock: { calls: unknown[][] } } })
      .apiCall.mock.calls;
    expect(mockCalls).toHaveLength(2);
    const args2 = mockCalls[1][1] as { chunks: Array<Record<string, unknown>> };
    expect(args2.chunks[0]).toMatchObject({
      type: "task_update",
      task: { task_id: "task_1", title: "Test", status: "in_progress" },
    });
  });

  it("캐싱된 스키마 재사용 — flat 확정 후 두 번째 호출은 flat만 (1회 apiCall)", async () => {
    const { appendTaskUpdate } = await import("./streaming.js");
    const client = createMockClient([{ ok: true }, { ok: true }]);

    await appendTaskUpdate(SESSION, client, {
      id: "task_1",
      title: "A",
      status: "in_progress",
    });
    await appendTaskUpdate(SESSION, client, {
      id: "task_2",
      title: "B",
      status: "complete",
    });

    const mockCalls = (client as unknown as { apiCall: { mock: { calls: unknown[][] } } })
      .apiCall.mock.calls;
    expect(mockCalls).toHaveLength(2);
    // 두 번째 호출도 평면 형태 (task 중첩 없음)
    const args2 = mockCalls[1][1] as { chunks: Array<Record<string, unknown>> };
    expect(args2.chunks[0].task).toBeUndefined();
    expect(args2.chunks[0]).toMatchObject({ id: "task_2" });
  });

  it("invalid_chunks 외 에러는 폴백하지 않고 throw", async () => {
    const { appendTaskUpdate } = await import("./streaming.js");
    const client = createMockClient([{ ok: false, error: "rate_limited" }]);

    await expect(
      appendTaskUpdate(SESSION, client, {
        id: "task_1",
        title: "Test",
        status: "in_progress",
      }),
    ).rejects.toThrow("rate_limited");

    const mockCalls = (client as unknown as { apiCall: { mock: { calls: unknown[][] } } })
      .apiCall.mock.calls;
    expect(mockCalls).toHaveLength(1);
  });

  it("details가 있으면 chunk에 details 필드 포함", async () => {
    const { appendTaskUpdate } = await import("./streaming.js");
    const client = createMockClient([{ ok: true }]);

    await appendTaskUpdate(SESSION, client, {
      id: "task_1",
      title: "Test",
      status: "in_progress",
      details: "요약",
    });

    const args = (client as unknown as { apiCall: { mock: { calls: unknown[][] } } })
      .apiCall.mock.calls[0][1] as { chunks: Array<Record<string, unknown>> };
    expect(args.chunks[0].details).toBe("요약");
  });

  it("output이 있으면 chunk에 output 필드 포함 (string)", async () => {
    const { appendTaskUpdate } = await import("./streaming.js");
    const client = createMockClient([{ ok: true }]);

    await appendTaskUpdate(SESSION, client, {
      id: "task_1",
      title: "Test",
      status: "complete",
      output: "결과 본문 텍스트",
    });

    const args = (client as unknown as { apiCall: { mock: { calls: unknown[][] } } })
      .apiCall.mock.calls[0][1] as { chunks: Array<Record<string, unknown>> };
    // chunk의 output은 string (task_card block과 다름)
    expect(args.chunks[0].output).toBe("결과 본문 텍스트");
  });
});

describe("startPlanStream", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("성공 시 StreamSession 반환, task_display_mode=plan으로 호출", async () => {
    const { startPlanStream } = await import("./streaming.js");
    const client = createMockClient([{ ok: true, ts: "111.222" }]);

    const session = await startPlanStream(client, "C1", "111.000");

    expect(session).toEqual({
      channel: "C1",
      messageTs: "111.222",
      threadTs: "111.000",
    });
    const args = (client as unknown as { apiCall: { mock: { calls: unknown[][] } } })
      .apiCall.mock.calls[0][1] as Record<string, unknown>;
    expect(args.task_display_mode).toBe("plan");
  });

  it("ok=false면 throw", async () => {
    const { startPlanStream } = await import("./streaming.js");
    const client = createMockClient([{ ok: false, error: "missing_scope" }]);

    await expect(startPlanStream(client, "C1", "111.000")).rejects.toThrow("missing_scope");
  });

  it("ts 없으면 throw", async () => {
    const { startPlanStream } = await import("./streaming.js");
    const client = createMockClient([{ ok: true }]); // ts 누락

    await expect(startPlanStream(client, "C1", "111.000")).rejects.toThrow();
  });
});
