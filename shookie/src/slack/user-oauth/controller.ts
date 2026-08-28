import type { IncomingMessage, ServerResponse } from "node:http";
import { logger } from "../../logger.js";
import {
  SlackOAuthClient,
  SlackOAuthApiError,
  type SlackUserOAuthGrant,
} from "./slack-oauth-client.js";
import {
  SlackOAuthStateService,
  type ConsumedSlackOAuthState,
  type SlackOAuthContext,
} from "./state-service.js";
import {
  SlackUserOAuthRequiredError,
  SlackUserTokenService,
} from "./token-service.js";

const REQUIRED_USER_SCOPE = "chat:write";

export interface SlackOAuthStartRequest {
  teamId: string;
  userId: string;
  context?: SlackOAuthContext;
}

export interface SlackUserOAuthControllerOptions {
  clientId: string;
  redirectUri: string;
  onAuthorized?: (state: ConsumedSlackOAuthState) => Promise<void>;
}

export class SlackUserOAuthController {
  readonly callbackPath: string;

  constructor(
    private readonly options: SlackUserOAuthControllerOptions,
    private readonly stateService: SlackOAuthStateService,
    private readonly oauthClient: SlackOAuthClient,
    private readonly tokenService: SlackUserTokenService,
  ) {
    this.callbackPath = new URL(options.redirectUri).pathname;
  }

  /** Returns null when this exact workspace user already has a valid token. */
  async createAuthorizationUrl(request: SlackOAuthStartRequest): Promise<string | null> {
    if (!request.teamId || !request.userId) {
      throw new Error("Slack OAuth authorization requires a team and user");
    }
    try {
      await this.tokenService.getAccessToken(request.teamId, request.userId);
      return null;
    } catch (error) {
      if (!(error instanceof SlackUserOAuthRequiredError)) throw error;
    }

    const state = await this.stateService.create(request);
    const url = new URL("https://slack.com/oauth/v2/authorize");
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("user_scope", REQUIRED_USER_SCOPE);
    url.searchParams.set("redirect_uri", this.options.redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("team", request.teamId);
    return url.toString();
  }

  async getAccessToken(teamId: string, userId: string): Promise<string> {
    return this.tokenService.getAccessToken(teamId, userId);
  }

  async revoke(teamId: string, userId: string): Promise<boolean> {
    return this.tokenService.revoke(teamId, userId);
  }

  async invalidateAccessToken(
    teamId: string,
    userId: string,
    expectedAccessToken: string,
  ): Promise<boolean> {
    return this.tokenService.invalidateAccessToken(teamId, userId, expectedAccessToken);
  }

  handleCallback = (req: IncomingMessage, res: ServerResponse): void => {
    void this.processCallback(req, res).catch((error: unknown) => {
      const safeError = error instanceof SlackOAuthApiError ? error.code : errorName(error);
      logger.error("Slack 사용자 OAuth 콜백 실패", { error: safeError });
      sendHtml(res, 500, "Slack 인증을 완료하지 못했습니다. Slack에서 다시 시도해 주세요.");
    });
  };

  async processCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? this.callbackPath, "http://localhost");
    const stateValue = url.searchParams.get("state") ?? "";
    if (!stateValue) {
      sendHtml(res, 400, "잘못된 Slack 인증 요청입니다.");
      return;
    }

    const state = await this.stateService.consume(stateValue);
    if (!state) {
      sendHtml(res, 400, "만료되었거나 이미 사용된 Slack 인증 요청입니다.");
      return;
    }

    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      logger.info("Slack 사용자 OAuth 취소", {
        teamId: state.teamId,
        userId: state.userId,
        error: safeOAuthErrorCode(oauthError),
      });
      sendHtml(res, 400, "Slack 인증이 취소되었습니다. 이 창을 닫아도 됩니다.");
      return;
    }

    const code = url.searchParams.get("code") ?? "";
    if (!code) {
      sendHtml(res, 400, "잘못된 Slack 인증 요청입니다.");
      return;
    }

    const grant = await this.oauthClient.exchangeCode(code);
    if (grant.teamId !== state.teamId || grant.userId !== state.userId) {
      logger.warn("Slack 사용자 OAuth 주체 불일치", {
        expectedTeamId: state.teamId,
        actualTeamId: grant.teamId,
        expectedUserId: state.userId,
        actualUserId: grant.userId,
      });
      await this.discardGrant(grant);
      sendHtml(res, 403, "요청을 시작한 Slack 계정으로 인증해 주세요.");
      return;
    }

    try {
      await this.tokenService.saveGrant(grant);
    } catch (error) {
      await this.discardGrant(grant);
      throw error;
    }

    let followUpSucceeded = true;
    if (this.options.onAuthorized) {
      try {
        await this.options.onAuthorized(state);
      } catch (error) {
        followUpSucceeded = false;
        logger.error("Slack 사용자 OAuth 후속 처리 실패", { error: errorName(error) });
      }
    }

    logger.info("Slack 사용자 OAuth 저장 완료", {
      teamId: state.teamId,
      userId: state.userId,
      scopes: grant.scopes,
    });
    sendHtml(
      res,
      200,
      followUpSucceeded
        ? "Slack 인증이 완료되었습니다. 이 창을 닫고 Slack으로 돌아가세요."
        : "Slack 인증은 완료되었습니다. Slack으로 돌아가 원래 요청을 다시 시도해 주세요.",
    );
  }

  private async discardGrant(grant: SlackUserOAuthGrant): Promise<void> {
    const tokens = [grant.accessToken, grant.refreshToken].filter(
      (token): token is string => Boolean(token),
    );
    for (const token of tokens) {
      try {
        await this.oauthClient.revokeToken(token);
      } catch (error) {
        logger.warn("저장하지 않은 Slack OAuth grant 폐기 실패", {
          error: error instanceof SlackOAuthApiError ? error.code : errorName(error),
        });
      }
    }
  }
}

function safeOAuthErrorCode(value: string): string {
  return /^[a-z0-9_]{1,64}$/u.test(value) ? value : "unexpected_oauth_error";
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown_error";
}

function sendHtml(res: ServerResponse, statusCode: number, message: string): void {
  if (res.headersSent) return;
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(`<!doctype html>
<html lang="ko">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
  <body style="font-family: sans-serif; max-width: 560px; margin: 80px auto; padding: 0 24px">
    <h1>Shookie</h1><p>${message}</p>
  </body>
</html>`);
}
