import { describe, expect, it } from "vitest";
import { convertMarkdownToBlocks } from "./markdown-to-blocks.js";

describe("convertMarkdownToBlocks", () => {
  it("converts plain text to a single section block", () => {
    const { blocks, fallbackText } = convertMarkdownToBlocks("Hello world", "🔧 도구: 없음");
    expect(blocks).toHaveLength(2); // section + context
    expect(blocks[0]).toEqual({
      type: "section",
      text: { type: "mrkdwn", text: "Hello world" },
    });
    expect(fallbackText).toContain("Hello world");
  });

  it("converts ## heading to header block", () => {
    const { blocks } = convertMarkdownToBlocks("## :octopus: PR 분석", "footer");
    const header = blocks.find((b) => b.type === "header");
    expect(header).toBeDefined();
    expect(header).toEqual({
      type: "header",
      text: { type: "plain_text", text: ":octopus: PR 분석", emoji: true },
    });
  });

  it("converts ### heading to bold section block", () => {
    const { blocks } = convertMarkdownToBlocks("### :clipboard: 요약", "footer");
    const section = blocks[0];
    expect(section.type).toBe("section");
    if (section.type === "section" && "text" in section) {
      expect(section.text).toEqual({
        type: "mrkdwn",
        text: "*:clipboard: 요약*",
      });
    }
  });

  it("converts --- to divider block", () => {
    const { blocks } = convertMarkdownToBlocks("before\n---\nafter", "footer");
    expect(blocks.some((b) => b.type === "divider")).toBe(true);
  });

  it("converts markdown table to bullet list", () => {
    const markdown = [
      "| PR | 제목 | 상태 |",
      "|---|---|---|",
      "| #133 | fix: bug | Merged |",
      "| #132 | feat: new | Open |",
    ].join("\n");

    const { blocks } = convertMarkdownToBlocks(markdown, "footer");
    const section = blocks.find((b) => b.type === "section");
    expect(section).toBeDefined();
    if (section && section.type === "section" && "text" in section) {
      const text = section.text as { type: string; text: string };
      expect(text.text).toContain("*#133*");
      expect(text.text).toContain("fix: bug");
      expect(text.text).toContain("Merged");
    }
  });

  it("converts 2-column table to key-value format", () => {
    const markdown = ["| 항목 | 값 |", "|---|---|", "| 이름 | 테스트 |"].join("\n");
    const { blocks } = convertMarkdownToBlocks(markdown, "footer");
    const section = blocks.find((b) => b.type === "section");
    expect(section).toBeDefined();
    if (section && section.type === "section" && "text" in section) {
      const text = section.text as { type: string; text: string };
      expect(text.text).toContain("*이름*: 테스트");
    }
  });

  it("preserves code blocks verbatim", () => {
    const markdown = "```\n## not a heading\n---\n```";
    const { blocks } = convertMarkdownToBlocks(markdown, "footer");
    const section = blocks.find((b) => b.type === "section");
    expect(section).toBeDefined();
    if (section && section.type === "section" && "text" in section) {
      const text = section.text as { type: string; text: string };
      expect(text.text).toContain("## not a heading");
      expect(text.text).toContain("---");
    }
    expect(blocks.some((b) => b.type === "header")).toBe(false);
    expect(blocks.some((b) => b.type === "divider")).toBe(false);
  });

  it("puts debug footer in context block", () => {
    const { blocks } = convertMarkdownToBlocks("text", "🔧 도구: github\n💰 토큰: 100");
    const context = blocks.find((b) => b.type === "context");
    expect(context).toBeDefined();
    if (context && context.type === "context" && "elements" in context) {
      const elements = context.elements as Array<{ type: string; text: string }>;
      expect(elements[0].text).toContain("🔧");
      expect(elements[0].text).toContain("💰");
    }
  });

  it("handles mixed content (realistic response)", () => {
    const markdown = [
      "## :octopus: PR 분석",
      "",
      ":warning: 최근 PR이 없어요.",
      "",
      "---",
      "",
      "### :clipboard: PR 요약",
      "",
      "| PR | 제목 | 상태 | 작성자 |",
      "|---|---|---|---|",
      "| **#133** | fix: bug | Merged | PeraSite |",
      "",
      "---",
      "",
      "### :mag: 주요 내용",
      "",
      "- **#133** 버그 수정",
    ].join("\n");

    const { blocks, fallbackText } = convertMarkdownToBlocks(markdown, "footer");

    expect(blocks.some((b) => b.type === "header")).toBe(true);
    expect(blocks.some((b) => b.type === "divider")).toBe(true);
    expect(fallbackText).not.toContain("## ");
    expect(fallbackText).toContain("PR 분석");
  });

  it("strips ## and --- from fallback text", () => {
    const { fallbackText } = convertMarkdownToBlocks("## Title\n---\nBody text", "footer");
    expect(fallbackText).not.toContain("## ");
    expect(fallbackText).not.toMatch(/^---$/m);
    expect(fallbackText).toContain("Title");
    expect(fallbackText).toContain("Body text");
  });

  it("handles empty input gracefully", () => {
    const { blocks } = convertMarkdownToBlocks("", "footer");
    expect(blocks.length).toBeGreaterThan(0);
  });

  it("splits long text into multiple sections", () => {
    const longText = Array(200).fill("Lorem ipsum dolor sit amet consectetur adipiscing elit").join("\n\n");
    const { blocks } = convertMarkdownToBlocks(longText, "footer");
    const sections = blocks.filter((b) => b.type === "section");
    expect(sections.length).toBeGreaterThan(1);
  });

  it("preserves bold and emoji shortcodes", () => {
    const { blocks } = convertMarkdownToBlocks("**bold** and :white_check_mark:", "footer");
    const section = blocks.find((b) => b.type === "section");
    expect(section).toBeDefined();
    if (section && section.type === "section" && "text" in section) {
      const text = section.text as { type: string; text: string };
      expect(text.text).toContain("*bold*");
      expect(text.text).toContain(":white_check_mark:");
      expect(text.text).not.toContain("**bold**");
    }
  });

  it("converts **bold** to Slack *bold* in paragraphs and tables", () => {
    const markdown = "**SSUTime-Prod** 분석 결과입니다.";
    const { blocks } = convertMarkdownToBlocks(markdown, "footer");
    const section = blocks.find((b) => b.type === "section");
    if (section && section.type === "section" && "text" in section) {
      const text = section.text as { type: string; text: string };
      expect(text.text).toContain("*SSUTime-Prod*");
      expect(text.text).not.toContain("**SSUTime-Prod**");
    }
  });

  it("converts __bold__ to Slack *bold*", () => {
    const markdown = "__중요__ 안내입니다.";
    const { blocks } = convertMarkdownToBlocks(markdown, "footer");
    const section = blocks.find((b) => b.type === "section");
    if (section && section.type === "section" && "text" in section) {
      const text = section.text as { type: string; text: string };
      expect(text.text).toContain("*중요*");
      expect(text.text).not.toContain("__중요__");
    }
  });

  it("converts ~~strike~~ to Slack ~strike~", () => {
    const markdown = "~~취소됨~~ 항목입니다.";
    const { blocks } = convertMarkdownToBlocks(markdown, "footer");
    const section = blocks.find((b) => b.type === "section");
    if (section && section.type === "section" && "text" in section) {
      const text = section.text as { type: string; text: string };
      expect(text.text).toContain("~취소됨~");
      expect(text.text).not.toContain("~~취소됨~~");
    }
  });

  it("preserves ** inside code blocks (no mrkdwn conversion)", () => {
    const markdown = "```\n**not bold**\n```";
    const { blocks } = convertMarkdownToBlocks(markdown, "footer");
    const section = blocks.find((b) => b.type === "section");
    expect(section).toBeDefined();
    if (section && section.type === "section" && "text" in section) {
      const text = section.text as { type: string; text: string };
      // Code block content must be preserved verbatim, including the double **
      expect(text.text).toBe("```\n**not bold**\n```");
    }
  });

  it("wraps code blocks with ``` fences in output", () => {
    const markdown = "```\nconst x = 1;\n```";
    const { blocks } = convertMarkdownToBlocks(markdown, "footer");
    const section = blocks.find((b) => b.type === "section");
    if (section && section.type === "section" && "text" in section) {
      const text = section.text as { type: string; text: string };
      expect(text.text).toMatch(/```[\s\S]*const x = 1;[\s\S]*```/);
    }
  });

  it("preserves ** inside inline code spans", () => {
    const markdown = "실행하려면 `**flag**` 값을 바꾸세요.";
    const { blocks } = convertMarkdownToBlocks(markdown, "footer");
    const section = blocks.find((b) => b.type === "section");
    if (section && section.type === "section" && "text" in section) {
      const text = section.text as { type: string; text: string };
      expect(text.text).toContain("`**flag**`");
      expect(text.text).not.toContain("`*flag*`");
    }
  });

  it("converts *<URL*> to *<URL>* (닫는 asterisk를 > 바깥으로)", () => {
    const markdown = "*<https://github.com/yourssu/shookie/pull/46*>";
    const { blocks } = convertMarkdownToBlocks(markdown, "footer");
    const section = blocks.find((b) => b.type === "section");
    expect(section).toBeDefined();
    if (section && section.type === "section" && "text" in section) {
      const text = section.text as { type: string; text: string };
      expect(text.text).toBe("*<https://github.com/yourssu/shookie/pull/46>*");
      expect(text.text).not.toContain("pull/46*>");
    }
  });

  it("preserves already-correct *<URL>* format", () => {
    const markdown = "*<https://github.com/yourssu/shookie/pull/46>*";
    const { blocks } = convertMarkdownToBlocks(markdown, "footer");
    const section = blocks.find((b) => b.type === "section");
    expect(section).toBeDefined();
    if (section && section.type === "section" && "text" in section) {
      const text = section.text as { type: string; text: string };
      expect(text.text).toBe("*<https://github.com/yourssu/shookie/pull/46>*");
    }
  });

  it("fallback text도 **bold**를 *bold*로 정규화", () => {
    const markdown = "**제목**: feat: 팀 릴레이 슬랙봇 기능 추가";
    const { fallbackText } = convertMarkdownToBlocks(markdown, "footer");
    expect(fallbackText).toContain("*제목*");
    expect(fallbackText).not.toContain("**제목**");
  });

  it("닫는 * 뒤에 CJK 문자가 붙으면 공백을 삽입한다", () => {
    const { blocks } = convertMarkdownToBlocks("**3위**야 드디어!", "footer");
    const section = blocks.find((b) => b.type === "section");
    if (section && section.type === "section" && "text" in section) {
      const text = section.text as { type: string; text: string };
      expect(text.text).toContain("*3위* 야");
      expect(text.text).not.toContain("*3위*야");
    }
  });

  it("닫는 * 뒤에 CJK(한글)가 붙으면 공백을 삽입한다", () => {
    const { blocks } = convertMarkdownToBlocks("**안녕**하세요 반갑습니다", "footer");
    const section = blocks.find((b) => b.type === "section");
    if (section && section.type === "section" && "text" in section) {
      const text = section.text as { type: string; text: string };
      expect(text.text).toContain("*안녕* 하세요");
    }
  });

  it("닫는 * 뒤에 영문/숫자가 오면 공백을 삽입하지 않는다 (기존 동작 유지)", () => {
    const { blocks } = convertMarkdownToBlocks("**bold**and **count**3개", "footer");
    const section = blocks.find((b) => b.type === "section");
    if (section && section.type === "section" && "text" in section) {
      const text = section.text as { type: string; text: string };
      // 영문/숫자는 CJK가 아니므로 공백이 삽입되지 않음
      expect(text.text).toContain("*bold*and");
      expect(text.text).toContain("*count*3개");
    }
  });

  it("fallback text도 *<URL*>을 *<URL>*로 정규화", () => {
    const markdown = "*<https://github.com/yourssu/shookie/pull/46*>";
    const { fallbackText } = convertMarkdownToBlocks(markdown, "footer");
    expect(fallbackText).toContain("*<https://github.com/yourssu/shookie/pull/46>*");
    expect(fallbackText).not.toContain("pull/46*>");
  });

  it("splits long code blocks into multiple sections with balanced ``` fences", () => {
    const longLine = "x".repeat(2000);
    const markdown = "```\n" + longLine + "\n" + longLine + "\n```";
    const { blocks } = convertMarkdownToBlocks(markdown, "footer");
    const codeSections = blocks.filter((b) => {
      if (b.type !== "section" || !("text" in b)) return false;
      const text = (b.text as { text: string }).text;
      return text.includes("```");
    });
    expect(codeSections.length).toBeGreaterThan(1);
    for (const s of codeSections) {
      if (s.type === "section" && "text" in s) {
        const text = (s.text as { text: string }).text;
        const fenceCount = (text.match(/```/g) ?? []).length;
        expect(fenceCount).toBe(2); // each chunk must open AND close its own code block
      }
    }
  });

  it("withFeedback 옵션 미지정 시 context_actions 블록 없음", () => {
    const { blocks } = convertMarkdownToBlocks("text", "footer");
    expect(blocks.find((b) => b.type === "context_actions")).toBeUndefined();
  });

  it("withFeedback: true일 때 context_actions 블록 추가", () => {
    const { blocks } = convertMarkdownToBlocks("text", "footer", { withFeedback: true });
    const feedbackBlock = blocks.find((b) => b.type === "context_actions");
    expect(feedbackBlock).toBeDefined();
  });

  it("context_actions가 debug context 블록보다 앞에 위치", () => {
    const { blocks } = convertMarkdownToBlocks("text", "footer", { withFeedback: true });
    const feedbackIdx = blocks.findIndex((b) => b.type === "context_actions");
    const contextIdx = blocks.findIndex((b) => b.type === "context");
    expect(feedbackIdx).toBeGreaterThan(-1);
    expect(contextIdx).toBeGreaterThan(-1);
    expect(feedbackIdx).toBeLessThan(contextIdx);
  });

  it("feedback_buttons에 positive/negative 버튼 모두 포함", () => {
    const { blocks } = convertMarkdownToBlocks("text", "footer", { withFeedback: true });
    const feedbackBlock = blocks.find((b) => b.type === "context_actions") as
      | { type: string; elements: Array<{ type: string; positive_button?: unknown; negative_button?: unknown }> }
      | undefined;
    expect(feedbackBlock).toBeDefined();
    expect(feedbackBlock!.elements[0].type).toBe("feedback_buttons");
    expect(feedbackBlock!.elements[0].positive_button).toBeDefined();
    expect(feedbackBlock!.elements[0].negative_button).toBeDefined();
  });
});
