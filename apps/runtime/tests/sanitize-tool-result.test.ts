import { expect, it } from "vitest";

import {
  MAX_TOOL_RESULT_CONTEXT_CHARS,
  OMITTED_MEDIA_NOTE,
  sanitizeToolResultForContext,
  sanitizeToolResultText,
} from "../src/session/history/sanitize-tool-result.js";
import { transcriptToPrompt } from "../src/session/external/sdk/host/prompt.js";
import { appendExternalTurnToSession } from "../src/session/turn/external-turn.js";

const HUGE_PNG = `data:image/png;base64,${"A".repeat(8000)}`;

it("strips data:image base64 from tool result strings (ViewImage shape)", () => {
  const raw = JSON.stringify([{ type: "image_url", image_url: { url: HUGE_PNG } }]);
  const cleaned = sanitizeToolResultText(raw);
  expect(cleaned).toBe(OMITTED_MEDIA_NOTE);
  expect(cleaned).not.toContain("base64");
  expect(cleaned.length).toBeLessThan(200);
});

it("strips image_url / image blocks from content arrays", () => {
  const cleaned = sanitizeToolResultForContext([
    { type: "text", text: "截图如下" },
    { type: "image_url", image_url: { url: HUGE_PNG } },
    { type: "image", mimeType: "image/png", data: "AAAA" },
  ]);
  expect(cleaned).toEqual([
    { type: "text", text: "截图如下" },
    { type: "text", text: OMITTED_MEDIA_NOTE },
  ]);
});

it("truncates extreme plain-text tool dumps", () => {
  const raw = "x".repeat(MAX_TOOL_RESULT_CONTEXT_CHARS + 5000);
  const cleaned = sanitizeToolResultText(raw);
  expect(cleaned.length).toBeLessThan(raw.length);
  expect(cleaned).toContain("已截断");
});

it("writeBack does not persist ViewImage data URLs into toolResult", () => {
  const appended: unknown[] = [];
  appendExternalTurnToSession(
    { sessionManager: { appendMessage: (message) => appended.push(message) } },
    {
      text: "验收通过",
      toolDigest: [],
      trail: [
        {
          kind: "tool",
          id: "v1",
          name: "ViewImage",
          args: { image_path: "/tmp/shot.png" },
          result: JSON.stringify([{ type: "image_url", image_url: { url: HUGE_PNG } }]),
          done: true,
        },
        { kind: "text", text: "验收通过" },
      ],
    },
  );
  const toolResult = appended.find(
    (row) => row && typeof row === "object" && (row as { role?: string }).role === "toolResult",
  ) as { content?: unknown };
  const blob = JSON.stringify(toolResult?.content ?? "");
  expect(blob).not.toContain("data:image");
  expect(blob).not.toContain("AAAA");
  expect(blob).toContain("省略");
});

it("transcriptToPrompt strips already-poisoned ViewImage history", () => {
  const prompt = transcriptToPrompt([
    {
      role: "toolResult",
      toolCallId: "v1",
      toolName: "ViewImage",
      content: [{ type: "text", text: JSON.stringify([{ type: "image_url", image_url: { url: HUGE_PNG } }]) }],
      isError: false,
      timestamp: 1,
    } as never,
    {
      role: "user",
      content: "请合并成单文件 html",
      timestamp: 2,
    } as never,
  ]);
  expect(prompt).toContain("请合并成单文件 html");
  expect(prompt).not.toContain("data:image");
  expect(prompt).not.toContain("A".repeat(100));
  expect(prompt).toContain("省略");
});
