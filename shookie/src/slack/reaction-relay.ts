import type { App } from "@slack/bolt";
import { logger } from "../logger.js";

export type TeamKey = "pm" | "design" | "android" | "backend" | "frontend" | "ios" | "hr" | "legal" | "marketing" | "all" | "test";

const ALL_TEAMS: TeamKey[] = ["pm", "design", "android", "backend", "frontend", "ios", "hr", "legal", "marketing"];

const TEAM_CHANNELS: Partial<Record<TeamKey, string>> = {
  pm: "C05C46WG935",
  design: "C2SR82YCC",
  android: "CPD6BSC92",
  backend: "C8UT5E95E",
  frontend: "C8WCKQ4UE",
  ios: "CM8DWU3KP",
  hr: "C9SKN0VRP",
  legal: "C02HKM30AMC",
  marketing: "CPCDPFSCS",
  test: "C0ATVRN2KA6",
};

const ROUTABLE_KEYS: ReadonlySet<string> = new Set<string>([...ALL_TEAMS, "all", "test"]);

const RELAY_BATCH_DELAY_MS = 250;

export function routeTeam(reaction: string): TeamKey | null {
  if (!reaction.endsWith("_go")) return null;
  const key = reaction.slice(0, -3);
  return ROUTABLE_KEYS.has(key) ? (key as TeamKey) : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function buildPermalink(
  client: App["client"],
  channel: string,
  messageTs: string,
): Promise<string | null> {
  try {
    const res = await client.chat.getPermalink({ channel, message_ts: messageTs });
    if (!res?.permalink) {
      logger.warn("permalink null — 스킵", { channel, messageTs });
      return null;
    }
    return res.permalink;
  } catch (e) {
    logger.warn("chat.getPermalink 실패", {
      channel,
      messageTs,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

async function relayToOne(
  client: App["client"],
  teamKey: TeamKey,
  channelId: string,
  permalink: string,
): Promise<void> {
  try {
    await client.chat.postMessage({
      channel: channelId,
      text: permalink,
      unfurl_links: true,
    });
    logger.info("relay sent", { team: teamKey, channelId });
  } catch (e) {
    logger.warn("relay failed", {
      team: teamKey,
      channelId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function relayToAll(client: App["client"], permalink: string): Promise<void> {
  for (let i = 0; i < ALL_TEAMS.length; i++) {
    const team = ALL_TEAMS[i];
    await relayToOne(client, team, TEAM_CHANNELS[team] as string, permalink);
    if (i < ALL_TEAMS.length - 1) {
      await delay(RELAY_BATCH_DELAY_MS);
    }
  }
}

async function verifyChannelMembership(client: App["client"]): Promise<void> {
  const joined = new Set<string>();
  let cursor: string | undefined;
  try {
    do {
      const res = await client.conversations.list({
        cursor,
        limit: 1000,
        types: "public_channel,private_channel",
      });
      for (const ch of res?.channels ?? []) {
        if (ch && typeof ch.id === "string" && ch.is_member) {
          joined.add(ch.id);
        }
      }
      cursor = res?.response_metadata?.next_cursor || undefined;
    } while (cursor);
  } catch (e) {
    logger.warn("conversations.list 조회 실패 — join 상태 검증 생략", {
      error: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  for (const team of Object.keys(TEAM_CHANNELS) as TeamKey[]) {
    const id = TEAM_CHANNELS[team];
    if (id && !joined.has(id)) {
      logger.warn("봇이 채널에 join 되어 있지 않음 — 전송 실패 가능", { team, channelId: id });
    }
  }
}

export function registerReactionRelay(app: App): void {
  void (async () => {
    await verifyChannelMembership(app.client);

    let botUserId: string | undefined;
    try {
      const test = await app.client.auth.test();
      botUserId = test.user_id;
    } catch (e) {
      logger.error("BOT_USER_ID 조회 실패 — 릴레이 핸들러 미등록", {
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    if (!botUserId) {
      logger.error("BOT_USER_ID 조회 실패 — 릴레이 핸들러 미등록");
      return;
    }

    app.event("reaction_added", async ({ event, client }) => {
      const item = event.item as { type?: string; channel?: string; ts?: string } | undefined;
      if (!item || item.type !== "message" || !item.channel || !item.ts) return;

      if (event.user === botUserId) return;
      if (event.item_user === botUserId) return;

      const teamKey = routeTeam(event.reaction);
      if (!teamKey) return;

      const permalink = await buildPermalink(client, item.channel, item.ts);
      if (!permalink) return;

      if (teamKey === "all") {
        await relayToAll(client, permalink);
      } else {
        await relayToOne(client, teamKey, TEAM_CHANNELS[teamKey] as string, permalink);
      }
    });

    logger.info("팀 릴레이 핸들러 등록 완료", { teams: ALL_TEAMS });
  })().catch((e) => {
    logger.error("registerReactionRelay 비동기 초기화 실패", {
      error: e instanceof Error ? e.message : String(e),
    });
  });
}
