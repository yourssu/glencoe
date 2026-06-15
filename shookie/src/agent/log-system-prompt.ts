import { wrapLanguageModel } from "ai";
import { logger } from "../logger.js";

const lastLogged = new Map<string, string>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withSystemPromptLogging(model: any, tag: string): any {
  logger.info(`[${tag}] system-prompt-logging: wrap model START`);
  const wrapped = wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v3",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transformParams: async ({ params, type }: any) => {
        logger.info(
          `[${tag}] system-prompt-logging: transformParams CALLED type=${type}`,
        );

        const prompt = (params as any)?.prompt;
        const promptKeys = prompt && typeof prompt === "object" ? Object.keys(prompt) : null;

        // params.prompt가 배열(messages)인 경우
        const messages = Array.isArray(prompt)
          ? (prompt as Array<{ role: string; content: unknown }>)
          : null;

        if (!messages) {
          logger.info(
            `[${tag}] system-prompt-logging: params.prompt is not an array. ` +
              `typeof=${typeof prompt} keys=${promptKeys?.join(",") ?? "n/a"} ` +
              `paramKeys=${Object.keys(params ?? {}).join(",")}`,
          );
          return params;
        }

        const roles = messages.map((m) => m.role);
        const systemMessages = messages.filter((m) => m.role === "system");
        logger.info(
          `[${tag}] system-prompt-logging: messages=${messages.length} ` +
            `roles=[${roles.join(",")}] systemCount=${systemMessages.length}`,
        );

        if (systemMessages.length === 0) return params;

        const content = systemMessages
          .map((m) =>
            typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          )
          .join("\n\n---\n\n");

        if (lastLogged.get(tag) === content) return params;
        lastLogged.set(tag, content);
        logger.info(
          `[${tag}] system-prompt DUMP (${type}) length=${content.length}\n${content}`,
        );

        return params;
      },
    },
  });
  logger.info(`[${tag}] system-prompt-logging: wrap model DONE`);
  return wrapped;
}
