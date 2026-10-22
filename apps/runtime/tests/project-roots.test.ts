import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { startLocalServer } from "../src/local/server.js";
import {
  addProjectRoot,
  assertInsideAnyRoot,
  MAX_PROJECT_ROOTS,
  parseStoredProjectRoots,
  readProjectRoots,
  removeProjectRoot,
  resolveAllowedRoots,
  validateCandidateRoot,
} from "../src/session/workspace/project-roots.js";
import { serveWorkspace } from "../src/local/workspace.js";

it("parses and bounds stored project_roots", () => {
  expect(parseStoredProjectRoots(undefined)).toEqual([]);
  expect(parseStoredProjectRoots(["/a", "/a", "", 1, "/b"])).toEqual([
    path.resolve("/a"),
    path.resolve("/b"),
  ]);
});

it("validates candidate roots and refuses sensitive paths", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-pr-data-"));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-pr-proj-"));
  expect(validateCandidateRoot(dataRoot, project)).toBe(fs.realpathSync(project));

  const underData = path.join(dataRoot, "users", "guest");
  fs.mkdirSync(underData, { recursive: true });
  expect(() => validateCandidateRoot(dataRoot, underData)).toThrow(/数据目录/);
  expect(() => validateCandidateRoot(dataRoot, os.homedir())).toThrow(/主目录/);
  if (fs.existsSync("/etc") && fs.statSync("/etc").isDirectory()) {
    expect(() => validateCandidateRoot(dataRoot, "/etc")).toThrow(/受保护/);
  }
  expect(() => validateCandidateRoot(dataRoot, "/no/such/dir-xyz")).toThrow(/有效目录/);
});

it("adds and removes project roots on instance.json", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-pr-inst-"));
  const visitRoot = path.join(dataRoot, "users", "u1", "agents", "coder");
  fs.mkdirSync(visitRoot, { recursive: true });
  fs.writeFileSync(
    path.join(visitRoot, "instance.json"),
    `${JSON.stringify({ user_id: "u1", agent_id: "coder", project_trust: "granted" }, null, 2)}\n`,
  );
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-pr-code-"));
  const roots = addProjectRoot(dataRoot, visitRoot, "agent", project);
  expect(roots).toEqual([fs.realpathSync(project)]);
  expect(readProjectRoots(visitRoot, "agent")).toEqual(roots);

  const removed = removeProjectRoot(visitRoot, "agent", roots[0]!);
  expect(removed).toEqual([]);
  expect(readProjectRoots(visitRoot, "agent")).toEqual([]);
});

it("enforces max project roots", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-pr-max-"));
  const visitRoot = path.join(dataRoot, "users", "u1", "agents", "coder");
  fs.mkdirSync(visitRoot, { recursive: true });
  fs.writeFileSync(path.join(visitRoot, "instance.json"), "{}\n");
  for (let i = 0; i < MAX_PROJECT_ROOTS; i += 1) {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), `agentup-pr-m${i}-`));
    addProjectRoot(dataRoot, visitRoot, "agent", project);
  }
  const extra = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-pr-extra-"));
  expect(() => addProjectRoot(dataRoot, visitRoot, "agent", extra)).toThrow(/最多挂载/);
});

it("assertInsideAnyRoot gates absolute paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-pr-allow-"));
  const inside = path.join(root, "src", "a.ts");
  fs.mkdirSync(path.dirname(inside), { recursive: true });
  fs.writeFileSync(inside, "ok");
  assertInsideAnyRoot(inside, [root]);
  expect(() => assertInsideAnyRoot(path.join(os.tmpdir(), "outside.txt"), [root])).toThrow(/允许范围/);
  const missing = path.join(root, "new", "file.ts");
  assertInsideAnyRoot(missing, [root], { allowMissing: true });
  expect(resolveAllowedRoots(root, [])).toEqual([fs.realpathSync(root)]);
});

it("workspace scope=project refuses unmounted roots and does not pollute layout", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-pr-ws-"));
  const visitRoot = path.join(dataRoot, "users", "patient-a", "agents", "weather");
  const cwd = path.join(visitRoot, "cwd");
  fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  fs.writeFileSync(
    path.join(visitRoot, "instance.json"),
    `${JSON.stringify({ user_id: "patient-a", agent_id: "weather", project_trust: "granted" }, null, 2)}\n`,
  );
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-pr-ws-proj-"));
  fs.writeFileSync(path.join(project, "main.ts"), "export {}\n");
  addProjectRoot(dataRoot, visitRoot, "agent", project);
  const projectReal = fs.realpathSync(project);

  const listed = serveWorkspace(
    dataRoot,
    "GET",
    "/agents/weather/workspace",
    new URLSearchParams({
      user_id: "patient-a",
      scope: "project",
      root: projectReal,
      path: "",
    }),
    {},
  );
  expect(listed.status).toBe(200);
  expect((listed.payload as { entries: Array<{ name: string }> }).entries.map((e) => e.name)).toContain(
    "main.ts",
  );
  expect(fs.existsSync(path.join(project, "ARTIFACT"))).toBe(false);

  expect(() =>
    serveWorkspace(
      dataRoot,
      "GET",
      "/agents/weather/workspace",
      new URLSearchParams({
        user_id: "patient-a",
        scope: "project",
        root: fs.mkdtempSync(path.join(os.tmpdir(), "agentup-pr-other-")),
        path: "",
      }),
      {},
    ),
  ).toThrow(/未挂载/);
});

it("serves project-roots HTTP CRUD", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-pr-http-"));
  const visitRoot = path.join(dataRoot, "users", "patient-a", "agents", "weather");
  fs.mkdirSync(path.join(visitRoot, "cwd", ".pi"), { recursive: true });
  fs.writeFileSync(
    path.join(visitRoot, "instance.json"),
    `${JSON.stringify({ user_id: "patient-a", agent_id: "weather", project_trust: "granted" }, null, 2)}\n`,
  );
  const local = await startLocalServer({
    host: "127.0.0.1",
    port: 0,
    userDataRoot: dataRoot,
    backendUrl: "http://127.0.0.1:9",
  });
  try {
    const headers = { authorization: "Bearer token", "content-type": "application/json" };
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-pr-http-proj-"));

    const listed = await fetch(`${local.url}/agents/weather/project-roots?user_id=patient-a`, { headers });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ roots: [] });

    const added = await fetch(`${local.url}/agents/weather/project-roots`, {
      method: "POST",
      headers,
      body: JSON.stringify({ user_id: "patient-a", path: project }),
    });
    expect(added.status).toBe(200);
    const addedBody = (await added.json()) as { roots: string[] };
    expect(addedBody.roots).toEqual([fs.realpathSync(project)]);

    const removed = await fetch(
      `${local.url}/agents/weather/project-roots?user_id=patient-a&path=${encodeURIComponent(addedBody.roots[0]!)}`,
      { method: "DELETE", headers },
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ roots: [] });
  } finally {
    await local.close();
  }
});
