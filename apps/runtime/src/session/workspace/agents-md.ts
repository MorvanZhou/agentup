import fs from "node:fs";
import path from "node:path";

/**
 * 把运行包 `.pi/AGENTS.md` 投影到 Pi agentDir（visit `.runtime/AGENTS.md`）。
 * 私人助理本身已写在 `.runtime/`，无需调用。
 * 旧盘若仅有 `.pi/rules/`，一次性拼进 `.runtime/AGENTS.md`（不改 `.pi`，避免 digest 漂移）。
 */
export function projectVisitAgentsMd(visitRoot: string): void {
  const runtimeDir = path.join(visitRoot, ".runtime");
  const runtimeFile = path.join(runtimeDir, "AGENTS.md");
  const piFile = path.join(visitRoot, "cwd", ".pi", "AGENTS.md");
  fs.mkdirSync(runtimeDir, { recursive: true });

  if (fs.existsSync(piFile) && fs.statSync(piFile).isFile()) {
    const text = fs.readFileSync(piFile, "utf8");
    if (!text.trim()) {
      if (fs.existsSync(runtimeFile)) fs.rmSync(runtimeFile, { force: true });
      return;
    }
    const body = text.endsWith("\n") ? text : `${text}\n`;
    const temporary = `${runtimeFile}.tmp`;
    fs.writeFileSync(temporary, body, { mode: 0o600 });
    fs.renameSync(temporary, runtimeFile);
    return;
  }

  if (fs.existsSync(runtimeFile) && fs.statSync(runtimeFile).isFile()) return;

  const migrated = migrateLegacyRules(path.join(visitRoot, "cwd", ".pi", "rules"));
  if (!migrated) return;
  const temporary = `${runtimeFile}.tmp`;
  fs.writeFileSync(temporary, migrated, { mode: 0o600 });
  fs.renameSync(temporary, runtimeFile);
}

function migrateLegacyRules(rulesDir: string): string | undefined {
  if (!fs.existsSync(rulesDir) || !fs.statSync(rulesDir).isDirectory()) return undefined;
  const blocks: string[] = [];
  for (const name of fs.readdirSync(rulesDir).sort()) {
    if (!name.endsWith(".mdc")) continue;
    const filePath = path.join(rulesDir, name);
    if (!fs.statSync(filePath).isFile()) continue;
    let text: string;
    try {
      text = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);
    if (!match) continue;
    const body = (match[2] ?? "").trim();
    if (!body) continue;
    const id = path.basename(name, ".mdc");
    blocks.push(`## ${id}\n\n${body}`);
  }
  if (blocks.length === 0) return undefined;
  return `# AgentUp Rules\n\n${blocks.join("\n\n")}\n`;
}
