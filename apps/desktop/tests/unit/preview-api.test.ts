import { expect, it, vi } from "vitest";

import { RuntimeHttp } from "../../src/shared/api/runtime/http.js";
import {
  startPreviewRecipe,
  stopPreviewRecipe,
} from "../../src/shared/api/runtime/preview.js";

it("群预览 start 把 user_id/agent_id 放在 JSON body，而不是包在 { method, body }", async () => {
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    expect(body).toEqual({ user_id: "u1", agent_id: "holder-1" });
    expect(body.method).toBeUndefined();
    return new Response(JSON.stringify({ recipe: { id: "web", title: "Dev", command: "npm run dev", cwd: ".", preview_url: "http://127.0.0.1:5173" }, jobId: "j1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const http = new RuntimeHttp("/runtime", fetchImpl);
  const result = await startPreviewRecipe(http, "tok", "u1", "group:g1", false, "web", "holder-1");
  expect(result.status).toBe("started");
  expect(fetchImpl).toHaveBeenCalledOnce();
});

it("start 带 force 并解析 conflict 响应", async () => {
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    expect(body.force).toBe(true);
    return new Response(
      JSON.stringify({
        status: "conflict",
        pid: 4242,
        preview_url: "http://127.0.0.1:8765",
        recipe: {
          id: "web",
          title: "Dev",
          command: "npm run dev",
          cwd: ".",
          preview_url: "http://127.0.0.1:8765",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  const http = new RuntimeHttp("/runtime", fetchImpl);
  const result = await startPreviewRecipe(http, "tok", "u1", "a1", false, "web", undefined, true);
  expect(result).toEqual({
    status: "conflict",
    pid: 4242,
    preview_url: "http://127.0.0.1:8765",
    recipe: {
      id: "web",
      title: "Dev",
      command: "npm run dev",
      cwd: ".",
      preview_url: "http://127.0.0.1:8765",
    },
  });
});

it("群预览 stop 同样直传 body", async () => {
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body ?? "{}"))).toEqual({
      user_id: "u1",
      agent_id: "holder-1",
    });
    return new Response(
      JSON.stringify({
        recipe: {
          id: "web",
          title: "Dev",
          command: "npm run dev",
          cwd: ".",
          preview_url: "http://127.0.0.1:5173",
          linked_job_id: null,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  const http = new RuntimeHttp("/runtime", fetchImpl);
  await stopPreviewRecipe(http, "tok", "u1", "group:g1", false, "web", "holder-1");
});
