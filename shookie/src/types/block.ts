import type { KnownBlock, ContextActionsBlock } from "@slack/types";

/**
 * shookie에서 사용하는 Block Kit 블록 타입.
 * @slack/types@2.21의 KnownBlock union에 아직 포함되지 않은
 * context_actions (feedback_buttons 등)를 추가로 허용.
 *
 * 실제 Slack API 호출 경경에서는 KnownBlock[]로 캐스팅 필요.
 */
export type ShookieBlock = KnownBlock | ContextActionsBlock;
