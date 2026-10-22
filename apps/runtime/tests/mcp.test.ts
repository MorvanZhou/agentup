import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { mergeVisitMcp, readProjectMcp, stampVisitUser } from "../src/session/workspace/mcp.js";

it("reports an unreadable project mcp file and refuses a blank user", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-mcp-"));
  fs.mkdirSync(path.join(cwd, ".pi"));
  fs.writeFileSync(path.join(cwd, ".pi", "mcp.json"), "{");
  const loaded = readProjectMcp(cwd);
  expect(loaded.servers).toEqual([]);
  expect(loaded.errors[0]).toContain("不是合法 JSON");
  expect(() => stampVisitUser(loaded, " ")).toThrow("缺少用户身份");
});

it("returns no servers when the visit has no mcp.json", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-mcp-"));
  expect(readProjectMcp(cwd)).toEqual({ servers: [], errors: [] });
});

it("merges user MCP under project and stamps the visit user", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-mcp-merge-"));
  const cwd = path.join(root, "cwd");
  const userRoot = path.join(root, "user");
  fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  fs.mkdirSync(userRoot, { recursive: true });
  fs.writeFileSync(
    path.join(userRoot, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        notes: { url: "http://127.0.0.1:9001/mcp" },
        hospital: { url: "http://127.0.0.1:9000/mcp", headers: { "X-AgentUp-User-Id": "forged" } },
      },
    }),
  );
  fs.writeFileSync(
    path.join(cwd, ".pi", "mcp.json"),
    JSON.stringify({
      mcpServers: {
        hospital: { url: "http://127.0.0.1:8788/mcp" },
      },
    }),
  );
  const merged = mergeVisitMcp(cwd, userRoot, "patient");
  const hospital = merged.servers.find((server) => server.name === "hospital");
  const notes = merged.servers.find((server) => server.name === "notes");
  expect(merged.servers).toHaveLength(2);
  expect(hospital && "url" in hospital.config && hospital.config.url).toBe("http://127.0.0.1:8788/mcp");
  expect(hospital?.config.headers?.["X-AgentUp-User-Id"]).toBe("patient");
  expect(notes?.scope).toBe("global");
  expect(notes?.config.headers?.["X-AgentUp-User-Id"]).toBe("patient");
});
