import { expect, it } from "vitest";

import {
  argString,
  formatToolErrorMessage,
  formatToolResult,
  isToolFailureOutput,
  isInterruptedToolOutput,
  isToolProgressActive,
  mergeToolArgs,
  parseMcpToolName,
  partialJsonStringField,
  shortPath,
  summarizeArgs,
} from "../../src/pages/conversation/components/agent-main/thread/assistant-ui/tools/shared/tool-args.js";

it("reads string args and shortens paths", () => {
  expect(argString({ path: "a/b/c.ts" }, "path")).toBe("a/b/c.ts");
  expect(argString({ path: 1 }, "path")).toBe("");
  expect(shortPath("apps/desktop/src/main.ts")).toBe("src/main.ts");
  expect(shortPath("note.md")).toBe("note.md");
});

it("parses streaming argsText for write/edit previews", () => {
  expect(partialJsonStringField('{"path":"a.py","content":"hel', "path")).toBe("a.py");
  expect(partialJsonStringField('{"path":"a.py","content":"hel', "content")).toBe("hel");
  expect(partialJsonStringField('{"content":"line\\nnext"', "content")).toBe("line\nnext");
  expect(mergeToolArgs({}, '{"path":"x.ts","content":"hi')).toMatchObject({
    path: "x.ts",
    content: "hi",
  });
  expect(mergeToolArgs({ path: "kept.ts" }, '{"path":"other.ts","content":"body"}')).toMatchObject({
    path: "kept.ts",
    content: "body",
  });
  expect(mergeToolArgs({}, '{"command":"node weather.mjs')).toMatchObject({
    command: "node weather.mjs",
  });
});

it("parses mcp tool names and summarizes args", () => {
  expect(parseMcpToolName("mcp__hospital__write")).toEqual({
    server: "hospital",
    tool: "write",
  });
  expect(parseMcpToolName("mcp__respiratory__get_record")).toEqual({
    server: "respiratory",
    tool: "get_record",
  });
  expect(parseMcpToolName("read")).toBeNull();
  expect(parseMcpToolName("mcp__only")).toBeNull();
  expect(summarizeArgs({ server: "hospital", uri: "a/b/note.md" }, ["server", "uri"])).toBe(
    "hospital · b/note.md",
  );
  expect(summarizeArgs({ cursor: "page-2" }, ["server", "uri", "cursor"])).toBe("page-2");
});

it("formats and truncates tool results", () => {
  expect(formatToolResult({ ok: true })).toContain('"ok"');
  expect(formatToolResult("x".repeat(10), 4)).toBe("xxxx\n…");
});

it("detects interrupted tool outputs after app exit", () => {
  expect(
    isInterruptedToolOutput(
      "Tool call interrupted: the app exited before the tool finished.",
    ),
  ).toBe(true);
  expect(
    isInterruptedToolOutput(
      "User dismissed the questions. Session was interrupted before answers were received.",
    ),
  ).toBe(true);
  expect(isInterruptedToolOutput({ error: "Tool call interrupted: …" })).toBe(true);
  expect(isInterruptedToolOutput("ok")).toBe(false);
});

it("formats tool failures as an Error line", () => {
  expect(
    formatToolErrorMessage(
      "File has not been read yet: /tmp/a.vue. Read it first before writing to it.",
    ),
  ).toBe(
    "Error: File has not been read yet: /tmp/a.vue. Read it first before writing to it.",
  );
  expect(formatToolErrorMessage("Error: job not found")).toBe("Error: job not found");
  expect(formatToolErrorMessage("  error: already failed  ")).toBe("error: already failed");
  expect(formatToolErrorMessage("")).toBe("Error");
  expect(formatToolErrorMessage("   ")).toBe("Error");
  expect(
    formatToolErrorMessage({
      error: "File has not been read yet: /tmp/a.vue. Read it first before writing to it.",
    }),
  ).toBe(
    "Error: File has not been read yet: /tmp/a.vue. Read it first before writing to it.",
  );
  expect(formatToolErrorMessage({ error: "Error: job not found" })).toBe("Error: job not found");
});

it("treats a tool result that is only an Error line as a failure", () => {
  expect(isToolFailureOutput("Error: task_id required")).toBe(true);
  expect(isToolFailureOutput("error: query required")).toBe(true);
  expect(isToolFailureOutput({ error: "委托失败" })).toBe(true);
  expect(isToolFailureOutput("Delegation completed")).toBe(false);
  expect(isToolFailureOutput("")).toBe(false);
  expect(isToolFailureOutput("path:12: Error: not a tool failure")).toBe(false);
});

it("marks running and pending incomplete tools as active", () => {
  expect(isToolProgressActive("running")).toBe(true);
  expect(isToolProgressActive("requires-action")).toBe(true);
  expect(isToolProgressActive("incomplete")).toBe(true);
  expect(isToolProgressActive("complete", { hasResult: false })).toBe(true);
  expect(isToolProgressActive("complete", { isPreliminary: true })).toBe(true);
  expect(isToolProgressActive("complete", { awaitingApproval: true })).toBe(true);
  expect(isToolProgressActive("incomplete", { cancelled: true })).toBe(false);
  expect(isToolProgressActive("incomplete", { error: true })).toBe(false);
  expect(
    isToolProgressActive("requires-action", { cancelled: true, hasResult: false }),
  ).toBe(false);
  expect(
    isToolProgressActive("complete", { awaitingApproval: true, cancelled: true }),
  ).toBe(false);
  expect(isToolProgressActive("complete")).toBe(false);
});
