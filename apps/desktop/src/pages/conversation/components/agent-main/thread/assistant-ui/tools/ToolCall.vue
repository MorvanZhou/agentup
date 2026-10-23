<script setup lang="ts">
import { computed } from "vue";
import { useAuiState } from "@assistant-ui/vue";
import type {} from "@assistant-ui/core/store";

import AskUserTool from "./AskUserTool.vue";
import BashTool from "./BashTool.vue";
import BgRunTool from "./BgRunTool.vue";
import DelegateTool from "./DelegateTool.vue";
import EditTool from "./EditTool.vue";
import FindTool from "./FindTool.vue";
import GenericTool from "./GenericTool.vue";
import GrepTool from "./GrepTool.vue";
import LocalTimeTool from "./LocalTimeTool.vue";
import LsTool from "./LsTool.vue";
import McpResourceTool from "./McpResourceTool.vue";
import McpTool from "./McpTool.vue";
import ReadTool from "./ReadTool.vue";
import TodoTool from "./TodoTool.vue";
import WebFetchTool from "./WebFetchTool.vue";
import WebSearchTool from "./WebSearchTool.vue";
import WriteTool from "./WriteTool.vue";

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
    case "bg_status":
    case "bg_kill":
      return BgRunTool;
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
    case "delegate_to_agent":
    case "check_delegation":
      return DelegateTool;
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
