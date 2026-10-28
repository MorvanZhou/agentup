import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { GroupStore } from "../src/session/group/index.js";
import { clearGroupWorkspace } from "../src/session/group/workspace.js";

const members = [
  { agentId: "pm", name: "产品经理" },
  { agentId: "dev", name: "开发" },
];

function seed(root: string): { groupId: string; workspace: string } {
  const store = new GroupStore(root);
  const room = store.create({ userId: "u1", title: "开发小队", members });
  const workspace = path.join(root, "users", "u1", ".runtime", "groups", room.id, "workspace");
  fs.mkdirSync(path.join(workspace, "ARTIFACT"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "WORK"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "ATTACHMENTS"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "ARTIFACT", "done.txt"), "产物");
  fs.writeFileSync(path.join(workspace, "WORK", "draft.txt"), "过程");
  fs.writeFileSync(path.join(workspace, "ATTACHMENTS", "upload.txt"), "上传");
  return { groupId: room.id, workspace };
}

it("clears only artifacts unless asked to clear the work directory too", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-ws-"));
  const { groupId, workspace } = seed(root);

  clearGroupWorkspace(root, "u1", groupId, false);

  expect(fs.existsSync(path.join(workspace, "ARTIFACT", "done.txt"))).toBe(false);
  expect(fs.existsSync(path.join(workspace, "ARTIFACT"))).toBe(true);
  expect(fs.readFileSync(path.join(workspace, "WORK", "draft.txt"), "utf8")).toBe("过程");
  expect(fs.readFileSync(path.join(workspace, "ATTACHMENTS", "upload.txt"), "utf8")).toBe("上传");

  clearGroupWorkspace(root, "u1", groupId, true);

  expect(fs.existsSync(path.join(workspace, "WORK", "draft.txt"))).toBe(false);
  expect(fs.existsSync(path.join(workspace, "WORK"))).toBe(true);
  expect(fs.readFileSync(path.join(workspace, "ATTACHMENTS", "upload.txt"), "utf8")).toBe("上传");
  expect(fs.existsSync(path.join(root, "users", "u1", ".runtime", "groups", `${groupId}.json`))).toBe(true);
});

it("unlinks a swapped artifact directory instead of deleting the link target", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-ws-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-ws-outside-"));
  fs.writeFileSync(path.join(outside, "keep.txt"), "留着");
  const { groupId, workspace } = seed(root);
  fs.rmSync(path.join(workspace, "ARTIFACT"), { recursive: true });
  fs.symlinkSync(outside, path.join(workspace, "ARTIFACT"));

  clearGroupWorkspace(root, "u1", groupId, false);

  expect(fs.readFileSync(path.join(outside, "keep.txt"), "utf8")).toBe("留着");
  expect(fs.lstatSync(path.join(workspace, "ARTIFACT")).isSymbolicLink()).toBe(false);
  expect(fs.lstatSync(path.join(workspace, "ARTIFACT")).isDirectory()).toBe(true);
});

it("refuses a missing group or a group id that leaves the groups directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-group-ws-"));
  expect(() => clearGroupWorkspace(root, "u1", "missing1", false)).toThrow("群不存在");
  expect(() => clearGroupWorkspace(root, "u1", "..", true)).toThrow("群不存在");
  expect(fs.existsSync(path.join(root, "users", "u1", ".runtime", "groups"))).toBe(false);
});
