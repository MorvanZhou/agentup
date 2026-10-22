import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { readState } from "../src/local/user/state.js";
import { readProjectRoots } from "../src/session/workspace/project-roots.js";
import { ApprovalBroker, createApprovalExtension } from "../src/session/hitl/approval/index.js";

async function bindHandler(
  broker: ApprovalBroker,
  projectMount: {
    cwd: string;
    visitRoot: string;
    kind: "personal" | "agent";
    userDataRoot: string;
  },
) {
  let handler:
    | ((
        event: Record<string, unknown>,
        context: { signal?: AbortSignal; cwd?: string },
      ) => Promise<unknown>)
    | undefined;
  const extension = createApprovalExtension(broker, "patient-a", "coder", { projectMount });
  await extension({
    on(event: string, value: typeof handler) {
      if (event === "tool_call") handler = value;
      return vi.fn();
    },
  } as never);
  return handler!;
}

function seedVisit(dataRoot: string): {
  visitRoot: string;
  cwd: string;
  project: string;
} {
  const visitRoot = path.join(dataRoot, "users", "patient-a", "agents", "coder");
  const cwd = path.join(visitRoot, "cwd");
  fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  fs.writeFileSync(
    path.join(visitRoot, "instance.json"),
    `${JSON.stringify({ user_id: "patient-a", agent_id: "coder", project_trust: "granted" }, null, 2)}\n`,
  );
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-mount-proj-"));
  fs.writeFileSync(path.join(project, "main.ts"), "export {}\n");
  return { visitRoot, cwd, project };
}

it("asks to mount when read targets a path outside cwd, then persists project_roots", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-mount-hitl-"));
  const { visitRoot, cwd, project } = seedVisit(dataRoot);
  const broker = new ApprovalBroker(dataRoot);
  const handler = await bindHandler(broker, {
    cwd,
    visitRoot,
    kind: "agent",
    userDataRoot: dataRoot,
  });

  const seen = vi.fn();
  broker.subscribe((request) => {
    seen(request);
    expect(request.args.project_mount).toBe(true);
    expect(request.args.mount_path).toBe(fs.realpathSync(project));
    broker.decide(request.id, true, "once");
  });

  await expect(
    handler(
      {
        type: "tool_call",
        toolCallId: "read-out",
        toolName: "read",
        input: { path: path.join(project, "main.ts") },
      },
      { cwd },
    ),
  ).resolves.toBeUndefined();

  expect(seen).toHaveBeenCalledTimes(1);
  expect(readProjectRoots(visitRoot, "agent")).toEqual([fs.realpathSync(project)]);
});

it("denies project mount and blocks the tool call", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-mount-deny-"));
  const { visitRoot, cwd, project } = seedVisit(dataRoot);
  const broker = new ApprovalBroker(dataRoot);
  const handler = await bindHandler(broker, {
    cwd,
    visitRoot,
    kind: "agent",
    userDataRoot: dataRoot,
  });
  broker.subscribe((request) => broker.decide(request.id, false));

  await expect(
    handler(
      {
        type: "tool_call",
        toolCallId: "read-out",
        toolName: "read",
        input: { path: path.join(project, "main.ts") },
      },
      { cwd },
    ),
  ).resolves.toEqual({ block: true, reason: "用户拒绝了这次工具调用" });
  expect(readProjectRoots(visitRoot, "agent")).toEqual([]);
});

it("session pathMountAllow auto-mounts later outside paths without asking", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-mount-auto-"));
  const { visitRoot, cwd, project } = seedVisit(dataRoot);
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-mount-other-"));
  fs.writeFileSync(path.join(other, "b.ts"), "export {}\n");

  const broker = new ApprovalBroker(dataRoot);
  const handler = await bindHandler(broker, {
    cwd,
    visitRoot,
    kind: "agent",
    userDataRoot: dataRoot,
  });

  const seen = vi.fn();
  broker.subscribe((request) => {
    seen(request);
    broker.decide(request.id, true, "session");
  });

  await handler(
    {
      type: "tool_call",
      toolCallId: "read-1",
      toolName: "read",
      input: { path: path.join(project, "main.ts") },
    },
    { cwd },
  );
  expect(seen).toHaveBeenCalledTimes(1);
  expect(readState(dataRoot, "patient-a").pathMountAllow).toEqual({ coder: "session" });

  await expect(
    handler(
      {
        type: "tool_call",
        toolCallId: "read-2",
        toolName: "read",
        input: { path: path.join(other, "b.ts") },
      },
      { cwd },
    ),
  ).resolves.toBeUndefined();
  expect(seen).toHaveBeenCalledTimes(1);
  expect(readProjectRoots(visitRoot, "agent")).toEqual([
    fs.realpathSync(project),
    fs.realpathSync(other),
  ]);
});

it("does not ask for relative paths inside cwd", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-mount-in-"));
  const { visitRoot, cwd } = seedVisit(dataRoot);
  fs.writeFileSync(path.join(cwd, "note.txt"), "hi");
  const broker = new ApprovalBroker(dataRoot);
  const handler = await bindHandler(broker, {
    cwd,
    visitRoot,
    kind: "agent",
    userDataRoot: dataRoot,
  });
  const seen = vi.fn();
  broker.subscribe(seen);

  await expect(
    handler(
      { type: "tool_call", toolCallId: "read-in", toolName: "read", input: { path: "note.txt" } },
      { cwd },
    ),
  ).resolves.toBeUndefined();
  expect(seen).not.toHaveBeenCalled();
});
