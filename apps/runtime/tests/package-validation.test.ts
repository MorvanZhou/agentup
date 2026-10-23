import { describe, expect, it } from "vitest";

import { validateAgentPackage } from "../src/package/validate.js";

const bytes = (value: string) => Buffer.from(value);

describe("agent package validation", () => {
  it("accepts ecosystem skill frontmatter variants", () => {
    const issues = validateAgentPackage({
      "SYSTEM.md": bytes("You are a test agent."),
      "skills/humanizer-zh/SKILL.md": bytes(
        "---\nname: humanizer-zh\ndescription: Soften AI writing traces.\nallowed-tools:\n  - Read\n  - Write\nmetadata:\n  trigger: edit copy\n---\n\nRewrite the text.\n",
      ),
      "skills/find-skills/SKILL.md": bytes(
        "---\nname: find-skills\ndescription: Discover installable skills.\nallowed-tools:\ndisable: true\n---\n\nSearch the registry.\n",
      ),
      "skills/canvas/SKILL.md": bytes(
        "---\nname: canvas\ndescription: Open a live canvas beside chat.\nmetadata:\n  surfaces:\n    - ide\n    - cloud\nenvironments:\n  - local\n---\n\nUse a canvas for artifacts.\n",
      ),
    });
    expect(issues).toEqual([]);
  });

  it("accepts SYSTEM, AGENTS, Agent Skills, MCP and settings hooks", () => {
    const issues = validateAgentPackage({
      "SYSTEM.md": bytes("You are a test agent."),
      "AGENTS.md": bytes("Verify facts before answering."),
      "skills/check-weather/SKILL.md": bytes(
        "---\nname: check-weather\ndescription: Check weather when a user asks about a city.\nallowed-tools: Read Write\nmetadata:\n  owner: agentup\n---\n\nRun the weather script.\n",
      ),
      "skills/check-weather/scripts/weather.mjs": bytes("console.log('sunny')"),
      "mcp.json": bytes(JSON.stringify({
        mcpServers: {
          hospital: { url: "http://127.0.0.1:8788/mcp", headers: { accept: "application/json" } },
        },
      })),
      "settings.json": bytes(JSON.stringify({
        hooks: {
          PreToolUse: [{
            matcher: "Bash|Write",
            hooks: [{ type: "command", command: "node hooks/check.mjs", timeout: 5 }],
          }],
        },
      })),
      "hooks/check.mjs": bytes("process.exit(0)"),
    });

    expect(issues).toEqual([]);
  });

  it("aggregates errors with their file paths", () => {
    const issues = validateAgentPackage({
      "APPEND_SYSTEM.md": bytes("legacy"),
      "skills/Bad_Name/SKILL.md": bytes("---\nname: other\n---\n"),
      "rules/safety.mdc": bytes("legacy"),
      "mcp.json": bytes(JSON.stringify({
        mcpServers: {
          bad: { command: "node", url: "https://example.com", headers: { "X-AgentUp-User-Id": "forged" } },
        },
      })),
      "settings.json": bytes(JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "[", hooks: [{ type: "command", timeout: 0 }] }],
        },
      })),
    });

    expect(issues.map((value) => value.path)).toEqual(expect.arrayContaining([
      "SYSTEM.md",
      "APPEND_SYSTEM.md",
      "skills/Bad_Name/SKILL.md",
      "rules/",
      "mcp.json",
      "settings.json",
    ]));
    expect(issues.length).toBeGreaterThanOrEqual(9);
    expect(issues).toContainEqual({
      path: "rules/",
      message: "不再支持 rules/，请迁移为根目录 AGENTS.md",
    });
  });

  it("allows publish sources without SYSTEM.md", () => {
    const issues = validateAgentPackage(
      {
        "AGENTS.md": bytes("Keep answers short."),
        "skills/check-weather/SKILL.md": bytes(
          "---\nname: check-weather\ndescription: Check weather when a user asks about a city.\n---\n\nRun the weather script.\n",
        ),
      },
      { requireSystemMd: false },
    );
    expect(issues).toEqual([]);
  });
});
