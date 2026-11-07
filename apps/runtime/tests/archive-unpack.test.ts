import { expect, it } from "vitest";

import { packTarGz, unpackTarGz } from "../src/package/archive.js";

it("unpacks a packed tree in memory", async () => {
  const packed = await packTarGz({
    "SYSTEM.md": Buffer.from("hello"),
    "skills/intake/SKILL.md": Buffer.from("skill"),
  });
  const files = await unpackTarGz(packed);
  expect(Buffer.from(files["SYSTEM.md"]!).toString("utf8")).toBe("hello");
  expect(Buffer.from(files["skills/intake/SKILL.md"]!).toString("utf8")).toBe("skill");
});

it("rejects a symlink member before any file is returned", async () => {
  const packed = await packTarGz({ "SYSTEM.md": Buffer.from("ok") });
  await expect(unpackTarGz(withSymlink(packed))).rejects.toThrow(/链接|非常规/);
});

it("rejects a path that escapes the archive", async () => {
  const packed = await packTarGz({ "SYSTEM.md": Buffer.from("ok") });
  await expect(unpackTarGz(rewriteName(packed, "../SYSTEM.md"))).rejects.toThrow(/非法路径/);
});

/** 把第一个普通文件头改成符号链接。解包必须在写出任何内容前拒绝。 */
function withSymlink(archive: Uint8Array): Uint8Array {
  const raw = inflate(Buffer.from(archive));
  const offset = firstFileHeader(raw);
  raw[offset + 156] = "2".charCodeAt(0);
  restamp(raw, offset);
  return gzip(raw);
}

function rewriteName(archive: Uint8Array, name: string): Uint8Array {
  const raw = inflate(Buffer.from(archive));
  const offset = firstFileHeader(raw);
  raw.fill(0, offset, offset + 100);
  raw.write(name, offset, "utf8");
  restamp(raw, offset);
  return gzip(raw);
}

function firstFileHeader(raw: Buffer): number {
  let offset = 0;
  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const type = header[156] ?? 0;
    if (type === 0 || type === 48) return offset;
    const size = Number.parseInt(header.subarray(124, 136).toString("utf8").replace(/\0/g, "").trim() || "0", 8);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("找不到文件头");
}

function inflate(archive: Buffer): Buffer {
  const zlib = require("node:zlib") as typeof import("node:zlib");
  return zlib.gunzipSync(archive);
}

function gzip(raw: Buffer): Uint8Array {
  const zlib = require("node:zlib") as typeof import("node:zlib");
  return new Uint8Array(zlib.gzipSync(raw));
}

function restamp(raw: Buffer, offset: number): void {
  let sum = 0;
  for (let index = 0; index < 512; index += 1) {
    sum += index >= 148 && index < 156 ? 32 : (raw[offset + index] ?? 0);
  }
  const text = sum.toString(8).padStart(6, "0");
  raw.write(`${text}\0 `, offset + 148, "utf8");
}
