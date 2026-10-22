import { expect, it } from "vitest";

import {
  displayRollbackPath,
  filesAffectedByEditResend,
  wouldRollbackFilesOnEdit,
} from "../../src/pages/conversation/model/message/edit-resend-confirm.js";

it("detects write/edit tools after the edited user message", () => {
  const messages = [
    { id: "u1", role: "user", parts: [] },
    {
      id: "a1",
      role: "assistant",
      parts: [{ type: "tool-call", toolName: "write", args: { path: "a.ts", content: "a\nb\n" } }],
    },
    { id: "u2", role: "user", parts: [] },
    {
      id: "a2",
      role: "assistant",
      parts: [{ type: "tool-call", toolName: "read", args: { path: "a.ts" } }],
    },
  ];
  expect(wouldRollbackFilesOnEdit(messages, "u1")).toBe(true);
  expect(wouldRollbackFilesOnEdit(messages, "u2")).toBe(false);
  expect(wouldRollbackFilesOnEdit(messages, "missing")).toBe(false);
});

it("lists unique write/edit paths with line deltas after the edited user message", () => {
  const messages = [
    { id: "u1", role: "user", parts: [] },
    {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-call",
          toolName: "write",
          args: { path: "src/a.ts", content: "one\ntwo\nthree\n" },
        },
        {
          type: "tool-call",
          toolName: "edit",
          args: { path: "src/b.ts", oldText: "hello\n", newText: "hello\nworld\n" },
        },
        {
          type: "tool-call",
          toolName: "write",
          args: { path: "src/a.ts", content: "one\n" },
        },
        { type: "tool-call", toolName: "bash", args: { command: "rm x" } },
      ],
    },
    { id: "u2", role: "user", parts: [] },
    {
      id: "a2",
      role: "assistant",
      parts: [
        {
          type: "tool-call",
          toolName: "edit",
          args: { file_path: "src/c.ts", oldText: "x\ny\n", newText: "z\n" },
        },
      ],
    },
  ];
  expect(filesAffectedByEditResend(messages, "u1")).toEqual([
    { path: "src/a.ts", added: 4, removed: 0 },
    { path: "src/b.ts", added: 1, removed: 0 },
    { path: "src/c.ts", added: 1, removed: 2 },
  ]);
  expect(filesAffectedByEditResend(messages, "u2")).toEqual([
    { path: "src/c.ts", added: 1, removed: 2 },
  ]);
  expect(filesAffectedByEditResend(messages, "missing")).toEqual([]);
});

it("shortens long paths for dialog display", () => {
  expect(displayRollbackPath("src/a.ts")).toBe("src/a.ts");
  expect(displayRollbackPath("apps/desktop/src/a.ts")).toBe("src/a.ts");
  expect(displayRollbackPath("./note.txt")).toBe("note.txt");
});
