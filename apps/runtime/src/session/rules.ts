import fs from "node:fs";
import path from "node:path";

import { parseDocument } from "yaml";

export interface VisitRule {
  id: string;
  source: "package";
  alwaysApply: boolean;
  description: string;
  body: string;
  filePath: string;
}

/**
 * 第三方 Agent 运行包 `.pi/rules/*.mdc`（AgentUp 扩展，非 Pi 官方）。
 * 私人助理改用 `.runtime/AGENTS.md`（agentDir），不再走此路径。
 */
export function loadVisitAlwaysApplyRules(cwd: string): VisitRule[] {
  return loadRulesFromDir(path.join(cwd, ".pi", "rules"), "package").filter(
    (rule) => rule.alwaysApply && rule.body.trim(),
  );
}

/** 拼进 Pi appendSystemPrompt；空则不追加。 */
export function formatRulesAppend(rules: VisitRule[]): string {
  if (rules.length === 0) return "";
  const blocks = rules.map((rule) => {
    const title = rule.description ? `${rule.id} — ${rule.description}` : rule.id;
    return `## ${title}\n\n${rule.body.trim()}`;
  });
  return `# AgentUp Rules\n\n${blocks.join("\n\n")}`;
}

function loadRulesFromDir(dir: string, source: "package"): VisitRule[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const rules: VisitRule[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".mdc")) continue;
    const filePath = path.join(dir, name);
    if (!fs.statSync(filePath).isFile()) continue;
    const rule = readRuleFile(filePath, source);
    if (rule) rules.push(rule);
  }
  return rules;
}

function readRuleFile(filePath: string, source: "package"): VisitRule | undefined {
  const id = path.basename(filePath, ".mdc");
  if (!id) return undefined;
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (!match) return undefined;
  const document = parseDocument(match[1], { uniqueKeys: true });
  if (document.errors.length > 0) return undefined;
  const value = document.toJS() as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const frontmatter = value as Record<string, unknown>;
  if (typeof frontmatter.alwaysApply !== "boolean") return undefined;
  const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
  return {
    id,
    source,
    alwaysApply: frontmatter.alwaysApply,
    description,
    body: match[2] ?? "",
    filePath,
  };
}
