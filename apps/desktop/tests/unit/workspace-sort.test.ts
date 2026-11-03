import { expect, it } from "vitest";

import type { WorkspaceEntry } from "../../src/shared/api/runtime/workspace";
import { sortWorkspaceEntries } from "../../src/pages/conversation/model/workspace/workspace-sort";
import { formatWorkspaceUpdatedAt } from "../../src/pages/conversation/model/workspace/workspace-time";
import {
  shouldLoadWorkspaceThumb,
  WORKSPACE_THUMB_MAX_BYTES,
} from "../../src/pages/conversation/model/workspace/workspace-thumb";

function entry(
  name: string,
  kind: "file" | "dir",
  times?: { mtimeMs?: number; birthtimeMs?: number },
): WorkspaceEntry {
  return { name, kind, size: kind === "file" ? 1 : 0, ...times };
}

it("按名称排序时目录置顶且同 kind 按名字", () => {
  const sorted = sortWorkspaceEntries(
    [entry("b.txt", "file"), entry("a", "dir"), entry("z", "dir"), entry("a.txt", "file")],
    "name",
  );
  expect(sorted.map((item) => item.name)).toEqual(["a", "z", "a.txt", "b.txt"]);
});

it("按更新时间降序，目录仍置顶", () => {
  const sorted = sortWorkspaceEntries(
    [
      entry("old.txt", "file", { mtimeMs: 10 }),
      entry("new.txt", "file", { mtimeMs: 30 }),
      entry("mid", "dir", { mtimeMs: 20 }),
      entry("fresh", "dir", { mtimeMs: 40 }),
    ],
    "updated",
  );
  expect(sorted.map((item) => item.name)).toEqual(["fresh", "mid", "new.txt", "old.txt"]);
});

it("按创建时间降序", () => {
  const sorted = sortWorkspaceEntries(
    [
      entry("later.txt", "file", { birthtimeMs: 5 }),
      entry("earlier.txt", "file", { birthtimeMs: 50 }),
    ],
    "created",
  );
  expect(sorted.map((item) => item.name)).toEqual(["earlier.txt", "later.txt"]);
});

it("格式化更新时间：相对与缺省", () => {
  const now = Date.parse("2026-11-02T12:00:00.000Z");
  // 相对文案走全局 i18n（测环境默认 zh）；locale 参数只影响短日期格式
  expect(formatWorkspaceUpdatedAt(now - 30_000, "zh", now)).toBe("刚刚");
  expect(formatWorkspaceUpdatedAt(now - 5 * 60_000, "zh", now)).toBe("5 分钟前");
  expect(formatWorkspaceUpdatedAt(now - 3 * 60 * 60_000, "zh", now)).toBe("3 小时前");
  expect(formatWorkspaceUpdatedAt(undefined, "zh", now)).toBe("");
});

it("图标缩略图只拉中等体积的图片文件", () => {
  expect(shouldLoadWorkspaceThumb(entry("shot.png", "file", { mtimeMs: 1 }))).toBe(true);
  expect(
    shouldLoadWorkspaceThumb({
      name: "shot.png",
      kind: "file",
      size: WORKSPACE_THUMB_MAX_BYTES + 1,
    }),
  ).toBe(false);
  expect(shouldLoadWorkspaceThumb(entry("note.txt", "file"))).toBe(false);
  expect(shouldLoadWorkspaceThumb(entry("shots", "dir"))).toBe(false);
});
