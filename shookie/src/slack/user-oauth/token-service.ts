import {
  getSlackUserOAuthToken,
  replaceRotatedSlackUserOAuthToken,
  revokeSlackUserOAuthToken,
  revokeSlackUserOAuthTokenIfUnchanged,
  saveSlackUserOAuthToken,
  type SaveSlackUserOAuthToken,
  type SlackUserOAuthTokenRecord,
} from "database";
import { timingSafeEqual } from "node:crypto";
import { logger } from "../../logger.js";
import { TokenCipher } from "../../security/token-cipher.js";
import {
  SlackOAuthClient,
  SlackOAuthApiError,
  type SlackUserOAuthGrant,
} from "./slack-oauth-client.js";

const REFRESH_EARLY_MS = 5 * 60 * 1000;
const REQUIRED_SCOPE = "chat:write";
const MAX_SLACK_ID_LENGTH = 255;
const MAX_SLACK_TOKEN_LENGTH = 8_192;
const TERMINAL_TOKEN_ERRORS = new Set([
  "invalid_auth",
  "not_authed",
  "account_inactive",
  "token_expired",
  "token_revoked",
  "invalid_refresh_token",
  "refresh_token_revoked",
]);

export interface SlackUserOAuthTokenRepository {
  save(record: SaveSlackUserOAuthToken): Promise<SlackUserOAuthTokenRecord>;
  get(teamId: string, userId: string): Promise<SlackUserOAuthTokenRecord | null>;
  replaceRotated(
    record: SaveSlackUserOAuthToken & { expectedEncryptedRefreshToken: string },
  ): Promise<boolean>;
  revoke(teamId: string, userId: string): Promise<boolean>;
  revokeIfUnchanged(
    teamId: string,
    userId: string,
    expectedEncryptedAccessToken: string,
    expectedEncryptedRefreshToken: string | null,
  ): Promise<boolean>;
}

const databaseTokenRepository: SlackUserOAuthTokenRepository = {
  save: saveSlackUserOAuthToken,
  get: getSlackUserOAuthToken,
  replaceRotated: replaceRotatedSlackUserOAuthToken,
  revoke: revokeSlackUserOAuthToken,
  revokeIfUnchanged: revokeSlackUserOAuthTokenIfUnchanged,
};

export class SlackUserOAuthRequiredError extends Error {
  constructor(readonly reason: "missing" | "expired" | "revoked") {
    super(`Slack user OAuth is required: ${reason}`);
    this.name = "SlackUserOAuthRequiredError";
  }
}

export class SlackOAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlackOAuthConfigurationError";
  }
}

function hasOnlyRequiredScope(scopes: string[]): boolean {
  return scopes.length > 0 && scopes.every((scope) => scope === REQUIRED_SCOPE);
}

export class SlackUserTokenService {
  private readonly refreshes = new Map<string, Promise<void>>();

  constructor(
    private readonly cipher: TokenCipher,
    private readonly oauthClient: SlackOAuthClient,
    private readonly rotationEnabled: boolean,
    private readonly repository: SlackUserOAuthTokenRepository = databaseTokenRepository,
    private readonly now: () => number = Date.now,
  ) {}

  async saveGrant(grant: SlackUserOAuthGrant): Promise<void> {
    if (
      !grant.teamId ||
      !grant.userId ||
      !grant.accessToken ||
      grant.teamId !== grant.teamId.trim() ||
      grant.userId !== grant.userId.trim() ||
      grant.accessToken !== grant.accessToken.trim() ||
      grant.teamId.length > MAX_SLACK_ID_LENGTH ||
      grant.userId.length > MAX_SLACK_ID_LENGTH ||
      grant.accessToken.length > MAX_SLACK_TOKEN_LENGTH ||
      (grant.refreshToken !== null &&
        (grant.refreshToken !== grant.refreshToken.trim() ||
          grant.refreshToken.length > MAX_SLACK_TOKEN_LENGTH))
    ) {
      throw new SlackOAuthConfigurationError("Slack OAuth grant has an invalid identity or token");
    }
    if (!hasOnlyRequiredScope(grant.scopes)) {
      throw new SlackOAuthConfigurationError(
        `Slack OAuth grant must contain only ${REQUIRED_SCOPE}`,
      );
    }
    this.assertRotationMatchesConfiguration(grant);

    const identity = { teamId: grant.teamId, userId: grant.userId };
    await this.repository.save({
      ...identity,
      encryptedAccessToken: this.cipher.encrypt(grant.accessToken, {
        ...identity,
        kind: "access",
      }),
      encryptedRefreshToken: grant.refreshToken
        ? this.cipher.encrypt(grant.refreshToken, { ...identity, kind: "refresh" })
        : null,
      scopes: [REQUIRED_SCOPE],
      expiresAt:
        grant.expiresInSeconds === null
          ? null
          : new Date(this.now() + grant.expiresInSeconds * 1000),
    });
  }

  async getAccessToken(teamId: string, userId: string): Promise<string> {
    return this.getAccessTokenWithRetry(teamId, userId, 2);
  }

  private async getAccessTokenWithRetry(
    teamId: string,
    userId: string,
    retriesRemaining: number,
  ): Promise<string> {
    const record = await this.repository.get(teamId, userId);
    if (!record) throw new SlackUserOAuthRequiredError("missing");

    const hasRefreshToken = record.encryptedRefreshToken !== null;
    const hasExpiration = record.expiresAt !== null;
    if (hasRefreshToken !== hasExpiration) {
      return this.revokeStaleRecordOrRetry(record, retriesRemaining);
    }
    if (this.rotationEnabled && !hasRefreshToken) {
      throw new SlackUserOAuthRequiredError("expired");
    }
    if (!this.rotationEnabled && hasRefreshToken) {
      throw new SlackOAuthConfigurationError(
        "Stored Slack token uses rotation; set SLACK_TOKEN_ROTATION_ENABLED=true",
      );
    }
    if (record.expiresAt && !Number.isFinite(record.expiresAt.getTime())) {
      return this.revokeStaleRecordOrRetry(record, retriesRemaining);
    }

    if (!hasOnlyRequiredScope(record.scopes)) {
      return this.revokeStaleRecordOrRetry(record, retriesRemaining);
    }

    if (record.expiresAt && record.expiresAt.getTime() <= this.now() + REFRESH_EARLY_MS) {
      if (!this.rotationEnabled || !record.encryptedRefreshToken) {
        throw new SlackUserOAuthRequiredError("expired");
      }

      await this.runRefresh(record);
      if (retriesRemaining <= 0) throw new SlackUserOAuthRequiredError("expired");
      return this.getAccessTokenWithRetry(teamId, userId, retriesRemaining - 1);
    }

    const accessToken = this.decrypt(record, "access");
    try {
      const identity = await this.oauthClient.validateToken(accessToken);
      if (identity.teamId !== teamId || identity.userId !== userId) {
        return this.revokeStaleRecordOrRetry(record, retriesRemaining);
      }
    } catch (error) {
      if (
        error instanceof SlackOAuthApiError &&
        error.code === "token_expired" &&
        this.rotationEnabled &&
        record.encryptedRefreshToken
      ) {
        await this.runRefresh(record, true);
        if (retriesRemaining <= 0) throw new SlackUserOAuthRequiredError("expired");
        return this.getAccessTokenWithRetry(teamId, userId, retriesRemaining - 1);
      }
      if (!isTerminalTokenError(error)) throw error;
      return this.revokeStaleRecordOrRetry(record, retriesRemaining);
    }
    return accessToken;
  }

  private async revokeStaleRecordOrRetry(
    record: SlackUserOAuthTokenRecord,
    retriesRemaining: number,
  ): Promise<string> {
    const revoked = await this.repository.revokeIfUnchanged(
      record.teamId,
      record.userId,
      record.encryptedAccessToken,
      record.encryptedRefreshToken,
    );
    if (!revoked && retriesRemaining > 0) {
      return this.getAccessTokenWithRetry(record.teamId, record.userId, retriesRemaining - 1);
    }
    throw new SlackUserOAuthRequiredError("revoked");
  }

  async revoke(teamId: string, userId: string): Promise<boolean> {
    const record = await this.repository.get(teamId, userId);
    if (!record) return false;

    // Decrypt before changing local state. A misconfigured encryption key must
    // not destroy ciphertext that is recoverable after configuration repair.
    const tokens = [this.decrypt(record, "access")];
    if (record.encryptedRefreshToken) tokens.push(this.decrypt(record, "refresh"));

    const revokeErrors: unknown[] = [];
    for (const token of tokens) {
      try {
        await this.oauthClient.revokeToken(token);
      } catch (error) {
        if (!isTerminalTokenError(error)) revokeErrors.push(error);
      }
    }

    // Erase both ciphertexts even when Slack is temporarily unavailable. This
    // fails closed locally; callers can surface the remote cleanup failure.
    await this.repository.revoke(teamId, userId);
    if (revokeErrors.length > 0) throw revokeErrors[0];
    return true;
  }

  /**
   * Invalidates only the credential that a failed Slack call actually used.
   * A concurrent OAuth callback or rotation must not be revoked because an
   * older in-flight chat.update received a terminal authentication error.
   */
  async invalidateAccessToken(
    teamId: string,
    userId: string,
    expectedAccessToken: string,
  ): Promise<boolean> {
    const record = await this.repository.get(teamId, userId);
    if (!record) return false;
    const currentAccessToken = this.decrypt(record, "access");
    if (!tokensEqual(currentAccessToken, expectedAccessToken)) return false;

    const invalidated = await this.repository.revokeIfUnchanged(
      teamId,
      userId,
      record.encryptedAccessToken,
      record.encryptedRefreshToken,
    );
    if (!invalidated) return false;

    try {
      await this.oauthClient.revokeToken(expectedAccessToken);
    } catch (error) {
      if (!isTerminalTokenError(error)) {
        logger.warn("Slack API 실패 토큰 원격 폐기 실패", {
          error: error instanceof SlackOAuthApiError ? error.code : errorName(error),
        });
      }
    }
    return true;
  }

  private async runRefresh(
    record: SlackUserOAuthTokenRecord,
    force = false,
  ): Promise<void> {
    const key = `${record.teamId}:${record.userId}`;
    let activeRefresh = this.refreshes.get(key);
    if (!activeRefresh) {
      const refresh = this.refresh(record, force).finally(() => {
        if (this.refreshes.get(key) === refresh) this.refreshes.delete(key);
      });
      this.refreshes.set(key, refresh);
      activeRefresh = refresh;
    }
    await activeRefresh;
  }

  private async refresh(
    staleRecord: SlackUserOAuthTokenRecord,
    force: boolean,
  ): Promise<void> {
    const current = await this.repository.get(staleRecord.teamId, staleRecord.userId);
    if (!current) throw new SlackUserOAuthRequiredError("revoked");
    if (
      !current.expiresAt ||
      (!force && current.expiresAt.getTime() > this.now() + REFRESH_EARLY_MS)
    ) {
      return;
    }
    if (!current.encryptedRefreshToken) throw new SlackUserOAuthRequiredError("expired");

    const refreshToken = this.decrypt(current, "refresh");
    let grant;
    try {
      grant = await this.oauthClient.refreshToken(refreshToken);
    } catch (error) {
      if (isTerminalTokenError(error)) {
        const revoked = await this.repository.revokeIfUnchanged(
          current.teamId,
          current.userId,
          current.encryptedAccessToken,
          current.encryptedRefreshToken,
        );
        if (revoked) throw new SlackUserOAuthRequiredError("revoked");
        return;
      }
      throw error;
    }
    if (!hasOnlyRequiredScope(grant.scopes)) {
      throw new SlackOAuthConfigurationError(
        `Rotated Slack token must contain only ${REQUIRED_SCOPE}`,
      );
    }
    if (!Number.isSafeInteger(grant.expiresInSeconds) || grant.expiresInSeconds <= 0) {
      throw new SlackOAuthConfigurationError("Rotated Slack token has an invalid expiration");
    }

    const identity = { teamId: current.teamId, userId: current.userId };
    const encryptedAccessToken = this.cipher.encrypt(grant.accessToken, {
      ...identity,
      kind: "access",
    });
    const encryptedRefreshToken = this.cipher.encrypt(grant.refreshToken, {
      ...identity,
      kind: "refresh",
    });
    const replaced = await this.repository.replaceRotated({
      ...identity,
      expectedEncryptedRefreshToken: current.encryptedRefreshToken,
      encryptedAccessToken,
      encryptedRefreshToken,
      scopes: [REQUIRED_SCOPE],
      expiresAt: new Date(this.now() + grant.expiresInSeconds * 1000),
    });

    if (!replaced) {
      // The response belongs to a losing concurrent refresh and is not stored.
      // Revoke both orphaned credentials so they do not consume Slack's active
      // token allowance or remain usable outside this process.
      for (const token of [grant.accessToken, grant.refreshToken]) {
        try {
          await this.oauthClient.revokeToken(token);
        } catch (error) {
          logger.warn("저장되지 않은 Slack rotation token 폐기 실패", {
            error: error instanceof SlackOAuthApiError ? error.code : errorName(error),
          });
        }
      }
    }
  }

  private decrypt(record: SlackUserOAuthTokenRecord, kind: "access" | "refresh"): string {
    const envelope =
      kind === "access" ? record.encryptedAccessToken : record.encryptedRefreshToken;
    if (!envelope) throw new SlackUserOAuthRequiredError("expired");
    return this.cipher.decrypt(envelope, {
      teamId: record.teamId,
      userId: record.userId,
      kind,
    });
  }

  private assertRotationMatchesConfiguration(grant: SlackUserOAuthGrant): void {
    const responseUsesRotation = grant.refreshToken !== null || grant.expiresInSeconds !== null;
    if (this.rotationEnabled && (!grant.refreshToken || grant.expiresInSeconds === null)) {
      throw new SlackOAuthConfigurationError(
        "SLACK_TOKEN_ROTATION_ENABLED is true, but Slack did not return a rotating user token",
      );
    }
    if (
      this.rotationEnabled &&
      (!Number.isSafeInteger(grant.expiresInSeconds) || (grant.expiresInSeconds ?? 0) <= 0)
    ) {
      throw new SlackOAuthConfigurationError("Slack rotating user token has an invalid expiration");
    }
    if (!this.rotationEnabled && responseUsesRotation) {
      throw new SlackOAuthConfigurationError(
        "Slack returned a rotating user token; set SLACK_TOKEN_ROTATION_ENABLED=true",
      );
    }
  }
}

function isTerminalTokenError(error: unknown): boolean {
  return error instanceof SlackOAuthApiError && TERMINAL_TOKEN_ERRORS.has(error.code);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown_error";
}

function tokensEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
