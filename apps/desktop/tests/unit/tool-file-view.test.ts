import { expect, it } from "vitest";

import {
  diffEditHunks,
  diffLines,
  filePathFromArgs,
  formatDiffBadge,
  formatReadRange,
  parseEditHunks,
  splitContentLines,
  summarizeDiff,
} from "../../src/pages/conversation/components/agent-main/thread/assistant-ui/tools/files/tool-file-view.js";
import {
  escapeHtml,
  highlightCodeHtml,
  languageFromPath,
} from "../../src/pages/conversation/model/render/highlight-code.js";

it("reads path and read ranges from args", () => {
  expect(filePathFromArgs({ path: "a/b.ts" })).toBe("a/b.ts");
  expect(filePathFromArgs({ file_path: "x.md" })).toBe("x.md");
  expect(formatReadRange({ offset: 10, limit: 5 })).toBe(":10-14");
  expect(formatReadRange({ offset: 3 })).toBe(":3");
  expect(formatReadRange({})).toBe("");
});

it("infers highlight language from path and highlights code", () => {
  expect(languageFromPath("src/app.ts")).toBe("typescript");
  expect(languageFromPath("main.py")).toBe("python");
  expect(languageFromPath("unknown.xyz")).toBeUndefined();
  expect(escapeHtml("<a>&")).toBe("&lt;a&gt;&amp;");
  const html = highlightCodeHtml("const x = 1;", "typescript");
  expect(html).toContain("hljs-");
  expect(highlightCodeHtml("<raw>", undefined)).toBe("&lt;raw&gt;");
});

it("parses edit hunks from edits[] or legacy fields", () => {
  expect(
    parseEditHunks({
      path: "a.ts",
      edits: [
        { oldText: "a", newText: "b" },
        { oldText: "c", newText: "d" },
      ],
    }),
  ).toEqual([
    { oldText: "a", newText: "b" },
    { oldText: "c", newText: "d" },
  ]);
  expect(parseEditHunks({ oldText: "x", newText: "y" })).toEqual([
    { oldText: "x", newText: "y" },
  ]);
  expect(parseEditHunks({ path: "a.ts" })).toEqual([]);
});

it("builds line diffs and badges", () => {
  expect(splitContentLines("a\nb\n")).toEqual(["a", "b"]);
  const lines = diffLines("hello\nworld", "hello\nthere");
  expect(lines).toEqual([
    { kind: "context", text: "hello" },
    { kind: "remove", text: "world" },
    { kind: "add", text: "there" },
  ]);
  expect(summarizeDiff(lines)).toEqual({ added: 1, removed: 1 });
  expect(formatDiffBadge(2, 1)).toBe("+2 −1");
  expect(formatDiffBadge(0, 0)).toBe("");

  const multi = diffEditHunks([
    { oldText: "a", newText: "b" },
    { oldText: "c", newText: "d" },
  ]);
  expect(multi.some((line) => line.text === "…")).toBe(true);
  expect(summarizeDiff(multi)).toEqual({ added: 2, removed: 2 });
});
