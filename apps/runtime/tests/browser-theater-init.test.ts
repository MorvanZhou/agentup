/**
 * 剧场 init-script 契约：常驻箭头指针 + 呼吸边框（受控标识）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INIT = path.resolve(HERE, "../src/session/mcp/browser-theater/theater-init.js");

it("theater-init uses glowing arrow pointer, always-on cursor, breathing frame, and glide on teleports", () => {
  const src = fs.readFileSync(INIT, "utf8");
  // 箭头路径（非圆点）+ 光晕层
  expect(src).toContain("<svg");
  expect(src).toContain('stroke="#ff6a00"');
  expect(src).toContain('class="glow"');
  expect(src).toContain("agentup-cursor-breathe");
  expect(src).not.toMatch(/\.cursor \.dot\{/);
  // 常驻：不再 1600ms 后隐藏
  expect(src).not.toMatch(/1600/);
  expect(src).toMatch(/opacity:1/);
  // 呼吸边框（边框与指针都有光晕）
  expect(src).toContain("agentup-breathe");
  expect(src).toContain('class="frame"');
  expect(src).toContain("blur(");
  // 自动化 hover 大位移滑动
  expect(src).toContain(".cursor.glide");
  expect(src).toContain("GLIDE_MIN_PX");
});
