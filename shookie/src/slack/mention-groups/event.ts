const TEAM_ID_PATTERN = /^T[A-Z0-9]{2,}$/u;
const CHANNEL_ID_PATTERN = /^[CG][A-Z0-9]{2,}$/u;
const USER_ID_PATTERN = /^[UW][A-Z0-9]{2,20}$/u;
const TIMESTAMP_PATTERN = /^\d{1,20}\.\d{1,20}$/u;

export interface MentionMessageEvent {
  eventId: string;
  teamId: string;
  userId: string;
  channelId: string;
  messageTs: string;
  threadTs?: string;
  text: string;
}

/** Converts only new human-authored public/private channel messages. */
export function extractMentionMessageEvent(
  bodyValue: unknown,
  eventValue: unknown,
): MentionMessageEvent | null {
  if (!isRecord(bodyValue) || !isRecord(eventValue)) return null;
  if (eventValue.type !== "message") return null;
  if (eventValue.hidden === true || eventValue.bot_id || eventValue.app_id) return null;
  if (eventValue.edited) return null;
  if (eventValue.subtype !== undefined && eventValue.subtype !== "me_message") return null;

  const channelId = stringValue(eventValue.channel);
  const userId = stringValue(eventValue.user);
  const messageTs = stringValue(eventValue.ts);
  const text = stringValue(eventValue.text);
  const eventTeamId = stringValue(eventValue.team);
  const envelopeTeamId = stringValue(bodyValue.team_id);
  const teamId = eventTeamId ?? envelopeTeamId;
  const userTeamId = stringValue(eventValue.user_team);
  const channelType = stringValue(eventValue.channel_type);
  const threadTs = stringValue(eventValue.thread_ts);

  if (
    !teamId ||
    !TEAM_ID_PATTERN.test(teamId) ||
    !channelId ||
    !CHANNEL_ID_PATTERN.test(channelId) ||
    !userId ||
    !USER_ID_PATTERN.test(userId) ||
    !messageTs ||
    !TIMESTAMP_PATTERN.test(messageTs) ||
    text === null
  ) {
    return null;
  }
  if (channelType && channelType !== "channel" && channelType !== "group") return null;
  if (threadTs && !TIMESTAMP_PATTERN.test(threadTs)) return null;

  // A user token belongs to one workspace. Do not start OAuth for a Slack
  // Connect author whose home workspace differs from this event's workspace.
  if (userTeamId && userTeamId !== teamId) return null;

  const suppliedEventId = stringValue(bodyValue.event_id);
  const eventId = suppliedEventId && suppliedEventId.length <= 255
    ? suppliedEventId
    : `${teamId}:${channelId}:${messageTs}`;

  return {
    eventId,
    teamId,
    userId,
    channelId,
    messageTs,
    ...(threadTs ? { threadTs } : {}),
    text,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
