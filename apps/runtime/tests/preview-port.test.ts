import { createServer } from "node:net";

import { expect, it } from "vitest";

import {
  findTcpListenPid,
  parsePreviewPort,
} from "../src/session/preview/port.js";

it("parsePreviewPort reads explicit and default ports", () => {
  expect(parsePreviewPort("http://127.0.0.1:8765/")).toBe(8765);
  expect(parsePreviewPort("http://localhost:5173")).toBe(5173);
  expect(parsePreviewPort("http://127.0.0.1/")).toBe(80);
  expect(parsePreviewPort("not-a-url")).toBeNull();
});

it("findTcpListenPid sees a temporary localhost listener", async () => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  try {
    expect(port).toBeGreaterThan(0);
    expect(findTcpListenPid(port)).toBe(process.pid);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
