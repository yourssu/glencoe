import { describe, expect, it, vi } from "vitest";
import type { SaveSlackUserOAuthToken, SlackUserOAuthTokenRecord } from "database";
import { TokenCipher } from "../../security/token-cipher.js";
import { SlackOAuthApiError, type SlackOAuthClient } from "./slack-oauth-client.js";
import {
  SlackOAuthConfigurationError,
  SlackUserOAuthRequiredError,
  SlackUserTokenService,
  type SlackUserOAuthTokenRepository,
} from "./token-service.js";

class MemoryTokenRepository implements SlackUserOAuthTokenRepository {
  record: SlackUserOAuthTokenRecord | null = null;

  async save(input: SaveSlackUserOAuthToken): Promise<SlackUserOAuthTokenRecord> {
    this.record = {
      ...input,
      encryptedRefreshToken: input.encryptedRefreshToken ?? null,
      expiresAt: input.expiresAt ?? null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    return this.record;
  }

  async get(teamId: string, userId: string): Promise<SlackUserOAuthTokenRecord | null> {
    if (this.record?.teamId !== teamId || this.record.userId !== userId) return null;
    return this.record;
  }

  async replaceRotated(
    input: SaveSlackUserOAuthToken & { expectedEncryptedRefreshToken: string },
  ): Promise<boolean> {
    if (this.record?.encryptedRefreshToken !== input.expectedEncryptedRefreshToken) return false;
    this.record = {
      ...this.record,
      ...input,
      encryptedRefreshToken: input.encryptedRefreshToken ?? null,
      expiresAt: input.expiresAt ?? null,
      updatedAt: new Date(1),
    };
    return true;
  }

  async revoke(): Promise<boolean> {
    const existed = this.record !== null;
    this.record = null;
    return existed;
  }

  async revokeIfUnchanged(
    teamId: string,
    userId: string,
    expectedEncryptedAccessToken: string,
    expectedEncryptedRefreshToken: string | null,
  ): Promise<boolean> {
    if (
      this.record?.teamId !== teamId ||
      this.record.userId !== userId ||
      this.record.encryptedAccessToken !== expectedEncryptedAccessToken ||
      this.record.encryptedRefreshToken !== expectedEncryptedRefreshToken
    ) {
      return false;
    }
    this.record = null;
    return true;
  }
}

const cipher = new TokenCipher(Buffer.alloc(32, 9));

function oauthClient(overrides: Partial<SlackOAuthClient> = {}): SlackOAuthClient {
  return {
    validateToken: vi.fn().mockResolvedValue({ teamId: "T123", userId: "U123" }),
    refreshToken: vi.fn(),
    revokeToken: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as SlackOAuthClient;
}

describe("SlackUserTokenService", () => {
  it("평문 토큰을 저장하지 않고 필요할 때만 복호화한다", async () => {
    const repository = new MemoryTokenRepository();
    const service = new SlackUserTokenService(cipher, oauthClient(), false, repository, () => 0);

    await service.saveGrant({
      teamId: "T123",
      userId: "U123",
      accessToken: "xoxp-access",
      refreshToken: null,
      expiresInSeconds: null,
      scopes: ["chat:write"],
    });

    expect(repository.record?.encryptedAccessToken).not.toContain("xoxp-access");
    await expect(service.getAccessToken("T123", "U123")).resolves.toBe("xoxp-access");
  });

  it("chat:write가 없는 grant를 거부한다", async () => {
    const service = new SlackUserTokenService(
      cipher,
      oauthClient(),
      false,
      new MemoryTokenRepository(),
    );

    await expect(
      service.saveGrant({
        teamId: "T123",
        userId: "U123",
        accessToken: "xoxp-access",
        refreshToken: null,
        expiresInSeconds: null,
        scopes: ["users:read"],
      }),
    ).rejects.toBeInstanceOf(SlackOAuthConfigurationError);
  });

  it("Token Rotation 설정과 Slack 응답이 다르면 저장을 거부한다", async () => {
    const service = new SlackUserTokenService(
      cipher,
      oauthClient(),
      false,
      new MemoryTokenRepository(),
    );

    await expect(
      service.saveGrant({
        teamId: "T123",
        userId: "U123",
        accessToken: "xoxe.xoxp-access",
        refreshToken: "xoxe-refresh",
        expiresInSeconds: 43_200,
        scopes: ["chat:write"],
      }),
    ).rejects.toThrow("SLACK_TOKEN_ROTATION_ENABLED=true");
  });

  it("만료가 임박한 토큰을 한 번만 갱신하고 회전된 refresh token을 저장한다", async () => {
    const repository = new MemoryTokenRepository();
    const refreshToken = vi.fn().mockResolvedValue({
      accessToken: "xoxe.xoxp-new-access",
      refreshToken: "xoxe-new-refresh",
      expiresInSeconds: 43_200,
      scopes: ["chat:write"],
    });
    const service = new SlackUserTokenService(
      cipher,
      oauthClient({ refreshToken }),
      true,
      repository,
      () => 1_000,
    );
    await service.saveGrant({
      teamId: "T123",
      userId: "U123",
      accessToken: "xoxe.xoxp-old-access",
      refreshToken: "xoxe-old-refresh",
      expiresInSeconds: 1,
      scopes: ["chat:write"],
    });

    await expect(
      Promise.all([
        service.getAccessToken("T123", "U123"),
        service.getAccessToken("T123", "U123"),
      ]),
    ).resolves.toEqual(["xoxe.xoxp-new-access", "xoxe.xoxp-new-access"]);
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(refreshToken).toHaveBeenCalledWith("xoxe-old-refresh");
    expect(repository.record?.encryptedRefreshToken).not.toContain("xoxe-new-refresh");
  });

  it("폐기 시 Slack revoke를 호출한 뒤 저장된 암호문을 제거한다", async () => {
    const repository = new MemoryTokenRepository();
    const revokeToken = vi.fn().mockResolvedValue(undefined);
    const service = new SlackUserTokenService(
      cipher,
      oauthClient({ revokeToken }),
      false,
      repository,
    );
    await service.saveGrant({
      teamId: "T123",
      userId: "U123",
      accessToken: "xoxp-access",
      refreshToken: null,
      expiresInSeconds: null,
      scopes: ["chat:write"],
    });

    await expect(service.revoke("T123", "U123")).resolves.toBe(true);
    expect(revokeToken).toHaveBeenCalledWith("xoxp-access");
    expect(repository.record).toBeNull();
  });

  it("chat:write 외 사용자 scope가 섞인 grant를 거부한다", async () => {
    const service = new SlackUserTokenService(
      cipher,
      oauthClient(),
      false,
      new MemoryTokenRepository(),
    );

    await expect(
      service.saveGrant({
        teamId: "T123",
        userId: "U123",
        accessToken: "xoxp-access",
        refreshToken: null,
        expiresInSeconds: null,
        scopes: ["chat:write", "users:read"],
      }),
    ).rejects.toBeInstanceOf(SlackOAuthConfigurationError);
  });

  it("재시작 후 같은 저장소의 암호문을 다시 검증해 재사용한다", async () => {
    const repository = new MemoryTokenRepository();
    await new SlackUserTokenService(cipher, oauthClient(), false, repository).saveGrant({
      teamId: "T123",
      userId: "U123",
      accessToken: "xoxp-persisted",
      refreshToken: null,
      expiresInSeconds: null,
      scopes: ["chat:write"],
    });

    const restartedService = new SlackUserTokenService(
      cipher,
      oauthClient(),
      false,
      repository,
    );
    await expect(restartedService.getAccessToken("T123", "U123")).resolves.toBe(
      "xoxp-persisted",
    );
  });

  it("auth.test 주체가 다르면 해당 DB 버전만 폐기하고 재인증을 요구한다", async () => {
    const repository = new MemoryTokenRepository();
    const service = new SlackUserTokenService(
      cipher,
      oauthClient({
        validateToken: vi.fn().mockResolvedValue({ teamId: "T123", userId: "U999" }),
      }),
      false,
      repository,
    );
    await service.saveGrant({
      teamId: "T123",
      userId: "U123",
      accessToken: "xoxp-wrong-subject",
      refreshToken: null,
      expiresInSeconds: null,
      scopes: ["chat:write"],
    });

    await expect(service.getAccessToken("T123", "U123")).rejects.toMatchObject({
      reason: "revoked",
    });
    expect(repository.record).toBeNull();
  });

  it("Slack이 토큰 폐기를 보고하면 로컬 암호문을 지우고 재인증을 요구한다", async () => {
    const repository = new MemoryTokenRepository();
    const service = new SlackUserTokenService(
      cipher,
      oauthClient({
        validateToken: vi.fn().mockRejectedValue(new SlackOAuthApiError("token_revoked")),
      }),
      false,
      repository,
    );
    await service.saveGrant({
      teamId: "T123",
      userId: "U123",
      accessToken: "xoxp-revoked",
      refreshToken: null,
      expiresInSeconds: null,
      scopes: ["chat:write"],
    });

    await expect(service.getAccessToken("T123", "U123")).rejects.toBeInstanceOf(
      SlackUserOAuthRequiredError,
    );
    expect(repository.record).toBeNull();
  });

  it("일시적 auth.test 실패에는 저장 토큰을 폐기하지 않는다", async () => {
    const repository = new MemoryTokenRepository();
    const service = new SlackUserTokenService(
      cipher,
      oauthClient({
        validateToken: vi.fn().mockRejectedValue(new SlackOAuthApiError("network_error")),
      }),
      false,
      repository,
    );
    await service.saveGrant({
      teamId: "T123",
      userId: "U123",
      accessToken: "xoxp-retry-later",
      refreshToken: null,
      expiresInSeconds: null,
      scopes: ["chat:write"],
    });

    await expect(service.getAccessToken("T123", "U123")).rejects.toMatchObject({
      code: "network_error",
    });
    expect(repository.record).not.toBeNull();
  });

  it("stale refresh 실패가 다른 프로세스가 저장한 rotation 승자를 폐기하지 않는다", async () => {
    const repository = new MemoryTokenRepository();
    const validateToken = vi.fn().mockResolvedValue({ teamId: "T123", userId: "U123" });
    const refreshToken = vi.fn().mockImplementation(async () => {
      const current = repository.record;
      if (!current) throw new Error("missing test record");
      repository.record = {
        ...current,
        encryptedAccessToken: cipher.encrypt("xoxe.xoxp-winner", {
          teamId: "T123",
          userId: "U123",
          kind: "access",
        }),
        encryptedRefreshToken: cipher.encrypt("xoxe-winner-refresh", {
          teamId: "T123",
          userId: "U123",
          kind: "refresh",
        }),
        expiresAt: new Date(50_000_000),
      };
      throw new SlackOAuthApiError("invalid_refresh_token");
    });
    const service = new SlackUserTokenService(
      cipher,
      oauthClient({ refreshToken, validateToken }),
      true,
      repository,
      () => 1_000,
    );
    await service.saveGrant({
      teamId: "T123",
      userId: "U123",
      accessToken: "xoxe.xoxp-stale",
      refreshToken: "xoxe-stale-refresh",
      expiresInSeconds: 1,
      scopes: ["chat:write"],
    });

    await expect(service.getAccessToken("T123", "U123")).resolves.toBe(
      "xoxe.xoxp-winner",
    );
    expect(repository.record).not.toBeNull();
    expect(validateToken).toHaveBeenCalledWith("xoxe.xoxp-winner");
  });

  it("rotation CAS에서 진 응답 토큰은 폐기하고 DB 승자를 사용한다", async () => {
    const repository = new MemoryTokenRepository();
    const revokeToken = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(repository, "replaceRotated").mockImplementation(async () => {
      const current = repository.record;
      if (!current) return false;
      repository.record = {
        ...current,
        encryptedAccessToken: cipher.encrypt("xoxe.xoxp-winner", {
          teamId: "T123",
          userId: "U123",
          kind: "access",
        }),
        encryptedRefreshToken: cipher.encrypt("xoxe-winner-refresh", {
          teamId: "T123",
          userId: "U123",
          kind: "refresh",
        }),
        expiresAt: new Date(50_000_000),
      };
      return false;
    });
    const service = new SlackUserTokenService(
      cipher,
      oauthClient({
        refreshToken: vi.fn().mockResolvedValue({
          accessToken: "xoxe.xoxp-loser",
          refreshToken: "xoxe-loser-refresh",
          expiresInSeconds: 43_200,
          scopes: ["chat:write"],
        }),
        revokeToken,
      }),
      true,
      repository,
      () => 1_000,
    );
    await service.saveGrant({
      teamId: "T123",
      userId: "U123",
      accessToken: "xoxe.xoxp-stale",
      refreshToken: "xoxe-stale-refresh",
      expiresInSeconds: 1,
      scopes: ["chat:write"],
    });

    await expect(service.getAccessToken("T123", "U123")).resolves.toBe(
      "xoxe.xoxp-winner",
    );
    expect(revokeToken).toHaveBeenNthCalledWith(1, "xoxe.xoxp-loser");
    expect(revokeToken).toHaveBeenNthCalledWith(2, "xoxe-loser-refresh");
  });

  it("auth.test가 조기 만료를 보고하면 유효한 refresh token으로 갱신한다", async () => {
    const repository = new MemoryTokenRepository();
    const validateToken = vi
      .fn()
      .mockRejectedValueOnce(new SlackOAuthApiError("token_expired"))
      .mockResolvedValue({ teamId: "T123", userId: "U123" });
    const refreshToken = vi.fn().mockResolvedValue({
      accessToken: "xoxe.xoxp-refreshed",
      refreshToken: "xoxe-refreshed",
      expiresInSeconds: 43_200,
      scopes: ["chat:write"],
    });
    const service = new SlackUserTokenService(
      cipher,
      oauthClient({ validateToken, refreshToken }),
      true,
      repository,
      () => 1_000,
    );
    await service.saveGrant({
      teamId: "T123",
      userId: "U123",
      accessToken: "xoxe.xoxp-early-expired",
      refreshToken: "xoxe-early-refresh",
      expiresInSeconds: 43_200,
      scopes: ["chat:write"],
    });

    await expect(service.getAccessToken("T123", "U123")).resolves.toBe(
      "xoxe.xoxp-refreshed",
    );
    expect(refreshToken).toHaveBeenCalledWith("xoxe-early-refresh");
  });

  it("rotation 폐기 시 access와 refresh token을 모두 Slack에서 폐기한다", async () => {
    const repository = new MemoryTokenRepository();
    const revokeToken = vi.fn().mockResolvedValue(undefined);
    const service = new SlackUserTokenService(
      cipher,
      oauthClient({ revokeToken }),
      true,
      repository,
    );
    await service.saveGrant({
      teamId: "T123",
      userId: "U123",
      accessToken: "xoxe.xoxp-access",
      refreshToken: "xoxe-refresh",
      expiresInSeconds: 43_200,
      scopes: ["chat:write"],
    });

    await expect(service.revoke("T123", "U123")).resolves.toBe(true);
    expect(revokeToken).toHaveBeenNthCalledWith(1, "xoxe.xoxp-access");
    expect(revokeToken).toHaveBeenNthCalledWith(2, "xoxe-refresh");
    expect(repository.record).toBeNull();
  });

  it("Slack revoke가 일시 실패해도 로컬 토큰을 fail-closed로 제거한다", async () => {
    const repository = new MemoryTokenRepository();
    const service = new SlackUserTokenService(
      cipher,
      oauthClient({
        revokeToken: vi.fn().mockRejectedValue(new SlackOAuthApiError("network_error")),
      }),
      false,
      repository,
    );
    await service.saveGrant({
      teamId: "T123",
      userId: "U123",
      accessToken: "xoxp-access",
      refreshToken: null,
      expiresInSeconds: null,
      scopes: ["chat:write"],
    });

    await expect(service.revoke("T123", "U123")).rejects.toMatchObject({
      code: "network_error",
    });
    expect(repository.record).toBeNull();
  });
});
