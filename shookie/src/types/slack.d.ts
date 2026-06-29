// Slack의 새 Block Kit 타입들 중 @slack/types@2.21에 아직 정의되지 않은 것들을 보강.
// docs: https://docs.slack.dev/reference/block-kit/blocks/context-actions-block
declare module "@slack/types" {
  export interface FeedbackButton {
    text: { type: "plain_text"; text: string; emoji?: boolean };
    value: string;
  }

  export interface FeedbackButtonsElement {
    type: "feedback_buttons";
    action_id: string;
    positive_button: FeedbackButton;
    negative_button: FeedbackButton;
  }

  export interface ContextActionsBlock {
    type: "context_actions";
    elements: FeedbackButtonsElement[];
    block_id?: string;
  }
}

export {};

