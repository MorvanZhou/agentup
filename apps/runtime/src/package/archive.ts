import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import * as tar from "tar";

/** 把相对路径文件树打成 tar.gz。 */
export async function packTarGz(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-pack-"));
  try {
    for (const [relative, content] of Object.entries(files)) {
      validateRelative(relative);
      const target = path.join(staging, ...relative.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    const out = path.join(staging, "package.tar.gz");
    const entries = Object.keys(files).sort();
    await tar.c({ gzip: true, file: out, cwd: staging, portable: true, mtime: new Date(0) }, entries);
    return new Uint8Array(fs.readFileSync(out));
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/** 解出相对路径文件树。 */
export async function unpackTarGz(archive: Uint8Array): Promise<Record<string, Uint8Array>> {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-unpack-"));
  const archivePath = path.join(staging, `${randomUUID()}.tar.gz`);
  const extractDir = path.join(staging, "tree");
  fs.mkdirSync(extractDir, { recursive: true });
  try {
    fs.writeFileSync(archivePath, archive);
    await tar.x({ file: archivePath, cwd: extractDir, strict: true });
    return readTree(extractDir);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function readTree(root: string): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, relative);
        continue;
      }
      if (!entry.isFile()) continue;
      validateRelative(relative);
      files[relative] = new Uint8Array(fs.readFileSync(full));
    }
  };
  walk(root, "");
  return files;
}

function validateRelative(relative: string): void {
  const normalized = relative.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`非法路径: ${relative}`);
  }
}
