import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { App } from "@slack/bolt";
import { routeTeam, buildPermalink, relayToAll } from "./reaction-relay.js";
import { logger } from "../logger.js";

type MockPostMessage = ReturnType<typeof vi.fn>;
type MockGetPermalink = ReturnType<typeof vi.fn>;

function createMockClient(opts: {
  getPermalink?: MockGetPermalink;
  postMessage?: MockPostMessage;
}): App["client"] {
  return {
    chat: {
      getPermalink: opts.getPermalink ?? vi.fn(),
      postMessage: opts.postMessage ?? vi.fn(),
    },
  } as unknown as App["client"];
}

describe("routeTeam", () => {
  it("팀 이모지를 teamKey로 매핑한다", () => {
    expect(routeTeam("pm_go")).toBe("pm");
    expect(routeTeam("design_go")).toBe("design");
    expect(routeTeam("android_go")).toBe("android");
    expect(routeTeam("backend_go")).toBe("backend");
    expect(routeTeam("frontend_go")).toBe("frontend");
    expect(routeTeam("back_go")).toBe("backend");
    expect(routeTeam("front_go")).toBe("frontend");
    expect(routeTeam("ios_go")).toBe("ios");
    expect(routeTeam("hr_go")).toBe("hr");
    expect(routeTeam("legal_go")).toBe("legal");
    expect(routeTeam("marketing_go")).toBe("marketing");
    expect(routeTeam("all_go")).toBe("all");
    expect(routeTeam("test_go")).toBe("test");
  });

  it("릴레이 대상이 아닌 리액션은 null을 반환한다", () => {
    expect(routeTeam("thumbsup")).toBeNull();
    expect(routeTeam("")).toBeNull();
    expect(routeTeam("unknown_go")).toBeNull();
    expect(routeTeam("pm")).toBeNull();
    expect(routeTeam("_go")).toBeNull();
  });
});

describe("buildPermalink", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("chat.getPermalink가 실패하면 null 반환 + warn 로깅", async () => {
    const getPermalink = vi.fn().mockRejectedValue(new Error("not_found"));
    const client = createMockClient({ getPermalink });

    const result = await buildPermalink(client, "C123", "1234567890.123456");

    expect(result).toBeNull();
    expect(getPermalink).toHaveBeenCalledWith({
      channel: "C123",
      message_ts: "1234567890.123456",
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "chat.getPermalink 실패",
      expect.objectContaining({ channel: "C123", error: "not_found" }),
    );
  });

  it("permalink 필드가 없으면 null 반환 + warn 로깅", async () => {
    const getPermalink = vi.fn().mockResolvedValue({ ok: true });
    const client = createMockClient({ getPermalink });

    const result = await buildPermalink(client, "C123", "1234567890.123456");

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      "permalink null — 스킵",
      expect.objectContaining({ channel: "C123" }),
    );
  });

  it("permalink가 있으면 문자열 반환", async () => {
    const permalink = "https://yourssu.slack.com/archives/C123/p1234567890123456";
    const getPermalink = vi.fn().mockResolvedValue({ permalink });
    const client = createMockClient({ getPermalink });

    const result = await buildPermalink(client, "C123", "1234567890.123456");

    expect(result).toBe(permalink);
  });
});

describe("relayToAll", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("일부 채널 실패 시 warn 로깅 + 나머지 채널은 정상 전송", async () => {
    const postMessage = vi.fn()
      .mockRejectedValueOnce(new Error("channel_not_found"))
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });
    const client = createMockClient({ postMessage });

    await relayToAll(client, "https://permalink.example");

    expect(postMessage).toHaveBeenCalledTimes(9);
    expect(warnSpy).toHaveBeenCalledWith(
      "relay failed",
      expect.objectContaining({ team: "pm", error: "channel_not_found" }),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "relay sent",
      expect.objectContaining({ team: "design" }),
    );
  });
});
