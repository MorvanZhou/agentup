import { describe, expect, it } from "vitest";

import { validateAgentPackage } from "../src/package/validate.js";

const bytes = (value: string) => Buffer.from(value);

describe("agent package validation", () => {
  it("accepts SYSTEM, Agent Skills, rules, MCP and settings hooks", () => {
    const issues = validateAgentPackage({
      "SYSTEM.md": bytes("You are a test agent."),
      "skills/check-weather/SKILL.md": bytes(
        "---\nname: check-weather\ndescription: Check weather when a user asks about a city.\nmetadata:\n  owner: agentup\n---\n\nRun the weather script.\n",
      ),
      "skills/check-weather/scripts/weather.mjs": bytes("console.log('sunny')"),
      "rules/safety.mdc": bytes(
        "---\ndescription: Keep output safe.\nalwaysApply: true\nglobs:\n  - \"**/*.md\"\n---\n\nNever expose secrets.\n",
      ),
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
      "rules/readme.txt": bytes("wrong"),
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
      "rules/readme.txt",
      "mcp.json",
      "settings.json",
    ]));
    expect(issues.length).toBeGreaterThanOrEqual(9);
  });
});
