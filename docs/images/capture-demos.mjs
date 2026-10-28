/**
 * Capture homepage demo stills + frame sequences for GIF export.
 * Usage: node docs/images/capture-demos.mjs
 * Requires: apps/web (or agentup-main/apps/web) Nuxt on :45280
 */
import { createRequire } from "node:module";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(
  join(
    process.env.WEB_ROOT ||
      "/Users/morvanzhou/Documents/repo/agentup-main/apps/web",
    "package.json",
  ),
);
const { chromium } = require("playwright");
const OUT = __dirname;
const RAW = join(OUT, "raw");
const FRAMES = join(OUT, "gif-src");
const BASE = process.env.DEMO_URL || "http://127.0.0.1:45280/";

const DEMOS = [
  {
    id: "feature-hero",
    selector: "section.relative .marketing-product-demo",
    waitMs: 5200,
    gifMs: 10000,
    fps: 5,
  },
  {
    id: "feature-add-assistant",
    selector: "#features .marketing-product-demo",
    waitMs: 4500,
    gifMs: 8000,
    fps: 5,
  },
  {
    id: "feature-agent-team",
    selector: "#team .marketing-product-demo",
    waitMs: 9000,
    gifMs: 11000,
    fps: 4,
  },
  {
    id: "feature-one-chat",
    selector: "#collab .marketing-product-demo",
    waitMs: 3500,
    gifMs: 6500,
    fps: 5,
  },
  {
    id: "feature-on-computer",
    selector: "#privacy .marketing-product-demo",
    waitMs: 4500,
    gifMs: 8000,
    fps: 5,
  },
  {
    id: "feature-models",
    selector: "#models .marketing-product-demo",
    waitMs: 4000,
    gifMs: 10000,
    fps: 4,
  },
];

async function ensureEn(page) {
  const en = page.getByRole("button", { name: "EN", exact: true });
  if (await en.count()) await en.click();
  await page.waitForTimeout(400);
}

async function settleDemo(page, selector, waitMs) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  // Disable sticky header overlap by scrolling a bit more
  await page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (!node) return;
    const y = node.getBoundingClientRect().top + window.scrollY - 88;
    window.scrollTo({ top: Math.max(0, y), behavior: "instant" });
  }, selector);
  await page.waitForTimeout(waitMs);
  return el;
}

async function main() {
  await mkdir(RAW, { recursive: true });
  await mkdir(FRAMES, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 920 },
    deviceScaleFactor: 2,
  });

  await page.goto(BASE, { waitUntil: "networkidle" });
  await ensureEn(page);
  await page.waitForTimeout(800);

  for (const demo of DEMOS) {
    console.log(`still: ${demo.id}`);
    const el = await settleDemo(page, demo.selector, demo.waitMs);
    const stillPath = join(RAW, `${demo.id}.png`);
    await el.screenshot({ path: stillPath, type: "png" });
    console.log(`  -> ${stillPath}`);

    const frameDir = join(FRAMES, demo.id);
    await rm(frameDir, { recursive: true, force: true });
    await mkdir(frameDir, { recursive: true });

    const interval = Math.round(1000 / demo.fps);
    const frames = Math.max(8, Math.round(demo.gifMs / interval));
    console.log(`gif frames: ${demo.id} (${frames} @ ${demo.fps}fps)`);
    // Restart near cycle start: reload section by scrolling away then back is flaky;
    // just capture a contiguous window of the live loop.
    await el.scrollIntoViewIfNeeded();
    for (let i = 0; i < frames; i++) {
      const name = `frame-${String(i).padStart(3, "0")}.png`;
      await el.screenshot({ path: join(frameDir, name), type: "png" });
      await page.waitForTimeout(interval);
    }
    await writeFile(
      join(frameDir, "meta.json"),
      JSON.stringify({ id: demo.id, fps: demo.fps, frames }, null, 2),
    );
  }

  await browser.close();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
