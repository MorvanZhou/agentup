import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

const { isUnderManagedWorkspace, resolveUserWorkspacePath } = createRequire(import.meta.url)(
  "../../electron/user-workspace-path.cjs",
) as {
  isUnderManagedWorkspace(dataRootReal: string, targetReal: string): boolean;
  resolveUserWorkspacePath(
    targetPath: string,
    dataRoot: string,
    deniedMessage: string,
  ): Promise<string>;
};

let root = "";

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "agentup-reveal-"));
  await fs.mkdir(path.join(root, "users", "u1", "agents", "a1", "cwd", "ARTIFACT"), {
    recursive: true,
  });
  await fs.mkdir(path.join(root, "users", "u1", "personal-assistant", "cwd"), { recursive: true });
  await fs.mkdir(path.join(root, "users", "u1", ".runtime", "groups", "g1", "workspace", "WORK"), {
    recursive: true,
  });
  await fs.mkdir(path.join(root, "users", "u1", ".runtime", "groups", "g1", "holders"), {
    recursive: true,
  });
  await fs.writeFile(path.join(root, "users", "u1", "agents", "a1", "cwd", "ARTIFACT", "note.txt"), "a");
  await fs.writeFile(path.join(root, "users", "u1", "personal-assistant", "cwd", "memo.txt"), "p");
  await fs.writeFile(
    path.join(root, "users", "u1", ".runtime", "groups", "g1", "workspace", "WORK", "draft.txt"),
    "g",
  );
  await fs.writeFile(path.join(root, "users", "u1", ".runtime", "groups", "g1", "holders", "state.json"), "{}");
  await fs.writeFile(path.join(root, "outside.txt"), "x");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it("放行 agent / personal cwd，与 runtime 单聊布局一致", async () => {
  const agentFile = path.join(root, "users", "u1", "agents", "a1", "cwd", "ARTIFACT", "note.txt");
  const personalFile = path.join(root, "users", "u1", "personal-assistant", "cwd", "memo.txt");
  await expect(resolveUserWorkspacePath(agentFile, root, "拒")).resolves.toBe(await fs.realpath(agentFile));
  await expect(resolveUserWorkspacePath(personalFile, root, "拒")).resolves.toBe(
    await fs.realpath(personalFile),
  );
});

it("放行群共享 workspace（.runtime/groups/.../workspace）", async () => {
  const groupFile = path.join(
    root,
    "users",
    "u1",
    ".runtime",
    "groups",
    "g1",
    "workspace",
    "WORK",
    "draft.txt",
  );
  await expect(resolveUserWorkspacePath(groupFile, root, "只能显示本机工作文件")).resolves.toBe(
    await fs.realpath(groupFile),
  );
});

it("拒绝群 holders 等非 workspace 运行态目录", async () => {
  const holder = path.join(root, "users", "u1", ".runtime", "groups", "g1", "holders", "state.json");
  await expect(resolveUserWorkspacePath(holder, root, "只能显示本机工作文件")).rejects.toThrow(
    "只能显示本机工作文件",
  );
});

it("拒绝业务根外路径与符号链接逃逸", async () => {
  const outside = path.join(root, "outside.txt");
  await expect(resolveUserWorkspacePath(outside, root, "拒")).rejects.toThrow("拒");

  const link = path.join(root, "users", "u1", "agents", "a1", "cwd", "escape");
  await fs.symlink(outside, link);
  await expect(resolveUserWorkspacePath(link, root, "拒")).rejects.toThrow("拒");
});

it("放行 instance.json 里已挂载的 project_roots", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "agentup-project-"));
  try {
    const file = path.join(project, "readme.md");
    await fs.writeFile(file, "hi");
    await fs.writeFile(
      path.join(root, "users", "u1", "agents", "a1", "instance.json"),
      JSON.stringify({ project_roots: [project] }),
    );
    await expect(resolveUserWorkspacePath(file, root, "拒")).resolves.toBe(await fs.realpath(file));
  } finally {
    await fs.rm(project, { recursive: true, force: true });
  }
});

it("isUnderManagedWorkspace 按工作区根判定，不把 cwd 前缀误判为合法", () => {
  const dataRoot = path.sep === "\\" ? "C:\\data" : "/data";
  const join = (...parts: string[]) => path.join(dataRoot, ...parts);
  expect(isUnderManagedWorkspace(dataRoot, join("users", "u", "agents", "a", "cwd", "f"))).toBe(true);
  expect(isUnderManagedWorkspace(dataRoot, join("users", "u", "agents", "a", "cwd-extra", "f"))).toBe(
    false,
  );
  expect(
    isUnderManagedWorkspace(
      dataRoot,
      join("users", "u", ".runtime", "groups", "g", "workspace", "ARTIFACT", "x"),
    ),
  ).toBe(true);
  expect(
    isUnderManagedWorkspace(dataRoot, join("users", "u", ".runtime", "groups", "g", "workspace-x", "f")),
  ).toBe(false);
});
