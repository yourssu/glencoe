import { afterEach, describe, expect, it, vi } from "vitest";

const baseEnvironment = {
  SLACK_BOT_TOKEN: "xoxb-test",
  SLACK_APP_TOKEN: "xapp-test",
  SLACK_USER_OAUTH_ENABLED: "true",
  SLACK_CLIENT_ID: "123.456",
  SLACK_CLIENT_SECRET: "0123456789abcdef0123456789abcdef",
  SLACK_OAUTH_REDIRECT_URI: "https://example.com/slack/user-oauth/callback",
  SLACK_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
  SLACK_TOKEN_ROTATION_ENABLED: "false",
  SLACK_USER_OAUTH_PORT: "3000",
  SLACK_OAUTH_STATE_TTL_SECONDS: "600",
  LLM_API_KEY: "test-llm-key",
};

async function loadConfig(overrides: Record<string, string> = {}) {
  vi.resetModules();
  for (const [name, value] of Object.entries({ ...baseEnvironment, ...overrides })) {
    vi.stubEnv(name, value);
  }
  return import("./config.js");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Slack user OAuth config", () => {
  it("유효한 보안 설정을 정규화한다", async () => {
    const { getSlackUserOAuthConfig } = await loadConfig();

    expect(getSlackUserOAuthConfig()).toMatchObject({
      clientId: "123.456",
      redirectUri: "https://example.com/slack/user-oauth/callback",
      tokenRotationEnabled: false,
      port: 3000,
      stateTtlSeconds: 600,
    });
  });

  it("callback URI의 query와 비 HTTPS 외부 주소를 거부한다", async () => {
    const withQuery = await loadConfig({
      SLACK_OAUTH_REDIRECT_URI: "https://example.com/callback?source=unsafe",
    });
    expect(() => withQuery.getSlackUserOAuthConfig()).toThrow("query");

    const insecure = await loadConfig({
      SLACK_OAUTH_REDIRECT_URI: "http://example.com/callback",
    });
    expect(() => insecure.getSlackUserOAuthConfig()).toThrow("HTTPS");
  });

  it("state TTL과 listener port의 안전 범위를 강제한다", async () => {
    await expect(
      loadConfig({ SLACK_OAUTH_STATE_TTL_SECONDS: "901" }),
    ).rejects.toThrow();
    await expect(loadConfig({ SLACK_USER_OAUTH_PORT: "65536" })).rejects.toThrow();
  });

  it("기능이 꺼져 있으면 OAuth secret 없이 null을 반환한다", async () => {
    const { getSlackUserOAuthConfig } = await loadConfig({
      SLACK_USER_OAUTH_ENABLED: "false",
      SLACK_CLIENT_ID: "",
      SLACK_CLIENT_SECRET: "",
      SLACK_TOKEN_ENCRYPTION_KEY: "",
    });

    expect(getSlackUserOAuthConfig()).toBeNull();
  });
});
