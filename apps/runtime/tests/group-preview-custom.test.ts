import { expect, it } from "vitest";

import { assistantPayloadFromMessage } from "../src/session/group/turns.js";

it("forwards agentUpPreview from assistant metadata.custom", () => {
  const preview = {
    recipes: [
      {
        id: "web",
        title: "Dev",
        command: "npm run dev",
        cwd: ".",
        preview_url: "http://127.0.0.1:5173",
      },
    ],
  };
  expect(
    assistantPayloadFromMessage({
      id: "m1",
      role: "assistant",
      parts: [{ type: "text", text: "ok", state: "done" }],
      metadata: { custom: { agentUpSummary: { textPartIndex: 0 }, agentUpPreview: preview } },
    } as never),
  ).toEqual({
    parts: [{ type: "text", text: "ok", state: "done" }],
    assistantCustom: {
      agentUpSummary: { textPartIndex: 0 },
      agentUpPreview: preview,
    },
  });
});

it("backfills agentUpPreview from present_preview tool parts when custom missing", () => {
  const payload = assistantPayloadFromMessage({
    id: "m2",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolCallId: "c1",
        toolName: "present_preview",
        state: "output-available",
        input: {
          title: "Game",
          command: "python3 -m http.server 8765",
          preview_url: "http://127.0.0.1:8765",
          linked_job_id: "job-1",
        },
        output: "Preview recipe registered (game): Game",
      },
      { type: "text", text: "ready", state: "done" },
    ],
    metadata: { custom: { agentUpSummary: { textPartIndex: 1 } } },
  } as never);
  expect(payload.assistantCustom?.agentUpPreview).toEqual({
    recipes: [
      {
        id: "game",
        title: "Game",
        command: "python3 -m http.server 8765",
        cwd: ".",
        preview_url: "http://127.0.0.1:8765",
        linked_job_id: "job-1",
      },
    ],
  });
});

it("backfills agentUpPreview from mcp__agentup__present_preview tool parts", () => {
  const payload = assistantPayloadFromMessage({
    id: "m3",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolCallId: "c2",
        toolName: "mcp__agentup__present_preview",
        state: "output-available",
        input: {
          title: "SDK Game",
          command: "npm run dev",
          preview_url: "http://127.0.0.1:5173",
        },
        output: "Preview recipe registered (sdk-game): SDK Game",
      },
      { type: "text", text: "ready", state: "done" },
    ],
    metadata: {},
  } as never);
  expect(payload.assistantCustom?.agentUpPreview).toEqual({
    recipes: [
      {
        id: "sdk-game",
        title: "SDK Game",
        command: "npm run dev",
        cwd: ".",
        preview_url: "http://127.0.0.1:5173",
      },
    ],
  });
});
