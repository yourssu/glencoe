import { describe, expect, it } from "vitest";
import { MentionEventDeduper } from "./event-deduper.js";
import { extractMentionMessageEvent } from "./event.js";

const body = { team_id: "T123", event_id: "Ev123" };
const event = {
  type: "message",
  channel: "C123",
  channel_type: "channel",
  user: "U123",
  text: "hello @backend",
  ts: "123.456",
};

describe("mention message event filtering", () => {
  it("일반 채널 본문과 스레드 답글을 추출한다", () => {
    expect(extractMentionMessageEvent(body, event)).toEqual({
      eventId: "Ev123",
      teamId: "T123",
      userId: "U123",
      channelId: "C123",
      messageTs: "123.456",
      text: "hello @backend",
    });
    expect(
      extractMentionMessageEvent(body, { ...event, ts: "124.456", thread_ts: "123.456" }),
    ).toMatchObject({ messageTs: "124.456", threadTs: "123.456" });
  });

  it("봇, 수정, 시스템, DM과 다른 team의 Slack Connect 작성자를 무시한다", () => {
    expect(extractMentionMessageEvent(body, { ...event, bot_id: "B123" })).toBeNull();
    expect(extractMentionMessageEvent(body, { ...event, subtype: "message_changed" })).toBeNull();
    expect(extractMentionMessageEvent(body, { ...event, subtype: "thread_broadcast" })).toBeNull();
    expect(
      extractMentionMessageEvent(body, { ...event, channel: "D123", channel_type: "im" }),
    ).toBeNull();
    expect(extractMentionMessageEvent(body, { ...event, user_team: "T999" })).toBeNull();
  });

  it("chat.update가 지원하는 me_message는 사용자 메시지로 허용한다", () => {
    expect(extractMentionMessageEvent(body, { ...event, subtype: "me_message" })).not.toBeNull();
  });
});

describe("MentionEventDeduper", () => {
  it("event id와 메시지 좌표 중 하나라도 중복이면 거부하고 TTL 뒤 허용한다", () => {
    let now = 0;
    const deduper = new MentionEventDeduper(1_000, 10, () => now);

    expect(deduper.claim("Ev1", "T:C:1.1")).toBe(true);
    expect(deduper.claim("Ev1", "T:C:2.2")).toBe(false);
    expect(deduper.claim("Ev2", "T:C:1.1")).toBe(false);
    now = 1_001;
    expect(deduper.claim("Ev2", "T:C:1.1")).toBe(true);
  });
});
