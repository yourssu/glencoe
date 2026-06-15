import { wrapLanguageModel } from "ai";
import { logger } from "../logger.js";

const lastLogged = new Map<string, string>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withSystemPromptLogging(model: any, tag: string): any {
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v3",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transformParams: async ({ params, type }: any) => {
        const messages = params.prompt as Array<{ role: string; content: unknown }>;
        const systemMessages = messages.filter((m) => m.role === "system");
        if (systemMessages.length === 0) return params;

        const content = systemMessages
          .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
          .join("\n\n---\n\n");

        if (lastLogged.get(tag) === content) return params;
        lastLogged.set(tag, content);
        logger.debug(
          `[${tag}] system-prompt (${type}) length=${content.length}\n${content}`,
        );

        return params;
      },
    },
  });
}
