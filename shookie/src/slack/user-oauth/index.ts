import { TokenCipher } from "../../security/token-cipher.js";
import {
  SlackUserOAuthController,
  type SlackUserOAuthControllerOptions,
} from "./controller.js";
import { SlackOAuthClient } from "./slack-oauth-client.js";
import { SlackOAuthStateService } from "./state-service.js";
import { SlackUserTokenService } from "./token-service.js";

export interface SlackUserOAuthRuntimeConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenEncryptionKey: string;
  tokenRotationEnabled: boolean;
  stateTtlSeconds: number;
}

export function createSlackUserOAuthController(
  config: SlackUserOAuthRuntimeConfig,
  options: Pick<SlackUserOAuthControllerOptions, "onAuthorized"> = {},
): SlackUserOAuthController {
  const oauthClient = new SlackOAuthClient(
    config.clientId,
    config.clientSecret,
    config.redirectUri,
  );
  const tokenService = new SlackUserTokenService(
    TokenCipher.fromBase64Key(config.tokenEncryptionKey),
    oauthClient,
    config.tokenRotationEnabled,
  );
  const stateService = new SlackOAuthStateService(undefined, config.stateTtlSeconds * 1000);
  return new SlackUserOAuthController(
    { clientId: config.clientId, redirectUri: config.redirectUri, ...options },
    stateService,
    oauthClient,
    tokenService,
  );
}

export {
  SlackUserOAuthController,
  type SlackOAuthStartRequest,
  type SlackUserOAuthControllerOptions,
} from "./controller.js";
export { SlackUserTokenService, SlackUserOAuthRequiredError } from "./token-service.js";
