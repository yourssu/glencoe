import { afterEach, describe, expect, it, vi } from "vitest";
import { logger, setLogLevel } from "./logger.js";

afterEach(() => {
  vi.restoreAllMocks();
  setLogLevel("info");
});

describe("logger secret redaction", () => {
  it("메시지, URL, 구조화 객체의 Slack 자격증명을 마스킹한다", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const token = "xoxe.xoxp-1-sensitive-token";

    logger.error(
      `request failed: Bearer ${token} https://example.com/callback?code=oauth-code&state=oauth-state`,
      {
        accessToken: token,
        nested: { refresh_token: "xoxe-1-refresh-secret", scopes: ["chat:write"] },
      },
    );

    const output = JSON.stringify(log.mock.calls);
    expect(output).not.toContain(token);
    expect(output).not.toContain("oauth-code");
    expect(output).not.toContain("oauth-state");
    expect(output).not.toContain("xoxe-1-refresh-secret");
    expect(output).toContain("[REDACTED]");
    expect(output).toContain("chat:write");
  });

  it("Error message, stack, cause 안의 토큰도 마스킹한다", () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = new Error("failed with xoxp-raw-secret");
    error.cause = { authorization: "Basic client-secret-base64" };

    logger.warn("OAuth failure", error);

    const output = JSON.stringify(log.mock.calls);
    expect(output).not.toContain("xoxp-raw-secret");
    expect(output).not.toContain("client-secret-base64");
    expect(output).toContain("[REDACTED]");
  });
});
