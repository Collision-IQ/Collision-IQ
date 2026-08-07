/**
 * TRUE redaction of a source estimate PDF.
 *
 * The annotated estimate reproduces the customer's own estimate pages, so no
 * text-level rule reaches the identifiers — they live in the page content
 * itself. Drawing a filled rectangle over them with pdf-lib is a FALSE
 * redaction: the glyphs stay in the content stream, selectable and extractable
 * by anyone with `pdftotext`. A document that looks protected and is not is
 * worse than one that is visibly unprotected.
 *
 * So each page is rendered to pixels, the identifiers are painted out ON THE
 * RASTER, and the image replaces the page. The text layer is destroyed by
 * construction — there is nothing left to extract — and what remains readable
 * is only what survived the paint.
 *
 * The cost is real and inherent: the output is image-based, so it is larger and
 * its text is no longer selectable. That is what redaction means; a redaction
 * you can select is not one.
 *
 * REGIONS ARE MEASURED, NEVER INVENTED. Every box comes from a text item's own
 * transform, in the same measured-coordinates discipline the annotation rule
 * uses. The VIN box is narrowed by character proportion so the first 9
 * characters stay legible and only the last 8 are covered.
 */
import { PDFDocument } from "pdf-lib";
import { COMMON_INSURERS } from "../ai/extractors/extractEstimateFacts";

/** Rendering scale. 2x keeps an estimate's 7pt rows readable in print. */
const DEFAULT_SCALE = 2;

/** Characters of the VIN that survive. 17 - 8 = 9. */
const VIN_VISIBLE_PREFIX = 9;

const VIN_ALPHABET = /^[A-HJ-NPR-Z0-9]{17}$/;
const VIN_TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

function isVin(candidate: string): boolean {
  const vin = candidate.toUpperCase();
  if (!VIN_ALPHABET.test(vin)) return false;
  // A run of digits is a claim number, not a VIN.
  if ((vin.match(/[A-Z]/g) ?? []).length < 3) return false;
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    const char = vin[i];
    const value = /\d/.test(char) ? Number(char) : VIN_TRANSLITERATION[char];
    if (value === undefined) return false;
    sum += value * VIN_WEIGHTS[i];
  }
  const remainder = sum % 11;
  return vin[8] === (remainder === 10 ? "X" : String(remainder));
}

/** A character span of one text item that must not survive export. */
interface CharSpan {
  start: number;
  end: number;
}

/**
 * Which characters of `text` are identifiers.
 *
 * Operates on the item's own string, so a glued run
 * ("VIN:5YJ3E1EA6PF691987Interior") yields a span covering only the VIN's last
 * 8 characters and leaves the labels around it readable.
 */
export function identifierSpans(text: string, carriers: string[] = COMMON_INSURERS): CharSpan[] {
  const spans: CharSpan[] = [];
  const push = (start: number, end: number) => {
    if (end > start) spans.push({ start, end });
  };

  // VIN — cover the last 8 characters only.
  for (let i = 0; i + 17 <= text.length; i += 1) {
    if (isVin(text.slice(i, i + 17))) {
      push(i + VIN_VISIBLE_PREFIX, i + 17);
      i += 16;
    }
  }

  // Whole-value identifiers and personal data.
  const wholeValue: RegExp[] = [
    // claim / policy / RO values, wherever the label sits
    /(?:claim|policy)\s*(?:#|no\.?|number|id)?\s*[:#.-]{1,3}\s*([A-Za-z0-9][A-Za-z0-9-]{4,})/gi,
    // US phone. The digit-run boundaries matter: without them this matches a
    // 10-digit window INSIDE a 21-digit claim number, and would black out any
    // long part number that happens to be numeric.
    /(?<![\d-])(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?![\d-])/g,
    // street address and city/state/ZIP
    /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\b\.?/gi,
    /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g,
    // license plate
    /\b(?:license|plate)\s*(?:#|no\.?|number)?\s*[:#.-]{1,3}\s*([A-Z0-9-]{4,10})/gi,
    // email
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  ];
  for (const pattern of wholeValue) {
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      // When the pattern captured a value, cover the value; else the whole hit.
      if (match[1]) {
        const offset = match[0].lastIndexOf(match[1]);
        push(index + offset, index + offset + match[1].length);
      } else {
        push(index, index + match[0].length);
      }
    }
  }

  // Carrier names, wherever they appear.
  for (const carrier of carriers) {
    const pattern = new RegExp(
      `\\b${carrier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s+(?:Insurance|Mutual|Group|Company|Co\\.?))?\\b`,
      "gi"
    );
    for (const match of text.matchAll(pattern)) {
      push(match.index ?? 0, (match.index ?? 0) + match[0].length);
    }
  }

  // Values following a personal-identity label, on the item's own text.
  for (const match of text.matchAll(
    /\b(?:insured|owner|claimant|policyholder|adjuster|appraiser|written\s+by)\s*[:#.-]{1,3}\s*(.+)$/gi
  )) {
    const value = match[1];
    const offset = (match.index ?? 0) + match[0].lastIndexOf(value);
    push(offset, offset + value.length);
  }

  return mergeSpans(spans);
}

/**
 * Labels whose VALUE is an identifier. In a CCC header the label and its value
 * are SEPATE text items — "Insured:" is one, "YU, WENBAO" is the next — so a
 * rule that only looks inside one item leaves the name in the clear. That is
 * exactly what the first cut did.
 */
const IDENTITY_LABEL =
  /\b(?:insured|owner|claimant|policyholder|adjuster|appraiser|written\s+by|claim|policy|license|plate|insurance\s+company|inspection\s+location)\s*(?:#|no\.?|number|id)?\s*[:#.-]*\s*$/i;

/** A value worth sweeping for elsewhere in the document. Short or generic
 *  strings are refused so a captured value cannot black out the estimate. */
export function isSweepableValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 4) return false;
  if (/^\d{1,4}$/.test(trimmed)) return false;
  if (/^(?:none|n\/a|unknown|cell|business|home|repair facility)$/i.test(trimmed)) return false;
  return /[A-Za-z0-9]/.test(trimmed);
}

function mergeSpans(spans: CharSpan[]): CharSpan[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: CharSpan[] = [sorted[0]];
  for (const span of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

export interface RasterRedactionResult {
  bytes: Uint8Array;
  pageCount: number;
  /** Boxes painted, per page — the evidence that redaction happened. */
  redactedRegionCount: number;
}

/**
 * Render every page, paint out the identifiers, and return an image-only PDF
 * of the same page dimensions, so annotation coordinates still land.
 */
export async function redactAndRasterizePdf(
  sourceBytes: Uint8Array,
  options: { scale?: number; carriers?: string[] } = {}
): Promise<RasterRedactionResult> {
  const scale = options.scale ?? DEFAULT_SCALE;
  const napi = await import("@napi-rs/canvas");
  // pdfjs v5 paints glyphs through Path2D/DOMMatrix. Without the canvas
  // implementation's own classes on the global, fill() rejects the handle and
  // every page renders blank-or-throws.
  for (const name of ["Path2D", "DOMMatrix", "DOMPoint", "DOMRect", "ImageData", "Image"] as const) {
    const value = (napi as unknown as Record<string, unknown>)[name];
    if (value && !(globalThis as Record<string, unknown>)[name]) {
      (globalThis as Record<string, unknown>)[name] = value;
    }
  }
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const doc = await pdfjs.getDocument({
    data: sourceBytes.slice(),
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;

  const out = await PDFDocument.create();
  let redactedRegionCount = 0;

  // PASS 1 — collect the VALUE beside every identity label, across the whole
  // document. The label and its value are separate text items, and a value
  // printed once beside "Insured:" reappears alone under "Owner:", so the
  // values have to be gathered before anything is painted.
  const sweepValues = new Set<string>();
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = (content.items as Array<Record<string, unknown>>)
      .filter((item) => typeof item.str === "string" && (item.str as string).trim().length > 0)
      .map((item) => ({
        text: (item.str as string).trim(),
        x: (item.transform as number[])[4],
        y: (item.transform as number[])[5],
      }));
    // Reading order: same line (y within a glyph height), then left to right.
    items.sort((a, b) => (Math.abs(a.y - b.y) > 3 ? b.y - a.y : a.x - b.x));
    for (let i = 0; i < items.length - 1; i += 1) {
      if (!IDENTITY_LABEL.test(items[i].text)) continue;
      const next = items[i + 1];
      // Only a value on the SAME line belongs to this label.
      if (Math.abs(next.y - items[i].y) > 3) continue;
      if (IDENTITY_LABEL.test(next.text)) continue;
      if (isSweepableValue(next.text)) sweepValues.add(next.text.toUpperCase());
    }
  }

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = napi.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      canvas: canvas as unknown as HTMLCanvasElement,
    }).promise;

    const textContent = await page.getTextContent();
    context.fillStyle = "#000000";
    const items = (textContent.items as Array<Record<string, unknown>>).filter(
      (item) => typeof item.str === "string" && (item.str as string).trim().length > 0
    );
    for (const item of items) {
      const text = item.str as string;
      const spans = [...identifierSpans(text, options.carriers)];
      // Any value captured from a label ANYWHERE in the document, wherever it
      // reappears — "YU, WENBAO" is printed beside "Insured:" once and stands
      // alone under "Owner:" a few lines later.
      for (const value of sweepValues) {
        let at = text.toUpperCase().indexOf(value);
        while (at !== -1) {
          spans.push({ start: at, end: at + value.length });
          at = text.toUpperCase().indexOf(value, at + 1);
        }
      }
      const merged = mergeSpans(spans);
      if (merged.length === 0) continue;

      const transform = pdfjs.Util.transform(viewport.transform, item.transform as number[]);
      const width = (item.width as number) * scale;
      const height = (item.height as number) * scale;
      const left = transform[4];
      // transform[5] is the BASELINE; the glyph box sits above it.
      const top = transform[5] - height;

      for (const span of merged) {
        // Character proportion within the item's own measured width. This is
        // what keeps the VIN's first 9 characters legible.
        const x = left + (span.start / text.length) * width;
        const spanWidth = ((span.end - span.start) / text.length) * width;
        // A hair of padding so antialiased glyph edges do not survive.
        context.fillRect(x - 1, top - 1, spanWidth + 2, height + 2);
        redactedRegionCount += 1;
      }
    }

    const png = await out.embedPng(canvas.toBuffer("image/png"));
    // Original page size, so pdf-lib annotation coordinates still land.
    const originalViewport = page.getViewport({ scale: 1 });
    const outPage = out.addPage([originalViewport.width, originalViewport.height]);
    outPage.drawImage(png, {
      x: 0,
      y: 0,
      width: originalViewport.width,
      height: originalViewport.height,
    });
  }

  await doc.destroy();
  return { bytes: await out.save(), pageCount: doc.numPages, redactedRegionCount };
}
