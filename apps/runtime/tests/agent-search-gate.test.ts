import { expect, it, vi } from "vitest";

import { PERSONAL_ASSISTANT_ID } from "../src/local/assistant/personal-assistant.js";
import { agentSearchGate } from "../src/session/delegation/search-gate.js";
import type { DelegationService } from "../src/session/delegation/service/index.js";
import { AGENT_SEARCH_TOOL, createDelegateExtension } from "../src/session/tools/delegate.js";

const enforced = { enforce: true, hasOtherAgents: true, searched: false };

it("blocks assistant work tools until agent_search has run", () => {
  for (const toolName of ["ask_user", "write", "edit", "bash", "powershell", "bg_run"]) {
    expect(agentSearchGate({ ...enforced, toolName })?.block).toBe(true);
  }
  expect(agentSearchGate({ ...enforced, toolName: "ask_user" })?.reason).toContain("agent_search");
});

it("allows agent_search, delegation tools, and work after a search", () => {
  expect(agentSearchGate({ ...enforced, toolName: "agent_search" })).toBeUndefined();
  expect(agentSearchGate({ ...enforced, toolName: "check_delegation" })).toBeUndefined();
  expect(agentSearchGate({ ...enforced, toolName: "read" })).toBeUndefined();
  expect(agentSearchGate({ ...enforced, searched: true, toolName: "write" })).toBeUndefined();
});

it("does not gate specialists or an empty roster", () => {
  expect(agentSearchGate({ ...enforced, enforce: false, toolName: "write" })).toBeUndefined();
  expect(agentSearchGate({ ...enforced, hasOtherAgents: false, toolName: "bash" })).toBeUndefined();
});

it("personal-assistant tool hook blocks ask_user until agent_search", async () => {
  const service = {
    listRecruited: vi.fn(async () => [
      { agentId: "cody", name: "Cody", role: "实现", background: "", remark: "" },
    ]),
    delegationDispositionArmed: () => false,
  } as unknown as DelegationService;
  let onTool:
    | ((event: { toolName: string; toolCallId: string; input: Record<string, unknown> }) => Promise<unknown>)
    | undefined;
  let onStart: (() => void) | undefined;
  const extension = createDelegateExtension(service, "patient", PERSONAL_ASSISTANT_ID);
  extension({
    on(event: string, handler: unknown) {
      if (event === "tool_call") onTool = handler as typeof onTool;
      if (event === "agent_start") onStart = handler as typeof onStart;
    },
    registerTool() {
      return undefined;
    },
  } as never);

  onStart?.();
  const blocked = await onTool?.({ toolName: "ask_user", toolCallId: "q1", input: {} });
  expect(blocked).toMatchObject({ block: true });
  await onTool?.({ toolName: "agent_search", toolCallId: "s1", input: { query: "实现" } });
  expect(await onTool?.({ toolName: "write", toolCallId: "w1", input: {} })).toBeUndefined();

  onStart?.();
  expect(await onTool?.({ toolName: "bash", toolCallId: "b1", input: {} })).toMatchObject({ block: true });
});

it("does not register agent_search or gate work tools in a group", async () => {
  const names: string[] = [];
  let onTool:
    | ((event: { toolName: string; toolCallId: string; input: Record<string, unknown> }) => Promise<unknown>)
    | undefined;
  createDelegateExtension(
    {
      listRecruited: vi.fn(async () => [
        { agentId: "cody", name: "Cody", role: "实现", background: "", remark: "" },
      ]),
      delegationDispositionArmed: () => false,
    } as unknown as DelegationService,
    "patient",
    PERSONAL_ASSISTANT_ID,
    { groupId: "g1" },
  )({
    on(event: string, handler: unknown) {
      if (event === "tool_call") onTool = handler as typeof onTool;
    },
    registerTool(tool: { name: string }) {
      names.push(tool.name);
    },
  } as never);

  expect(names).not.toContain(AGENT_SEARCH_TOOL);
  expect(names).toContain("delegate_to_agent");
  expect(await onTool?.({ toolName: "ask_user", toolCallId: "q1", input: {} })).toBeUndefined();
  expect(await onTool?.({ toolName: "write", toolCallId: "w1", input: {} })).toBeUndefined();
});
