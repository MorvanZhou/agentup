/**
 * 能力对象：每个 skill 一个 tar.gz，hooks 一个 tar.gz，mcp/settings 是原始 JSON。
 * SYSTEM.md / AGENTS.md 不进对象；安装时再按名片和界面语言拼出来。
 * MD5 是对象字节的身份，和 backend `domain/capability.py` 同一套拆分。
 */
import { createHash } from "node:crypto";

import { packTarGz } from "./archive.js";

const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SKILL_MAX_COUNT = 20;
export const JSON_OBJECT_MAX_BYTES = 200 * 1024;

export interface CapabilitySkill {
  name: string;
  md5: string;
  body: Uint8Array;
}

export interface CapabilityBlob {
  md5: string;
  body: Uint8Array;
}

export interface PreparedCapability {
  skills: CapabilitySkill[];
  hooks?: CapabilityBlob;
  mcp?: CapabilityBlob;
  settings?: CapabilityBlob;
}

export function md5Hex(bytes: Uint8Array): string {
  return createHash("md5").update(bytes).digest("hex");
}

/** 从已校验的运行包拆出要上传的对象。缺了的 JSON / hooks 表示发布时删掉。 */
export async function prepareCapabilityObjects(
  files: Record<string, Uint8Array>,
): Promise<PreparedCapability> {
  const grouped = new Map<string, Record<string, Uint8Array>>();
  const hooks: Record<string, Uint8Array> = {};
  for (const [filePath, data] of Object.entries(files)) {
    if (filePath === "SYSTEM.md" || filePath === "AGENTS.md" || filePath === "mcp.json" || filePath === "settings.json") {
      continue;
    }
    if (filePath.startsWith("skills/")) {
      const parts = filePath.split("/");
      const name = parts[1] ?? "";
      const relative = parts.slice(2).join("/");
      if (!name || !relative || !SKILL_NAME.test(name)) throw new Error("skill 路径无效");
      const tree = grouped.get(name) ?? {};
      tree[relative] = data;
      grouped.set(name, tree);
      continue;
    }
    if (filePath.startsWith("hooks/")) {
      const relative = filePath.slice("hooks/".length);
      if (!relative) throw new Error("hooks 路径无效");
      hooks[relative] = data;
      continue;
    }
    throw new Error(`无法拆分的文件: ${filePath}`);
  }
  if (grouped.size > SKILL_MAX_COUNT) throw new Error("skill 数量超过上限");
  const skills: CapabilitySkill[] = [];
  for (const name of [...grouped.keys()].sort()) {
    const body = await packTarGz(grouped.get(name)!);
    skills.push({ name, md5: md5Hex(body), body });
  }
  const prepared: PreparedCapability = { skills };
  if (Object.keys(hooks).length > 0) {
    const body = await packTarGz(hooks);
    prepared.hooks = { md5: md5Hex(body), body };
  }
  const mcp = jsonBlob(files["mcp.json"]);
  const settings = jsonBlob(files["settings.json"]);
  if (mcp) prepared.mcp = mcp;
  if (settings) prepared.settings = settings;
  return prepared;
}

function jsonBlob(body: Uint8Array | undefined): CapabilityBlob | undefined {
  if (!body || body.byteLength === 0) return undefined;
  if (body.byteLength > JSON_OBJECT_MAX_BYTES) throw new Error("JSON 对象超过上限");
  return { md5: md5Hex(body), body };
}
