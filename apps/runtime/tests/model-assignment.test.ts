import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { readStored } from "../src/config/provider/store.js";
import {
  setModelEnabled,
  touchActiveModel,
  upsertProviderConnection,
} from "../src/config/provider/index.js";
import { GroupStore } from "../src/session/group/index.js";
import {
  planGroupSpeakerModel,
  readVisitModelMode,
  resolveDelegationModelConfig,
  writeVisitModelMode,
} from "../src/session/model/assignment.js";
import { setVisitSessionModel } from "../src/session/model/session-model.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentup-model-mode-"));
}

function seedProvider(root: string): void {
  upsertProviderConnection(root, {
    templateId: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    customModelId: "model-a",
  });
  upsertProviderConnection(root, {
    templateId: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    customModelId: "model-b",
  });
  setModelEnabled(root, { templateId: "ollama", modelId: "model-a" }, true);
  setModelEnabled(root, { templateId: "ollama", modelId: "model-b" }, true);
}

it("defaults a conversation to unified and keeps a saved per-agent mode", () => {
  const root = tmpRoot();
  const sessionDir = path.join(root, "sessions");
  expect(readVisitModelMode(sessionDir)).toBe("unified");
  writeVisitModelMode(sessionDir, "perAgent");
  expect(readVisitModelMode(sessionDir)).toBe("perAgent");
  expect(readStored(root).activeModel).toBeNull();
});

it("uses the snapshotted model for a unified task and the delegatee's own model for per-agent", () => {
  const root = tmpRoot();
  seedProvider(root);
  touchActiveModel(root, { templateId: "ollama", modelId: "model-a" });

  const delegateeRoot = path.join(root, "users", "u1", "agents", "bob");
  const cwd = path.join(delegateeRoot, "cwd");
  const sessionDir = path.join(delegateeRoot, "sessions");
  setVisitSessionModel(root, cwd, sessionDir, { templateId: "ollama", modelId: "model-b" });
  // setVisitSessionModel 会把设备最近使用改成 B；拨回 A，确认解析不再改它。
  touchActiveModel(root, { templateId: "ollama", modelId: "model-a" });

  const visit = {
    kind: "recruited" as const,
    userId: "u1",
    agentId: "bob",
    root: delegateeRoot,
    packageVersion: 1,
    packageDigest: "d",
    tools: [],
    modelCapabilities: [],
    projectTrust: "trusted",
  };

  const unified = resolveDelegationModelConfig(
    root,
    { modelPin: { mode: "unified", templateId: "ollama", modelId: "model-a" } },
    visit,
  );
  expect(unified.modelId).toBe("model-a");

  const own = resolveDelegationModelConfig(root, { modelPin: { mode: "perAgent" } }, visit);
  expect(own.modelId).toBe("model-b");
  expect(readStored(root).activeModel).toEqual({ templateId: "ollama", modelId: "model-a" });
});

it("keeps an existing group on unified until the room switches to per-agent", () => {
  const root = tmpRoot();
  const store = new GroupStore(root);
  const created = store.create({
    userId: "u1",
    title: "组",
    members: [
      { agentId: "pm", name: "产品" },
      { agentId: "dev", name: "开发" },
    ],
  });
  expect(created.modelMode).toBe("unified");

  const file = path.join(root, "users", "u1", ".runtime", "groups", `${created.id}.json`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  delete raw.modelMode;
  fs.writeFileSync(file, JSON.stringify(raw));
  expect(new GroupStore(root).get("u1", created.id).modelMode).toBe("unified");

  expect(store.setModelMode("u1", created.id, "perAgent").modelMode).toBe("perAgent");
  expect(new GroupStore(root).get("u1", created.id).modelMode).toBe("perAgent");
});

it("keeps a unified group's model on the room, and leaves per-agent turns on the speaker", () => {
  const root = tmpRoot();
  seedProvider(root);
  const room = { templateId: "ollama", modelId: "model-a" };
  const speaker = { templateId: "ollama", modelId: "model-b" };

  expect(
    planGroupSpeakerModel(root, { mode: "unified", roomModel: room, speaker }),
  ).toEqual({ kind: "room", ref: room, persist: false });

  expect(
    planGroupSpeakerModel(root, { mode: "unified", roomModel: null, speaker }),
  ).toEqual({ kind: "room", ref: speaker, persist: true });

  expect(
    planGroupSpeakerModel(root, { mode: "perAgent", roomModel: room, speaker }),
  ).toEqual({ kind: "visit" });

  const before = readStored(root).activeModel;
  const store = new GroupStore(root);
  const created = store.create({
    userId: "u1",
    title: "组",
    members: [
      { agentId: "pm", name: "产品" },
      { agentId: "dev", name: "开发" },
    ],
  });
  expect(created.model).toBeNull();
  expect(store.setModel("u1", created.id, room).model).toEqual(room);
  expect(store.setModelMode("u1", created.id, "perAgent").model).toEqual(room);
  expect(readStored(root).activeModel).toEqual(before);
});
