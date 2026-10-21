import { packTarGz } from "../package/archive.js";
import { packageDigest, sameDigest } from "../package/digest.js";
import type { AgentPublishSource } from "../package/source.js";

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

/** 更新名片层（name / role / background / rules / 可选 avatar），不换运行包。 */
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

/** 下载已发布包内单个 skill 为 zip。 */
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
  return new Uint8Array(await response.arrayBuffer());
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
  const archive = await packTarGz(source.files);
  const form = new FormData();
  form.set("name", name);
  form.set("role", role);
  form.set("background", background);
  form.set("rules", rules);
  form.set(
    "archive",
    new Blob([Uint8Array.from(archive)], { type: "application/gzip" }),
    // 后端会按 agent_id + 白名单扩展名改写；上传名仅需合法后缀。
    agentId ? `${agentId}.tar.gz` : "package.tar.gz",
  );
  if (source.avatar) {
    form.set(
      "avatar",
      new Blob([Uint8Array.from(source.avatar)], { type: "application/octet-stream" }),
      "avatar.bin",
    );
  }
  const accepted = await requestForm(
    fetchImpl,
    backendUrl,
    "POST",
    agentId ? `/v1/agents/${encodeURIComponent(agentId)}/publish` : "/v1/agents",
    form,
    token,
  );
  const ready = await waitPublishJob(backendUrl, token, accepted, fetchImpl);
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
  const assignedManifest = { version: manifestRecord.version, tools: [], modelCapabilities: [] };
  if (!sameDigest(packageDigest(assignedManifest, source.files), ready.digest)) {
    throw new BackendClientError("运行包摘要不一致", 502);
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

function agentListQuery(query: AgentListQuery): string {
  const params = new URLSearchParams();
  const q = query.q?.trim();
  if (q) params.set("q", q.slice(0, 64));
  if (query.recruited === true) params.set("recruited", "true");
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}
