import type { App } from "@slack/bolt";
import type { SlackUserOAuthController } from "../user-oauth/controller.js";
import { extractMentionMessageEvent } from "./event.js";
import { RadarMentionGroupsClient } from "./radar-client.js";
import { MentionGroupReplacementService } from "./service.js";
import { BoltMentionSlackGateway } from "./slack-gateway.js";

export interface MentionGroupReplacementRuntimeConfig {
  apiUrl: string;
  apiKey: string;
  cacheTtlMs: number;
  requestTimeoutMs: number;
}

export function createMentionGroupReplacementService(
  app: App,
  userOAuth: SlackUserOAuthController,
  config: MentionGroupReplacementRuntimeConfig,
): MentionGroupReplacementService {
  const radar = new RadarMentionGroupsClient(config);
  const slack = new BoltMentionSlackGateway(app);
  return new MentionGroupReplacementService(radar, userOAuth, slack);
}

export function registerMentionGroupReplacement(
  app: App,
  service: MentionGroupReplacementService,
): void {
  app.event("message", async ({ body, event }) => {
    const input = extractMentionMessageEvent(body, event);
    if (!input) return;
    await service.handleEvent(input);
  });
}

export { MentionGroupReplacementService } from "./service.js";
