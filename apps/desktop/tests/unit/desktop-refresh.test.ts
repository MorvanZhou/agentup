import { expect, it, vi } from "vitest";

import {
  loadAgentsLocalFirst,
  localFirstAgentSnapshot,
  mergeAgentLists,
} from "../../src/app/desktop-refresh";
import type { AgentCard } from "../../src/shared/model/runtime/runtime";

function card(
  agentId: string,
  extras: Partial<AgentCard> = {},
): AgentCard {
  return {
    agentId,
    name: agentId,
    role: "",
    background: "",
    latestVersion: 1,
    latestDigest: "d",
    localVersion: 1,
    recruited: false,
    hasAvatar: false,
    remark: "",
    recruitCount: 0,
    createdAt: "",
    updatedAt: "",
    ...extras,
  };
}

it("merges extras after preferred without duplicating ids", () => {
  const local = [card("loc-1", { kind: "local" })];
  const remote = [
    card("loc-1", { kind: "local", name: "stale" }),
    card("mkt-1", { recruited: true }),
  ];
  expect(mergeAgentLists(local, remote)).toEqual([
    expect.objectContaining({ agentId: "loc-1", name: "loc-1" }),
    expect.objectContaining({ agentId: "mkt-1" }),
  ]);
});

it("local-first snapshot prefers disk projection over previous frame", () => {
  const local = [card("loc-1", { kind: "local" })];
  const projected = [card("mkt-1", { recruited: true, name: "disk" })];
  const previous = [card("mkt-1", { recruited: true, name: "old" }), card("mkt-2", { recruited: true })];
  expect(localFirstAgentSnapshot(local, projected, previous)).toEqual([
    expect.objectContaining({ agentId: "loc-1" }),
    expect.objectContaining({ agentId: "mkt-1", name: "disk" }),
    expect.objectContaining({ agentId: "mkt-2" }),
  ]);
});

it("commits local+projected before awaiting remote, and does not await avatar hydrate", async () => {
  const order: string[] = [];
  let agents: AgentCard[] = [];
  let personal: { name: string } | null = null;

  let releaseRemote!: (value: AgentCard[]) => void;
  const remoteGate = new Promise<AgentCard[]>((resolve) => {
    releaseRemote = resolve;
  });

  let releaseHydrate!: () => void;
  const hydrateGate = new Promise<void>((resolve) => {
    releaseHydrate = resolve;
  });

  const done = loadAgentsLocalFirst({
    hydrateAccountAvatar: async () => {
      order.push("hydrate-start");
      await hydrateGate;
      order.push("hydrate-done");
    },
    loadPersonalAssistant: async () => {
      order.push("pa");
      return { name: "助手" } as never;
    },
    loadLocalAgents: async () => {
      order.push("local");
      return [card("loc-1", { kind: "local" })];
    },
    loadProjectedAgents: async () => {
      order.push("projected");
      return [card("mkt-1", { recruited: true })];
    },
    loadRemoteAgents: async () => {
      order.push("remote-start");
      const remote = await remoteGate;
      order.push("remote-done");
      return remote;
    },
    isStale: () => false,
    readPreviousAgents: () => agents,
    commitPersonalAssistant: (profile) => {
      personal = profile ? { name: String((profile as { name?: string }).name ?? "") } : null;
      order.push("commit-pa");
    },
    commitAgents: (next) => {
      agents = next;
      order.push(`commit-agents:${next.map((item) => item.agentId).join(",")}`);
    },
  });

  await vi.waitFor(() => {
    expect(order).toContain("commit-agents:loc-1,mkt-1");
  });
  expect(personal).toEqual({ name: "助手" });
  expect(order).toContain("hydrate-start");
  expect(order).not.toContain("hydrate-done");
  expect(order).toContain("remote-start");
  expect(order).not.toContain("remote-done");

  releaseRemote([card("mkt-1", { recruited: true, name: "fresh" }), card("mkt-2", { recruited: true })]);
  releaseHydrate();
  const merged = await done;

  expect(merged.map((item) => item.agentId)).toEqual(["loc-1", "mkt-1", "mkt-2"]);
  expect(agents.find((item) => item.agentId === "mkt-1")?.name).toBe("fresh");
  expect(order.indexOf("commit-agents:loc-1,mkt-1")).toBeLessThan(order.indexOf("remote-done"));
  expect(order).toContain("hydrate-done");
});

it("keeps local-first snapshot when remote load fails", async () => {
  let agents: AgentCard[] = [card("mkt-old", { recruited: true })];
  const merged = await loadAgentsLocalFirst({
    loadPersonalAssistant: async () => null,
    loadLocalAgents: async () => [card("loc-1", { kind: "local" })],
    loadProjectedAgents: async () => [card("mkt-1", { recruited: true })],
    loadRemoteAgents: async () => {
      throw new Error("control plane down");
    },
    isStale: () => false,
    readPreviousAgents: () => agents,
    commitPersonalAssistant: () => undefined,
    commitAgents: (next) => {
      agents = next;
    },
  });
  expect(merged.map((item) => item.agentId)).toEqual(["loc-1", "mkt-1", "mkt-old"]);
  expect(agents.map((item) => item.agentId)).toEqual(["loc-1", "mkt-1", "mkt-old"]);
});
