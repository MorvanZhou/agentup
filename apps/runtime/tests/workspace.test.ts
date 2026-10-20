import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { startLocalServer } from "../src/local/server.js";
import {
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
    "ATTACHMENTS",
    "DELIVERABLES",
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
    expect(rootEntries).toContain("DELIVERABLES");
    expect(rootEntries).not.toContain("WORK");
    expect(rootEntries).not.toContain(".pi");
    const escaped = await get(local.url, "/agents/weather/workspace/file?user_id=patient-a&path=.pi/SYSTEM.md", "token");
    expect(escaped.status).toBe(400);
    const workHidden = await get(local.url, "/agents/weather/workspace?user_id=patient-a&path=WORK", "token");
    expect(workHidden.status).toBe(400);

    const created = await post(
      local.url,
      "/agents/weather/workspace",
      { user_id: "patient-a", path: "DELIVERABLES/draft.txt", kind: "file" },
      "token",
    );
    expect(created).toMatchObject({ status: 200, path: "DELIVERABLES/draft.txt" });
    const saved = await put(
      local.url,
      "/agents/weather/workspace/file",
      { user_id: "patient-a", path: "DELIVERABLES/draft.txt", text: "正文" },
      "token",
    );
    expect(saved).toMatchObject({ status: 200, size: Buffer.byteLength("正文") });
    expect(fs.readFileSync(path.join(cwd, "DELIVERABLES", "draft.txt"), "utf8")).toBe("正文");

    const absolute = await get(
      local.url,
      "/agents/weather/workspace/absolute?user_id=patient-a&path=DELIVERABLES/draft.txt",
      "token",
    );
    expect(absolute.status).toBe(200);
    expect(absolute.body.path).toBe(fs.realpathSync(path.join(cwd, "DELIVERABLES", "draft.txt")));

    const personal = await get(local.url, "/personal-assistant/workspace?user_id=patient-a", "token");
    expect(personal.status).toBe(200);
    const personalEntries = (personal.body.entries as Array<{ name: string }>).map((entry) => entry.name);
    expect(personalEntries).toEqual(["ATTACHMENTS", "DELIVERABLES"]);
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
