import { describe, expect, it, vi } from "vitest";
import { SlackOAuthApiError, SlackOAuthClient } from "./slack-oauth-client.js";

describe("SlackOAuthClient", () => {
  it("authorization code를 chat:write 사용자 토큰으로 교환한다", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          team: { id: "T123" },
          authed_user: {
            id: "U123",
            access_token: "xoxp-access",
            scope: "chat:write",
          },
        }),
        { status: 200 },
      ),
    );
    const client = new SlackOAuthClient(
      "client-id",
      "client-secret",
      "https://example.com/slack/oauth/callback",
      fetcher,
    );

    await expect(client.exchangeCode("one-time-code")).resolves.toEqual({
      teamId: "T123",
      userId: "U123",
      accessToken: "xoxp-access",
      refreshToken: null,
      expiresInSeconds: null,
      scopes: ["chat:write"],
    });

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual(
      expect.objectContaining({ Authorization: expect.stringMatching(/^Basic /u) }),
    );
    expect(String(init.body)).toContain("code=one-time-code");
    expect(String(init.body)).not.toContain("client-secret");
  });

  it("Slack API 오류 코드를 토큰 없이 전달한다", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "invalid_code" }), { status: 200 }),
    );
    const client = new SlackOAuthClient("id", "secret", "https://example.com/callback", fetcher);

    await expect(client.exchangeCode("bad-code")).rejects.toEqual(
      new SlackOAuthApiError("invalid_code"),
    );
  });

  it("auth.test로 토큰의 team과 user 주체를 검증한다", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, team_id: "T123", user_id: "U123" }),
        { status: 200 },
      ),
    );
    const client = new SlackOAuthClient("id", "secret", "https://example.com/callback", fetcher);

    await expect(client.validateToken("xoxp-sensitive-token")).resolves.toEqual({
      teamId: "T123",
      userId: "U123",
    });

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("xoxp-sensitive-token");
    expect(init.headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer xoxp-sensitive-token" }),
    );
  });

  it("예상하지 못한 Slack error 문자열을 예외에 반사하지 않는다", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "xoxp-sensitive-token" }), {
        status: 200,
      }),
    );
    const client = new SlackOAuthClient("id", "secret", "https://example.com/callback", fetcher);

    await expect(client.exchangeCode("bad-code")).rejects.toMatchObject({
      code: "unexpected_api_error",
      message: expect.not.stringContaining("xoxp-sensitive-token"),
    });
  });

  it("토큰 폐기 시 access token을 URL이나 body에 넣지 않는다", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, revoked: true }), { status: 200 }),
    );
    const client = new SlackOAuthClient("id", "secret", "https://example.com/callback", fetcher);

    await client.revokeToken("xoxp-sensitive-token");

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("xoxp-sensitive-token");
    expect(String(init.body ?? "")).not.toContain("xoxp-sensitive-token");
    expect(init.headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer xoxp-sensitive-token" }),
    );
  });
});
