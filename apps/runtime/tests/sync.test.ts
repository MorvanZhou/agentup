import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { packageDigest } from "../src/package/digest.js";
import { NotRecruited, PackageMismatch, Runtime, type PackageRelease, type PackageSource } from "../src/package/sync.js";

const digest = "84ec3d5f38615aa54f5eed75f242d3dbe0f6d993d3ec9c2430021606a2e523ff";

function files(text: string): Record<string, Uint8Array> {
  return {
    "SYSTEM.md": Buffer.from(text),
    "skills/intake/SKILL.md": Buffer.from(
      "---\nname: intake\ndescription: Collect intake details when a user starts a consultation.\n---\n\nCollect the intake.\n",
    ),
  };
}

function release(version: number, text: string, packageDigestValue = packageDigest(manifest(version), files(text))): PackageRelease {
  return {
    agentId: "tax-advisor",
    name: "税务顾问",
    background: text,
    manifest: manifest(version),
    files: files(text),
    digest: packageDigestValue,
  };
}

function manifest(version: number) {
  return { version, tools: ["read", "mcp"], modelCapabilities: ["tools"] };
}

function source(recruited: Set<string>, current: PackageRelease): PackageSource {
  return {
    async isRecruited(userId, agentId) {
      return recruited.has(`${userId}:${agentId}`);
    },
    async getPackage() {
      return current;
    },
  };
}

describe("runtime sync", () => {
  it("matches the backend package digest", () => {
    expect(packageDigest(manifest(1), files("第一版"))).toBe(digest);
  });

  it("installs one package projection for each recruited user", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-runtime-"));
    const published = release(1, "第一版");
    const runtime = new Runtime(
      source(new Set(["patient-a:tax-advisor", "patient-b:tax-advisor"]), published),
      root,
    );
    const visitA = await runtime.sync("patient-a", "tax-advisor");
    const visitB = await runtime.sync("patient-b", "tax-advisor");

    expect(visitA.root).not.toBe(visitB.root);
    expect(visitA.packageDigest).toBe(published.digest);
    expect(visitA.projectTrust).toBe("granted");
    expect(visitA.tools).toEqual(["read", "mcp"]);
    for (const visit of [visitA, visitB]) {
      expect(fs.readFileSync(path.join(visit.root, "cwd", ".pi", "SYSTEM.md"), "utf8")).toBe("第一版");
      expect(fs.statSync(path.join(visit.root, "sessions")).isDirectory()).toBe(true);
    }
  });

  it("replaces .pi on upgrade and keeps sessions and work files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-runtime-"));
    let current = release(1, "第一版");
    const runtime = new Runtime(
      {
        async isRecruited() {
          return true;
        },
        async getPackage() {
          return current;
        },
      },
      root,
    );
    const visit = await runtime.sync("patient", "tax-advisor");
    const session = path.join(visit.root, "sessions", "main.jsonl");
    const report = path.join(visit.root, "cwd", "reports", "note.txt");
    fs.writeFileSync(session, '{"role":"user","text":"你好"}\n');
    fs.mkdirSync(path.dirname(report));
    fs.writeFileSync(report, "检查记录");
    const instancePath = path.join(visit.root, "instance.json");
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-sync-proj-"));
    const projectReal = fs.realpathSync(project);
    const instance = JSON.parse(fs.readFileSync(instancePath, "utf8")) as Record<string, unknown>;
    instance.active_session_id = "branch-1";
    instance.project_roots = [projectReal];
    fs.writeFileSync(instancePath, `${JSON.stringify(instance, null, 2)}\n`);

    current = release(2, "第二版");
    const upgraded = await runtime.sync("patient", "tax-advisor");

    expect(upgraded.packageVersion).toBe(2);
    expect(fs.readFileSync(path.join(upgraded.root, "cwd", ".pi", "SYSTEM.md"), "utf8")).toBe("第二版");
    expect(fs.readFileSync(session, "utf8")).toBe('{"role":"user","text":"你好"}\n');
    expect(fs.readFileSync(report, "utf8")).toBe("检查记录");
    expect(fs.readFileSync(instancePath, "utf8")).toContain('"active_session_id": "branch-1"');
    expect(JSON.parse(fs.readFileSync(instancePath, "utf8")).project_roots).toEqual([projectReal]);
    expect(fs.readdirSync(path.join(upgraded.root, "cwd")).some((name) => name.startsWith(".pi.staging-"))).toBe(false);
    expect(fs.readdirSync(path.join(upgraded.root, "cwd")).some((name) => name.startsWith(".pi.backup-"))).toBe(false);
  });

  it("keeps the installed projection when the digest does not match", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-runtime-"));
    const published = release(1, "第一版");
    const runtime = new Runtime(source(new Set(["patient:tax-advisor"]), published), root);
    const visit = await runtime.sync("patient", "tax-advisor");
    const before = fs.readFileSync(path.join(visit.root, "cwd", ".pi", "SYSTEM.md"));

    await expect(runtime.apply("patient", { ...published, files: files("被篡改") })).rejects.toBeInstanceOf(PackageMismatch);
    expect(fs.readFileSync(path.join(visit.root, "cwd", ".pi", "SYSTEM.md"))).toEqual(before);
  });

  it("does not create a home directory without a recruit", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-runtime-"));
    const data = path.join(root, "user-data");
    const runtime = new Runtime(source(new Set(), release(1, "第一版")), data);
    await expect(runtime.sync("stranger", "tax-advisor")).rejects.toBeInstanceOf(NotRecruited);
    expect(fs.existsSync(data)).toBe(false);
  });

  it("openDiskVisit returns the projected visit without calling the package source", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-runtime-"));
    const published = release(1, "第一版");
    const runtime = new Runtime(source(new Set(["patient:tax-advisor"]), published), root);
    const synced = await runtime.sync("patient", "tax-advisor");

    expect(Runtime.openDiskVisit(root, "patient", "tax-advisor")).toMatchObject({
      kind: "recruited",
      userId: "patient",
      agentId: "tax-advisor",
      root: synced.root,
      packageVersion: 1,
      packageDigest: published.digest,
    });
    expect(Runtime.openDiskVisit(root, "patient", "missing")).toBeNull();
    expect(Runtime.openDiskVisit(root, "other", "tax-advisor")).toBeNull();
  });
});
