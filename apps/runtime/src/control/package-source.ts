import { HOOKS_ARCHIVE_LIMITS, SKILL_ARCHIVE_LIMITS, unpackTarGz } from "../package/archive.js";
import { md5Hex } from "../package/capability.js";
import { packageDigest, sameDigest } from "../package/digest.js";
import { composeSystemPrompt } from "../local/agents/identity.js";
import type { UiLocale } from "../i18n/index.js";
import type { PackageRelease, PackageSource } from "../package/sync.js";
import { validateAgentPackage } from "../package/validate.js";

import { getCosObject, type ObjectCredential } from "./cos-put.js";
import { BackendClientError } from "./errors.js";
import { decodeHeader, requestJson } from "./http.js";

export class HttpPackageSource implements PackageSource {
  constructor(
    private readonly backendUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly locale: UiLocale = "zh",
  ) {}

  async isRecruited(userId: string, agentId: string): Promise<boolean> {
    const payload = await requestJson(this.fetchImpl, this.backendUrl, "GET", "/v1/recruits", undefined, this.token);
    const recruits = payload.recruits;
    if (!Array.isArray(recruits)) throw new BackendClientError("招募列表无效", 200);
    return recruits.some((item) => {
      if (typeof item !== "object" || item === null) return false;
      const record = item as Record<string, unknown>;
      return record.user_id === userId && record.agent_id === agentId;
    });
  }

  async getPackage(agentId: string): Promise<PackageRelease> {
    const response = await this.fetchImpl(
      `${this.backendUrl.replace(/\/$/, "")}/v1/agents/${encodeURIComponent(agentId)}/package`,
      { method: "GET", headers: { authorization: `Bearer ${this.token}` } },
    );
    if (!response.ok) {
      let message = "下载运行包失败";
      try {
        const payload = (await response.json()) as Record<string, unknown>;
        if (typeof payload.error === "string") message = payload.error;
      } catch {
        // 非 JSON 错误体
      }
      throw new BackendClientError(message, response.status);
    }
    const contentType = response.headers.get("content-type") ?? "";
    let archive: Uint8Array | undefined;
    let version: number;
    let digest: string;
    let name: string;
    let background: string;
    let resolvedAgentId: string;
    let files: Record<string, Uint8Array> | undefined;
    let capability = false;
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as Record<string, unknown>;
      if (Array.isArray(payload.skills)) {
        capability = true;
        files = await assembleCapability(payload, this.fetchImpl, this.locale);
      } else {
        archive = await getCosObject(readCredential(payload), this.fetchImpl);
      }
      version = typeof payload.version === "number" ? payload.version : NaN;
      digest = typeof payload.digest === "string" ? payload.digest : "";
      name = typeof payload.name === "string" ? payload.name : agentId;
      background = typeof payload.background === "string" ? payload.background : "";
      resolvedAgentId = typeof payload.agent_id === "string" ? payload.agent_id : agentId;
    } else {
      archive = new Uint8Array(await response.arrayBuffer());
      const versionHeader = response.headers.get("x-package-version");
      digest = response.headers.get("x-package-digest") ?? "";
      name = decodeHeader(response.headers.get("x-package-name")) || agentId;
      background = decodeHeader(response.headers.get("x-package-background"));
      version = versionHeader ? Number(versionHeader) : NaN;
      resolvedAgentId = response.headers.get("x-agent-id") || agentId;
    }
    if (!files) files = await unpackTarGz(archive!);
    if (!Number.isInteger(version) || version < 1 || !digest) {
      throw new BackendClientError("运行包响应无效", 502);
    }
    const issues = validateAgentPackage(files);
    if (issues.length > 0) {
      throw new BackendClientError(`运行包校验失败: ${issues[0]?.path ?? ""}`, 200, issues);
    }
    const manifest = { version, tools: [], modelCapabilities: [] };
    // 能力对象的服务端摘要是清单哈希。落盘仍用文件树摘要，招募更新看版本号。
    const releaseDigest = capability ? packageDigest(manifest, files) : digest;
    const release: PackageRelease = {
      agentId: resolvedAgentId,
      name,
      background,
      manifest,
      files,
      digest: releaseDigest,
    };
    if (!sameDigest(packageDigest(release.manifest, release.files), release.digest)) {
      throw new BackendClientError("运行包摘要不一致", 200);
    }
    return release;
  }
}

/** 编辑页点开 MCP 时只拉这一个对象，不把 skill 包一起下下来。 */
export async function fetchCapabilityText(
  backendUrl: string,
  token: string,
  agentId: string,
  kind: "mcp" | "settings",
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(
    `${backendUrl.replace(/\/$/, "")}/v1/agents/${encodeURIComponent(agentId)}/package`,
    { method: "GET", headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new BackendClientError("下载运行包失败", response.status);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const files = await unpackTarGz(new Uint8Array(await response.arrayBuffer()));
    return Buffer.from(files[kind === "mcp" ? "mcp.json" : "settings.json"] ?? []).toString("utf8");
  }
  const payload = (await response.json()) as Record<string, unknown>;
  if (!Array.isArray(payload.skills)) {
    const files = await unpackTarGz(await getCosObject(readCredential(payload), fetchImpl));
    return Buffer.from(files[kind === "mcp" ? "mcp.json" : "settings.json"] ?? []).toString("utf8");
  }
  const object = payload[kind];
  if (!object || typeof object !== "object") return "";
  const record = object as Record<string, unknown>;
  const bytes = await getCosObject(readCredential(record), fetchImpl);
  const expected = typeof record.md5 === "string" ? record.md5 : "";
  if (expected && md5Hex(bytes) !== expected.toLowerCase()) {
    throw new BackendClientError("对象摘要不一致", 200);
  }
  return Buffer.from(bytes).toString("utf8");
}

async function assembleCapability(
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch,
  locale: UiLocale,
): Promise<Record<string, Uint8Array>> {
  const name = typeof payload.name === "string" ? payload.name : "";
  const role = typeof payload.role === "string" ? payload.role : "";
  const background = typeof payload.background === "string" ? payload.background : "";
  const rules = typeof payload.rules === "string" ? payload.rules : "";
  const files: Record<string, Uint8Array> = {
    "SYSTEM.md": Buffer.from(`${composeSystemPrompt({ name, role, background }, locale)}\n`),
  };
  const trimmedRules = rules.trim();
  if (trimmedRules) {
    files["AGENTS.md"] = Buffer.from(`${trimmedRules}\n`);
  }
  const skills = payload.skills;
  if (!Array.isArray(skills)) throw new BackendClientError("运行包响应无效", 502);
  const downloaded = await Promise.all(
    skills.map(async (item) => {
      if (!item || typeof item !== "object") throw new BackendClientError("运行包响应无效", 502);
      const record = item as Record<string, unknown>;
      const skillName = typeof record.name === "string" ? record.name : "";
      const bytes = await getCosObject(readCredential(record), fetchImpl);
      return { skillName, md5: typeof record.md5 === "string" ? record.md5 : "", bytes };
    }),
  );
  for (const skill of downloaded) {
    if (!skill.skillName || md5Hex(skill.bytes) !== skill.md5.toLowerCase()) {
      throw new BackendClientError("对象摘要不一致", 200);
    }
    const unpacked = await unpackTarGz(skill.bytes, SKILL_ARCHIVE_LIMITS);
    for (const [relative, data] of Object.entries(unpacked)) {
      files[`skills/${skill.skillName}/${relative}`] = data;
    }
  }
  await attachObject(files, payload.hooks, "hooks", fetchImpl);
  await attachRaw(files, payload.mcp, "mcp.json", fetchImpl);
  await attachRaw(files, payload.settings, "settings.json", fetchImpl);
  return files;
}

async function attachObject(
  files: Record<string, Uint8Array>,
  value: unknown,
  prefix: "hooks",
  fetchImpl: typeof fetch,
): Promise<void> {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const bytes = await getCosObject(readCredential(record), fetchImpl);
  const expected = typeof record.md5 === "string" ? record.md5 : "";
  if (expected && md5Hex(bytes) !== expected.toLowerCase()) {
    throw new BackendClientError("对象摘要不一致", 200);
  }
  const unpacked = await unpackTarGz(bytes, HOOKS_ARCHIVE_LIMITS);
  for (const [relative, data] of Object.entries(unpacked)) {
    files[`${prefix}/${relative}`] = data;
  }
}

async function attachRaw(
  files: Record<string, Uint8Array>,
  value: unknown,
  filePath: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const bytes = await getCosObject(readCredential(record), fetchImpl);
  const expected = typeof record.md5 === "string" ? record.md5 : "";
  if (expected && md5Hex(bytes) !== expected.toLowerCase()) {
    throw new BackendClientError("对象摘要不一致", 200);
  }
  files[filePath] = bytes;
}

function readCredential(payload: Record<string, unknown>): ObjectCredential {
  const bucket = payload.bucket;
  const region = payload.region;
  const key = payload.key;
  const secretId = payload.tmp_secret_id;
  const secretKey = payload.tmp_secret_key;
  const token = payload.session_token;
  if (
    typeof bucket !== "string"
    || typeof region !== "string"
    || typeof key !== "string"
    || typeof secretId !== "string"
    || typeof secretKey !== "string"
    || typeof token !== "string"
  ) {
    throw new BackendClientError("下载凭证无效", 502);
  }
  return {
    bucket,
    region,
    key,
    tmp_secret_id: secretId,
    tmp_secret_key: secretKey,
    session_token: token,
    content_type: typeof payload.content_type === "string" ? payload.content_type : "",
    ...(typeof payload.host === "string" && payload.host.trim() ? { host: payload.host.trim() } : {}),
  };
}
