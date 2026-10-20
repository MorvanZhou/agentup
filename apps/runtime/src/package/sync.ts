import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ensureCwdLayout } from "../session/cwd-layout.js";
import { packageDigest, sameDigest, type PackageManifest } from "./digest.js";
import { validateAgentPackage } from "./validate.js";

export interface PackageRelease {
  agentId: string;
  name: string;
  summary: string;
  manifest: PackageManifest;
  files: Record<string, Uint8Array>;
  digest: string;
}

export interface PackageSource {
  isRecruited(userId: string, agentId: string): Promise<boolean>;
  getPackage(agentId: string): Promise<PackageRelease>;
}

export interface Visit {
  kind?: "recruited" | "personal";
  userId: string;
  agentId: string;
  root: string;
  packageVersion: number;
  packageDigest: string;
  tools: string[];
  modelCapabilities: string[];
  projectTrust: string;
}

export class NotRecruited extends Error {}

export class PackageMismatch extends Error {}

export class Runtime {
  constructor(
    private readonly source: PackageSource,
    private readonly userDataRoot: string,
  ) {}

  async sync(userId: string, agentId: string): Promise<Visit> {
    if (!(await this.source.isRecruited(userId, agentId))) {
      throw new NotRecruited(agentId);
    }
    return this.apply(userId, await this.source.getPackage(agentId));
  }

  async apply(userId: string, release: PackageRelease): Promise<Visit> {
    requireDigest(release);
    validateRelativeFiles(release.files);
    const issues = validateAgentPackage(release.files);
    if (issues.length > 0) {
      throw new PackageMismatch(`运行包校验失败: ${issues[0].path}: ${issues[0].message}`);
    }
    validateSegment(userId);
    validateSegment(release.agentId);
    const visitRoot = path.join(this.userDataRoot, "users", userId, "agents", release.agentId);
    const sessions = path.join(visitRoot, "sessions");
    const cwd = path.join(visitRoot, "cwd");
    const pi = path.join(cwd, ".pi");
    if (projectionIsCurrent(visitRoot, userId, release) && sameTree(readTree(pi), release.files)) {
      return visitFromInstance(visitRoot);
    }
    fs.mkdirSync(sessions, { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });
    ensureCwdLayout(cwd);
    replacePi(cwd, release);
    writeInstance(visitRoot, userId, release);
    return visitFromInstance(visitRoot);
  }
}

function requireDigest(release: PackageRelease): void {
  const actual = packageDigest(release.manifest, release.files);
  if (!sameDigest(actual, release.digest)) {
    throw new PackageMismatch("摘要不一致");
  }
}

function replacePi(cwd: string, release: PackageRelease): void {
  const staging = path.join(cwd, `.pi.staging-${randomUUID()}`);
  const backup = path.join(cwd, `.pi.backup-${randomUUID()}`);
  const target = path.join(cwd, ".pi");
  try {
    writeTree(staging, release.files);
    const actual = packageDigest(release.manifest, readTree(staging));
    if (!sameDigest(actual, release.digest)) {
      throw new PackageMismatch("落盘后的摘要不一致");
    }
    let moved = false;
    if (fs.existsSync(target)) {
      fs.renameSync(target, backup);
      moved = true;
    }
    try {
      fs.renameSync(staging, target);
    } catch (error) {
      if (moved && fs.existsSync(backup) && !fs.existsSync(target)) {
        fs.renameSync(backup, target);
      }
      throw error;
    }
    if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
  } finally {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  }
}

function writeInstance(visitRoot: string, userId: string, release: PackageRelease): void {
  const previous = readInstance(path.join(visitRoot, "instance.json"));
  let activeSessionId = "main";
  const current = previous?.active_session_id;
  if (
    typeof current === "string" &&
    current &&
    current !== "." &&
    current !== ".." &&
    !current.includes("/") &&
    !current.includes("\\") &&
    !current.includes("..")
  ) {
    activeSessionId = current;
  }
  const payload = {
    user_id: userId,
    agent_id: release.agentId,
    package_version: release.manifest.version,
    package_digest: release.digest,
    active_session_id: activeSessionId,
    tools: release.manifest.tools,
    model_capabilities: release.manifest.modelCapabilities,
    project_trust: "granted",
  };
  const temporary = path.join(visitRoot, `.instance-${randomUUID()}.json`);
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(temporary, path.join(visitRoot, "instance.json"));
}

function projectionIsCurrent(visitRoot: string, userId: string, release: PackageRelease): boolean {
  const data = readInstance(path.join(visitRoot, "instance.json"));
  if (!data) return false;
  return (
    data.user_id === userId &&
    data.agent_id === release.agentId &&
    data.package_version === release.manifest.version &&
    data.package_digest === release.digest &&
    data.project_trust === "granted"
  );
}

function visitFromInstance(visitRoot: string): Visit {
  const data = readInstance(path.join(visitRoot, "instance.json"));
  if (!data) throw new PackageMismatch("instance.json 无法读取");
  return {
    kind: "recruited",
    userId: String(data.user_id),
    agentId: String(data.agent_id),
    root: visitRoot,
    packageVersion: numberValue(data.package_version),
    packageDigest: String(data.package_digest),
    tools: stringList(data.tools),
    modelCapabilities: stringList(data.model_capabilities),
    projectTrust: String(data.project_trust),
  };
}

function readInstance(filePath: string): Record<string, unknown> | undefined {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
    return data as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function writeTree(root: string, files: Record<string, Uint8Array>): void {
  fs.mkdirSync(root);
  for (const [relative, content] of Object.entries(files)) {
    const target = safeTarget(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function readTree(root: string): Record<string, Uint8Array> {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return {};
  const files: Record<string, Uint8Array> = {};
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        files[path.relative(root, full).split(path.sep).join("/")] = fs.readFileSync(full);
      }
    }
  };
  walk(root);
  return files;
}

function sameTree(actual: Record<string, Uint8Array>, expected: Record<string, Uint8Array>): boolean {
  const actualNames = Object.keys(actual).sort();
  const expectedNames = Object.keys(expected).sort();
  if (actualNames.join("\0") !== expectedNames.join("\0")) return false;
  return actualNames.every((name) => Buffer.from(actual[name]).equals(Buffer.from(expected[name])));
}

function safeTarget(root: string, relative: string): string {
  const target = path.resolve(root, relative);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (target !== root && !target.startsWith(prefix)) {
    throw new PackageMismatch(`非法路径: ${relative}`);
  }
  return target;
}

function validateRelativeFiles(files: Record<string, Uint8Array>): void {
  for (const filePath of Object.keys(files)) {
    const parts = filePath.split(/[\\/]/);
    if (
      !filePath ||
      filePath.endsWith("/") ||
      filePath.includes("\\") ||
      filePath.startsWith("/") ||
      parts.includes("..") ||
      parts.includes(".")
    ) {
      throw new PackageMismatch(`非法路径: ${filePath}`);
    }
  }
}

function validateSegment(value: string): void {
  if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\")) {
    throw new PackageMismatch("身份无效");
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new PackageMismatch("instance.json 无法读取");
  }
  return value;
}

function numberValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new PackageMismatch("instance.json 版本无效");
  }
  return value;
}
