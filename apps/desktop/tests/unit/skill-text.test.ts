import { describe, expect, it } from "vitest";

import {
  displaySkillMessage,
  filterSkillsByQuery,
  insertSkillReference,
  partitionDisplayAttachments,
  segmentComposerText,
  segmentDisplayMessage,
  serializeComposerSegments,
  skillCommandText,
  slashQueryAtCursor,
  slashSkillQuery,
} from "../../src/pages/conversation/model/composer/skill-text";

describe("slashQueryAtCursor", () => {
  it("detects slash queries at arbitrary cursor positions", () => {
    expect(slashQueryAtCursor("hello /che", 10)).toEqual({
      query: "che",
      start: 6,
      end: 10,
    });
    expect(slashQueryAtCursor("/", 1)).toEqual({ query: "", start: 0, end: 1 });
    expect(slashQueryAtCursor("hello", 5)).toBeNull();
  });
});

describe("slashSkillQuery", () => {
  it("detects whole-text slash queries", () => {
    expect(slashSkillQuery("/")).toBe("");
    expect(slashSkillQuery("/check")).toBe("check");
    expect(slashSkillQuery("/skill:check")).toBe("check");
  });
});

describe("insertSkillReference", () => {
  it("inserts /name with trailing space by default", () => {
    expect(insertSkillReference("hello /che", 6, 10, "check-weather")).toEqual({
      text: "hello /check-weather ",
      cursor: 21,
    });
    expect(insertSkillReference("ab", 1, 1, "note-taker")).toEqual({
      text: "a /note-taker b",
      cursor: 14,
    });
    expect(insertSkillReference("", 0, 0, "check-weather")).toEqual({
      text: "/check-weather ",
      cursor: 15,
    });
  });
});

describe("segmentComposerText", () => {
  it("segments known skill tokens anywhere in text", () => {
    const known = new Set(["check-weather", "note-taker"]);
    expect(segmentComposerText("请用 /check-weather 查杭州", known)).toEqual([
      { type: "text", value: "请用 " },
      { type: "skill", name: "check-weather" },
      { type: "text", value: " 查杭州" },
    ]);
    expect(segmentComposerText("用 /skill:note-taker 吧", known)).toEqual([
      { type: "text", value: "用 " },
      { type: "skill", name: "note-taker" },
      { type: "text", value: " 吧" },
    ]);
  });

  it("does not treat CJK-glued tokens as skills (need space)", () => {
    const known = new Set(["check-weather"]);
    expect(segmentComposerText("/check-weather杭州", known)).toEqual([
      { type: "text", value: "/check-weather杭州" },
    ]);
  });
});

describe("segmentDisplayMessage", () => {
  it("renders inline chips when slash refs have space boundaries", () => {
    expect(segmentDisplayMessage("/check-weather 杭州")).toEqual([
      { type: "skill", name: "check-weather" },
      { type: "text", value: " 杭州" },
    ]);
  });

  it("keeps leading skill blocks as chips before body", () => {
    const text = `<skill name="check-world-clock" location="/tmp/SKILL.md">
# body
</skill>

东京`;
    expect(segmentDisplayMessage(text)).toEqual([
      { type: "skill", name: "check-world-clock" },
      { type: "text", value: " 东京" },
    ]);
  });
});

describe("partitionDisplayAttachments", () => {
  it("lifts file refs out of the body for history layout", () => {
    const parts = partitionDisplayAttachments(
      segmentDisplayMessage(
        "@ATTACHMENTS/a1b2c3d4-a.xlsx @ATTACHMENTS/b2c3d4e5-b.zip 这几个文件名的名字是什么",
      ),
    );
    // 旧扁平格式不再剥 id 前缀，name 原样显示
    expect(parts.files).toEqual([
      { path: "ATTACHMENTS/a1b2c3d4-a.xlsx", name: "a1b2c3d4-a.xlsx" },
      { path: "ATTACHMENTS/b2c3d4e5-b.zip", name: "b2c3d4e5-b.zip" },
    ]);
    expect(parts.body).toEqual([{ type: "text", value: "这几个文件名的名字是什么" }]);
  });
});

describe("serializeComposerSegments", () => {
  it("pads spaces around skill chips", () => {
    expect(
      serializeComposerSegments([
        { type: "skill", name: "check-weather" },
        { type: "text", value: "杭州" },
      ]),
    ).toBe("/check-weather 杭州");
    expect(serializeComposerSegments([{ type: "skill", name: "check-weather" }])).toBe(
      "/check-weather ",
    );
  });
});

describe("skillCommandText", () => {
  it("formats industry slash form with trailing space when no args", () => {
    expect(skillCommandText("check-world-clock")).toBe("/check-world-clock ");
    expect(skillCommandText("check-world-clock", "东京")).toBe("/check-world-clock 东京");
  });
});

describe("displaySkillMessage", () => {
  it("extracts leading skill blocks and body", () => {
    const text = `<skill name="check-world-clock" location="/tmp/SKILL.md">
References are relative to /tmp.

# body
</skill>

东京`;
    expect(displaySkillMessage(text)).toEqual({
      skills: ["check-world-clock"],
      body: "东京",
    });
  });

  it("extracts inline slash refs from unexpanded text", () => {
    expect(displaySkillMessage("请用 /check-weather 查杭州")).toEqual({
      skills: ["check-weather"],
      body: "请用 查杭州",
    });
  });

  it("does not extract slash refs glued to CJK without space", () => {
    expect(displaySkillMessage("/check-weather杭州")).toEqual({
      skills: [],
      body: "/check-weather杭州",
    });
  });
});

describe("filterSkillsByQuery", () => {
  const skills = [
    { name: "check-weather", description: "查天气" },
    { name: "note-taker", description: "整理笔记" },
  ];

  it("filters by name or description", () => {
    expect(filterSkillsByQuery(skills, "weather").map((s) => s.name)).toEqual(["check-weather"]);
    expect(filterSkillsByQuery(skills, "笔记").map((s) => s.name)).toEqual(["note-taker"]);
  });
});
