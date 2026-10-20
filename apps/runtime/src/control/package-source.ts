import { unpackTarGz } from "../package/archive.js";
import { packageDigest, sameDigest } from "../package/digest.js";
import type { PackageRelease, PackageSource } from "../package/sync.js";

import { BackendClientError } from "./errors.js";
import { decodeHeader, requestJson } from "./http.js";

export class HttpPackageSource implements PackageSource {
  constructor(
    private readonly backendUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
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
    const archive = new Uint8Array(await response.arrayBuffer());
    const files = await unpackTarGz(archive);
    const versionHeader = response.headers.get("x-package-version");
    const digest = response.headers.get("x-package-digest") ?? "";
    const name = decodeHeader(response.headers.get("x-package-name")) || agentId;
    const summary = decodeHeader(response.headers.get("x-package-summary"));
    const version = versionHeader ? Number(versionHeader) : NaN;
    if (!Number.isInteger(version) || version < 1 || !digest) {
      throw new BackendClientError("运行包响应头无效", 502);
    }
    const release: PackageRelease = {
      agentId: response.headers.get("x-agent-id") || agentId,
      name,
      summary,
      manifest: { version, tools: [], modelCapabilities: [] },
      files,
      digest,
    };
    if (!sameDigest(packageDigest(release.manifest, release.files), release.digest)) {
      throw new BackendClientError("运行包摘要不一致", 200);
    }
    return release;
  }
}
