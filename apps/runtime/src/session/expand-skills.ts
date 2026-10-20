import fs from "node:fs";

import type { Skill } from "@earendil-works/pi-coding-agent";

const SKILL_NAME = "[a-z0-9]+(?:-[a-z0-9]+)*";
/** 前界 + /name|/skill:name + 后界（空白/标点/行尾）。桌面插入时默认补空格。 */
const SKILL_REF_RE = new RegExp(
  `(^|[\\s([{（【])\\/(?:skill:)?(${SKILL_NAME})(?=$|[\\s,.;:!?，。；：！？)\\]}）】])`,
  "gi",
);

/**
 * 用户显式 `/skill-name`（或 Pi `/skill:name`）→ harness 注入 `<skill>` 块。
 * 对齐 agentskills.io「User-explicit activation」与 Pi 的 skill block 形态。
 */
export function expandSkillReferences(text: string, skills: Skill[]): string {
  if (!text.trim() || skills.length === 0) return text;
  const byName = new Map(skills.map((skill) => [skill.name.toLowerCase(), skill]));
  const ordered: Skill[] = [];
  const seen = new Set<string>();
  const re = new RegExp(SKILL_REF_RE.source, "gi");
  for (const match of text.matchAll(re)) {
    const name = (match[2] ?? "").toLowerCase();
    const skill = byName.get(name);
    if (!skill || seen.has(name)) continue;
    seen.add(name);
    ordered.push(skill);
  }
  if (!ordered.length) return text;

  const blocks: string[] = [];
  for (const skill of ordered) {
    const block = readSkillBlock(skill);
    if (block) blocks.push(block);
  }
  if (!blocks.length) return text;

  const body = text
    .replace(re, (full, boundary: string, name: string) => {
      if (seen.has(name.toLowerCase())) return boundary ?? "";
      return full;
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ \n/g, "\n")
    .trim();

  return body ? `${blocks.join("\n\n")}\n\n${body}` : blocks.join("\n\n");
}

function readSkillBlock(skill: Skill): string | null {
  try {
    const content = fs.readFileSync(skill.filePath, "utf8");
    const body = stripFrontmatter(content).trim();
    return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
  } catch {
    return null;
  }
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}
