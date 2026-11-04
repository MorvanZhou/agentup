import { createHash } from "node:crypto";

import {
  acquireAgentSdkRuntime,
  agentSdkRuntimeKey,
  type AgentSdkRuntimeLease,
} from "../../host/runtime-pool.js";
import { ensureCopilotHome, readCopilotGithubToken } from "./home.js";
import { loadCopilotModule, resolveCopilotCliPath, type CopilotSdkClient } from "./load.js";

export type CopilotPooledClient = {
  client: CopilotSdkClient;
  home: string;
};

/** token + cwd：换账号或换工作区不复用旧进程。 */
export function copilotRuntimeFingerprint(token: string, cwd = ""): string {
  const digest = createHash("sha256").update(token).digest("hex").slice(0, 16);
  return `${digest}:${cwd}`;
}

export async function acquireCopilotClient(input: {
  userDataRoot: string;
  templateId: string;
  /** 对话用 cwd；listModels 可空 */
  cwd?: string;
  tokenOverride?: string;
}): Promise<AgentSdkRuntimeLease<CopilotPooledClient>> {
  const token = input.tokenOverride ?? readCopilotGithubToken(input.userDataRoot, input.templateId);
  if (!token) {
    throw new Error("尚未登录 GitHub Copilot（请先在设置里粘贴 GitHub token）");
  }
  const cwd = input.cwd ?? "";
  const key = agentSdkRuntimeKey(
    input.userDataRoot,
    input.templateId,
    copilotRuntimeFingerprint(token, cwd),
  );
  return acquireAgentSdkRuntime({
    key,
    create: async () => {
      const sdk = await loadCopilotModule(input.userDataRoot, input.templateId);
      const home = ensureCopilotHome(input.userDataRoot, input.templateId);
      const cliPath = resolveCopilotCliPath(input.userDataRoot, input.templateId);
      const options: Record<string, unknown> = {
        baseDirectory: home,
        gitHubToken: token,
        useLoggedInUser: false,
      };
      if (cwd) options.workingDirectory = cwd;
      const forStdio = sdk.RuntimeConnection?.forStdio;
      if (cliPath && typeof forStdio === "function") {
        options.connection = forStdio({
          path: cliPath,
          env: {
            ...process.env,
            COPILOT_HOME: home,
          },
        });
      }
      const client = new sdk.CopilotClient(options) as CopilotSdkClient;
      await client.start();
      return { client, home };
    },
    destroy: async (runtime) => {
      await runtime.client.stop().catch(() => undefined);
    },
  });
}
