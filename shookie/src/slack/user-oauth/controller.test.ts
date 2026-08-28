import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { SlackUserOAuthController } from "./controller.js";
import type { SlackOAuthClient } from "./slack-oauth-client.js";
import type { SlackOAuthStateService } from "./state-service.js";
import {
  SlackUserOAuthRequiredError,
  type SlackUserTokenService,
} from "./token-service.js";

function createResponse() {
  const response = {
    headersSent: false,
    writeHead: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse;
  return response;
}

describe("SlackUserOAuthController", () => {
  it("chat:write만 요청하는 사용자 OAuth URL을 만든다", async () => {
    const stateService = { create: vi.fn().mockResolvedValue("raw-state") };
    const tokenService = {
      getAccessToken: vi.fn().mockRejectedValue(new SlackUserOAuthRequiredError("missing")),
    };
    const controller = new SlackUserOAuthController(
      {
        clientId: "123.456",
        redirectUri: "https://example.com/slack/user-oauth/callback",
      },
      stateService as unknown as SlackOAuthStateService,
      {} as SlackOAuthClient,
      tokenService as unknown as SlackUserTokenService,
    );

    const authorizationUrl = await controller.createAuthorizationUrl({
      teamId: "T123",
      userId: "U123",
      context: { channelId: "C123" },
    });
    expect(authorizationUrl).not.toBeNull();
    const result = new URL(authorizationUrl as string);

    expect(result.origin + result.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(result.searchParams.get("user_scope")).toBe("chat:write");
    expect(result.searchParams.get("scope")).toBeNull();
    expect(result.searchParams.get("state")).toBe("raw-state");
    expect(result.searchParams.get("team")).toBe("T123");
    expect(stateService.create).toHaveBeenCalledWith({
      teamId: "T123",
      userId: "U123",
      context: { channelId: "C123" },
    });
  });

  it("이미 유효한 토큰이 있는 사용자에게는 인증 URL을 만들지 않는다", async () => {
    const stateService = { create: vi.fn() };
    const controller = new SlackUserOAuthController(
      { clientId: "123.456", redirectUri: "https://example.com/oauth/callback" },
      stateService as unknown as SlackOAuthStateService,
      {} as SlackOAuthClient,
      { getAccessToken: vi.fn().mockResolvedValue("xoxp-existing") } as unknown as SlackUserTokenService,
    );

    await expect(
      controller.createAuthorizationUrl({ teamId: "T123", userId: "U123" }),
    ).resolves.toBeNull();
    expect(stateService.create).not.toHaveBeenCalled();
  });

  it("요청을 시작한 사용자와 OAuth 사용자가 다르면 토큰을 저장하지 않는다", async () => {
    const stateService = {
      consume: vi.fn().mockResolvedValue({
        teamId: "T123",
        userId: "U123",
        context: {},
      }),
    };
    const oauthClient = {
      exchangeCode: vi.fn().mockResolvedValue({
        teamId: "T123",
        userId: "U999",
        accessToken: "xoxp-access",
        refreshToken: null,
        expiresInSeconds: null,
        scopes: ["chat:write"],
      }),
      revokeToken: vi.fn().mockResolvedValue(undefined),
    };
    const tokenService = { saveGrant: vi.fn() };
    const controller = new SlackUserOAuthController(
      { clientId: "123.456", redirectUri: "https://example.com/oauth/callback" },
      stateService as unknown as SlackOAuthStateService,
      oauthClient as unknown as SlackOAuthClient,
      tokenService as unknown as SlackUserTokenService,
    );
    const response = createResponse();

    await controller.processCallback(
      { url: "/oauth/callback?code=code&state=state" } as IncomingMessage,
      response,
    );

    expect(tokenService.saveGrant).not.toHaveBeenCalled();
    expect(oauthClient.revokeToken).toHaveBeenCalledWith("xoxp-access");
    expect(response.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
  });

  it("유효한 콜백의 암호화 저장 후 성공 응답을 보낸다", async () => {
    const grant = {
      teamId: "T123",
      userId: "U123",
      accessToken: "xoxp-access",
      refreshToken: null,
      expiresInSeconds: null,
      scopes: ["chat:write"],
    };
    const tokenService = { saveGrant: vi.fn().mockResolvedValue(undefined) };
    const controller = new SlackUserOAuthController(
      { clientId: "123.456", redirectUri: "https://example.com/oauth/callback" },
      {
        consume: vi.fn().mockResolvedValue({ teamId: "T123", userId: "U123", context: {} }),
      } as unknown as SlackOAuthStateService,
      { exchangeCode: vi.fn().mockResolvedValue(grant) } as unknown as SlackOAuthClient,
      tokenService as unknown as SlackUserTokenService,
    );
    const response = createResponse();

    await controller.processCallback(
      { url: "/oauth/callback?code=code&state=state" } as IncomingMessage,
      response,
    );

    expect(tokenService.saveGrant).toHaveBeenCalledWith(grant);
    expect(response.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
  });

  it("grant 저장 실패 시 저장되지 않은 access와 refresh token을 폐기한다", async () => {
    const grant = {
      teamId: "T123",
      userId: "U123",
      accessToken: "xoxe.xoxp-access",
      refreshToken: "xoxe-refresh",
      expiresInSeconds: 43_200,
      scopes: ["chat:write"],
    };
    const revokeToken = vi.fn().mockResolvedValue(undefined);
    const controller = new SlackUserOAuthController(
      { clientId: "123.456", redirectUri: "https://example.com/oauth/callback" },
      {
        consume: vi.fn().mockResolvedValue({ teamId: "T123", userId: "U123", context: {} }),
      } as unknown as SlackOAuthStateService,
      {
        exchangeCode: vi.fn().mockResolvedValue(grant),
        revokeToken,
      } as unknown as SlackOAuthClient,
      {
        saveGrant: vi.fn().mockRejectedValue(new Error("database unavailable")),
      } as unknown as SlackUserTokenService,
    );

    await expect(
      controller.processCallback(
        { url: "/oauth/callback?code=code&state=state" } as IncomingMessage,
        createResponse(),
      ),
    ).rejects.toThrow("database unavailable");
    expect(revokeToken).toHaveBeenNthCalledWith(1, "xoxe.xoxp-access");
    expect(revokeToken).toHaveBeenNthCalledWith(2, "xoxe-refresh");
  });

  it("사용자가 인증을 취소해도 state를 검증하고 소비한다", async () => {
    const consume = vi.fn().mockResolvedValue({ teamId: "T123", userId: "U123", context: {} });
    const exchangeCode = vi.fn();
    const controller = new SlackUserOAuthController(
      { clientId: "123.456", redirectUri: "https://example.com/oauth/callback" },
      { consume } as unknown as SlackOAuthStateService,
      { exchangeCode } as unknown as SlackOAuthClient,
      {} as SlackUserTokenService,
    );
    const response = createResponse();

    await controller.processCallback(
      { url: "/oauth/callback?error=access_denied&state=state" } as IncomingMessage,
      response,
    );

    expect(consume).toHaveBeenCalledWith("state");
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(response.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
  });

  it("후속 재개 처리 실패가 저장된 인증을 되돌리거나 OAuth 실패로 보이지 않게 한다", async () => {
    const grant = {
      teamId: "T123",
      userId: "U123",
      accessToken: "xoxp-access",
      refreshToken: null,
      expiresInSeconds: null,
      scopes: ["chat:write"],
    };
    const tokenService = { saveGrant: vi.fn().mockResolvedValue(undefined) };
    const controller = new SlackUserOAuthController(
      {
        clientId: "123.456",
        redirectUri: "https://example.com/oauth/callback",
        onAuthorized: vi.fn().mockRejectedValue(new Error("resume failed")),
      },
      {
        consume: vi.fn().mockResolvedValue({ teamId: "T123", userId: "U123", context: {} }),
      } as unknown as SlackOAuthStateService,
      { exchangeCode: vi.fn().mockResolvedValue(grant) } as unknown as SlackOAuthClient,
      tokenService as unknown as SlackUserTokenService,
    );
    const response = createResponse();

    await controller.processCallback(
      { url: "/oauth/callback?code=code&state=state" } as IncomingMessage,
      response,
    );

    expect(tokenService.saveGrant).toHaveBeenCalledWith(grant);
    expect(response.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    expect(response.end).toHaveBeenCalledWith(expect.stringContaining("원래 요청을 다시"));
  });
});
