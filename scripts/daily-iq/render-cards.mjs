#!/usr/bin/env node
/**
 * Renders The Daily iQ entry cards (1080x1350 PNG) from
 * src/lib/knowledgeDaily/entries.ts into public/daily-iq/.
 *
 *   node scripts/daily-iq/render-cards.mjs            # render every entry whose card is missing
 *   node scripts/daily-iq/render-cards.mjs --all      # re-render every card
 *   node scripts/daily-iq/render-cards.mjs --entry 5  # render one entry (overwrites)
 *   node scripts/daily-iq/render-cards.mjs --check    # exit 1 if any entry lacks a card
 *
 * Deterministic: same entry text → same PNG. Design matches the cards shipped
 * with entries 1–4 (dark ground #141a21, accent #f08a3c, DejaVu Sans Bold).
 * No network, no browser: @napi-rs/canvas only.
 */
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const ENTRIES_TS = path.join(ROOT, "src", "lib", "knowledgeDaily", "entries.ts");
const OUT_DIR = path.join(ROOT, "public", "daily-iq");

const W = 1080;
const H = 1350;
const MARGIN = 84;
const BG = "#141a21";
const ACCENT = "#f08a3c";
const INK = "#ffffff";
const MUTED = "#96998a";

const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
  "C:/Windows/Fonts/DejaVuSans-Bold.ttf",
];
const REGULAR_CANDIDATES = FONT_CANDIDATES.map((f) => f.replace("DejaVuSans-Bold", "DejaVuSans"));

function registerFont(candidates, family) {
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) return null;
  GlobalFonts.registerFromPath(file, family);
  return family;
}

const BOLD = registerFont(FONT_CANDIDATES, "DailyIqBold") ?? "sans-serif";
const REGULAR = registerFont(REGULAR_CANDIDATES, "DailyIqRegular") ?? BOLD;

/** Load the entries by transpiling entries.ts; keeps the TS file the single source of truth. */
function loadEntries() {
  const source = readFileSync(ENTRIES_TS, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const moduleShim = { exports: {} };
  new Function("module", "exports", "require", compiled.outputText)(moduleShim, moduleShim.exports, () => ({}));
  return moduleShim.exports.getAllKnowledgeDailyEntries();
}

function formatCardDate(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .toUpperCase();
}

function wrap(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function spaced(ctx, text, x, y, spacing) {
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + spacing;
  }
}

/** Shrink the figure font until it fits the content width. */
function fitFigure(ctx, text, maxWidth, start = 220, min = 96) {
  let size = start;
  for (; size > min; size -= 4) {
    ctx.font = `bold ${size}px ${BOLD}`;
    if (ctx.measureText(text).width <= maxWidth) break;
  }
  return size;
}

/** Shrink the headline font until it wraps into at most `maxLines` lines. */
function fitHeadline(ctx, text, maxWidth, maxLines = 5, start = 62, min = 40) {
  let size = start;
  let lines = [];
  for (; size >= min; size -= 2) {
    ctx.font = `bold ${size}px ${BOLD}`;
    lines = wrap(ctx, text, maxWidth);
    if (lines.length <= maxLines) break;
  }
  return { size, lines };
}

export function cardSourceLine(entry) {
  if (entry.cardSource) return entry.cardSource;
  const publishers = [...new Set(entry.sources.map((source) => source.publisher))];
  return `Source: ${publishers.join("; ")}.`;
}

export function renderCard(entry) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const contentWidth = W - MARGIN * 2;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, W, 14);

  // Eyebrow + entry line
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = ACCENT;
  ctx.font = `bold 34px ${BOLD}`;
  spaced(ctx, "THE DAILY IQ", MARGIN, 120, 6);
  ctx.fillStyle = MUTED;
  ctx.font = `bold 30px ${BOLD}`;
  spaced(ctx, `ENTRY #${entry.entryNumber} · ${formatCardDate(entry.date)}`, MARGIN, 168, 4);

  // Key figure, vertically centred in the upper block
  const figureSize = fitFigure(ctx, entry.keyFigure, contentWidth);
  ctx.fillStyle = INK;
  ctx.font = `bold ${figureSize}px ${BOLD}`;
  ctx.fillText(entry.keyFigure, MARGIN, 560);

  // Rule
  ctx.fillStyle = ACCENT;
  ctx.fillRect(MARGIN, 658, contentWidth, 6);

  // Headline
  const { size: headlineSize, lines } = fitHeadline(ctx, entry.headline, contentWidth);
  ctx.fillStyle = INK;
  ctx.font = `bold ${headlineSize}px ${BOLD}`;
  const lineHeight = Math.round(headlineSize * 1.12);
  let y = 750;
  for (const line of lines) {
    ctx.fillText(line, MARGIN, y);
    y += lineHeight;
  }

  // Source line(s) above the footer
  ctx.fillStyle = MUTED;
  ctx.font = `28px ${REGULAR}`;
  const sourceLines = wrap(ctx, cardSourceLine(entry), contentWidth).slice(0, 3);
  let sy = 1160 - (sourceLines.length - 1) * 36;
  for (const line of sourceLines) {
    ctx.fillText(line, MARGIN, sy);
    sy += 36;
  }

  // Footer
  ctx.fillStyle = ACCENT;
  ctx.font = `bold 30px ${BOLD}`;
  ctx.fillText("What Collision iQ learned today · collision-iq.ai", MARGIN, 1256);

  return canvas.toBuffer("image/png");
}

function main(argv) {
  const all = argv.includes("--all");
  const check = argv.includes("--check");
  const entryFlag = argv.indexOf("--entry");
  const only = entryFlag >= 0 ? Number(argv[entryFlag + 1]) : null;

  const entries = loadEntries();
  mkdirSync(OUT_DIR, { recursive: true });
  let rendered = 0;
  let missing = 0;
  for (const entry of entries) {
    const target = path.join(ROOT, "public", entry.image.src);
    const exists = existsSync(target);
    if (check) {
      if (!exists) {
        missing += 1;
        console.error(`missing card for entry #${entry.entryNumber}: ${entry.image.src}`);
      }
      continue;
    }
    const wanted = only !== null ? entry.entryNumber === only : all || !exists;
    if (!wanted) continue;
    writeFileSync(target, renderCard(entry));
    rendered += 1;
    console.log(`rendered entry #${entry.entryNumber} → ${path.relative(ROOT, target)}`);
  }
  if (check) {
    if (missing > 0) process.exit(1);
    console.log(`all ${entries.length} entries have cards`);
    return;
  }
  console.log(`${rendered} card(s) rendered`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main(process.argv.slice(2));
}
