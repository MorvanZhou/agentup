import { expect, it } from "vitest";

import { stagedPathsToRemove } from "../../src/pages/conversation/model/composer-staged-files";

it("does not remove staged files when composer is cleared (send)", () => {
  const path = "ATTACHMENTS/a1b2c3d4-note.txt";
  expect(
    stagedPathsToRemove(`请看 @${path} `, "", new Set([path])),
  ).toEqual([]);
});

it("removes a staged file when its chip is edited out of non-empty text", () => {
  const path = "ATTACHMENTS/a1b2c3d4-note.txt";
  expect(
    stagedPathsToRemove(`请看 @${path} 谢谢`, "请看 谢谢", new Set([path])),
  ).toEqual([path]);
});

it("keeps files that remain in the text", () => {
  const keep = "ATTACHMENTS/a1b2c3d4-a.txt";
  const drop = "ATTACHMENTS/b2c3d4e5-b.txt";
  expect(
    stagedPathsToRemove(
      `@${keep} @${drop} hi`,
      `@${keep} hi`,
      new Set([keep, drop]),
    ),
  ).toEqual([drop]);
});
