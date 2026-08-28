const SLACK_OAUTH_TOKEN_URL = "https://slack.com/api/oauth.v2.access";
const SLACK_AUTH_REVOKE_URL = "https://slack.com/api/auth.revoke";
const SLACK_AUTH_TEST_URL = "https://slack.com/api/auth.test";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

interface SlackOAuthApiResponse {
  ok?: boolean;
  error?: unknown;
  revoked?: boolean;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  team?: { id?: string };
  team_id?: string;
  user_id?: string;
  authed_user?: {
    id?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
}

export interface SlackUserOAuthGrant {
  teamId: string;
  userId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number | null;
  scopes: string[];
}

export interface RefreshedSlackUserOAuthGrant {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  scopes: string[];
}

export interface SlackTokenIdentityResponse {
  teamId: string;
  userId: string;
}

export class SlackOAuthApiError extends Error {
  readonly code: string;

  constructor(code: string) {
    const safeCode = /^[a-z0-9_]{1,64}$/u.test(code) ? code : "unexpected_api_error";
    super(`Slack OAuth API failed: ${safeCode}`);
    this.name = "SlackOAuthApiError";
    this.code = safeCode;
  }
}

function parseScopes(scope: string | undefined): string[] {
  return (scope ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export class SlackOAuthClient {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {}

  async exchangeCode(code: string): Promise<SlackUserOAuthGrant> {
    const response = await this.requestToken({
      code,
      redirect_uri: this.redirectUri,
    });
    const user = response.authed_user;
    const accessToken = user?.access_token;
    const teamId = response.team?.id;
    const userId = user?.id;

    if (!accessToken || !teamId || !userId) {
      throw new SlackOAuthApiError("invalid_oauth_response");
    }

    return {
      teamId,
      userId,
      accessToken,
      refreshToken: user.refresh_token ?? response.refresh_token ?? null,
      expiresInSeconds: user.expires_in ?? response.expires_in ?? null,
      scopes: parseScopes(user.scope),
    };
  }

  async refreshToken(refreshToken: string): Promise<RefreshedSlackUserOAuthGrant> {
    const response = await this.requestToken({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const accessToken = response.authed_user?.access_token ?? response.access_token;
    const nextRefreshToken = response.authed_user?.refresh_token ?? response.refresh_token;
    const expiresInSeconds = response.authed_user?.expires_in ?? response.expires_in;
    const scope = response.authed_user?.scope ?? response.scope;

    if (
      !accessToken ||
      !nextRefreshToken ||
      !Number.isSafeInteger(expiresInSeconds) ||
      (expiresInSeconds ?? 0) <= 0
    ) {
      throw new SlackOAuthApiError("invalid_token_rotation_response");
    }

    return {
      accessToken,
      refreshToken: nextRefreshToken,
      expiresInSeconds: expiresInSeconds as number,
      scopes: parseScopes(scope),
    };
  }

  async validateToken(accessToken: string): Promise<SlackTokenIdentityResponse> {
    const body = await this.requestAuthenticated(SLACK_AUTH_TEST_URL, accessToken);
    if (!body.team_id || !body.user_id) {
      throw new SlackOAuthApiError("invalid_auth_test_response");
    }
    return { teamId: body.team_id, userId: body.user_id };
  }

  async revokeToken(accessToken: string): Promise<void> {
    const body = await this.requestAuthenticated(SLACK_AUTH_REVOKE_URL, accessToken);
    if (body.revoked !== true) {
      throw new SlackOAuthApiError("invalid_revoke_response");
    }
  }

  private async requestToken(params: Record<string, string>): Promise<SlackOAuthApiResponse> {
    return this.request(SLACK_OAUTH_TOKEN_URL, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
    });
  }

  private async requestAuthenticated(
    url: string,
    token: string,
  ): Promise<SlackOAuthApiResponse> {
    return this.request(url, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
  }

  private async request(url: string, init: RequestInit): Promise<SlackOAuthApiResponse> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...init,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch {
      throw new SlackOAuthApiError("network_error");
    }

    let body: SlackOAuthApiResponse;
    try {
      body = (await response.json()) as SlackOAuthApiResponse;
    } catch {
      throw new SlackOAuthApiError("invalid_json_response");
    }
    if (!response.ok || body.ok !== true) {
      const errorCode =
        typeof body.error === "string" ? body.error : `http_${response.status}`;
      throw new SlackOAuthApiError(errorCode);
    }
    return body;
  }
}
