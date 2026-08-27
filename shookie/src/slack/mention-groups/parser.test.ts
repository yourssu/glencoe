import { describe, expect, it } from "vitest";
import {
  buildMentionGroupIndex,
  createMentionReplacementPlan,
  findMentionHandleOccurrences,
} from "./parser.js";
import type { ActiveMentionGroup, MentionGroupCatalog } from "./types.js";

const backend: ActiveMentionGroup = {
  id: "61b37086-28f7-44fd-9683-e1d8821cd51f",
  handle: "backend",
  aliases: ["be", "server-team"],
  memberUserIds: ["U111", "U222"],
};

function catalog(groups: ActiveMentionGroup[]): MentionGroupCatalog {
  return {
    revision: 1,
    etag: '"mention-groups-1"',
    groups,
    byHandle: buildMentionGroupIndex(groups),
  };
}

describe("mention group parser", () => {
  it("명확한 경계의 handle과 별칭을 대소문자와 무관하게 찾는다", () => {
    expect(findMentionHandleOccurrences("(@Backend), @be! / @server-team")).toMatchObject([
      { handle: "backend", raw: "@Backend" },
      { handle: "be", raw: "@be" },
      { handle: "server-team", raw: "@server-team" },
    ]);
    expect(findMentionHandleOccurrences("한글@backend foo@backend @backend_more")).toMatchObject([
      { handle: "backend_more", raw: "@backend_more" },
    ]);
  });

  it("코드, Slack entity, 링크, URL, 이메일 안의 handle은 무시한다", () => {
    const text = [
      "`@backend`",
      "```ts\n@backend\n```",
      "<@backend>",
      "<https://example.com/@backend|@backend>",
      "https://example.com/@backend",
      "owner@backend.example",
      "@backend",
    ].join(" ");

    expect(findMentionHandleOccurrences(text)).toMatchObject([
      { handle: "backend", raw: "@backend" },
    ]);
  });

  it("복수 그룹과 별칭의 멤버 합집합을 원문 순서대로 한 번씩 치환한다", () => {
    const platform: ActiveMentionGroup = {
      id: "4d92a1d8-52f4-46b0-b389-3284cff8a688",
      handle: "platform",
      aliases: ["infra"],
      memberUserIds: ["U222", "U333"],
    };

    const result = createMentionReplacementPlan(
      "검토: @be, @platform 그리고 @backend",
      catalog([backend, platform]),
    );

    expect(result.text).toBe("검토: <@U111> <@U222>, <@U333> 그리고 ");
    expect(result.memberUserIds).toEqual(["U111", "U222", "U333"]);
    expect(result.groupHandles).toEqual(["backend", "platform"]);
    expect(result.matchedOccurrenceCount).toBe(3);
  });

  it("알 수 없거나 멤버가 없는 활성 그룹은 원문에 남긴다", () => {
    const empty: ActiveMentionGroup = {
      id: "bdf1f060-2827-42a5-818c-3205279c6c8f",
      handle: "empty",
      aliases: [],
      memberUserIds: [],
    };

    const result = createMentionReplacementPlan(
      "@unknown @empty @backend",
      catalog([empty, backend]),
    );

    expect(result.text).toBe("@unknown @empty <@U111> <@U222>");
    expect(result.unknownHandles).toEqual(["unknown"]);
    expect(result.emptyGroupHandles).toEqual(["empty"]);
  });
});
