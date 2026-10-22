import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import {
  ATTACHMENTS_DIR,
  materializePromptImages,
  parsePromptAttachments,
  removeStagedAttachment,
  sanitizeAttachmentFileName,
  stageAttachment,
} from "../src/session/workspace/attachments.js";

it("parses attachments from prompt body", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
  expect(
    parsePromptAttachments({
      attachments: [{ name: "a.png", media_type: "image/png", data_base64: png }],
    }),
  ).toEqual([{ name: "a.png", mediaType: "image/png", dataBase64: png }]);
});

it("stages files flat under cwd/ATTACHMENTS/<id>-<name>", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-attach-"));
  const note = Buffer.from("hello note", "utf8").toString("base64");
  const staged = stageAttachment(cwd, {
    name: "note.txt",
    mediaType: "text/plain",
    dataBase64: note,
  });

  expect(staged.path).toBe(`${ATTACHMENTS_DIR}/${staged.id}-note.txt`);
  expect(staged.ref).toBe(`@${staged.path}`);
  expect(fs.readFileSync(path.join(cwd, staged.path), "utf8")).toBe("hello note");
  // 直接落在 ATTACHMENTS/ 下，不建子文件夹
  expect(fs.readdirSync(path.join(cwd, ATTACHMENTS_DIR))).toEqual([`${staged.id}-note.txt`]);
});

it("replaces whitespace in file names so chip tokens stay contiguous", () => {
  expect(sanitizeAttachmentFileName("my report final.docx")).toBe("my_report_final.docx");
  expect(sanitizeAttachmentFileName("  a\tb　c.txt  ")).toBe("a_b_c.txt");
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-space-"));
  const staged = stageAttachment(cwd, {
    name: "季度 报告.md",
    mediaType: "text/markdown",
    dataBase64: Buffer.from("# hi", "utf8").toString("base64"),
  });
  expect(staged.name).toBe("季度_报告.md");
  expect(staged.path).toBe(`${ATTACHMENTS_DIR}/${staged.id}-季度_报告.md`);
  expect(staged.ref).not.toMatch(/\s/);
  expect(fs.existsSync(path.join(cwd, staged.path))).toBe(true);
});

it("materializePromptImages saves images without prompt suffix text", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-img-"));
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).toString("base64");
  const images = materializePromptImages(cwd, [
    { name: "shot.png", mediaType: "image/png", dataBase64: png },
    { name: "note.txt", mediaType: "text/plain", dataBase64: Buffer.from("x").toString("base64") },
  ]);
  expect(images).toEqual([{ type: "image", data: png, mimeType: "image/png" }]);
  const files = fs.readdirSync(path.join(cwd, ATTACHMENTS_DIR));
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/^[a-f0-9]{8}-shot\.png$/i);
});

it("removes staged attachment files", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-rm-"));
  const staged = stageAttachment(cwd, {
    name: "a.txt",
    mediaType: "text/plain",
    dataBase64: Buffer.from("x").toString("base64"),
  });
  removeStagedAttachment(cwd, staged.path);
  expect(fs.existsSync(path.join(cwd, staged.path))).toBe(false);
});

it("removes legacy nested attachment paths and empty dirs", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-rm-nested-"));
  const nestedDir = path.join(cwd, ATTACHMENTS_DIR, "oldid");
  fs.mkdirSync(nestedDir, { recursive: true });
  const nestedFile = path.join(nestedDir, "legacy.txt");
  fs.writeFileSync(nestedFile, "x");
  removeStagedAttachment(cwd, `${ATTACHMENTS_DIR}/oldid/legacy.txt`);
  expect(fs.existsSync(nestedFile)).toBe(false);
  expect(fs.existsSync(nestedDir)).toBe(false);
});

it("rejects path traversal in attachment names", () => {
  const png = Buffer.from("x").toString("base64");
  const parsed = parsePromptAttachments({
    attachments: [{ name: "../evil.png", media_type: "image/png", data_base64: png }],
  });
  expect(parsed[0]?.name).toBe("evil.png");
});
