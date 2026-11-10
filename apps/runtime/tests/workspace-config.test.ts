import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { GroupStore } from "../src/session/group/index.js";
import { clearGroupWorkspace } from "../src/session/group/workspace.js";
import {
  AGENTUP_DIR,
  WORKSPACE_CONFIG_FILE,
  WORKSPACE_CONFIG_RELATIVE,
  hasPreviewRecipes,
  parseWorkspaceConfig,
  readWorkspaceConfig,
  upsertPreviewRecipe,
  workspaceConfigPath,
  type PreviewRecipe,
} from "../src/session/workspace/workspace-config.js";
import { HIDDEN_WORKSPACE_TOP_LEVEL } from "../src/session/workspace/cwd-layout.js";

it("parses valid preview recipes and rejects garbage", () => {
  expect(parseWorkspaceConfig(null)).toEqual({ version: 1 });
  expect(
    parseWorkspaceConfig({
      version: 1,
      preview: {
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
    })?.preview?.recipes,
  ).toEqual([
    {
      id: "web",
      title: "Dev",
      command: "npm run dev",
      cwd: ".",
      preview_url: "http://127.0.0.1:5173",
    },
  ]);
  expect(parseWorkspaceConfig({ version: 1, preview: { recipes: [{ id: "x" }] } })?.preview?.recipes).toEqual([]);
  expect(hasPreviewRecipes({ version: 1, preview: { recipes: [] } })).toBe(false);
});

it("writes and reads .agentup/workspace.json under a workspace root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-ws-cfg-"));
  expect(workspaceConfigPath(root)).toBe(path.join(root, AGENTUP_DIR, WORKSPACE_CONFIG_FILE));
  expect(WORKSPACE_CONFIG_RELATIVE).toBe(".agentup/workspace.json");
  expect(readWorkspaceConfig(root)).toBeNull();

  const recipe: PreviewRecipe = {
    id: "web-dev",
    title: "Vue Dev",
    command: "npm run dev",
    cwd: ".",
    preview_url: "http://127.0.0.1:5173",
  };
  const written = upsertPreviewRecipe(root, recipe);
  expect(written.preview?.recipes).toEqual([recipe]);
  expect(fs.existsSync(path.join(root, WORKSPACE_CONFIG_RELATIVE))).toBe(true);
  expect(readWorkspaceConfig(root)?.preview?.recipes?.[0]?.id).toBe("web-dev");
  expect(hasPreviewRecipes(readWorkspaceConfig(root))).toBe(true);

  upsertPreviewRecipe(root, { ...recipe, title: "Vue Dev 2", linked_job_id: "job-1" });
  expect(readWorkspaceConfig(root)?.preview?.recipes).toEqual([
    { ...recipe, title: "Vue Dev 2", linked_job_id: "job-1" },
  ]);
});

it("hides .agentup from workspace root listings", () => {
  expect(HIDDEN_WORKSPACE_TOP_LEVEL.has(AGENTUP_DIR)).toBe(true);
});

it("clears .agentup workspace config when clearing a group workspace", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-ws-cfg-"));
  const store = new GroupStore(root);
  const room = store.create({
    userId: "u1",
    title: "开发小队",
    members: [
      { agentId: "pm", name: "产品经理" },
      { agentId: "dev", name: "开发" },
    ],
  });
  const workspace = path.join(root, "users", "u1", ".runtime", "groups", room.id, "workspace");
  fs.mkdirSync(path.join(workspace, "ARTIFACT"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "WORK"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "ATTACHMENTS"), { recursive: true });
  upsertPreviewRecipe(workspace, {
    id: "web",
    title: "Dev",
    command: "npm run dev",
    cwd: ".",
    preview_url: "http://127.0.0.1:5173",
  });
  expect(fs.existsSync(path.join(workspace, WORKSPACE_CONFIG_RELATIVE))).toBe(true);

  clearGroupWorkspace(root, "u1", room.id, false);

  expect(fs.existsSync(path.join(workspace, AGENTUP_DIR))).toBe(false);
  expect(fs.existsSync(path.join(workspace, "ATTACHMENTS"))).toBe(true);
});
