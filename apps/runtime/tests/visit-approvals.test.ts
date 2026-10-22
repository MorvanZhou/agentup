import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import {
  readAgentApprovals,
  writeAgentApprovals,
} from "../src/local/approvals/visit-approvals.js";
import { setToolAllow } from "../src/local/user/state.js";
import { ApprovalBroker, createApprovalExtension } from "../src/session/hitl/approval/index.js";
import { vi } from "vitest";

it("reads and writes command / mcp server / delegation approvals", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-visit-approvals-"));
  const visitRoot = path.join(root, "users", "patient", "agents", "weather");
  const dir = path.join(visitRoot, "cwd", ".pi");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(visitRoot, "instance.json"),
    `${JSON.stringify({
      user_id: "patient",
      agent_id: "weather",
      package_version: 1,
      package_digest: "d",
      tools: [],
      model_capabilities: ["tools"],
      project_trust: "granted",
    })}\n`,
  );
  fs.writeFileSync(
    path.join(dir, "mcp.json"),
    `${JSON.stringify({ mcpServers: { hospital: { command: "npx", args: ["-y", "x"] } } }, null, 2)}\n`,
  );

  expect(readAgentApprovals(root, "patient", "weather")).toMatchObject({
    command: "once",
    delegation: { anyone: "once", targets: [] },
  });
  expect(readAgentApprovals(root, "patient", "weather").tools).toEqual([
    expect.objectContaining({ toolName: "mcp__hospital", kind: "mcp_server", scope: "once" }),
  ]);

  const saved = writeAgentApprovals(root, "patient", "weather", {
    command: "agent",
    tools: [{ toolName: "mcp__hospital", scope: "session" }],
    delegation: { anyone: "agent", targets: [{ agentId: "doctor", scope: "session" }] },
  });
  expect(saved.command).toBe("agent");
  expect(saved.tools.find((item) => item.toolName === "mcp__hospital")?.scope).toBe("session");
  expect(saved.delegation).toEqual({
    anyone: "agent",
    targets: [{ agentId: "doctor", scope: "session" }],
  });

  const cleared = writeAgentApprovals(root, "patient", "weather", {
    command: "once",
    tools: [{ toolName: "mcp__hospital", scope: "once" }],
    delegation: { anyone: "once", targets: [{ agentId: "doctor", scope: "once" }] },
  });
  expect(cleared.command).toBe("once");
  expect(cleared.tools.find((item) => item.toolName === "mcp__hospital")?.scope).toBe("once");
  expect(cleared.delegation).toEqual({ anyone: "once", targets: [] });
});

it("server-level mcp allow covers concrete tools", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-mcp-server-allow-"));
  setToolAllow(root, "patient", "weather", "mcp__hospital", "agent");
  const broker = new ApprovalBroker(root);
  let handler:
    | ((event: Record<string, unknown>, context: { signal?: AbortSignal }) => Promise<unknown>)
    | undefined;
  const extension = createApprovalExtension(broker, "patient", "weather");
  await extension({
    on(event: string, value: typeof handler) {
      if (event === "tool_call") handler = value;
      return vi.fn();
    },
  } as never);
  const seen = vi.fn();
  broker.subscribe(seen);
  await expect(
    handler!(
      {
        type: "tool_call",
        toolCallId: "1",
        toolName: "mcp__hospital__write",
        input: {},
      },
      { signal: undefined },
    ),
  ).resolves.toBeUndefined();
  expect(seen).not.toHaveBeenCalled();
});
