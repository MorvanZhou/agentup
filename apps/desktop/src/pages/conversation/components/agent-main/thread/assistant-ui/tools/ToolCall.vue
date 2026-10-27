<script setup lang="ts">
import { computed } from "vue";
import { useAuiState } from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";

import AgentSearchTool from "./delegation/AgentSearchTool.vue";
import AskUserTool from "./session/AskUserTool.vue";
import BashTool from "./shell/BashTool.vue";
import BgKillTool from "./shell/BgKillTool.vue";
import BgRunTool from "./shell/BgRunTool.vue";
import BgStatusTool from "./shell/BgStatusTool.vue";
import CheckDelegationTool from "./delegation/CheckDelegationTool.vue";
import DelegateToAgentTool from "./delegation/DelegateToAgentTool.vue";
import DeliverTool from "./delegation/DeliverTool.vue";
import EditTool from "./files/EditTool.vue";
import FindTool from "./files/FindTool.vue";
import GenericTool from "./shared/GenericTool.vue";
import GrepTool from "./files/GrepTool.vue";
import LocalTimeTool from "./session/LocalTimeTool.vue";
import LsTool from "./files/LsTool.vue";
import McpResourceTool from "./mcp/McpResourceTool.vue";
import McpTool from "./mcp/McpTool.vue";
import ReadTool from "./files/ReadTool.vue";
import ResolveDelegationTool from "./delegation/ResolveDelegationTool.vue";
import SteerDelegationTool from "./delegation/SteerDelegationTool.vue";
import TodoTool from "./session/TodoTool.vue";
import WebFetchTool from "./web/WebFetchTool.vue";
import WebSearchTool from "./web/WebSearchTool.vue";
import WriteTool from "./files/WriteTool.vue";

const toolName = useAuiState((s) =>
  s.part.type === "tool-call" ? s.part.toolName : "",
);

const component = computed(() => {
  const name = toolName.value;
  if (name.startsWith("mcp__")) return McpTool;
  switch (name) {
    case "read":
      return ReadTool;
    case "write":
      return WriteTool;
    case "edit":
      return EditTool;
    case "bash":
    case "powershell":
      return BashTool;
    case "bg_run":
      return BgRunTool;
    case "bg_status":
      return BgStatusTool;
    case "bg_kill":
      return BgKillTool;
    case "grep":
      return GrepTool;
    case "find":
      return FindTool;
    case "ls":
      return LsTool;
    case "get_local_time":
      return LocalTimeTool;
    case "web_search":
      return WebSearchTool;
    case "web_fetch":
      return WebFetchTool;
    case "ask_user":
      return AskUserTool;
    case "tool_search":
      return GenericTool;
    case "agent_search":
      return AgentSearchTool;
    case "delegate_to_agent":
      return DelegateToAgentTool;
    case "check_delegation":
      return CheckDelegationTool;
    case "steer_delegation":
      return SteerDelegationTool;
    case "resolve_delegation_update":
      return ResolveDelegationTool;
    case "deliver_artifacts":
      return DeliverTool;
    case "todo":
      return TodoTool;
    case "list_mcp_resources":
    case "list_mcp_resource_templates":
    case "read_mcp_resource":
      return McpResourceTool;
    default:
      return GenericTool;
  }
});
</script>

<template>
  <component :is="component" />
</template>
