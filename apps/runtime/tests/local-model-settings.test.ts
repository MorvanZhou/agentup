import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { startLocalServer } from "../src/local/server.js";

it("reads and saves provider settings through the loopback API", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-provider-api-"));
  const local = await startLocalServer({
    backendUrl: "http://127.0.0.1:9",
    userDataRoot: root,
    host: "127.0.0.1",
    port: 0,
  });
  const request = (method: string, pathname: string, body?: unknown, token = "token") =>
    fetch(`${local.url}${pathname}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    expect((await request("GET", "/settings/provider", undefined, "")).status).toBe(401);
    const empty = await (await request("GET", "/settings/provider")).json();
    expect(empty).toMatchObject({ active_model: null, configured: false });
    expect(Array.isArray(empty.templates)).toBe(true);
    expect(Array.isArray(empty.vendors)).toBe(true);
    expect(empty.templates.some((item: { id: string }) => item.id === "deepseek")).toBe(true);

    const saved = await request("POST", "/settings/provider/connections", {
      template_id: "ollama",
      base_url: "http://127.0.0.1:11434/v1/",
      custom_model_id: "qwen3:0.6b",
    });
    expect(saved.status).toBe(200);
    const savedBody = await saved.json();
    expect(savedBody).toMatchObject({
      configured: true,
      active_model: { template_id: "ollama", model_id: "qwen3:0.6b" },
      connections: [{ template_id: "ollama", base_url: "http://127.0.0.1:11434/v1" }],
    });
    expect(savedBody.enabled_models).toEqual(
      expect.arrayContaining([{ template_id: "ollama", model_id: "qwen3:0.6b" }]),
    );

    const secrets = await request("PUT", "/settings/provider/runtime-secrets", {
      secrets: { ollama: "unused-for-ollama" },
    });
    expect(secrets.status).toBe(200);

    const enabled = await request("POST", "/settings/provider/models/enabled", {
      template_id: "ollama",
      model_id: "qwen3:0.6b",
      enabled: false,
    });
    expect(enabled.status).toBe(200);
    expect((await enabled.json()).active_model).toBeNull();

    const reenabled = await request("POST", "/settings/provider/models/enabled", {
      template_id: "ollama",
      model_id: "qwen3:0.6b",
      enabled: true,
    });
    expect(reenabled.status).toBe(200);

    const activated = await request("POST", "/settings/provider/models/active", {
      template_id: "ollama",
      model_id: "qwen3:0.6b",
    });
    expect(activated.status).toBe(200);
    expect(await activated.json()).toMatchObject({
      active_model: { template_id: "ollama", model_id: "qwen3:0.6b" },
    });

    const deleted = await request("DELETE", "/settings/provider/connections/ollama");
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ configured: false, active_model: null, connections: [] });

    expect(
      (
        await request("POST", "/settings/provider/connections", {
          template_id: "ollama",
          base_url: "file:///tmp/model",
        })
      ).status,
    ).toBe(400);

    const connected = await request("POST", "/settings/provider/connections", {
      template_id: "ollama",
      base_url: "http://127.0.0.1:11434/v1",
    });
    expect(connected.status).toBe(200);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("127.0.0.1:11434") || url.includes("localhost:11434")) {
        return Response.json({
          data: [{ id: "qwen3:4b" }],
          models: [{ name: "qwen3:4b" }],
        });
      }
      return originalFetch(input as never, init as never);
    }) as typeof fetch;
    try {
      const refreshed = await request("POST", "/settings/provider/connections/ollama/refresh-models", {});
      expect(refreshed.status).toBe(200);
      const body = await refreshed.json();
      expect(body.connections[0].discovered_model_ids).toEqual(["qwen3:4b"]);
      expect(body.available_models.some((m: { model_id: string }) => m.model_id === "qwen3:4b")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    await local.close();
  }
});
