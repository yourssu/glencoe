import type { App } from "@slack/bolt";

export interface SlackMessageSnapshot {
  messageTs: string;
  userId?: string;
  text?: string;
  subtype?: string;
  botId?: string;
  edited: boolean;
}

export interface SlackMessageLookup {
  channelId: string;
  messageTs: string;
  threadTs?: string;
}

export interface SlackMessageUpdate extends SlackMessageLookup {
  accessToken: string;
  text: string;
}

export interface SlackEphemeralMessage {
  channelId: string;
  userId: string;
  text: string;
  threadTs?: string;
}

export interface MentionSlackGateway {
  updateMessage(input: SlackMessageUpdate): Promise<void>;
  postEphemeral(input: SlackEphemeralMessage): Promise<void>;
  loadMessage(input: SlackMessageLookup): Promise<SlackMessageSnapshot | null>;
}

export class BoltMentionSlackGateway implements MentionSlackGateway {
  constructor(private readonly app: App) {}

  async updateMessage(input: SlackMessageUpdate): Promise<void> {
    const response = await this.app.client.chat.update({
      token: input.accessToken,
      channel: input.channelId,
      ts: input.messageTs,
      text: input.text,
    });
    if (response.ts !== input.messageTs) {
      throw new Error("Slack chat.update returned an unexpected message timestamp");
    }
  }

  async postEphemeral(input: SlackEphemeralMessage): Promise<void> {
    await this.app.client.chat.postEphemeral({
      channel: input.channelId,
      user: input.userId,
      text: input.text,
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
    });
  }

  async loadMessage(input: SlackMessageLookup): Promise<SlackMessageSnapshot | null> {
    const response = input.threadTs
      ? await this.app.client.conversations.replies({
          channel: input.channelId,
          ts: input.threadTs,
          oldest: input.messageTs,
          latest: input.messageTs,
          inclusive: true,
          limit: 1,
        })
      : await this.app.client.conversations.history({
          channel: input.channelId,
          oldest: input.messageTs,
          latest: input.messageTs,
          inclusive: true,
          limit: 1,
        });
    const messages = (response as { messages?: unknown[] }).messages ?? [];
    const rawMessage = messages.find(
      (candidate) => isRecord(candidate) && candidate.ts === input.messageTs,
    );
    if (!isRecord(rawMessage)) return null;

    return {
      messageTs: input.messageTs,
      ...(typeof rawMessage.user === "string" ? { userId: rawMessage.user } : {}),
      ...(typeof rawMessage.text === "string" ? { text: rawMessage.text } : {}),
      ...(typeof rawMessage.subtype === "string" ? { subtype: rawMessage.subtype } : {}),
      ...(typeof rawMessage.bot_id === "string" ? { botId: rawMessage.bot_id } : {}),
      edited: isRecord(rawMessage.edited),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
