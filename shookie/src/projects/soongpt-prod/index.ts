import type { ProjectDefinition } from "../types.js";
import { soongptPostHogKnowledge, soongptPostHogProjectId } from "./posthog.js";

export const soongptProdProject: ProjectDefinition = {
  name: "soongpt-prod",
  displayName: "Soongpt-Prod",
  description: "숭피티 프로덕션",
  posthog: {
    projectId: soongptPostHogProjectId,
    knowledge: soongptPostHogKnowledge,
  },
};
