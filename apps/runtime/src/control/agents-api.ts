import { packTarGz } from "../package/archive.js";
import {
  prepareCapabilityObjects,
  type CapabilityBlob,
  type PreparedCapability,
} from "../package/capability.js";
import { packageDigest, sameDigest } from "../package/digest.js";
import type { AgentPublishSource } from "../package/source.js";
import { validateAgentPackage } from "../package/validate.js";

import { getCosObject, isWebp, putCosObject, type ObjectCredential } from "./cos-put.js";
import { BackendClientError } from "./errors.js";
import { requestForm, requestJson } from "./http.js";
import { agentCard, recruit } from "./parse.js";
import type { AgentCard, AgentListQuery, PublishedAgent, Recruit } from "./types.js";

const PUBLISH_POLL_MS = 200;
const PUBLISH_POLL_MAX_MS = 120_000;

export async function listAgents(
  backendUrl: string,
  token: string,
  query: AgentListQuery = {},
  fetchImpl: typeof fetch = fetch,
): Promise<AgentCard[]> {
  const payload = await requestJson(
    fetchImpl,
    backendUrl,
    "GET",
    `/v1/agents${agentListQuery(query)}`,
    undefined,
    token,
  );
  if (!Array.isArray(payload.agents)) throw new BackendClientError("Agent 列表无效", 200);
  return payload.agents.map(agentCard);
}

export async function listPublicAgents(
  backendUrl: string,
  query: AgentListQuery = {},
  fetchImpl: typeof fetch = fetch,
): Promise<AgentCard[]> {
  const payload = await requestJson(
    fetchImpl,
    backendUrl,
    "GET",
    `/v1/agents/public${agentListQuery({ q: query.q })}`,
  );
  if (!Array.isArray(payload.agents)) throw new BackendClientError("Agent 列表无效", 200);
  return payload.agents.map(agentCard);
}

export async function listOwnedAgents(
  backendUrl: string,
  token: string,
  query: AgentListQuery = {},
  fetchImpl: typeof fetch = fetch,
): Promise<AgentCard[]> {
  const payload = await requestJson(
    fetchImpl,
    backendUrl,
    "GET",
    `/v1/agents/owned${agentListQuery({ q: query.q })}`,
    undefined,
    token,
  );
  if (!Array.isArray(payload.agents)) throw new BackendClientError("Agent 列表无效", 200);
  return payload.agents.map(agentCard);
}

export async function recruitAgent(
  backendUrl: string,
  token: string,
  agentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Recruit> {
  const payload = await requestJson(
    fetchImpl,
    backendUrl,
    "POST",
    `/v1/agents/${encodeURIComponent(agentId)}/recruit`,
    undefined,
    token,
  );
  return recruit(payload);
}

export async function unrecruitAgent(
  backendUrl: string,
  token: string,
  agentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await requestJson(
    fetchImpl,
    backendUrl,
    "DELETE",
    `/v1/agents/${encodeURIComponent(agentId)}/recruit`,
    undefined,
    token,
  );
}

export async function deleteOwnedAgent(
  backendUrl: string,
  token: string,
  agentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await requestJson(
    fetchImpl,
    backendUrl,
    "DELETE",
    `/v1/agents/${encodeURIComponent(agentId)}`,
    undefined,
    token,
  );
}

export async function setAgentRemark(
  backendUrl: string,
  token: string,
  agentId: string,
  remark: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Recruit> {
  const payload = await requestJson(
    fetchImpl,
    backendUrl,
    "PUT",
    `/v1/agents/${encodeURIComponent(agentId)}/remark`,
    { remark },
    token,
  );
  return recruit(payload);
}

/** 更新名片层（name / role / background / rules / 可选 avatar）；有变更则升版，不换能力对象。 */
export async function updateAgentCard(
  backendUrl: string,
  token: string,
  agentId: string,
  input: {
    name: string;
    role: string;
    background: string;
    rules?: string;
    avatar?: Uint8Array;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<AgentCard> {
  const form = new FormData();
  form.set("name", input.name);
  form.set("role", input.role);
  form.set("background", input.background);
  form.set("rules", input.rules ?? "");
  if (input.avatar) {
    form.set(
      "avatar",
      new Blob([Uint8Array.from(input.avatar)], { type: "application/octet-stream" }),
      "avatar.bin",
    );
  }
  const payload = await requestForm(
    fetchImpl,
    backendUrl,
    "PUT",
    `/v1/agents/${encodeURIComponent(agentId)}/card`,
    form,
    token,
  );
  return agentCard(payload);
}

/** 下载已发布的单个 skill。新接口返回读取凭证，对象是 tar.gz。 */
export async function downloadAgentSkill(
  backendUrl: string,
  token: string,
  agentId: string,
  skillName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const response = await fetchImpl(
    `${backendUrl.replace(/\/$/, "")}/v1/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillName)}`,
    {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok) {
    throw new BackendClientError(
      response.status === 404 ? "找不到该 Skill" : "下载 Skill 失败",
      response.status,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return getCosObject(readCredential(await response.json()), fetchImpl);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export interface ManifestSkill {
  name: string;
  md5: string;
  /** 没变的 skill 只带 md5，服务端不会要求重传。 */
  body?: Uint8Array;
}

/** "" 表示删掉；省略表示更新时保留服务端现有对象。 */
export type ManifestPart = CapabilityBlob | "";

export async function publishManifest(input: {
  backendUrl: string;
  token: string;
  name: string;
  role: string;
  background: string;
  rules?: string;
  agentId?: string;
  skills: ManifestSkill[];
  mcp?: ManifestPart;
  settings?: ManifestPart;
  hooks?: ManifestPart;
  avatar?: Uint8Array;
  fetchImpl?: typeof fetch;
}): Promise<PublishedAgent> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const form = new FormData();
  form.set("name", input.name);
  form.set("role", input.role);
  form.set("background", input.background);
  form.set("rules", input.rules ?? "");
  form.set("skills", JSON.stringify(input.skills.map((skill) => ({ name: skill.name, md5: skill.md5 }))));
  if (input.mcp !== undefined) form.set("mcp_md5", input.mcp === "" ? "" : input.mcp.md5);
  if (input.settings !== undefined) form.set("settings_md5", input.settings === "" ? "" : input.settings.md5);
  if (input.hooks !== undefined) form.set("hooks_md5", input.hooks === "" ? "" : input.hooks.md5);
  const accepted = await requestForm(
    fetchImpl,
    input.backendUrl,
    "POST",
    input.agentId ? `/v1/agents/${encodeURIComponent(input.agentId)}/publish` : "/v1/agents",
    form,
    input.token,
  );
  let ready = accepted;
  if (accepted.status === "awaiting_upload") {
    if (!Array.isArray(accepted.uploads)) throw new BackendClientError("发布响应无效", 502);
    await putCapabilityUploads(accepted.uploads, uploadBodies(input.skills, input.mcp, input.settings, input.hooks), fetchImpl);
    ready = await requestJson(
      fetchImpl,
      input.backendUrl,
      "POST",
      `/v1/agents/publish-jobs/${encodeURIComponent(String(accepted.job_id))}/uploaded`,
      { digest: "0".repeat(64) },
      input.token,
    );
  }
  ready = await waitPublishJob(input.backendUrl, input.token, ready, fetchImpl);
  if (ready.status === "ready" && input.avatar && isWebp(input.avatar) && typeof ready.agent_id === "string") {
    await uploadAvatar(input.backendUrl, input.token, ready.agent_id, input.avatar, fetchImpl);
  }
  return readPublished(ready, input.agentId);
}

export async function publishAgent(
  backendUrl: string,
  token: string,
  source: AgentPublishSource,
  name: string,
  role: string,
  background: string,
  agentId?: string,
  rules = "",
  fetchImpl: typeof fetch = fetch,
): Promise<PublishedAgent> {
  const issues = validateAgentPackage(source.files);
  if (issues.length > 0) {
    throw new BackendClientError("运行包校验失败", 400, issues);
  }
  let prepared: PreparedCapability;
  try {
    prepared = await prepareCapabilityObjects(source.files);
  } catch (error) {
    throw new BackendClientError(error instanceof Error ? error.message : "运行包无效", 400);
  }
  const form = new FormData();
  form.set("name", name);
  form.set("role", role);
  form.set("background", background);
  form.set("rules", rules);
  form.set("skills", JSON.stringify(prepared.skills.map((skill) => ({ name: skill.name, md5: skill.md5 }))));
  form.set("mcp_md5", prepared.mcp?.md5 ?? "");
  form.set("settings_md5", prepared.settings?.md5 ?? "");
  form.set("hooks_md5", prepared.hooks?.md5 ?? "");
  const accepted = await requestForm(
    fetchImpl,
    backendUrl,
    "POST",
    agentId ? `/v1/agents/${encodeURIComponent(agentId)}/publish` : "/v1/agents",
    form,
    token,
  );
  let ready = accepted;
  // 旧测试桩和过渡期整包只返回 upload。正式服务端返回 uploads，摘要是清单哈希，不再和文件树比对。
  const uploads = accepted.uploads;
  const capability = Array.isArray(uploads);
  if (accepted.status === "awaiting_upload") {
    if (capability) {
      await putCapabilityUploads(uploads, preparedObjects(prepared), fetchImpl);
      ready = await requestJson(
        fetchImpl,
        backendUrl,
        "POST",
        `/v1/agents/publish-jobs/${encodeURIComponent(String(accepted.job_id))}/uploaded`,
        { digest: "0".repeat(64) },
        token,
      );
    } else {
      const archive = await packTarGz(source.files);
      const upload = readCredential(accepted.upload);
      await putCosObject({ ...upload, content_type: upload.content_type || "application/gzip" }, archive, fetchImpl);
      const version = versionFromKey(upload.key);
      const digest = packageDigest({ version, tools: [], modelCapabilities: [] }, source.files);
      ready = await requestJson(
        fetchImpl,
        backendUrl,
        "POST",
        `/v1/agents/publish-jobs/${encodeURIComponent(String(accepted.job_id))}/uploaded`,
        { digest },
        token,
      );
    }
    if (ready.status === "ready" && source.avatar && isWebp(source.avatar) && typeof ready.agent_id === "string") {
      await uploadAvatar(backendUrl, token, ready.agent_id, source.avatar, fetchImpl);
    }
  }
  ready = await waitPublishJob(backendUrl, token, ready, fetchImpl);
  const published = readPublished(ready, agentId);
  if (!capability) {
    const assignedManifest = { version: published.version, tools: [], modelCapabilities: [] };
    if (!sameDigest(packageDigest(assignedManifest, source.files), published.digest)) {
      throw new BackendClientError("运行包摘要不一致", 502);
    }
  }
  return published;
}

interface UploadBody {
  suffix: string;
  body: Uint8Array;
  contentType: string;
}

function preparedObjects(prepared: PreparedCapability): UploadBody[] {
  return [
    ...prepared.skills.map((skill) => ({
      suffix: `/skills/${skill.name}.tar.gz`,
      body: skill.body,
      contentType: "application/gzip",
    })),
    ...(prepared.hooks ? [{ suffix: "/hooks.tar.gz", body: prepared.hooks.body, contentType: "application/gzip" }] : []),
    ...(prepared.mcp ? [{ suffix: "/mcp.json", body: prepared.mcp.body, contentType: "application/json" }] : []),
    ...(prepared.settings
      ? [{ suffix: "/settings.json", body: prepared.settings.body, contentType: "application/json" }]
      : []),
  ];
}

function presentPart(part: ManifestPart | undefined): CapabilityBlob | undefined {
  if (!part) return undefined;
  return part;
}

function uploadBodies(
  skills: ManifestSkill[],
  mcp: ManifestPart | undefined,
  settings: ManifestPart | undefined,
  hooks: ManifestPart | undefined,
): UploadBody[] {
  const bodies: UploadBody[] = [];
  for (const skill of skills) {
    if (!skill.body) continue;
    bodies.push({ suffix: `/skills/${skill.name}.tar.gz`, body: skill.body, contentType: "application/gzip" });
  }
  const hooksBody = presentPart(hooks);
  const mcpBody = presentPart(mcp);
  const settingsBody = presentPart(settings);
  if (hooksBody) bodies.push({ suffix: "/hooks.tar.gz", body: hooksBody.body, contentType: "application/gzip" });
  if (mcpBody) bodies.push({ suffix: "/mcp.json", body: mcpBody.body, contentType: "application/json" });
  if (settingsBody) {
    bodies.push({ suffix: "/settings.json", body: settingsBody.body, contentType: "application/json" });
  }
  return bodies;
}

async function putCapabilityUploads(
  uploads: unknown[],
  bodies: UploadBody[],
  fetchImpl: typeof fetch,
): Promise<void> {
  await Promise.all(
    uploads.map(async (item) => {
      const credential = readCredential(item);
      const match = bodies.find((body) => credential.key.endsWith(body.suffix));
      if (!match) throw new BackendClientError("缺少要上传的文件", 502);
      await putCosObject(
        { ...credential, content_type: credential.content_type || match.contentType },
        match.body,
        fetchImpl,
        { forbidOverwrite: false },
      );
    }),
  );
}

function readPublished(ready: Record<string, unknown>, agentId?: string): PublishedAgent {
  const manifest = ready.manifest;
  if (
    (agentId !== undefined && ready.agent_id !== agentId) ||
    typeof ready.agent_id !== "string" ||
    typeof ready.name !== "string" ||
    typeof ready.background !== "string" ||
    typeof ready.digest !== "string" ||
    typeof manifest !== "object" ||
    manifest === null
  ) {
    throw new BackendClientError("发布响应无效", 502);
  }
  const manifestRecord = manifest as Record<string, unknown>;
  if (typeof manifestRecord.version !== "number" || !Number.isInteger(manifestRecord.version)) {
    throw new BackendClientError("发布响应无效", 502);
  }
  return {
    agentId: ready.agent_id,
    name: ready.name,
    role: typeof ready.role === "string" ? ready.role : "",
    background: ready.background,
    version: manifestRecord.version,
    digest: ready.digest,
  };
}

async function waitPublishJob(
  backendUrl: string,
  token: string,
  accepted: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  if (accepted.status === "ready") return accepted;
  if (accepted.status === "failed") {
    throwPublishFailed(accepted);
  }
  const jobId = accepted.job_id;
  if (typeof jobId !== "string" || !jobId) {
    throw new BackendClientError("发布响应无效", 502);
  }
  const started = Date.now();
  while (Date.now() - started < PUBLISH_POLL_MAX_MS) {
    await sleep(PUBLISH_POLL_MS);
    const job = await requestJson(
      fetchImpl,
      backendUrl,
      "GET",
      `/v1/agents/publish-jobs/${encodeURIComponent(jobId)}`,
      undefined,
      token,
    );
    if (job.status === "ready") return job;
    if (job.status === "failed") throwPublishFailed(job);
  }
  throw new BackendClientError("发布超时", 504);
}

function throwPublishFailed(job: Record<string, unknown>): never {
  const message = typeof job.error === "string" && job.error ? job.error : "运行包校验失败";
  const details = Array.isArray(job.details) ? job.details : undefined;
  throw new BackendClientError(
    message,
    400,
    details as { path: string; message: string }[] | undefined,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadAvatar(
  backendUrl: string,
  token: string,
  agentId: string,
  webp: Uint8Array,
  fetchImpl: typeof fetch,
): Promise<void> {
  const grant = await requestJson(
    fetchImpl,
    backendUrl,
    "POST",
    `/v1/agents/${encodeURIComponent(agentId)}/avatar-upload`,
    undefined,
    token,
  );
  const credential = readCredential(grant);
  await putCosObject({ ...credential, content_type: "image/webp" }, webp, fetchImpl);
  const rev = revFromKey(credential.key);
  await requestJson(
    fetchImpl,
    backendUrl,
    "POST",
    `/v1/agents/${encodeURIComponent(agentId)}/avatar-uploaded?rev=${rev}`,
    undefined,
    token,
  );
}

function readCredential(value: unknown): ObjectCredential {
  if (typeof value !== "object" || value === null) {
    throw new BackendClientError("上传凭证无效", 502);
  }
  const record = value as Record<string, unknown>;
  const bucket = record.bucket;
  const region = record.region;
  const key = record.key;
  const secretId = record.tmp_secret_id;
  const secretKey = record.tmp_secret_key;
  const session = record.session_token;
  if (
    typeof bucket !== "string"
    || typeof region !== "string"
    || typeof key !== "string"
    || typeof secretId !== "string"
    || typeof secretKey !== "string"
    || typeof session !== "string"
  ) {
    throw new BackendClientError("上传凭证无效", 502);
  }
  return {
    bucket,
    region,
    key,
    tmp_secret_id: secretId,
    tmp_secret_key: secretKey,
    session_token: session,
    content_type: typeof record.content_type === "string" ? record.content_type : "",
    ...(typeof record.host === "string" && record.host.trim() ? { host: record.host.trim() } : {}),
  };
}

function versionFromKey(key: string): number {
  const match = /\/v(\d+)\.tar\.gz$/.exec(key);
  const version = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(version) || version < 1) throw new BackendClientError("上传凭证无效", 502);
  return version;
}

function revFromKey(key: string): number {
  const match = /\/(\d+)\.webp$/.exec(key);
  const rev = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(rev) || rev < 1) throw new BackendClientError("上传凭证无效", 502);
  return rev;
}

function agentListQuery(query: AgentListQuery): string {
  const params = new URLSearchParams();
  const q = query.q?.trim();
  if (q) params.set("q", q.slice(0, 64));
  if (query.recruited === true) params.set("recruited", "true");
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}
