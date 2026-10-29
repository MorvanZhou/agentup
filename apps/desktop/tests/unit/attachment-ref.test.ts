import { expect, it } from "vitest";

import {
  attachmentFileName,
  attachmentFolderPath,
  attachmentPathsInText,
  findAttachmentRefs,
  insertAttachmentReference,
  isAttachmentFolderPath,
  middleEllipsisFileName,
} from "../../src/pages/conversation/model/composer/attachment-ref";
import { segmentComposerText, serializeComposerSegments } from "../../src/pages/conversation/model/composer/skill-text";

it("inserts @ATTACHMENTS ref at cursor with spacing", () => {
  const next = insertAttachmentReference("看 ", 2, 2, "ATTACHMENTS/a1b2c3d4-note.txt");
  expect(next.text).toBe("看 @ATTACHMENTS/a1b2c3d4-note.txt ");
  expect(next.cursor).toBe(next.text.length);
});

it("finds flat and legacy nested attachment refs", () => {
  const flat = findAttachmentRefs("见 @ATTACHMENTS/a1b2c3d4-y.png 与 /skill");
  expect(flat).toEqual([
    {
      start: 2,
      end: 2 + "@ATTACHMENTS/a1b2c3d4-y.png".length,
      path: "ATTACHMENTS/a1b2c3d4-y.png",
      name: "a1b2c3d4-y.png",
      folder: false,
    },
  ]);
  const nested = findAttachmentRefs("见 @ATTACHMENTS/x/y.png 与 /skill");
  expect(nested[0]).toMatchObject({ path: "ATTACHMENTS/x/y.png", name: "y.png", folder: false });
  expect([...attachmentPathsInText("a @ATTACHMENTS/i/f.txt b")]).toEqual(["ATTACHMENTS/i/f.txt"]);
});

it("finds folder attachment refs marked by trailing slash", () => {
  const hits = findAttachmentRefs("见 @ATTACHMENTS/docs_a1b2c3d4/ 谢谢");
  expect(hits).toHaveLength(1);
  expect(hits[0]).toMatchObject({
    path: "ATTACHMENTS/docs_a1b2c3d4/",
    name: "docs",
    folder: true,
  });
  expect(isAttachmentFolderPath("ATTACHMENTS/docs_a1b2c3d4/")).toBe(true);
  expect(attachmentFolderPath("ATTACHMENTS/docs_a1b2c3d4")).toBe("ATTACHMENTS/docs_a1b2c3d4/");
  expect(attachmentFileName("ATTACHMENTS/docs_a1b2c3d4/")).toBe("docs");
});

it("shows legacy flat names as-is (id prefix is no longer stripped)", () => {
  // 旧扁平 `<id>-<name>` 不再剥前缀：只承诺新格式与旧嵌套
  expect(attachmentFileName("ATTACHMENTS/a1b2c3d4-my_report.docx")).toBe("a1b2c3d4-my_report.docx");
  expect(attachmentFileName("ATTACHMENTS/id/my_report.docx")).toBe("my_report.docx");
});

it("strips id suffix from new-format display names", () => {  // 新存名格式 `<stem>_<id>.<ext>`：剥 id、保扩展名
  expect(attachmentFileName("ATTACHMENTS/note_94319ddb.txt")).toBe("note.txt");
  expect(attachmentFileName("ATTACHMENTS/季度_报告_2a98c7de.md")).toBe("季度_报告.md");
  // 名字里本来就含日期段（8 位全 hex 数字）时，贪婪剥「最后一个」id 段，不误伤日期
  expect(attachmentFileName("ATTACHMENTS/报告_20261029_a1b2c3d4.docx")).toBe("报告_20261029.docx");
  // 无扩展名文件
  expect(attachmentFileName("ATTACHMENTS/Dockerfile_e1f2a3b4")).toBe("Dockerfile");
});

it("middle-ellipsizes long file names", () => {
  expect(middleEllipsisFileName("short.txt")).toBe("short.txt");
  expect(middleEllipsisFileName("very_long_quarterly_report_final.docx", 28)).toBe(
    "very_long_qua…ort_final.docx",
  );
});

it("parses sanitized names that replaced spaces with underscores", () => {
  const token = "@ATTACHMENTS/a1b2c3d4-my_report_final.docx";
  const hits = findAttachmentRefs(`请读 ${token} 谢谢`);
  expect(hits).toHaveLength(1);
  expect(hits[0]?.path).toBe("ATTACHMENTS/a1b2c3d4-my_report_final.docx");
  // 旧扁平格式不再剥 id 前缀
  expect(hits[0]?.name).toBe("a1b2c3d4-my_report_final.docx");
});

it("segments and serializes file chips with skills", () => {
  const text = "用 /note-taker 读 @ATTACHMENTS/a1b2c3d4-a.txt ";
  const segments = segmentComposerText(text, new Set(["note-taker"]));
  expect(segments).toEqual([
    { type: "text", value: "用 " },
    { type: "skill", name: "note-taker" },
    { type: "text", value: " 读 " },
    { type: "file", path: "ATTACHMENTS/a1b2c3d4-a.txt", name: "a1b2c3d4-a.txt" },
    { type: "text", value: " " },
  ]);
  expect(serializeComposerSegments(segments).trim()).toBe("用 /note-taker 读 @ATTACHMENTS/a1b2c3d4-a.txt");
});
