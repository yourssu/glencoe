import type { ProjectDefinition } from "../types.js";
import { ssutimePostHogKnowledge, ssutimePostHogProjectId } from "./posthog.js";

export const ssutimeProdProject: ProjectDefinition = {
  name: "ssutime-prod",
  displayName: "SSUTime-Prod",
  description: "슈타임 프로덕션",
  posthog: {
    projectId: ssutimePostHogProjectId,
    knowledge: ssutimePostHogKnowledge,
  },
};
