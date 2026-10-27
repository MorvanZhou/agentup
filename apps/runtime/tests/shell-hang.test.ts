import { spawn } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";

import { ShellHangBroker } from "../src/session/hitl/shell-hang/broker.js";
import { formatIdleToolResult } from "../src/session/hitl/shell-hang/decide-tool.js";
import {
  createIdleAwareShellOperations,
  SHELL_HANG_IDLE_EXIT,
} from "../src/session/hitl/shell-hang/operations.js";

afterEach(() => {
  vi.useRealTimers();
});

it("parks on idle and returns exit 124 without killing the child", async () => {
  const broker = new ShellHangBroker();
  broker.setHumanEscalateMs(60_000);

  const ops = createIdleAwareShellOperations({
    shell: "bash",
    idleMs: 80,
    onIdlePark: ({ child, command, cwd, startedAt }) => {
      const hang = broker.park({
        userId: "u",
        agentId: "a",
        toolCallId: "bash-1",
        toolName: "bash",
        command,
        cwd,
        child,
        startedAt,
      });
      return hang.id;
    },
  });

  const chunks: Buffer[] = [];
  const result = await ops.exec(
    `${JSON.stringify(process.execPath)} -e ${JSON.stringify("setInterval(() => {}, 1000); console.log('ready')")}`,
    process.cwd(),
    {
      onData: (b) => chunks.push(b),
      signal: undefined,
    },
  );

  expect(Buffer.concat(chunks).toString()).toContain("ready");
  expect(result.exitCode).toBe(SHELL_HANG_IDLE_EXIT);

  const parked = broker.getParkedByToolCall("bash-1");
  expect(parked).toBeTruthy();
  expect(parked!.pid).toBeGreaterThan(0);
  expect(() => process.kill(parked!.pid, 0)).not.toThrow();

  expect(broker.decide(parked!.id, "kill")).toBe(true);
  expect(broker.getParked(parked!.id)).toBeUndefined();
});

it("agent wait can finish when the process exits", async () => {
  const broker = new ShellHangBroker();
  const child = spawn(
    process.execPath,
    ["-e", "setTimeout(() => { console.log('done'); process.exit(0); }, 80)"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const hang = broker.park({
    userId: "u",
    agentId: "a",
    toolCallId: "bash-2",
    toolName: "bash",
    command: "short",
    cwd: process.cwd(),
    child,
    startedAt: Date.now(),
  });

  const result = await broker.waitMore(hang.id, 5_000);
  expect(result.kind).toBe("exited");
  if (result.kind === "exited") {
    expect(result.exitCode).toBe(0);
    expect(result.outputTail).toContain("done");
  }
});

it("human escalate fires after park when agent does not decide", async () => {
  const broker = new ShellHangBroker();
  broker.setHumanEscalateMs(40);
  const seen = vi.fn();
  broker.subscribe(seen);

  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const hang = broker.park({
    userId: "u",
    agentId: "a",
    toolCallId: "bash-3",
    toolName: "bash",
    command: "hang",
    cwd: process.cwd(),
    child,
    startedAt: Date.now(),
  });

  expect(seen).not.toHaveBeenCalled();
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(seen).toHaveBeenCalledWith(
    expect.objectContaining({ id: hang.id, toolCallId: "bash-3" }),
  );
  expect(broker.listPending("u")).toHaveLength(1);

  expect(broker.decide(hang.id, "kill")).toBe(true);
  expect(broker.listPending("u")).toHaveLength(0);
});

it("formatIdleToolResult tells the model to call shell_hang_decide", () => {
  const text = formatIdleToolResult(
    {
      id: "hang-1",
      command: "node maze.js",
      outputTail: "ok\n",
      waitCount: 0,
    },
    "ok\n\nCommand exited with code 124",
  );
  expect(text).toContain("hang_id: hang-1");
  expect(text).toContain("shell_hang_decide");
  expect(text).toContain("kill|wait|bg");
  expect(text).not.toMatch(/Command exited with code 124\s*$/);
});
