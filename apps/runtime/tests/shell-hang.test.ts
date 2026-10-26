import { afterEach, expect, it, vi } from "vitest";

import {
  createShellHangExtension,
  ShellHangBroker,
} from "../src/session/hitl/shell-hang/index.js";

type Handler = (event: Record<string, unknown>, ctx: { abort: () => void }) => void;

async function bindHangHandlers(
  broker: ShellHangBroker,
  thresholdMs = 50,
): Promise<{ start: Handler; end: Handler }> {
  let start: Handler | undefined;
  let end: Handler | undefined;
  const extension = createShellHangExtension(broker, "user-a", "agent-a", { thresholdMs });
  await extension({
    on(event: string, handler: Handler) {
      if (event === "tool_execution_start") start = handler;
      if (event === "tool_execution_end") end = handler;
      return vi.fn();
    },
  } as never);
  return { start: start!, end: end! };
}

afterEach(() => {
  vi.useRealTimers();
});

it("asks after threshold and kill aborts the turn", async () => {
  vi.useFakeTimers();
  const broker = new ShellHangBroker();
  const { start, end } = await bindHangHandlers(broker, 40);
  const abort = vi.fn();
  const seen = vi.fn();
  broker.subscribe(seen);

  start(
    {
      type: "tool_execution_start",
      toolCallId: "bash-1",
      toolName: "bash",
      args: { command: "node WORK/t_visits.js" },
    },
    { abort },
  );

  expect(seen).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(40);
  expect(seen).toHaveBeenCalledWith(
    expect.objectContaining({
      toolCallId: "bash-1",
      toolName: "bash",
      command: "node WORK/t_visits.js",
    }),
  );

  const pending = broker.listPending("user-a");
  expect(pending).toHaveLength(1);
  expect(broker.decide(pending[0]!.id, "kill")).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(abort).toHaveBeenCalledTimes(1);

  end(
    { type: "tool_execution_end", toolCallId: "bash-1", toolName: "bash", result: {}, isError: true },
    { abort },
  );
  expect(broker.listPending("user-a")).toHaveLength(0);
});

it("wait re-arms another prompt while command still runs", async () => {
  vi.useFakeTimers();
  const broker = new ShellHangBroker();
  const { start, end } = await bindHangHandlers(broker, 30);
  const abort = vi.fn();
  const seen = vi.fn();
  broker.subscribe(seen);

  start(
    {
      type: "tool_execution_start",
      toolCallId: "bash-2",
      toolName: "bash",
      args: { command: "sleep 999" },
    },
    { abort },
  );

  await vi.advanceTimersByTimeAsync(30);
  expect(seen).toHaveBeenCalledTimes(1);
  broker.decide(broker.listPending("user-a")[0]!.id, "wait");
  await vi.advanceTimersByTimeAsync(0);
  expect(abort).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(30);
  expect(seen).toHaveBeenCalledTimes(2);
  expect(broker.listPending("user-a")).toHaveLength(1);

  end(
    { type: "tool_execution_end", toolCallId: "bash-2", toolName: "bash", result: {}, isError: false },
    { abort },
  );
  expect(broker.listPending("user-a")).toHaveLength(0);
});

it("ignores non-shell tools and cancels prompt when bash ends early", async () => {
  vi.useFakeTimers();
  const broker = new ShellHangBroker();
  const { start, end } = await bindHangHandlers(broker, 80);
  const seen = vi.fn();
  broker.subscribe(seen);

  start(
    { type: "tool_execution_start", toolCallId: "read-1", toolName: "read", args: { path: "a" } },
    { abort: vi.fn() },
  );
  await vi.advanceTimersByTimeAsync(80);
  expect(seen).not.toHaveBeenCalled();

  start(
    {
      type: "tool_execution_start",
      toolCallId: "bash-3",
      toolName: "bash",
      args: { command: "ls" },
    },
    { abort: vi.fn() },
  );
  await vi.advanceTimersByTimeAsync(40);
  end(
    { type: "tool_execution_end", toolCallId: "bash-3", toolName: "bash", result: "ok", isError: false },
    { abort: vi.fn() },
  );
  await vi.advanceTimersByTimeAsync(80);
  expect(seen).not.toHaveBeenCalled();
  expect(broker.listPending("user-a")).toHaveLength(0);
});
