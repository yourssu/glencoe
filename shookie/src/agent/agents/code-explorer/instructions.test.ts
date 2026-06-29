import { describe, expect, it } from "vitest";
import { buildCodeExplorerInstructions } from "./instructions.js";
import type { CodeExplorerConfig } from "./tools.js";

describe("code-explorer agent instructions", () => {
  const config: CodeExplorerConfig = {
    owner: "yourssu",
    gitHubToken: "dummy-token-for-test",
    workspaceBasePath: "/tmp/test-workspaces",
    workspaceMaxGb: 1,
  };
  const instructions = buildCodeExplorerInstructions(config);

  it("contains core workflow sections", () => {
    const required = [
      "## 1. 역할",
      "## 3. 워크플로우",
      "## 4. 보안 규칙",
      "## 7. 응답 규칙",
    ];
    for (const section of required) {
      expect(instructions).toContain(section);
    }
  });

  it("contains domain knowledge editing guide (section 3.5)", () => {
    expect(instructions).toContain("### 3.5 도메인 지식 파일 편집");
    expect(instructions).toContain("shookie/src/projects/<project>/posthog.ts");
    expect(instructions).toContain("PostHogKnowledge");
  });

  it("enforces fact-only updates (no inference)", () => {
    expect(instructions).toContain("사실만 반영");
    expect(instructions).toContain("추론/가설 금지");
  });

  it("delegates build verification to CI", () => {
    expect(instructions).toContain("빌드 검증은 CI에 위임");
  });

  it("includes domain-specific security guidance", () => {
    expect(instructions).toMatch(/실제 사용자 ID.*이메일.*토큰/);
    expect(instructions).toContain("민감 정보");
  });

  it("enforces exact event/property spelling from PostHog", () => {
    expect(instructions).toContain("정확한 스펠링");
    expect(instructions).toContain("스네이크 케이스");
  });

  it("injects owner into org info", () => {
    expect(instructions).toContain("yourssu");
  });
});
