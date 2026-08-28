import { App } from "@slack/bolt";
import { config, getSlackUserOAuthConfig } from "./config.js";
import { setLogLevel, logger } from "./logger.js";
import { createAgent } from "./agent/index.js";
import { registerHandlers } from "./slack/handlers.js";
import { registerAssistantHandlers } from "./slack/assistant.js";
import { registerReactionRelay } from "./slack/reaction-relay.js";
import { closePool, runMigrations } from "database";
import { createSlackUserOAuthController } from "./slack/user-oauth/index.js";

async function main() {
  // 1. 로깅 설정
  setLogLevel(config.LOG_LEVEL);
  logger.info("구성 로드 완료");

  // 2. 사용자 OAuth 초기화 (멘션 그룹 원문 치환용)
  const userOAuthConfig = getSlackUserOAuthConfig();
  if (userOAuthConfig) {
    const appliedMigrations = await runMigrations();
    if (appliedMigrations.length > 0) {
      logger.info("DB 마이그레이션 완료", { appliedMigrations });
    }
  }
  const userOAuth = userOAuthConfig
    ? createSlackUserOAuthController(userOAuthConfig)
    : null;

  // 3. 에이전트 생성
  const agent = createAgent();

  // 4. Slack 앱 초기화
  const app = new App({
    token: config.SLACK_BOT_TOKEN,
    socketMode: true,
    appToken: config.SLACK_APP_TOKEN,
    ...(userOAuth && userOAuthConfig
      ? {
          customRoutes: [
            {
              path: userOAuth.callbackPath,
              method: "GET",
              handler: userOAuth.handleCallback,
            },
          ],
          installerOptions: { port: userOAuthConfig.port },
        }
      : {}),
  });

  // 5. 핸들러 등록
  registerHandlers(app, agent);
  registerAssistantHandlers(app);
  registerReactionRelay(app);

  // 6. 시작
  await app.start();
  logger.info("슈키가 시작되었습니다! 🚀");

  // 7. 종료 시 DB 연결 정리
  const shutdown = async () => {
    logger.info("종료 중...");
    await closePool();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  logger.error("부팅 실패", err);
  process.exit(1);
});
