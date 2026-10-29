import { describe, expect, it } from "vitest";

import {
  findMentionRefs,
  firstMentionedMemberId,
  insertMention,
  mentionQueryAtCursor,
} from "../../src/pages/conversation/model/composer/mention-text";
import {
  segmentComposerText,
  serializeComposerSegments,
} from "../../src/pages/conversation/model/composer/skill-text";

const members = [
  { id: "pm", name: "产品经理" },
  { id: "design", name: "设计师" },
];
const knownMentions = new Set(members.map((member) => member.name));

describe("composer group mentions", () => {
  it("finds an @ query at the cursor and inserts a complete mention", () => {
    expect(mentionQueryAtCursor("请 @设", 4)).toEqual({ query: "设", start: 2, end: 4 });
    expect(insertMention("请 @设 做稿", 2, 4, members[1]!)).toEqual({
      text: "请 @设计师 做稿",
      cursor: 6,
    });
  });

  it("does not treat a file ref at the caret as a member query", () => {
    // 发送会 trim 掉尾部空格，群图片/文件引用常停在文末；编辑时光标落在这里不应弹出成员选择器
    const text = "看这个 @ATTACHMENTS/a1b2c3d4-a.txt";
    expect(mentionQueryAtCursor(text, text.length, knownMentions)).toBeNull();
    const mid = text.indexOf("a1b2c3d4");
    expect(mentionQueryAtCursor(text, mid, knownMentions)).toBeNull();
    // 附件前面的真 @ 查询仍要弹出
    expect(mentionQueryAtCursor("请 @设 @ATTACHMENTS/a1b2c3d4-a.txt", 4, knownMentions)).toEqual({
      query: "设",
      start: 2,
      end: 4,
    });
  });

  it("does not treat a finished @member as an open query", () => {
    // 选完后光标常落在名字后、空格前；有 knownNames 时应关闭选择器
    expect(mentionQueryAtCursor("请 @设计师 做稿", 6, knownMentions)).toBeNull();
    expect(mentionQueryAtCursor("@设计师 ", 5, knownMentions)).toBeNull();
    expect(mentionQueryAtCursor("@设计师", 4, knownMentions)).toBeNull();
    // 仍在输入中的前缀要继续弹出
    expect(mentionQueryAtCursor("请 @设", 4, knownMentions)).toEqual({
      query: "设",
      start: 2,
      end: 4,
    });
  });

  it("pads spaces around mentions like skill chips", () => {
    expect(insertMention("ab", 1, 1, members[1]!)).toEqual({
      text: "a @设计师 b",
      cursor: 7,
    });
    expect(insertMention("", 0, 0, members[0]!)).toEqual({
      text: "@产品经理 ",
      cursor: 6,
    });
    expect(
      serializeComposerSegments([
        { type: "mention", name: "设计师" },
        { type: "text", value: "做稿" },
      ]),
    ).toBe("@设计师 做稿");
    expect(serializeComposerSegments([{ type: "mention", name: "产品经理" }])).toBe("@产品经理 ");
  });

  it("segments known mention tokens and skips attachments / unknown names", () => {
    expect(segmentComposerText("请 @设计师 做稿", undefined, knownMentions)).toEqual([
      { type: "text", value: "请 " },
      { type: "mention", name: "设计师" },
      { type: "text", value: " 做稿" },
    ]);
    expect(findMentionRefs("@设计师杭州", knownMentions)).toEqual([]);
  // 旧扁平格式不再剥 id 前缀，name 原样显示
  expect(segmentComposerText("@ATTACHMENTS/a1b2c3d4-a.txt", undefined, knownMentions)).toEqual([
    { type: "file", path: "ATTACHMENTS/a1b2c3d4-a.txt", name: "a1b2c3d4-a.txt" },
    ]);
    expect(segmentComposerText("@路人 你好", undefined, knownMentions)).toEqual([
      { type: "text", value: "@路人 你好" },
    ]);
  });

  it("uses the first mentioned member as the Skill and attachment owner", () => {
    expect(firstMentionedMemberId("@产品经理 先看，@设计师 再做", members)).toBe("pm");
    expect(firstMentionedMemberId("先看看", members)).toBe("");
  });
});
