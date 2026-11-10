import { expect, it } from "vitest";

import {
  parseAgentUpPreview,
  previewRecipesFromParts,
  readAgentUpPreview,
} from "../../src/pages/conversation/model/message/message-preview";

it("parses agentUpPreview recipes from message metadata", () => {
  expect(parseAgentUpPreview({ recipes: [] })).toBeNull();
  expect(
    readAgentUpPreview({
      custom: {
        agentUpPreview: {
          recipes: [
            {
              id: "web",
              title: "Dev",
              command: "npm run dev",
              cwd: ".",
              preview_url: "http://127.0.0.1:5173",
            },
          ],
        },
      },
    }),
  ).toEqual({
    recipes: [
      {
        id: "web",
        title: "Dev",
        command: "npm run dev",
        cwd: ".",
        preview_url: "http://127.0.0.1:5173",
      },
    ],
  });
});

it("rebuilds recipes from present_preview tool parts when metadata missing", () => {
  expect(
    previewRecipesFromParts([
      {
        type: "dynamic-tool",
        toolName: "present_preview",
        state: "output-available",
        input: {
          title: "Incredibox-like 音乐混音游戏",
          command: "python3 -m http.server 8765",
          preview_url: "http://127.0.0.1:8765",
          linked_job_id: "job-1",
        },
        output:
          "Preview recipe registered (incredibox-like): Incredibox-like 音乐混音游戏\nurl: http://127.0.0.1:8765",
      },
    ]),
  ).toEqual({
    recipes: [
      {
        id: "incredibox-like",
        title: "Incredibox-like 音乐混音游戏",
        command: "python3 -m http.server 8765",
        cwd: ".",
        preview_url: "http://127.0.0.1:8765",
        linked_job_id: "job-1",
      },
    ],
  });
});

it("rebuilds recipes from mcp__agentup__present_preview tool parts", () => {
  expect(
    previewRecipesFromParts([
      {
        type: "dynamic-tool",
        toolName: "mcp__agentup__present_preview",
        state: "output-available",
        input: {
          title: "SDK Dev",
          command: "npm run dev",
          preview_url: "http://127.0.0.1:5173",
        },
        output: "Preview recipe registered (sdk-dev): SDK Dev",
      },
    ]),
  ).toEqual({
    recipes: [
      {
        id: "sdk-dev",
        title: "SDK Dev",
        command: "npm run dev",
        cwd: ".",
        preview_url: "http://127.0.0.1:5173",
      },
    ],
  });
});
