import type { ExternalDriver, ExternalDriverCapabilities } from "../../contract.js";

const CAPABILITIES: ExternalDriverCapabilities = {
  driverId: "claude-code",
  systemPromptMode: "append",
  askUserToolNames: ["AskUserQuestion"],
};

function notImplemented(): never {
  throw new Error("Claude Code adaptor 尚未接入（.cursor/skills/agentup-sdk-adapter/references）");
}

export const claudeCodeDriver: ExternalDriver = {
  capabilities: CAPABILITIES,
  login: async () => notImplemented(),
  logout: async () => notImplemented(),
  probeReady: async () => notImplemented(),
  listModels: async () => notImplemented(),
  startTurn: async () => notImplemented(),
};
