/**
 * Collision iQ page furniture for the forensic delta report.
 *
 * The model in deltaForensicReport.ts decides WHAT the report says. This file
 * decides only how it looks, and it takes its palette from the application's
 * own theme tokens (src/app/globals.css) rather than inventing report colours:
 * the warm cream surface, the near-black ink, the burnt-orange accent that
 * carries every rule and section marker. The masthead uses the Collision iQ
 * wordmark, so an exported report is recognisably the same product as the
 * screen the user generated it from.
 *
 * The logo is read from the filesystem and cached. If it cannot be read — a
 * trimmed serverless bundle, a permissions problem — the masthead falls back to
 * a typeset wordmark. A missing asset degrades the header; it never fails the
 * report.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { rgb, type PDFDocument, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type {
  DeltaForensicReportModel,
  ForensicBlock,
  ForensicTableColumn,
  ForensicTableRow,
} from "./deltaForensicReport";

// --- Theme tokens, mirrored from globals.css --------------------------------

const INK = rgb(0.082, 0.098, 0.122); // --foreground #15191f
const MUTED_INK = rgb(0.357, 0.4, 0.443); // --muted-foreground #5b6671
const ACCENT = rgb(0.769, 0.353, 0.141); // --accent #c45a24
const ACCENT_STRONG = rgb(0.659, 0.282, 0.102); // --accent-strong #a8481a
const SURFACE = rgb(0.957, 0.949, 0.925); // --background #f4f2ec
const SURFACE_MUTED = rgb(0.925, 0.91, 0.874); // --muted #ece8df
const BORDER = rgb(0.871, 0.843, 0.788); // --border #ded7c9
const WHITE = rgb(1, 1, 1);
const CREDIT = rgb(0.114, 0.42, 0.169); // a figure running the other way
const LOGO_TILE = rgb(0.012, 0.012, 0.016); // the wordmark asset's own background

const LOGO_PATH = path.join("public", "iq", "iq_logo.png");

// --- Layout -----------------------------------------------------------------

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const CONTENT_TOP = PAGE_HEIGHT - 58;
const CONTENT_BOTTOM = 62;

const BODY_SIZE = 9;
const BODY_LEADING = 12;
const TABLE_SIZE = 7.8;
const TABLE_LEADING = 9.6;

export type ForensicRenderOptions = {
  font: PDFFont;
  boldFont: PDFFont;
  /** Collision iQ wordmark. Omit to fall back to a typeset mark. */
  logo?: PDFImage | null;
  /** Document page number of the first page this renderer draws. */
  startPageNumber?: number;
};

let cachedLogoBytes: Uint8Array | null | undefined;

/**
 * Read the Collision iQ wordmark once per process. Returns null when the asset
 * is unavailable so callers can render the fallback mark instead of throwing.
 */
export async function loadCollisionIqLogo(pdfDoc: PDFDocument): Promise<PDFImage | null> {
  if (cachedLogoBytes === undefined) {
    try {
      const buffer = await readFile(path.join(process.cwd(), LOGO_PATH));
      cachedLogoBytes = new Uint8Array(buffer);
    } catch {
      cachedLogoBytes = null;
    }
  }
  if (!cachedLogoBytes) return null;
  try {
    return await pdfDoc.embedPng(cachedLogoBytes);
  } catch {
    return null;
  }
}

type RenderState = {
  pdfDoc: PDFDocument;
  page: PDFPage;
  y: number;
  pageNumber: number;
  pagesDrawn: number;
  options: ForensicRenderOptions;
  footerLine: string;
};

/**
 * Draw the whole model. Returns the number of pages added, so the caller can
 * keep the rest of the document's page numbering continuous.
 */
export function renderDeltaForensicReport(
  pdfDoc: PDFDocument,
  model: DeltaForensicReportModel,
  options: ForensicRenderOptions
): number {
  const startPageNumber = options.startPageNumber ?? 1;
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const state: RenderState = {
    pdfDoc,
    page,
    y: CONTENT_TOP,
    pageNumber: startPageNumber,
    pagesDrawn: 1,
    options,
    footerLine: model.footerLine,
  };

  drawMasthead(state, model);
  drawFooter(state);

  for (const section of model.sections) {
    drawSectionHeading(state, section.number ? `${section.number}. ${section.title}` : section.title);
    for (const block of section.blocks) {
      drawBlock(state, block);
    }
    state.y -= 6;
  }

  return state.pagesDrawn;
}

// --- Page furniture ---------------------------------------------------------

function newPage(state: RenderState) {
  state.page = state.pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  state.pageNumber += 1;
  state.pagesDrawn += 1;
  state.y = CONTENT_TOP;
  drawRunningHeader(state);
  drawFooter(state);
}

function ensureSpace(state: RenderState, required: number) {
  if (state.y - required >= CONTENT_BOTTOM) return;
  newPage(state);
}

function drawRunningHeader(state: RenderState) {
  const { boldFont } = state.options;
  state.page.drawText("COLLISION iQ", {
    x: MARGIN_X,
    y: PAGE_HEIGHT - 40,
    size: 7,
    font: boldFont,
    color: ACCENT_STRONG,
  });
  state.page.drawRectangle({
    x: MARGIN_X,
    y: PAGE_HEIGHT - 48,
    width: CONTENT_WIDTH,
    height: 0.6,
    color: BORDER,
  });
  state.y = PAGE_HEIGHT - 62;
}

function drawFooter(state: RenderState) {
  const { font } = state.options;
  state.page.drawRectangle({
    x: MARGIN_X,
    y: 46,
    width: CONTENT_WIDTH,
    height: 0.6,
    color: BORDER,
  });
  state.page.drawText(truncateToWidth(state.footerLine, font, 6.8, CONTENT_WIDTH - 60), {
    x: MARGIN_X,
    y: 34,
    size: 6.8,
    font,
    color: MUTED_INK,
  });
  const label = `Page ${state.pageNumber}`;
  state.page.drawText(label, {
    x: MARGIN_X + CONTENT_WIDTH - font.widthOfTextAtSize(label, 6.8),
    y: 34,
    size: 6.8,
    font,
    color: MUTED_INK,
  });
}

function drawMasthead(state: RenderState, model: DeltaForensicReportModel) {
  const { font, boldFont, logo } = state.options;
  const bandHeight = 40;
  const bandY = PAGE_HEIGHT - 40 - bandHeight;

  state.page.drawRectangle({
    x: MARGIN_X,
    y: bandY,
    width: CONTENT_WIDTH,
    height: bandHeight,
    color: SURFACE,
  });

  if (logo) {
    // The wordmark ships with an opaque near-black background (no alpha), so it
    // is set in a tile of that same colour rather than dropped onto the cream
    // band, where it would read as a stray black rectangle. Matching the tile
    // to the asset's own background makes the seam invisible.
    const maxHeight = 16;
    const maxWidth = 124;
    const scale = Math.min(maxWidth / logo.width, maxHeight / logo.height);
    const width = logo.width * scale;
    const height = logo.height * scale;
    const tileWidth = width + 18;
    const tileHeight = height + 12;
    const tileX = MARGIN_X + 10;
    const tileY = bandY + (bandHeight - tileHeight) / 2;
    state.page.drawRectangle({
      x: tileX,
      y: tileY,
      width: tileWidth,
      height: tileHeight,
      color: LOGO_TILE,
    });
    state.page.drawImage(logo, {
      x: tileX + (tileWidth - width) / 2,
      y: tileY + (tileHeight - height) / 2,
      width,
      height,
    });
  } else {
    state.page.drawText("COLLISION iQ", {
      x: MARGIN_X + 12,
      y: bandY + bandHeight / 2 - 4,
      size: 13,
      font: boldFont,
      color: ACCENT_STRONG,
    });
  }

  const rightEdge = MARGIN_X + CONTENT_WIDTH - 12;
  drawRightAligned(state.page, "COLLISION REPAIR INTELLIGENCE", rightEdge, bandY + bandHeight - 15, {
    size: 6.6,
    font: boldFont,
    color: MUTED_INK,
  });
  drawRightAligned(state.page, model.generatedLabel, rightEdge, bandY + 11, {
    size: 7.6,
    font,
    color: MUTED_INK,
  });

  state.y = bandY - 26;

  for (const line of wrapText(model.title, boldFont, 17, CONTENT_WIDTH)) {
    state.page.drawText(line, { x: MARGIN_X, y: state.y, size: 17, font: boldFont, color: INK });
    state.y -= 21;
  }

  state.y -= 2;
  for (const line of wrapText(model.subtitle, font, 8.6, CONTENT_WIDTH)) {
    state.page.drawText(line, { x: MARGIN_X, y: state.y, size: 8.6, font, color: MUTED_INK });
    state.y -= 11;
  }

  state.y -= 6;
  state.page.drawRectangle({ x: MARGIN_X, y: state.y, width: CONTENT_WIDTH, height: 1.4, color: ACCENT });
  state.y -= 14;

  if (model.identity.length) {
    const columnWidth = CONTENT_WIDTH / 2;
    const rowCount = Math.ceil(model.identity.length / 2);
    const topY = state.y;
    model.identity.forEach((entry, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = MARGIN_X + column * columnWidth;
      const y = topY - row * 12;
      state.page.drawText(`${entry.label}`, { x, y, size: 7.4, font: boldFont, color: MUTED_INK });
      const labelWidth = Math.max(boldFont.widthOfTextAtSize(entry.label, 7.4) + 8, 92);
      state.page.drawText(
        truncateToWidth(entry.value, font, 8, columnWidth - labelWidth - 10),
        { x: x + labelWidth, y, size: 8, font, color: INK }
      );
    });
    state.y = topY - rowCount * 12 - 8;
  }

  state.page.drawRectangle({ x: MARGIN_X, y: state.y, width: CONTENT_WIDTH, height: 0.6, color: BORDER });
  state.y -= 18;
}

// --- Blocks -----------------------------------------------------------------

function drawSectionHeading(state: RenderState, text: string) {
  const { boldFont } = state.options;
  const lines = wrapText(text, boldFont, 11.5, CONTENT_WIDTH - 14);
  // A heading needs its own height plus room for the first block under it —
  // otherwise the last line of a page is a heading whose section starts on the
  // next one, which reads as an empty section.
  ensureSpace(state, lines.length * 14 + 72);
  state.y -= 8;

  // The accent marker is drawn first so its rectangle can be positioned from
  // the first baseline; drawing it after the loop put it a full line low.
  const firstBaseline = state.y;
  const lastBaseline = firstBaseline - (lines.length - 1) * 14;
  state.page.drawRectangle({
    x: MARGIN_X,
    y: lastBaseline - 3,
    width: 3,
    height: firstBaseline + 9 - (lastBaseline - 3),
    color: ACCENT,
  });

  for (const line of lines) {
    state.page.drawText(line, { x: MARGIN_X + 10, y: state.y, size: 11.5, font: boldFont, color: INK });
    state.y -= 14;
  }
  state.y -= 2;
  state.page.drawRectangle({ x: MARGIN_X, y: state.y, width: CONTENT_WIDTH, height: 0.8, color: INK });
  state.y -= 14;
}

function drawBlock(state: RenderState, block: ForensicBlock) {
  switch (block.kind) {
    case "paragraph":
      drawParagraph(state, block.text, { size: BODY_SIZE, color: INK });
      break;
    case "note":
      drawParagraph(state, block.text, { size: 7.8, color: MUTED_INK, leading: 10 });
      break;
    case "subheading":
      drawSubheading(state, block.text);
      break;
    case "bullets":
      drawList(state, block.items, "bullet");
      break;
    case "steps":
      drawList(state, block.items, "number");
      break;
    case "table":
      drawTable(state, block.columns, block.rows);
      break;
    case "callout":
      drawCallout(state, block.tone, block.paragraphs);
      break;
  }
}

function drawParagraph(
  state: RenderState,
  text: string,
  options: { size: number; color: ReturnType<typeof rgb>; leading?: number; indent?: number }
) {
  const { font } = state.options;
  const leading = options.leading ?? BODY_LEADING;
  const indent = options.indent ?? 0;
  const lines = wrapText(text, font, options.size, CONTENT_WIDTH - indent);
  for (const line of lines) {
    ensureSpace(state, leading);
    state.page.drawText(line, {
      x: MARGIN_X + indent,
      y: state.y,
      size: options.size,
      font,
      color: options.color,
    });
    state.y -= leading;
  }
  state.y -= 5;
}

function drawSubheading(state: RenderState, text: string) {
  const { boldFont } = state.options;
  ensureSpace(state, 30);
  state.y -= 4;
  for (const line of wrapText(text, boldFont, 9.6, CONTENT_WIDTH)) {
    ensureSpace(state, 13);
    state.page.drawText(line, { x: MARGIN_X, y: state.y, size: 9.6, font: boldFont, color: ACCENT_STRONG });
    state.y -= 13;
  }
  state.y -= 3;
}

function drawList(state: RenderState, items: string[], marker: "bullet" | "number") {
  const { font, boldFont } = state.options;
  const indent = 16;
  items.forEach((item, index) => {
    const lines = wrapText(item, font, BODY_SIZE, CONTENT_WIDTH - indent);
    ensureSpace(state, BODY_LEADING);
    const markerText = marker === "bullet" ? "•" : `${index + 1}.`;
    state.page.drawText(markerText, {
      x: MARGIN_X,
      y: state.y,
      size: BODY_SIZE,
      font: marker === "bullet" ? font : boldFont,
      color: marker === "bullet" ? ACCENT : ACCENT_STRONG,
    });
    lines.forEach((line, lineIndex) => {
      if (lineIndex > 0) ensureSpace(state, BODY_LEADING);
      state.page.drawText(line, {
        x: MARGIN_X + indent,
        y: state.y,
        size: BODY_SIZE,
        font,
        color: INK,
      });
      state.y -= BODY_LEADING;
    });
    state.y -= 2;
  });
  state.y -= 4;
}

/**
 * pdf-lib paints in call order, so the tint has to go down BEFORE the text or
 * it covers it. The paragraph is therefore split into page-sized chunks first,
 * each chunk's band drawn to the height that chunk will actually occupy, and
 * the text laid over it. A callout that breaks across a page gets two correctly
 * sized bands rather than one band and one orphaned run of text.
 */
function drawCallout(state: RenderState, tone: "owner" | "caution" | "neutral", paragraphs: string[]) {
  const { font } = state.options;
  const accentColor = tone === "caution" ? ACCENT_STRONG : tone === "owner" ? CREDIT : MUTED_INK;
  const padding = 10;
  const innerWidth = CONTENT_WIDTH - padding * 2 - 4;

  for (const paragraph of paragraphs) {
    let remaining = wrapText(paragraph, font, BODY_SIZE, innerWidth);
    while (remaining.length) {
      const fits = Math.floor((state.y - CONTENT_BOTTOM - 10) / BODY_LEADING);
      if (fits < 1) {
        newPage(state);
        continue;
      }
      const chunk = remaining.slice(0, fits);
      remaining = remaining.slice(fits);

      const height = chunk.length * BODY_LEADING + 9;
      const top = state.y + BODY_SIZE + 3;
      const bottom = top - height;
      state.page.drawRectangle({ x: MARGIN_X, y: bottom, width: CONTENT_WIDTH, height, color: SURFACE });
      state.page.drawRectangle({ x: MARGIN_X, y: bottom, width: 3, height, color: accentColor });

      for (const line of chunk) {
        state.page.drawText(line, {
          x: MARGIN_X + padding + 4,
          y: state.y,
          size: BODY_SIZE,
          font,
          color: INK,
        });
        state.y -= BODY_LEADING;
      }
      state.y -= 5;
    }
    state.y -= 3;
  }
  state.y -= 2;
}

// --- Tables -----------------------------------------------------------------

function drawTable(state: RenderState, columns: ForensicTableColumn[], rows: ForensicTableRow[]) {
  const totalWeight = columns.reduce((sum, column) => sum + column.weight, 0) || 1;
  const widths = columns.map((column) => (column.weight / totalWeight) * CONTENT_WIDTH);
  const xs: number[] = [];
  let cursor = MARGIN_X;
  for (const width of widths) {
    xs.push(cursor);
    cursor += width;
  }

  ensureSpace(state, 42);
  drawTableHeader(state, columns, widths, xs);

  for (const row of rows) {
    const layout = rowLayout(columns, widths, xs, row);
    const cells = layout.texts.map((text, index) =>
      wrapText(text, rowFont(state, row), TABLE_SIZE, layout.widths[index] - 8)
    );
    const height = Math.max(1, ...cells.map((lines) => lines.length)) * TABLE_LEADING + 5;
    if (state.y - height < CONTENT_BOTTOM) {
      newPage(state);
      drawTableHeader(state, columns, widths, xs);
    }
    drawTableRow(state, layout, row, cells, height);
  }
  state.y -= 8;
}

type RowLayout = {
  texts: string[];
  widths: number[];
  xs: number[];
  aligns: Array<ForensicTableColumn["align"]>;
};

/**
 * A group row is a band introducing the rows beneath it, so its label spans
 * every column except the trailing figure. Squeezing that label into a 14%
 * "Ref" column wrapped it to five lines and buried the group name.
 */
function rowLayout(
  columns: ForensicTableColumn[],
  widths: number[],
  xs: number[],
  row: ForensicTableRow
): RowLayout {
  const base: RowLayout = {
    texts: columns.map((_, index) => row.cells[index] ?? ""),
    widths,
    xs,
    aligns: columns.map((column) => column.align),
  };
  if (row.variant !== "group" || columns.length < 2) return base;

  const last = columns.length - 1;
  const labelWidth = widths.slice(0, last).reduce((sum, width) => sum + width, 0);
  const label = row.cells.slice(0, last).find((cell) => Boolean(cell?.trim())) ?? "";
  return {
    texts: [label, row.cells[last] ?? ""],
    widths: [labelWidth, widths[last]],
    xs: [xs[0], xs[last]],
    aligns: [columns[0].align, columns[last].align],
  };
}

function rowFont(state: RenderState, row: ForensicTableRow): PDFFont {
  return row.variant === "group" || row.variant === "total"
    ? state.options.boldFont
    : state.options.font;
}

function drawTableHeader(
  state: RenderState,
  columns: ForensicTableColumn[],
  widths: number[],
  xs: number[]
) {
  const { boldFont } = state.options;
  const cells = columns.map((column, index) =>
    wrapText(column.header, boldFont, 7.2, widths[index] - 8)
  );
  const height = Math.max(...cells.map((lines) => lines.length)) * 8.6 + 6;
  state.page.drawRectangle({
    x: MARGIN_X,
    y: state.y - height + 8,
    width: CONTENT_WIDTH,
    height,
    color: INK,
  });
  cells.forEach((lines, index) => {
    lines.forEach((line, lineIndex) => {
      const x = alignedX(line, boldFont, 7.2, xs[index], widths[index], columns[index].align);
      state.page.drawText(line, {
        x,
        y: state.y - lineIndex * 8.6,
        size: 7.2,
        font: boldFont,
        color: WHITE,
      });
    });
  });
  state.y -= height + 3;
}

function drawTableRow(
  state: RenderState,
  layout: RowLayout,
  row: ForensicTableRow,
  cells: string[][],
  height: number
) {
  const font = rowFont(state, row);
  const bottom = state.y - height + TABLE_LEADING;

  if (row.variant === "group") {
    state.page.drawRectangle({ x: MARGIN_X, y: bottom, width: CONTENT_WIDTH, height, color: SURFACE_MUTED });
  } else if (row.variant === "total") {
    state.page.drawRectangle({ x: MARGIN_X, y: bottom, width: CONTENT_WIDTH, height, color: SURFACE });
    state.page.drawRectangle({ x: MARGIN_X, y: bottom + height, width: CONTENT_WIDTH, height: 0.9, color: INK });
  }

  const color = row.credit ? CREDIT : INK;
  cells.forEach((lines, index) => {
    lines.forEach((line, lineIndex) => {
      const x = alignedX(line, font, TABLE_SIZE, layout.xs[index], layout.widths[index], layout.aligns[index]);
      state.page.drawText(line, {
        x,
        y: state.y - lineIndex * TABLE_LEADING,
        size: TABLE_SIZE,
        font,
        color,
      });
    });
  });

  state.page.drawRectangle({ x: MARGIN_X, y: bottom - 1.5, width: CONTENT_WIDTH, height: 0.4, color: BORDER });
  state.y -= height;
}

function alignedX(
  text: string,
  font: PDFFont,
  size: number,
  columnX: number,
  columnWidth: number,
  align: ForensicTableColumn["align"]
): number {
  const width = font.widthOfTextAtSize(text, size);
  if (align === "right") return columnX + columnWidth - 4 - width;
  if (align === "center") return columnX + (columnWidth - width) / 2;
  return columnX + 4;
}

// --- Text -------------------------------------------------------------------

function drawRightAligned(
  page: PDFPage,
  text: string,
  rightEdge: number,
  y: number,
  options: { size: number; font: PDFFont; color: ReturnType<typeof rgb> }
) {
  page.drawText(text, {
    x: rightEdge - options.font.widthOfTextAtSize(text, options.size),
    y,
    size: options.size,
    font: options.font,
    color: options.color,
  });
}

/**
 * WinAnsi is the only encoding the standard fonts carry, so any character
 * outside it would throw at draw time. Normalising here — not at the call
 * sites — means a curly quote in an estimate description can never take down
 * a report.
 */
function toWinAnsi(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    // Whitespace stays in the allowed class rather than being stripped:
    // removing a newline here would glue two words together before the
    // caller collapses runs of whitespace into single spaces.
    .replace(/[^\s\x20-\x7E¡-ÿ•]/g, "");
}

export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const normalized = toWinAnsi(String(text ?? "")).replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const words = normalized.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    for (const piece of splitLongWord(word, font, size, maxWidth)) {
      const candidate = line ? `${line} ${piece}` : piece;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = piece;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

function splitLongWord(word: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (font.widthOfTextAtSize(word, size) <= maxWidth) return [word];
  const pieces: string[] = [];
  let piece = "";
  for (const character of word) {
    const candidate = `${piece}${character}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !piece) {
      piece = candidate;
    } else {
      pieces.push(piece);
      piece = character;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

function truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const normalized = toWinAnsi(String(text ?? "")).replace(/\s+/g, " ").trim();
  if (font.widthOfTextAtSize(normalized, size) <= maxWidth) return normalized;
  let result = normalized;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}...`, size) > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}...`;
}
