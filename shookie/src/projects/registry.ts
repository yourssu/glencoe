import type { ProjectDefinition, ProjectRegistry } from "./types.js";
import { ssutimeProdProject } from "./ssutime-prod/index.js";
import { soongptProdProject } from "./soongpt-prod/index.js";

export const PROJECTS = {
  "ssutime-prod": ssutimeProdProject,
  "soongpt-prod": soongptProdProject,
} as const satisfies ProjectRegistry;

type WithPostHog = ProjectDefinition & { posthog: NonNullable<ProjectDefinition["posthog"]> };
type WithCodeExplorer = ProjectDefinition & {
  codeExplorer: NonNullable<ProjectDefinition["codeExplorer"]>;
};

export function getPostHogProjects(): WithPostHog[] {
  return Object.values(PROJECTS).filter((p): p is WithPostHog => p.posthog !== undefined);
}

export function getCodeExplorerProjects(): WithCodeExplorer[] {
  return Object.values(PROJECTS).filter((p): p is WithCodeExplorer => p.codeExplorer !== undefined);
}

export function getProjectByDisplayName(displayName: string): ProjectDefinition | undefined {
  return Object.values(PROJECTS).find((p) => p.displayName === displayName);
}
