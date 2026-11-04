import { createHash } from "node:crypto";

import {
  acquireAgentSdkRuntime,
  agentSdkRuntimeKey,
  type AgentSdkRuntimeLease,
} from "../../host/runtime-pool.js";
import { startOpencodeServer, type OpencodeServer } from "./server.js";

/** cwd + config：换目录或配置不复用旧 serve。 */
export function opencodeServerFingerprint(
  cwd: string,
  config?: Record<string, unknown>,
): string {
  const raw = `${cwd}\n${JSON.stringify(config ?? {})}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

export async function acquireOpencodeServer(input: {
  userDataRoot: string;
  templateId: string;
  cwd: string;
  config?: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<AgentSdkRuntimeLease<OpencodeServer>> {
  const fingerprint = opencodeServerFingerprint(input.cwd, input.config);
  const key = agentSdkRuntimeKey(input.userDataRoot, input.templateId, fingerprint);
  return acquireAgentSdkRuntime({
    key,
    create: async () =>
      startOpencodeServer({
        userDataRoot: input.userDataRoot,
        templateId: input.templateId,
        cwd: input.cwd,
        config: input.config,
        // 池内 server 不跟单轮 abort 一起死；abort 只停本轮 session
        signal: undefined,
      }),
    destroy: async (server) => {
      await server.close();
    },
  });
}
