import { expect, it } from "vitest";

import {
  attachmentFileName,
  attachmentPathsInText,
  findAttachmentRefs,
  insertAttachmentReference,
  middleEllipsisFileName,
} from "../../src/pages/conversation/model/attachment-ref";
import { segmentComposerText, serializeComposerSegments } from "../../src/pages/conversation/model/skill-text";

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
      name: "y.png",
    },
  ]);
  const nested = findAttachmentRefs("见 @ATTACHMENTS/x/y.png 与 /skill");
  expect(nested[0]).toMatchObject({ path: "ATTACHMENTS/x/y.png", name: "y.png" });
  expect([...attachmentPathsInText("a @ATTACHMENTS/i/f.txt b")]).toEqual(["ATTACHMENTS/i/f.txt"]);
});

it("strips flat id prefix from display names", () => {
  expect(attachmentFileName("ATTACHMENTS/a1b2c3d4-my_report.docx")).toBe("my_report.docx");
  expect(attachmentFileName("ATTACHMENTS/id/my_report.docx")).toBe("my_report.docx");
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
  expect(hits[0]?.name).toBe("my_report_final.docx");
});

it("segments and serializes file chips with skills", () => {
  const text = "用 /note-taker 读 @ATTACHMENTS/a1b2c3d4-a.txt ";
  const segments = segmentComposerText(text, new Set(["note-taker"]));
  expect(segments).toEqual([
    { type: "text", value: "用 " },
    { type: "skill", name: "note-taker" },
    { type: "text", value: " 读 " },
    { type: "file", path: "ATTACHMENTS/a1b2c3d4-a.txt", name: "a.txt" },
    { type: "text", value: " " },
  ]);
  expect(serializeComposerSegments(segments).trim()).toBe("用 /note-taker 读 @ATTACHMENTS/a1b2c3d4-a.txt");
});
