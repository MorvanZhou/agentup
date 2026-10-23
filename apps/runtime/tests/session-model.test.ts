import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import {
  deleteProviderConnection,
  setModelEnabled,
  upsertProviderConnection,
} from "../src/config/provider.js";
import { clearContext } from "../src/session/history/history.js";
import {
  peekVisitModelRef,
  readSessionModelRef,
  resolveVisitModelRef,
  setVisitSessionModel,
  stampNewSessionModel,
  writeSessionModelRef,
} from "../src/session/model/session-model.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentup-session-model-"));
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

it("inherits previous session model when starting a new conversation", () => {
  const root = tmpRoot();
  seedProvider(root);
  const userId = "guest";
  const agentId = "agent-1";
  const visitRoot = path.join(root, "users", userId, "agents", agentId);
  const cwd = path.join(visitRoot, "cwd");
  const sessionDir = path.join(visitRoot, "sessions");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });

  const first = path.join(sessionDir, "20240101_000000_aaaa.jsonl");
  fs.writeFileSync(first, "");
  writeSessionModelRef(first, { templateId: "ollama", modelId: "model-b" });

  clearContext(root, userId, agentId);

  const files = fs.readdirSync(sessionDir).filter((name) => name.endsWith(".jsonl"));
  expect(files.length).toBe(2);
  const newest = files
    .map((name) => path.join(sessionDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]!;
  expect(readSessionModelRef(newest)).toEqual({ templateId: "ollama", modelId: "model-b" });
  expect(peekVisitModelRef(root, sessionDir)).toEqual({ templateId: "ollama", modelId: "model-b" });
});

it("falls back to first enabled when no session model exists", () => {
  const root = tmpRoot();
  seedProvider(root);
  const cwd = path.join(root, "cwd");
  const sessionDir = path.join(root, "sessions");
  fs.mkdirSync(sessionDir, { recursive: true });
  expect(peekVisitModelRef(root, sessionDir)).toEqual({
    templateId: "ollama",
    modelId: "model-a",
  });
  const resolved = resolveVisitModelRef(root, cwd, sessionDir);
  expect(resolved.ref).toEqual({ templateId: "ollama", modelId: "model-a" });
});

it("setVisitSessionModel writes sidecar for the current session", () => {
  const root = tmpRoot();
  seedProvider(root);
  const cwd = path.join(root, "cwd");
  const sessionDir = path.join(root, "sessions");
  setVisitSessionModel(root, cwd, sessionDir, { templateId: "ollama", modelId: "model-b" });
  expect(peekVisitModelRef(root, sessionDir)).toEqual({
    templateId: "ollama",
    modelId: "model-b",
  });
});

it("skips stale sidecar after provider is deleted and falls back to enabled model", () => {
  const root = tmpRoot();
  upsertProviderConnection(root, {
    templateId: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    customModelId: "keep-me",
  });
  setModelEnabled(root, { templateId: "ollama", modelId: "keep-me" }, true);
  // deepseek 内置目录任意模型；只测连接级失效
  const deepseek = upsertProviderConnection(root, {
    templateId: "deepseek",
    apiKeyCipher: "cipher-test",
  });
  const gone = deepseek.availableModels.find((m) => m.templateId === "deepseek");
  expect(gone).toBeTruthy();
  setModelEnabled(root, { templateId: "deepseek", modelId: gone!.modelId }, true);

  const cwd = path.join(root, "cwd");
  const sessionDir = path.join(root, "sessions");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  const sessionFile = path.join(sessionDir, "20240101_000000_aaaa.jsonl");
  fs.writeFileSync(sessionFile, "");
  writeSessionModelRef(sessionFile, { templateId: "deepseek", modelId: gone!.modelId });

  expect(peekVisitModelRef(root, sessionDir)).toEqual({
    templateId: "deepseek",
    modelId: gone!.modelId,
  });

  deleteProviderConnection(root, "deepseek");

  expect(peekVisitModelRef(root, sessionDir)).toEqual({
    templateId: "ollama",
    modelId: "keep-me",
  });
  const resolved = resolveVisitModelRef(root, cwd, sessionDir);
  expect(resolved.ref).toEqual({ templateId: "ollama", modelId: "keep-me" });
  expect(readSessionModelRef(sessionFile)).toEqual({
    templateId: "ollama",
    modelId: "keep-me",
  });
});

it("stampNewSessionModel skips deleted provider when inheriting", () => {
  const root = tmpRoot();
  upsertProviderConnection(root, {
    templateId: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    customModelId: "keep-me",
  });
  setModelEnabled(root, { templateId: "ollama", modelId: "keep-me" }, true);
  const deepseek = upsertProviderConnection(root, {
    templateId: "deepseek",
    apiKeyCipher: "cipher-test",
  });
  const gone = deepseek.availableModels.find((m) => m.templateId === "deepseek");
  expect(gone).toBeTruthy();
  setModelEnabled(root, { templateId: "deepseek", modelId: gone!.modelId }, true);

  const cwd = path.join(root, "cwd");
  const sessionDir = path.join(root, "sessions");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  const older = path.join(sessionDir, "20240101_000000_aaaa.jsonl");
  fs.writeFileSync(older, "");
  writeSessionModelRef(older, { templateId: "deepseek", modelId: gone!.modelId });

  deleteProviderConnection(root, "deepseek");

  const newer = path.join(sessionDir, "20240101_000001_bbbb.jsonl");
  fs.writeFileSync(newer, "");
  // mtime：newer 更新
  const later = Date.now() + 1000;
  fs.utimesSync(newer, later / 1000, later / 1000);

  stampNewSessionModel(root, cwd, sessionDir);
  expect(readSessionModelRef(newer)).toEqual({
    templateId: "ollama",
    modelId: "keep-me",
  });
});
