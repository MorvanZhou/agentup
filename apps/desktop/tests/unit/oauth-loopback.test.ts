import http from "node:http";
import { afterEach, expect, it, vi } from "vitest";

import { createOAuthLoopback } from "../../electron/oauth-loopback.cjs";

const loopbacks: ReturnType<typeof createOAuthLoopback>[] = [];

afterEach(async () => {
  while (loopbacks.length) {
    const item = loopbacks.pop();
    if (item) await item.stop();
  }
});

it("回跳码在无等待者时暂存，下次 wait/take 可领取", async () => {
  const loopback = createOAuthLoopback();
  loopbacks.push(loopback);
  const { loopbackUri } = await loopback.start("zh");

  const url = new URL(loopbackUri);
  url.searchParams.set("code", "late-code");
  await new Promise<void>((resolve, reject) => {
    http.get(url, (res) => {
      res.resume();
      res.on("end", resolve);
    }).on("error", reject);
  });

  expect(loopback.peekPending()).toEqual({ code: "late-code" });
  await expect(loopback.waitForCode()).resolves.toEqual({ code: "late-code" });
  expect(loopback.peekPending()).toBeNull();
});

it("有等待者时回跳码只交给 wait，不留 pending", async () => {
  const loopback = createOAuthLoopback();
  loopbacks.push(loopback);
  const { loopbackUri } = await loopback.start("zh");
  const waiting = loopback.waitForCode();

  const url = new URL(loopbackUri);
  url.searchParams.set("code", "once-code");
  await new Promise<void>((resolve, reject) => {
    http.get(url, (res) => {
      res.resume();
      res.on("end", resolve);
    }).on("error", reject);
  });

  await expect(waiting).resolves.toEqual({ code: "once-code" });
  expect(loopback.peekPending()).toBeNull();
});

it("cancelWait 后端口仍在，晚到的回跳可暂存", async () => {
  const loopback = createOAuthLoopback();
  loopbacks.push(loopback);
  const { loopbackUri } = await loopback.start("zh");
  const waiting = loopback.waitForCode();
  loopback.cancelWait();
  await expect(waiting).rejects.toThrow("已取消登录");

  const url = new URL(loopbackUri);
  url.searchParams.set("code", "after-cancel");
  await new Promise<void>((resolve, reject) => {
    http.get(url, (res) => {
      res.resume();
      res.on("end", resolve);
    }).on("error", reject);
  });
  expect(loopback.peekPending()).toEqual({ code: "after-cancel" });
  expect(loopback.takePending()).toEqual({ code: "after-cancel" });
});

it("stop 在浏览器仍开着回调页时也能立刻结束", async () => {
  const onOpenApp = vi.fn();
  const loopback = createOAuthLoopback({ onOpenApp });
  loopbacks.push(loopback);
  const { loopbackUri } = await loopback.start("zh");
  const waiting = loopback.waitForCode();

  const url = new URL(loopbackUri);
  url.searchParams.set("code", "test-code");
  const held = await new Promise<{
    req: http.ClientRequest;
    res: http.IncomingMessage;
  }>((resolve, reject) => {
    const req = http.get(url, (res) => resolve({ req, res }));
    req.on("error", reject);
  });

  await expect(waiting).resolves.toEqual({ code: "test-code" });
  expect(onOpenApp).toHaveBeenCalled();

  let html = "";
  held.res.setEncoding("utf8");
  for await (const chunk of held.res) html += chunk;
  expect(html).toContain('href="/open"');
  expect(html).toContain("打开 AgentUp");

  const openUrl = new URL("/open", `http://127.0.0.1:${url.port}`);
  const openRes = await new Promise<http.IncomingMessage>((resolve, reject) => {
    http.get(openUrl, resolve).on("error", reject);
  });
  expect(openRes.statusCode).toBe(200);
  expect(onOpenApp).toHaveBeenCalledTimes(2);
  openRes.resume();

  const stopped = loopback.stop();
  await expect(Promise.race([stopped, delay(1000).then(() => "timeout")])).resolves.toBeUndefined();
  held.req.destroy();
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
