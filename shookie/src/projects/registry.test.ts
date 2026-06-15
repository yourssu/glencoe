import { describe, expect, it } from "vitest";
import {
  PROJECTS,
  getPostHogProjects,
  getCodeExplorerProjects,
  getProjectByDisplayName,
} from "./registry.js";

describe("projects registry", () => {
  it("ssutime-prod와 soongpt-prod를 포함한다", () => {
    expect(Object.keys(PROJECTS)).toEqual(expect.arrayContaining(["ssutime-prod", "soongpt-prod"]));
  });

  it("ssutime-prod는 PostHog projectId 440922를 갖는다", () => {
    expect(PROJECTS["ssutime-prod"].posthog?.projectId).toBe("440922");
    expect(PROJECTS["ssutime-prod"].posthog?.knowledge).toContain("SSU-Time");
  });

  it("soongpt-prod는 PostHog projectId 308417을 갖는다", () => {
    expect(PROJECTS["soongpt-prod"].posthog?.projectId).toBe("308417");
    expect(PROJECTS["soongpt-prod"].posthog?.knowledge).toContain("Soongpt");
  });

  it("getPostHogProjects는 PostHog 섹션이 있는 프로젝트만 반환한다", () => {
    const projects = getPostHogProjects();
    expect(projects).toHaveLength(2);
    const displayNames = projects.map((p) => p.displayName);
    expect(displayNames).toEqual(expect.arrayContaining(["SSUTime-Prod", "soongpt-prod"]));
  });

  it("getCodeExplorerProjects는 현재 빈 배열을 반환한다", () => {
    expect(getCodeExplorerProjects()).toEqual([]);
  });

  it("getProjectByDisplayName으로 SSUTime-Prod를 찾는다", () => {
    const project = getProjectByDisplayName("SSUTime-Prod");
    expect(project?.name).toBe("ssutime-prod");
  });

  it("getProjectByDisplayName으로 unknown을 조회하면 undefined", () => {
    expect(getProjectByDisplayName("nonexistent")).toBeUndefined();
  });
});
