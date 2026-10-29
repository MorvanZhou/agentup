import { expect, it } from "vitest";

import { isAttachmentsWorkspacePath } from "../../src/pages/conversation/model/composer/composer-attach";

it("recognizes ATTACHMENTS relative paths that can chip without re-staging", () => {
  expect(isAttachmentsWorkspacePath("ATTACHMENTS/note_94319ddb.txt")).toBe(true);
  expect(isAttachmentsWorkspacePath("@ATTACHMENTS/note_94319ddb.txt")).toBe(true);
  expect(isAttachmentsWorkspacePath("ATTACHMENTS/docs_94319ddb/")).toBe(true);
  expect(isAttachmentsWorkspacePath("ARTIFACT/report.md")).toBe(false);
  expect(isAttachmentsWorkspacePath("src/main.ts")).toBe(false);
  expect(isAttachmentsWorkspacePath("ATTACHMENTS")).toBe(false);
});
