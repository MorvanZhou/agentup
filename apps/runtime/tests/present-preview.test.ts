import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { resolveExecutionTools } from "../src/session/context/tool-policy.js";
import {
  isPresentPreviewToolName,
  parsePreviewEntryData,
  registerPresentPreviewRecipe,
  slugifyPreviewId,
} from "../src/session/tools/present-preview.js";
import {
  readWorkspaceConfig,
  upsertPreviewRecipe,
} from "../src/session/workspace/workspace-config.js";

it("present_preview is on parent modes only", () => {
  const shell = { shellTools: ["bash"], mcp: false };
  expect(resolveExecutionTools("single", shell)).toContain("present_preview");
  expect(resolveExecutionTools("group-holder", shell)).toContain("present_preview");
  expect(resolveExecutionTools("single-delegation", shell)).not.toContain("present_preview");
  expect(resolveExecutionTools("group-delegation", shell)).not.toContain("present_preview");
});

it("slugifyPreviewId and parsePreviewEntryData keep localhost recipes only", () => {
  expect(slugifyPreviewId("Vue Dev Server")).toBe("vue-dev-server");
  expect(
    parsePreviewEntryData({
      recipes: [
        {
          id: "web",
          title: "Dev",
          command: "npm run dev",
          cwd: ".",
          preview_url: "http://127.0.0.1:5173",
        },
        {
          id: "evil",
          title: "Remote",
          command: "x",
          cwd: ".",
          preview_url: "https://example.com",
        },
      ],
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
  expect(parsePreviewEntryData({ recipes: [] })).toBeUndefined();
});

it("upsertPreviewRecipe persists recipes present_preview would register", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-present-preview-"));
  upsertPreviewRecipe(root, {
    id: "web",
    title: "Dev",
    command: "npm run dev",
    cwd: ".",
    preview_url: "http://localhost:5173",
    linked_job_id: "job-1",
  });
  expect(readWorkspaceConfig(root)?.preview?.recipes?.[0]).toMatchObject({
    id: "web",
    linked_job_id: "job-1",
  });
});

it("registerPresentPreviewRecipe shared core accepts localhost and rejects remote", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-present-core-"));
  const ok = registerPresentPreviewRecipe(root, {
    title: "Dev",
    command: "npm run dev",
    preview_url: "http://127.0.0.1:5173",
  });
  expect(ok.ok).toBe(true);
  if (ok.ok) expect(ok.recipe.id).toBe("dev");
  const bad = registerPresentPreviewRecipe(root, {
    title: "Remote",
    command: "x",
    preview_url: "https://example.com",
  });
  expect(bad.ok).toBe(false);
});

it("isPresentPreviewToolName accepts Pi and MCP names", () => {
  expect(isPresentPreviewToolName("present_preview")).toBe(true);
  expect(isPresentPreviewToolName("mcp__agentup__present_preview")).toBe(true);
  expect(isPresentPreviewToolName("mcp__agentup__delegate_to_agent")).toBe(false);
});
