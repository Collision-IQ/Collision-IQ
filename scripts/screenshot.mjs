#!/usr/bin/env node
// Screenshot app pages at desktop, tablet and mobile widths, so a UI change
// can be checked on all three layouts (CLAUDE.md: "If changing UI: verify
// desktop, tablet, and mobile layouts").
//
//   npm run screenshot -- /pricing                    # path on SCREENSHOT_BASE_URL
//   npm run screenshot -- https://www.collision-iq.ai/daily-iq
//   npm run screenshot -- /pricing --viewports mobile --full
//
// Options:
//   --viewports desktop,tablet,mobile   which widths to capture (default: all three)
//   --full                              capture the whole scrollable page
//   --out <dir>                         output folder (default: screenshots/)
//   --wait <ms>                         extra settle time after load (default: 500)
//
// A path is resolved against SCREENSHOT_BASE_URL (default http://localhost:3000,
// i.e. `npm run dev`). The browser is SCREENSHOT_BROWSER_PATH if set, else the
// Chromium preinstalled in Claude Code cloud sessions, else the installed
// Google Chrome. Pages behind sign-in render their signed-out state.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

function parseArgs(argv) {
  const options = { target: null, viewports: Object.keys(VIEWPORTS), full: false, out: "screenshots", wait: 500 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--full") options.full = true;
    else if (arg === "--viewports") options.viewports = argv[++i].split(",").map((name) => name.trim());
    else if (arg === "--out") options.out = argv[++i];
    else if (arg === "--wait") options.wait = Number(argv[++i]);
    else if (!options.target) options.target = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!options.target) throw new Error("Usage: npm run screenshot -- <url-or-path> [--viewports desktop,tablet,mobile] [--full] [--out dir]");
  const unknown = options.viewports.filter((name) => !VIEWPORTS[name]);
  if (unknown.length) throw new Error(`Unknown viewport(s): ${unknown.join(", ")}. Use ${Object.keys(VIEWPORTS).join(", ")}.`);
  return options;
}

function resolveUrl(target) {
  if (/^https?:\/\//i.test(target)) return target;
  const base = process.env.SCREENSHOT_BASE_URL || "http://localhost:3000";
  return new URL(target.startsWith("/") ? target : `/${target}`, base).toString();
}

function launchOptions() {
  const explicit = process.env.SCREENSHOT_BROWSER_PATH;
  if (explicit) return { executablePath: explicit };
  const cloudChromium = "/opt/pw-browsers/chromium";
  if (fs.existsSync(cloudChromium)) return { executablePath: cloudChromium };
  return { channel: "chrome" };
}

function fileSlug(url) {
  const { hostname, pathname } = new URL(url);
  const route = pathname.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9]+/g, "-") || "home";
  return `${hostname.replace(/[^a-zA-Z0-9]+/g, "-")}-${route}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const url = resolveUrl(options.target);
  fs.mkdirSync(options.out, { recursive: true });

  const browser = await chromium.launch(launchOptions());
  try {
    for (const name of options.viewports) {
      const { width, height, ...device } = VIEWPORTS[name];
      const context = await browser.newContext({ viewport: { width, height }, ...device });
      const page = await context.newPage();
      const response = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
      if (options.wait > 0) await page.waitForTimeout(options.wait);
      const file = path.join(options.out, `${fileSlug(url)}-${name}.png`);
      await page.screenshot({ path: file, fullPage: options.full });
      console.log(`${name.padEnd(7)} ${width}x${height}  HTTP ${response?.status() ?? "?"}  ${file}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`screenshot failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
