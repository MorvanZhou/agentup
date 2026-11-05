import type { InjectionKey } from "vue";

import type { AgentCard } from "../../model/runtime/runtime";
import type { AgentProfileScene } from "./agent-profile";

export type OpenAgentProfileInput = {
  agent: AgentCard;
  scene?: AgentProfileScene;
};

export type AgentProfileHostApi = {
  open: (input: OpenAgentProfileInput) => void;
};

export const agentProfileHostKey = Symbol("agentProfileHost") as InjectionKey<AgentProfileHostApi>;
