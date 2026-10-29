import { expect, it, vi } from "vitest";

import { PERSONAL_ASSISTANT_ID } from "../src/local/assistant/personal-assistant.js";
import type { DelegationService } from "../src/session/delegation/service/index.js";
import { createDelegateExtension } from "../src/session/tools/delegate.js";

/**
 * agent_search 只做提示词约束（协作契约 + 每轮注入），不再有工具级硬拦截：
 * 私人助理未搜索前调用 bash / write / ask_user 不应被 block。
 */
function collectToolHook(extension: ReturnType<typeof createDelegateExtension>) {
  let onTool:
    | ((event: { toolName: string; toolCallId: string; input: Record<string, unknown> }) => Promise<unknown>)
    | undefined;
  extension({
    on(event: string, handler: unknown) {
      if (event === "tool_call") onTool = handler as typeof onTool;
    },
    registerTool() {
      return undefined;
    },
  } as never);
  return (toolName: string) => onTool?.({ toolName, toolCallId: "t1", input: {} });
}

it("personal assistant work tools are not hard-blocked before agent_search", async () => {
  const service = {
    listRecruited: vi.fn(async () => [
      { agentId: "cody", name: "Cody", role: "实现", background: "", remark: "" },
    ]),
    delegationDispositionArmed: () => false,
  } as unknown as DelegationService;
  const call = collectToolHook(createDelegateExtension(service, "patient", PERSONAL_ASSISTANT_ID));

  for (const toolName of ["ask_user", "write", "edit", "bash", "powershell", "bg_run", "read"]) {
    expect(await call(toolName)).toBeUndefined();
  }
  // agent_search 本身也不需要任何前置状态。
  expect(await call("agent_search")).toBeUndefined();
});

it("group holder work tools are not blocked either", async () => {
  const service = {
    listRecruited: vi.fn(async () => [
      { agentId: "cody", name: "Cody", role: "实现", background: "", remark: "" },
    ]),
    delegationDispositionArmed: () => false,
  } as unknown as DelegationService;
  const call = collectToolHook(
    createDelegateExtension(service, "patient", PERSONAL_ASSISTANT_ID, { groupId: "g1" }),
  );

  expect(await call("bash")).toBeUndefined();
  expect(await call("ask_user")).toBeUndefined();
});
