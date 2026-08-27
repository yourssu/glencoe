import { createHash, randomBytes } from "node:crypto";
import {
  consumeSlackOAuthState,
  createSlackOAuthState,
  deleteExpiredSlackOAuthStates,
  type SlackOAuthStateRecord,
} from "database";

export interface SlackOAuthContext extends Record<string, unknown> {
  channelId?: string;
  messageTs?: string;
  threadTs?: string;
}

export interface SlackOAuthStateRepository {
  create(state: Omit<SlackOAuthStateRecord, "createdAt">): Promise<void>;
  consume(stateHash: string): Promise<SlackOAuthStateRecord | null>;
}

const databaseStateRepository: SlackOAuthStateRepository = {
  create: async (state) => {
    await deleteExpiredSlackOAuthStates();
    await createSlackOAuthState(state);
  },
  consume: consumeSlackOAuthState,
};

export interface ConsumedSlackOAuthState {
  teamId: string;
  userId: string;
  context: SlackOAuthContext;
}

const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAX_STATE_CONTEXT_BYTES = 4_096;

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export class SlackOAuthStateService {
  constructor(
    private readonly repository: SlackOAuthStateRepository = databaseStateRepository,
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  async create(input: {
    teamId: string;
    userId: string;
    context?: SlackOAuthContext;
  }): Promise<string> {
    if (
      !input.teamId ||
      !input.userId ||
      input.teamId !== input.teamId.trim() ||
      input.userId !== input.userId.trim() ||
      input.teamId.length > 255 ||
      input.userId.length > 255
    ) {
      throw new Error("Slack OAuth state requires a team and user");
    }
    const context = input.context ?? {};
    let encodedContext: string;
    try {
      encodedContext = JSON.stringify(context);
    } catch {
      throw new Error("Slack OAuth state context must be JSON serializable");
    }
    if (Buffer.byteLength(encodedContext, "utf8") > MAX_STATE_CONTEXT_BYTES) {
      throw new Error("Slack OAuth state context is too large");
    }

    const state = randomBytes(32).toString("base64url");
    await this.repository.create({
      stateHash: hashState(state),
      teamId: input.teamId,
      userId: input.userId,
      context,
      expiresAt: new Date(this.now() + this.ttlMs),
    });
    return state;
  }

  async consume(state: string): Promise<ConsumedSlackOAuthState | null> {
    if (!STATE_PATTERN.test(state)) return null;
    const record = await this.repository.consume(hashState(state));
    if (!record) return null;
    return {
      teamId: record.teamId,
      userId: record.userId,
      context: record.context as SlackOAuthContext,
    };
  }
}
