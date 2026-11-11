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
import BrowserClickTool from "./browser/BrowserClickTool.vue";
import BrowserNavigateTool from "./browser/BrowserNavigateTool.vue";
import BrowserScreenshotTool from "./browser/BrowserScreenshotTool.vue";
import BrowserSnapshotTool from "./browser/BrowserSnapshotTool.vue";
import BrowserTool from "./browser/BrowserTool.vue";
import BrowserTypeTool from "./browser/BrowserTypeTool.vue";
import ShellHangDecideTool from "./shell/ShellHangDecideTool.vue";
import CheckDelegationTool from "./delegation/CheckDelegationTool.vue";
import DelegateToAgentTool from "./delegation/DelegateToAgentTool.vue";
import CompleteGroupTaskTool from "./delegation/CompleteGroupTaskTool.vue";
import DeliverTool from "./delegation/DeliverTool.vue";
import EditTool from "./files/EditTool.vue";
import FindTool from "./files/FindTool.vue";
import GenericTool from "./shared/GenericTool.vue";
import GrepTool from "./files/GrepTool.vue";
import LocalTimeTool from "./session/LocalTimeTool.vue";
import PresentArtifactsTool from "./session/PresentArtifactsTool.vue";
import PresentPreviewTool from "./session/PresentPreviewTool.vue";
import LsTool from "./files/LsTool.vue";
import McpResourceTool from "./mcp/McpResourceTool.vue";
import McpTool from "./mcp/McpTool.vue";
import ToolSearchTool from "./mcp/ToolSearchTool.vue";
import ReadTool from "./files/ReadTool.vue";
import ResolveDelegationTool from "./delegation/ResolveDelegationTool.vue";
import SteerDelegationTool from "./delegation/SteerDelegationTool.vue";
import TodoTool from "./session/TodoTool.vue";
import WebFetchTool from "./web/WebFetchTool.vue";
import WebSearchTool from "./web/WebSearchTool.vue";
import WriteTool from "./files/WriteTool.vue";
import { resolveBrowserToolName } from "./browser/browser-tool-view";
import { unwrapAgentUpMcpShell } from "./shared/tool-args";

const toolPart = useAuiState((s) => (s.part.type === "tool-call" ? s.part : null));

/** SDK MCP 名 `mcp__agentup__X` 与 API 裸名 `X` 走同一张专用卡。 */
function agentUpToolName(name: string): string {
  const prefix = "mcp__agentup__";
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

/** Playwright MCP `mcp__playwright__browser_*` 与裸名 `browser_*` 共用浏览器卡。 */
function browserToolComponent(toolName: string) {
  const browser = resolveBrowserToolName(toolName);
  if (!browser) return null;
  switch (browser) {
    case "browser_navigate":
      return BrowserNavigateTool;
    case "browser_click":
      return BrowserClickTool;
    case "browser_type":
    case "browser_fill":
    case "browser_fill_form":
      return BrowserTypeTool;
    case "browser_snapshot":
      return BrowserSnapshotTool;
    case "browser_take_screenshot":
      return BrowserScreenshotTool;
    default:
      return BrowserTool;
  }
}

const component = computed(() => {
  // Cursor 元工具 mcp 壳先解成 mcp__agentup__* / ask_user（与 runtime unwrap 对齐）
  const projected = unwrapAgentUpMcpShell(
    toolPart.value?.toolName ?? "",
    toolPart.value?.args ?? {},
  );
  const raw = projected.toolName;
  // Playwright 浏览器工具优先于通用 MCP 卡
  const browser = browserToolComponent(raw);
  if (browser) return browser;
  // 非 AgentUp 的第三方 MCP 仍用通用卡
  if (raw.startsWith("mcp__") && !raw.startsWith("mcp__agentup__")) return McpTool;
  const name = agentUpToolName(raw);
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
    case "shell_hang_decide":
      return ShellHangDecideTool;
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
    case "AskUserQuestion": // 外部 SDK 原名；与 Pi ask_user 同一张卡
      return AskUserTool;
    case "tool_search":
      return ToolSearchTool;
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
    case "complete_group_task":
      return CompleteGroupTaskTool;
    case "present_artifacts":
      return PresentArtifactsTool;
    case "present_preview":
      return PresentPreviewTool;
    case "todo":
    case "TaskCreate":
    case "TaskUpdate":
    case "TaskList":
    case "TaskGet":
    case "TodoWrite":
    case "todo_write":
    case "UpdateTodos":
      return TodoTool;
    case "skill_list":
    case "skill_load":
    case "skill_read":
      return GenericTool;
    case "list_mcp_resources":
    case "list_mcp_resource_templates":
    case "read_mcp_resource":
      return McpResourceTool;
    default:
      return raw.startsWith("mcp__") ? McpTool : GenericTool;
  }
});
</script>

<template>
  <component :is="component" />
</template>
