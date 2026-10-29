import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import {
  ATTACHMENTS_DIR,
  AttachmentError,
  attachmentRefsInText,
  formatAttachmentLocations,
  materializePromptImages,
  parsePromptAttachments,
  removeStagedAttachment,
  sanitizeAttachmentFileName,
  stageAttachment,
  stageAttachmentFromPath,
} from "../src/session/workspace/attachments.js";
import { isBlockedPath } from "../src/session/workspace/project-roots.js";

it("parses attachments from prompt body", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
  expect(
    parsePromptAttachments({
      attachments: [{ name: "a.png", media_type: "image/png", data_base64: png }],
    }),
  ).toEqual([{ name: "a.png", mediaType: "image/png", dataBase64: png }]);
});

it("stages files flat under cwd/ATTACHMENTS/<stem>_<id>.<ext>", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-attach-"));
  const note = Buffer.from("hello note", "utf8").toString("base64");
  const staged = stageAttachment(cwd, {
    name: "note.txt",
    mediaType: "text/plain",
    dataBase64: note,
  });

  expect(staged.path).toBe(`${ATTACHMENTS_DIR}/note_${staged.id}.txt`);
  expect(staged.ref).toBe(`@${staged.path}`);
  expect(fs.readFileSync(path.join(cwd, staged.path), "utf8")).toBe("hello note");
  // 直接落在 ATTACHMENTS/ 下，不建子文件夹
  expect(fs.readdirSync(path.join(cwd, ATTACHMENTS_DIR))).toEqual([`note_${staged.id}.txt`]);
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
  expect(staged.path).toBe(`${ATTACHMENTS_DIR}/季度_报告_${staged.id}.md`);
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
  expect(files[0]).toMatch(/^shot_[a-f0-9]{8}\.png$/i);
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

it("stages by copying from a local disk path without base64", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-path-"));
  const source = path.join(cwd, "..", "src-big.bin"); // 随意放 cwd 外，验证跨目录复制
  fs.writeFileSync(source, Buffer.from("big content"));
  const staged = stageAttachmentFromPath(cwd, {
    path: source,
    name: "my report.bin",
    mediaType: "application/octet-stream",
  });

  // 名字净化规则与 base64 staging 一致；内容为复制而非转码
  expect(staged.name).toBe("my_report.bin");
  expect(staged.path).toBe(`${ATTACHMENTS_DIR}/my_report_${staged.id}.bin`);
  expect(staged.mediaType).toBe("application/octet-stream");
  expect(fs.readFileSync(path.join(cwd, staged.path), "utf8")).toBe("big content");
  expect(fs.existsSync(source)).toBe(true);
});

it("falls back to the source file name when name is omitted", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-path-name-"));
  const source = path.join(cwd, "原始 文档.pdf");
  fs.writeFileSync(source, "x");
  const staged = stageAttachmentFromPath(cwd, { path: source });
  expect(staged.name).toBe("原始_文档.pdf");
  expect(staged.mediaType).toBe("application/octet-stream");
});

it("rejects missing sources with a 400 AttachmentError", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-path-miss-"));
  expect(() => stageAttachmentFromPath(cwd, { path: path.join(cwd, "nope.txt") })).toThrow(
    AttachmentError,
  );
});

it("stages directory sources as ATTACHMENTS/<name>_<id>/ with trailing slash", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-path-dir-"));
  const dir = path.join(cwd, "my docs");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "a.txt"), "hello");
  fs.mkdirSync(path.join(dir, "nested"));
  fs.writeFileSync(path.join(dir, "nested", "b.txt"), "world");
  const staged = stageAttachmentFromPath(cwd, { path: dir, name: "my docs" });

  expect(staged.name).toBe("my_docs");
  expect(staged.path).toBe(`${ATTACHMENTS_DIR}/my_docs_${staged.id}/`);
  expect(staged.ref).toBe(`@${staged.path}`);
  expect(staged.mediaType).toBe("inode/directory");
  const copied = path.join(cwd, staged.path.replace(/\/+$/, ""));
  expect(fs.statSync(copied).isDirectory()).toBe(true);
  expect(fs.readFileSync(path.join(copied, "a.txt"), "utf8")).toBe("hello");
  expect(fs.readFileSync(path.join(copied, "nested", "b.txt"), "utf8")).toBe("world");

  removeStagedAttachment(cwd, staged.path);
  expect(fs.existsSync(copied)).toBe(false);
});

it("rejects directory trees that contain symlinks", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-path-dir-link-"));
  const dir = path.join(cwd, "folder");
  fs.mkdirSync(dir);
  const real = path.join(dir, "real.txt");
  fs.writeFileSync(real, "x");
  fs.symlinkSync(real, path.join(dir, "link.txt"));
  expect(() => stageAttachmentFromPath(cwd, { path: dir })).toThrow(AttachmentError);
});

it("allows empty directory staging", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-path-dir-empty-"));
  const dir = path.join(cwd, "empty");
  fs.mkdirSync(dir);
  const staged = stageAttachmentFromPath(cwd, { path: dir });
  expect(staged.path.endsWith("/")).toBe(true);
  expect(fs.readdirSync(path.join(cwd, staged.path.replace(/\/+$/, "")))).toEqual([]);
});

it("rejects symlink sources", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-path-link-"));
  const real = path.join(cwd, "real.txt");
  fs.writeFileSync(real, "x");
  const link = path.join(cwd, "link.txt");
  fs.symlinkSync(real, link);
  expect(() => stageAttachmentFromPath(cwd, { path: link })).toThrow(AttachmentError);
});

it("rejects sources over the byte limit", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-path-size-"));
  const source = path.join(cwd, "big.bin");
  fs.writeFileSync(source, "abcdef");
  // 注入小上限：避免测试造出 512MB 真文件
  expect(() => stageAttachmentFromPath(cwd, { path: source }, { maxBytes: 5 })).toThrow(
    AttachmentError,
  );
  expect(stageAttachmentFromPath(cwd, { path: source }, { maxBytes: 6 }).path).toContain("big_");
});

it("rejects empty files", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-path-empty-"));
  const source = path.join(cwd, "empty.txt");
  fs.writeFileSync(source, "");
  expect(() => stageAttachmentFromPath(cwd, { path: source })).toThrow(AttachmentError);
});

it("refuses existing sources under sensitive roots such as /etc", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-path-blocked-"));
  const sshKey = path.join(os.homedir(), ".ssh", "id_rsa");
  // 用必然存在的 /etc/passwd：文件真实存在、常规、非空，仍必须被敏感根判定拒绝，
  // 而不是被「不存在→路径无效」的分支蒙混（否则摘掉敏感判定测试仍绿）。
  expect(() => stageAttachmentFromPath(cwd, { path: "/etc/passwd" })).toThrow(AttachmentError);
  expect(isBlockedPath(sshKey)).toBe(true);
  expect(isBlockedPath("/etc/passwd")).toBe(true);
  // 普通目录不受影响
  expect(isBlockedPath(path.join(cwd, "a.txt"))).toBe(false);
});

it("attachmentRefsInText finds deduped chips incl. directory and legacy forms", () => {
  const text =
    "看看 @ATTACHMENTS/from-Cody-6HhyiCvG_9275efdf/ 里面有什么，" +
    "再对比 @ATTACHMENTS/note_abcd1234.txt 和旧版 @ATTACHMENTS/abcd1234-old.txt ，" +
    "目录重复提一次 @ATTACHMENTS/from-Cody-6HhyiCvG_9275efdf/；@别的 不算。";
  expect(attachmentRefsInText(text)).toEqual([
    "ATTACHMENTS/from-Cody-6HhyiCvG_9275efdf/",
    "ATTACHMENTS/note_abcd1234.txt",
    "ATTACHMENTS/abcd1234-old.txt",
  ]);
  expect(attachmentRefsInText("没有芯片的普通句子")).toEqual([]);
  expect(attachmentRefsInText("")).toEqual([]);
});

it("formatAttachmentLocations maps existing chips to absolute paths without listing", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-loc-"));
  fs.mkdirSync(path.join(cwd, ATTACHMENTS_DIR), { recursive: true });
  fs.writeFileSync(path.join(cwd, `${ATTACHMENTS_DIR}/note_abcd1234.txt`), "hi");
  fs.mkdirSync(path.join(cwd, `${ATTACHMENTS_DIR}/from-Cody-6HhyiCvG_9275efdf`));

  const content = formatAttachmentLocations(cwd, [
    "ATTACHMENTS/from-Cody-6HhyiCvG_9275efdf/",
    "ATTACHMENTS/note_abcd1234.txt",
    "ATTACHMENTS/gone_00000000.txt",
  ]);

  const absDir = path.resolve(cwd, "ATTACHMENTS/from-Cody-6HhyiCvG_9275efdf");
  const absFile = path.resolve(cwd, "ATTACHMENTS/note_abcd1234.txt");
  expect(content).toContain("# Attachment paths");
  expect(content).toContain("`ATTACHMENTS/from-Cody-6HhyiCvG_9275efdf/` (directory)");
  expect(content).toContain(`→ ${absDir}`);
  expect(content).toContain(`\`ATTACHMENTS/note_abcd1234.txt\` → ${absFile}`);
  // 已删除的芯片不注；也不展开目录内容列表
  expect(content).not.toContain("gone_00000000");
  expect(fs.readdirSync(absDir)).toEqual([]);
  // 全部不存在 → 不注入
  expect(formatAttachmentLocations(cwd, ["ATTACHMENTS/gone_00000000.txt"])).toBe("");
});
