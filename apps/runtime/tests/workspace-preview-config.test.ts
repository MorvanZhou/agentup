import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  readWorkspaceConfig,
  removePreviewRecipe,
  setRecipeHeaderPinned,
  upsertPreviewRecipe,
} from "../src/session/workspace/workspace-config.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-preview-cfg-"));
  dirs.push(dir);
  return dir;
}

it("upsert + header_pinned + removePreviewRecipe", () => {
  const root = tmpRoot();
  upsertPreviewRecipe(root, {
    id: "web",
    title: "Dev",
    command: "npm run dev",
    cwd: ".",
    preview_url: "http://127.0.0.1:5173",
  });
  setRecipeHeaderPinned(root, "web", true);
  expect(readWorkspaceConfig(root)?.preview?.recipes?.[0]?.header_pinned).toBe(true);
  upsertPreviewRecipe(root, {
    id: "web",
    title: "Dev",
    command: "npm run dev",
    cwd: ".",
    preview_url: "http://127.0.0.1:5173",
    header_pinned: true,
    linked_pid: 4321,
  });
  expect(readWorkspaceConfig(root)?.preview?.recipes?.[0]?.linked_pid).toBe(4321);

  const { removed } = removePreviewRecipe(root, "web");
  expect(removed?.id).toBe("web");
  expect(readWorkspaceConfig(root)?.preview?.recipes ?? []).toEqual([]);
});
