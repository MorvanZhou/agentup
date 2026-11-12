import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import * as providerTemplates from "../src/config/provider-templates.js";
import type { Visit } from "../src/package/sync.js";
import {
  clearSkillsProject,
  linkSkillDir,
  normalizeSkillsProjectRel,
  syncSkillsProject,
} from "../src/session/external/skills-project.js";

let root = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-skills-project-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function visit(cwd = path.join(root, "cwd")): Visit {
  return {
    kind: "recruited",
    userId: "u1",
    agentId: "a1",
    root: path.dirname(cwd),
    packageVersion: 1,
    packageDigest: "d",
    tools: [],
    modelCapabilities: [],
    projectTrust: "granted",
  };
}

function writeSkill(cwd: string, name: string, body = "do it"): string {
  const dir = path.join(cwd, ".pi", "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${body}\n---\n\nbody\n`);
  return dir;
}

it("normalizeSkillsProjectRel：拒绝对路径与 ..", () => {
  expect(normalizeSkillsProjectRel(".codebuddy/skills")).toBe(".codebuddy/skills");
  expect(normalizeSkillsProjectRel("/abs/skills")).toBeUndefined();
  expect(normalizeSkillsProjectRel("../skills")).toBeUndefined();
  expect(normalizeSkillsProjectRel("a/../b")).toBeUndefined();
});

it("codebuddy-sdk：把 .pi/skills 投影成 .codebuddy/skills 下的符号链接", () => {
  const cwd = path.join(root, "cwd");
  const handoff = writeSkill(cwd, "handoff", "交接");
  writeSkill(cwd, "grilling", "追问");

  const result = syncSkillsProject({
    cwd,
    templateId: "codebuddy-sdk",
    visit: visit(cwd),
  });

  expect(result.rel).toBe(".codebuddy/skills");
  expect(result.names.sort()).toEqual(["grilling", "handoff"]);
  const link = path.join(cwd, ".codebuddy", "skills", "handoff");
  expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  expect(fs.realpathSync(link)).toBe(fs.realpathSync(handoff));
  expect(fs.readFileSync(path.join(link, "SKILL.md"), "utf8")).toContain("交接");
  expect(fs.existsSync(path.join(cwd, ".pi", "skills-project.json"))).toBe(true);
});

it("切到 API 模板时拆掉旧厂商链", () => {
  const cwd = path.join(root, "cwd");
  writeSkill(cwd, "handoff");
  syncSkillsProject({ cwd, templateId: "codebuddy-sdk", visit: visit(cwd) });
  expect(fs.existsSync(path.join(cwd, ".codebuddy", "skills", "handoff"))).toBe(true);

  const cleared = syncSkillsProject({ cwd, templateId: "zai", visit: visit(cwd) });
  expect(cleared.rel).toBeUndefined();
  expect(fs.existsSync(path.join(cwd, ".codebuddy", "skills", "handoff"))).toBe(false);
  expect(fs.existsSync(path.join(cwd, ".pi", "skills-project.json"))).toBe(false);
});

it("切到另一家 SDK 投影路径时拆旧建新", () => {
  const cwd = path.join(root, "cwd");
  writeSkill(cwd, "handoff");

  vi.spyOn(providerTemplates, "agentSdkSkillsProjectRel").mockImplementation((templateId: string) => {
    if (templateId === "codebuddy-sdk") return ".codebuddy/skills";
    if (templateId === "future-sdk") return ".claude/skills";
    return undefined;
  });
  vi.spyOn(providerTemplates, "listAgentSdkSkillsProjectRels").mockReturnValue([
    ".codebuddy/skills",
    ".claude/skills",
  ]);

  syncSkillsProject({ cwd, templateId: "codebuddy-sdk", visit: visit(cwd) });
  expect(fs.lstatSync(path.join(cwd, ".codebuddy", "skills", "handoff")).isSymbolicLink()).toBe(true);

  const next = syncSkillsProject({ cwd, templateId: "future-sdk", visit: visit(cwd) });
  expect(next.rel).toBe(".claude/skills");
  expect(fs.existsSync(path.join(cwd, ".codebuddy", "skills", "handoff"))).toBe(false);
  expect(fs.lstatSync(path.join(cwd, ".claude", "skills", "handoff")).isSymbolicLink()).toBe(true);
});

it("clearSkillsProject 清掉管理链", () => {
  const cwd = path.join(root, "cwd");
  writeSkill(cwd, "handoff");
  syncSkillsProject({ cwd, templateId: "codebuddy-sdk", visit: visit(cwd) });
  clearSkillsProject(cwd);
  expect(fs.existsSync(path.join(cwd, ".codebuddy", "skills", "handoff"))).toBe(false);
  expect(fs.existsSync(path.join(cwd, ".pi", "skills-project.json"))).toBe(false);
});

it("不覆盖用户自建的同名实体目录", () => {
  const cwd = path.join(root, "cwd");
  writeSkill(cwd, "handoff");
  const userDir = path.join(cwd, ".codebuddy", "skills", "handoff");
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(userDir, "SKILL.md"), "user owned\n");

  const result = syncSkillsProject({ cwd, templateId: "codebuddy-sdk", visit: visit(cwd) });
  expect(result.names).not.toContain("handoff");
  expect(fs.lstatSync(userDir).isSymbolicLink()).toBe(false);
  expect(fs.readFileSync(path.join(userDir, "SKILL.md"), "utf8")).toContain("user owned");
});

it("模板表声明 codebuddy skillsProjectRel，供切 provider 扫残留", () => {
  expect(providerTemplates.agentSdkSkillsProjectRel("codebuddy-sdk")).toBe(".codebuddy/skills");
  expect(providerTemplates.listAgentSdkSkillsProjectRels()).toContain(".codebuddy/skills");
});

it("linkSkillDir：Windows 用 junction，避免未提权 symlink EPERM", () => {
  const symlinkSync = vi.spyOn(fs, "symlinkSync").mockImplementation(() => undefined);
  const target = path.join(root, "skill-src");
  const link = path.join(root, "skill-link");
  fs.mkdirSync(target, { recursive: true });

  const previous = process.platform;
  Object.defineProperty(process, "platform", { value: "win32" });
  try {
    linkSkillDir(target, link);
    expect(symlinkSync).toHaveBeenCalledWith(path.resolve(target), link, "junction");
  } finally {
    Object.defineProperty(process, "platform", { value: previous });
  }

  symlinkSync.mockClear();
  Object.defineProperty(process, "platform", { value: "darwin" });
  try {
    linkSkillDir(target, link);
    expect(symlinkSync).toHaveBeenCalledWith(path.resolve(target), link, "dir");
  } finally {
    Object.defineProperty(process, "platform", { value: previous });
  }
});
