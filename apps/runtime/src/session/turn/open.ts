import type { ModelConfig } from "../../config/load.js";
import type { Visit } from "../../package/sync.js";
import type { BackgroundJobs } from "../background/index.js";
import type { DelegationService } from "../delegation/index.js";
import type { ApprovalBroker } from "../hitl/approval/index.js";
import { openSession } from "../open.js";
import type { AskUserBroker } from "../tools/index.js";
import type { PromptSession } from "./types.js";

export async function openPromptSession(
  visit: Visit,
  model: ModelConfig,
  approvals?: ApprovalBroker,
  askUser?: AskUserBroker,
  delegation?: DelegationService,
  backgroundJobs?: BackgroundJobs,
): Promise<PromptSession> {
  const opened = await openSession(visit, model, approvals, askUser, delegation, backgroundJobs);
  return opened.session;
}
