import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import type { ModelConfig } from "../src/config/load.js";
import type { Visit } from "../src/package/sync.js";
import { openSession } from "../src/session/open.js";

const model: ModelConfig = {
  providerId: "ollama",
  templateId: "ollama",
  modelId: "qwen",
  apiKey: "ollama",
  baseUrl: "http://localhost:11434/v1",
  kind: "ollama",
};

it("injects private assistant skills without reading ~/.agents", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-skill-iso-"));
  const userId = "patient";
  const agentId = "personal-assistant";
  const visitRoot = path.join(data, "users", userId, "personal-assistant");
  const cwd = path.join(visitRoot, "cwd");
  const userSkill = path.join(visitRoot, "skills", "sketch-infographic");
  fs.mkdirSync(userSkill, { recursive: true });
  fs.mkdirSync(path.join(visitRoot, ".runtime"), { recursive: true });
  fs.mkdirSync(path.join(visitRoot, "sessions"), { recursive: true });
  fs.writeFileSync(
    path.join(userSkill, "SKILL.md"),
    "---\nname: sketch-infographic\ndescription: 画图\n---\n\n# sketch\n",
  );

  const visit: Visit = {
    kind: "personal",
    userId,
    agentId,
    root: visitRoot,
    packageVersion: 1,
    packageDigest: "digest",
    tools: ["read", "bash"],
    modelCapabilities: ["tools"],
    projectTrust: "granted",
  };
  const opened = await openSession(visit, model);
  try {
    const skills = opened.session.resourceLoader.getSkills().skills;
    expect(skills.map((skill) => skill.name).sort()).toEqual(["sketch-infographic"]);
    expect(skills.find((skill) => skill.name === "sketch-infographic")?.filePath).toBe(
      path.join(userSkill, "SKILL.md"),
    );
    expect(skills.every((skill) => !skill.filePath.includes(`${path.sep}.agents${path.sep}`))).toBe(true);
  } finally {
    opened.session.dispose();
  }
});
