import type { Server } from "node:http";

import { createAdaptorServer } from "@hono/node-server";

import { type LocalConfig, type ModelConfig } from "../config/load.js";
import { loadModelConfig } from "../config/provider.js";
import { Runtime, type Visit } from "../package/sync.js";
import { BackgroundJobs } from "../session/background/index.js";
import { ApprovalBroker } from "../session/hitl/approval/index.js";
import { ShellHangBroker } from "../session/hitl/shell-hang/index.js";
import { DelegationService } from "../session/delegation/index.js";
import { createHolderTurnDriver, GroupRooms, GroupTurns } from "../session/group/index.js";
import { resolveVisitModelConfig } from "../session/model/session-model.js";
import { AskUserBroker } from "../session/tools/index.js";
import { VisitChats, openPromptSession, type PromptSession } from "../session/turn/index.js";
import { isLocalAgentId, localAgentVisit } from "./agents/local-agent.js";
import {
  PERSONAL_ASSISTANT_ID,
  personalAssistantVisit,
} from "./assistant/personal-assistant.js";
import { createLocalApp, LocalError } from "./app.js";

export interface LocalServer {
  url: string;
  close(): Promise<void>;
}

export interface LocalServerOptions {
  openPrompt?: (visit: Visit, model: ModelConfig) => Promise<PromptSession>;
  readModel?: () => ModelConfig;
}

function resolveWakeVisit(
  userDataRoot: string,
  userId: string,
  agentId: string,
  kind: Visit["kind"],
): Visit | null {
  if (kind === "personal" || agentId === PERSONAL_ASSISTANT_ID) {
    return personalAssistantVisit(userDataRoot, userId);
  }
  if (kind === "local" || isLocalAgentId(agentId)) {
    try {
      return localAgentVisit(userDataRoot, userId, agentId);
    } catch {
      return null;
    }
  }
  return Runtime.openDiskVisit(userDataRoot, userId, agentId);
}

/** 只监听本机，供桌面界面调用。业务仍由 runtime 访问 backend。 */
export function startLocalServer(config: LocalConfig, options: LocalServerOptions = {}): Promise<LocalServer> {
  if (config.host !== "127.0.0.1") return Promise.reject(new LocalError("只能监听 127.0.0.1", 500));
  const approvals = new ApprovalBroker(config.userDataRoot);
  const askUser = new AskUserBroker(config.userDataRoot);
  const shellHang = new ShellHangBroker();
  const readModel = options.readModel ?? (() => loadModelConfig(config.userDataRoot));
  let chats!: VisitChats;
  const delegation = new DelegationService({
    userDataRoot: config.userDataRoot,
    backendUrl: config.backendUrl,
    getModel: readModel,
    approvals,
    askUser,
    shellHang,
    enqueueWake: (item) => chats.enqueueAsyncWake(item),
  });
  const groups = new GroupRooms(config.userDataRoot, delegation);
  const backgroundJobs = new BackgroundJobs({
    userDataRoot: config.userDataRoot,
    enqueueWake: (item) => chats.enqueueAsyncWake(item),
    deliverGroup: (job, body) => {
      if (!job.groupId) return;
      groups.acceptBackground(job.userId, job.groupId, body);
    },
  });
  const groupTurns = new GroupTurns(
    groups,
    createHolderTurnDriver({
      resolveVisit: (userId, agentId) =>
        resolveWakeVisit(config.userDataRoot, userId, agentId, "recruited") ??
        resolveWakeVisit(config.userDataRoot, userId, agentId, "local"),
      resolveModel: (visit) => resolveVisitModelConfig(config.userDataRoot, visit),
      approvals,
      askUser,
      shellHang,
      open: (visit, model, sessionDir, conversation) =>
        openPromptSession(
          visit,
          model,
          approvals,
          askUser,
          delegation,
          backgroundJobs,
          shellHang,
          { sessionDir, conversation },
        ),
    }),
    config.userDataRoot,
  );
  const open =
    options.openPrompt ??
    ((visit, model) =>
      openPromptSession(visit, model, approvals, askUser, delegation, backgroundJobs, shellHang));
  chats = new VisitChats(
    open,
    approvals,
    askUser,
    delegation,
    {
      resolveVisit: (userId, agentId, kind) =>
        resolveWakeVisit(config.userDataRoot, userId, agentId, kind),
      resolveModel: (visit) => resolveVisitModelConfig(config.userDataRoot, visit),
    },
    shellHang,
  );
  // 监听前收尾：上次退出留下的 running 没有执行体，避免编排条一直转。
  delegation.recoverInterrupted();
  backgroundJobs.recoverInterrupted();
  const app = createLocalApp({
    config,
    chats,
    approvals,
    askUser,
    shellHang,
    delegation,
    groups,
    groupTurns,
    backgroundJobs,
    readModel,
  });
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
