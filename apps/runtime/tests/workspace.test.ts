import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { startLocalServer } from "../src/local/server.js";
import {
  IMAGE_PREVIEW_LIMIT,
  TEXT_PREVIEW_LIMIT,
  agentWorkspaceCwd,
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  listWorkspace,
  readWorkspaceFile,
  renameWorkspaceEntry,
  writeWorkspaceText,
} from "../src/local/workspace.js";

it("lists and edits cwd files while hiding .pi/WORK and refusing escapes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-workspace-"));
  const cwd = path.join(root, "users", "patient-a", "agents", "weather", "cwd");
  fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "WORK"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".pi", "SYSTEM.md"), "secret");
  fs.writeFileSync(path.join(cwd, "WORK", "draft.ts"), "temp");
  fs.writeFileSync(path.join(cwd, "note.txt"), "hello");
  fs.writeFileSync(path.join(cwd, ".keep"), "dot");
  fs.mkdirSync(path.join(cwd, "reports"));
  fs.symlinkSync(path.join(cwd, "reports"), path.join(cwd, "linked"));
  fs.symlinkSync(path.resolve("/etc"), path.join(cwd, "escape"));

  const listed = listWorkspace(agentWorkspaceCwd(root, "patient-a", "weather"), "");
  expect(listed.entries.map((entry) => entry.name)).toEqual([
    "ARTIFACT",
    "ATTACHMENTS",
    "linked",
    "reports",
    ".keep",
    "note.txt",
  ]);
  expect(listed.entries.find((entry) => entry.name === "note.txt")).toMatchObject({ kind: "file", size: 5 });
  expect(listed.entries.find((entry) => entry.name === "WORK")).toBeUndefined();

  expect(() => listWorkspace(cwd, ".pi")).toThrow(/路径无效/);
  expect(() => listWorkspace(cwd, "WORK")).toThrow(/路径无效/);
  expect(() => listWorkspace(cwd, "../sessions")).toThrow(/路径无效/);
  expect(() => readWorkspaceFile(cwd, "escape")).toThrow(/路径无效/);
  expect(() => writeWorkspaceText(cwd, "../outside.txt", "no")).toThrow(/路径无效/);
  expect(() => createWorkspaceEntry(cwd, ".pi", "dir")).toThrow(/路径无效/);
  expect(() => createWorkspaceEntry(cwd, "WORK", "dir")).toThrow(/路径无效/);

  expect(readWorkspaceFile(cwd, "note.txt")).toMatchObject({ kind: "text", text: "hello" });
  writeWorkspaceText(cwd, "note.txt", "updated");
  expect(readWorkspaceFile(cwd, "note.txt")).toMatchObject({ text: "updated" });

  createWorkspaceEntry(cwd, "reports/a.txt", "file");
  expect(listWorkspace(cwd, "reports").entries.map((entry) => entry.name)).toEqual(["a.txt"]);
  expect(listWorkspace(cwd, "linked").entries.map((entry) => entry.name)).toEqual(["a.txt"]);

  renameWorkspaceEntry(cwd, "note.txt", "renamed.txt");
  expect(fs.existsSync(path.join(cwd, "renamed.txt"))).toBe(true);
  deleteWorkspaceEntry(cwd, "reports");
  expect(fs.existsSync(path.join(cwd, "reports"))).toBe(false);
  expect(fs.readFileSync(path.join(cwd, ".pi", "SYSTEM.md"), "utf8")).toBe("secret");

  fs.writeFileSync(path.join(cwd, "big.txt"), Buffer.alloc(TEXT_PREVIEW_LIMIT + 1));
  expect(readWorkspaceFile(cwd, "big.txt")).toMatchObject({ kind: "too-large", media: "text" });
  expect(() => writeWorkspaceText(cwd, "renamed.txt", "x".repeat(TEXT_PREVIEW_LIMIT + 1))).toThrow(/文件过大/);

  fs.writeFileSync(path.join(cwd, "shot.png"), Buffer.from([1, 2, 3]));
  expect(readWorkspaceFile(cwd, "shot.png")).toMatchObject({ kind: "image", media_type: "image/png" });
  fs.writeFileSync(path.join(cwd, "blob.bin"), Buffer.from([0, 1, 2, 3]));
  expect(readWorkspaceFile(cwd, "blob.bin")).toMatchObject({ kind: "binary" });

  // 截图 / 封面常超过旧的 2MB：应用内能显示的图仍应是 image，而不是交给系统。
  fs.writeFileSync(path.join(cwd, "cover.png"), Buffer.alloc(3 * 1024 * 1024, 1));
  expect(readWorkspaceFile(cwd, "cover.png")).toMatchObject({ kind: "image", media_type: "image/png" });
  fs.writeFileSync(path.join(cwd, "huge.png"), Buffer.alloc(IMAGE_PREVIEW_LIMIT + 1, 1));
  expect(readWorkspaceFile(cwd, "huge.png")).toMatchObject({ kind: "too-large", media: "image" });

  // 面板已按这些扩展名做 HTML / Markdown 预览；大于嗅探窗口也不能当成二进制。
  const longText = "x".repeat(9000);
  fs.writeFileSync(path.join(cwd, "page.htm"), longText);
  fs.writeFileSync(path.join(cwd, "notes.mdx"), longText);
  fs.writeFileSync(path.join(cwd, "doc.markdown"), longText);
  expect(readWorkspaceFile(cwd, "page.htm")).toMatchObject({ kind: "text", text: longText });
  expect(readWorkspaceFile(cwd, "notes.mdx")).toMatchObject({ kind: "text", text: longText });
  expect(readWorkspaceFile(cwd, "doc.markdown")).toMatchObject({ kind: "text", text: longText });

  // xlsx 等办公文件应用内没有预览器，保持二进制，由桌面交给系统打开。
  fs.writeFileSync(path.join(cwd, "sheet.xlsx"), Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(16, 0)]));
  expect(readWorkspaceFile(cwd, "sheet.xlsx")).toMatchObject({ kind: "binary" });
});

it("serves workspace routes for a recruited cwd and the personal assistant", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-workspace-http-"));
  const cwd = path.join(root, "users", "patient-a", "agents", "weather", "cwd");
  fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".pi", "SYSTEM.md"), "secret");
  fs.writeFileSync(path.join(cwd, "note.txt"), "hello");
  const local = await startLocalServer({
    backendUrl: "http://127.0.0.1:9",
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    expect((await get(local.url, "/agents/weather/workspace?user_id=patient-a&path=", "")).status).toBe(401);
    const listed = await get(local.url, "/agents/weather/workspace?user_id=patient-a", "token");
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({ path: "" });
    const rootEntries = (listed.body.entries as Array<{ name: string }>).map((entry) => entry.name);
    expect(rootEntries).toContain("note.txt");
    expect(rootEntries).toContain("ATTACHMENTS");
    expect(rootEntries).toContain("ARTIFACT");
    expect(rootEntries).not.toContain("WORK");
    expect(rootEntries).not.toContain(".pi");
    const escaped = await get(local.url, "/agents/weather/workspace/file?user_id=patient-a&path=.pi/SYSTEM.md", "token");
    expect(escaped.status).toBe(400);
    const workHidden = await get(local.url, "/agents/weather/workspace?user_id=patient-a&path=WORK", "token");
    expect(workHidden.status).toBe(400);

    const created = await post(
      local.url,
      "/agents/weather/workspace",
      { user_id: "patient-a", path: "ARTIFACT/draft.txt", kind: "file" },
      "token",
    );
    expect(created).toMatchObject({ status: 200, path: "ARTIFACT/draft.txt" });
    const saved = await put(
      local.url,
      "/agents/weather/workspace/file",
      { user_id: "patient-a", path: "ARTIFACT/draft.txt", text: "正文" },
      "token",
    );
    expect(saved).toMatchObject({ status: 200, size: Buffer.byteLength("正文") });
    expect(fs.readFileSync(path.join(cwd, "ARTIFACT", "draft.txt"), "utf8")).toBe("正文");

    const absolute = await get(
      local.url,
      "/agents/weather/workspace/absolute?user_id=patient-a&path=ARTIFACT/draft.txt",
      "token",
    );
    expect(absolute.status).toBe(200);
    expect(absolute.body.path).toBe(fs.realpathSync(path.join(cwd, "ARTIFACT", "draft.txt")));

    const personal = await get(local.url, "/personal-assistant/workspace?user_id=patient-a", "token");
    expect(personal.status).toBe(200);
    const personalEntries = (personal.body.entries as Array<{ name: string }>).map((entry) => entry.name);
    expect(personalEntries).toEqual(["ARTIFACT", "ATTACHMENTS"]);
    const personalRoot = path.join(root, "users", "patient-a", "personal-assistant");
    expect(fs.existsSync(path.join(personalRoot, "cwd"))).toBe(true);
    expect(fs.existsSync(path.join(personalRoot, ".runtime"))).toBe(true);
    expect(fs.existsSync(path.join(personalRoot, "cwd", ".pi"))).toBe(false);
    expect(fs.existsSync(path.join(personalRoot, "cwd", "WORK"))).toBe(true);
  } finally {
    await local.close();
  }
});

async function get(base: string, pathName: string, token: string) {
  const response = await fetch(`${base}${pathName}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function post(base: string, pathName: string, body: Record<string, unknown>, token: string) {
  const response = await fetch(`${base}${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, ...(await response.json() as Promise<Record<string, unknown>>) };
}

async function put(base: string, pathName: string, body: Record<string, unknown>, token: string) {
  const response = await fetch(`${base}${pathName}`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, ...(await response.json() as Promise<Record<string, unknown>>) };
}
