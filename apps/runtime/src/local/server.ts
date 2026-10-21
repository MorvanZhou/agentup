import type { Server } from "node:http";

import { createAdaptorServer } from "@hono/node-server";

import { type LocalConfig, type ModelConfig } from "../config/load.js";
import { loadModelConfig } from "../config/provider.js";
import { ApprovalBroker } from "../session/approval.js";
import { DelegationService } from "../session/delegation/index.js";
import { AskUserBroker } from "../session/tools/index.js";
import { VisitChats, openPromptSession, type PromptSession } from "../session/turn.js";
import type { Visit } from "../package/sync.js";
import { createLocalApp, LocalError } from "./app.js";

export interface LocalServer {
  url: string;
  close(): Promise<void>;
}

export interface LocalServerOptions {
  openPrompt?: (visit: Visit, model: ModelConfig) => Promise<PromptSession>;
  readModel?: () => ModelConfig;
}

/** 只监听本机，供桌面界面调用。业务仍由 runtime 访问 backend。 */
export function startLocalServer(config: LocalConfig, options: LocalServerOptions = {}): Promise<LocalServer> {
  if (config.host !== "127.0.0.1") return Promise.reject(new LocalError("只能监听 127.0.0.1", 500));
  const approvals = new ApprovalBroker(config.userDataRoot);
  const askUser = new AskUserBroker(config.userDataRoot);
  const readModel = options.readModel ?? (() => loadModelConfig(config.userDataRoot));
  let chats!: VisitChats;
  const delegation = new DelegationService({
    userDataRoot: config.userDataRoot,
    backendUrl: config.backendUrl,
    getModel: readModel,
    approvals,
    askUser,
    invalidateVisit: (userId, agentId, kind) => chats.invalidate(userId, agentId, kind),
  });
  const open =
    options.openPrompt ??
    ((visit, model) => openPromptSession(visit, model, approvals, askUser, delegation));
  chats = new VisitChats(open, approvals, askUser, delegation);
  const app = createLocalApp({ config, chats, approvals, askUser, delegation, readModel });
  const server = createAdaptorServer({ fetch: app.fetch }) as Server;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : config.port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
