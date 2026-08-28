import type { App } from "@slack/bolt";
import { describe, expect, it, vi } from "vitest";
import { BoltMentionSlackGateway } from "./slack-gateway.js";

function gateway(client: Record<string, unknown>) {
  return new BoltMentionSlackGateway({ client } as unknown as App);
}

describe("BoltMentionSlackGateway", () => {
  it("chat.update 호출마다 작성자 User Token을 명시적으로 override한다", async () => {
    const update = vi.fn().mockResolvedValue({ ts: "123.456" });
    const slack = gateway({ chat: { update } });

    await slack.updateMessage({
      accessToken: "xoxp-author",
      channelId: "C123",
      messageTs: "123.456",
      text: "hello <@U123>",
    });

    expect(update).toHaveBeenCalledWith({
      token: "xoxp-author",
      channel: "C123",
      ts: "123.456",
      text: "hello <@U123>",
    });
  });

  it("일반 채널 메시지는 conversations.history에서 정확한 ts만 복원한다", async () => {
    const history = vi.fn().mockResolvedValue({
      messages: [
        {
          ts: "123.456",
          user: "U123",
          text: "@backend",
        },
      ],
    });
    const slack = gateway({ conversations: { history } });

    await expect(
      slack.loadMessage({ channelId: "C123", messageTs: "123.456" }),
    ).resolves.toEqual({
      messageTs: "123.456",
      userId: "U123",
      text: "@backend",
      edited: false,
    });
    expect(history).toHaveBeenCalledWith({
      channel: "C123",
      oldest: "123.456",
      latest: "123.456",
      inclusive: true,
      limit: 1,
    });
  });

  it("스레드 답글은 root ts의 conversations.replies에서 복원한다", async () => {
    const replies = vi.fn().mockResolvedValue({
      messages: [{ ts: "124.456", user: "U123", text: "@backend" }],
    });
    const slack = gateway({ conversations: { replies } });

    await slack.loadMessage({
      channelId: "C123",
      messageTs: "124.456",
      threadTs: "123.456",
    });

    expect(replies).toHaveBeenCalledWith({
      channel: "C123",
      ts: "123.456",
      oldest: "124.456",
      latest: "124.456",
      inclusive: true,
      limit: 1,
    });
  });
});
