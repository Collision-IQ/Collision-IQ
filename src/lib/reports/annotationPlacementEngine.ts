/**
 * annotationPlacementEngine — document-agnostic placement, verification, and
 * repair for on-page estimate annotations.
 *
 * Codifies the universal Delta Annotation Rule (CLAUDE.md): every mark must be
 * anchored to a coordinate MEASURED from the document itself, keyed notes may
 * only be written into whitespace that was verified empty on the original
 * render, and nothing ships until a plan → audit → repair loop completes at
 * zero failures. Anything that cannot be placed safely is returned as
 * `unplaced` so the caller can route it to the existing unanchored appendix —
 * the engine never invents a coordinate and never silently drops a finding.
 *
 * The engine is pure and deterministic: it takes measured word boxes
 * (pdfjs/pdfplumber top-left origin, PDF points) plus a text-measuring
 * function, and returns placements. It knows nothing about carriers, RO
 * numbers, column positions, or any specific estimate pair.
 */

export type PlacementWord = {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
};

export type PlacementPageGeometry = {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
};

/** Rectangle in top-left-origin PDF points. */
export type PlacementRect = {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WhitespaceBand = PlacementRect & {
  /** True for the band that touches the page's bottom edge (below the running
   * footer). Note placement deprioritizes it — spilling under the footer is a
   * last resort, not the default margin. */
  atPageBottom?: boolean;
  /** True for the band that touches the page's top edge (above the running
   * header). Keyed notes never render there — a note band above a page
   * header reads as content bleeding across pages. */
  atPageTop?: boolean;
};

export type MeasureText = (text: string, fontSize: number) => number;

export type KeyedNoteRequest = {
  /** Stable id so callers can map placements back to findings. */
  id: string;
  pageNumber: number;
  text: string;
};

export type PlannedKeyedNote = {
  request: KeyedNoteRequest;
  rect: PlacementRect;
  fontSize: number;
};

export type ValueStampRequest = {
  /** Measured bbox of the value being struck/highlighted. */
  targetRect: PlacementRect;
  /** Verbatim source-document value to stamp beside it. */
  stampText: string;
  fontSize: number;
};

export type ValueStampPlacement =
  | { mode: "stamp"; rect: PlacementRect; fontSize: number }
  /**
   * Degraded: the stamp text would have covered neighboring document text
   * (e.g. an adjacent column). The caller should mark the target value
   * (strike/highlight) without inline text and carry the source value in a
   * keyed note or the report body instead.
   */
  | { mode: "mark_only"; collidingText: string[] };

export type PlacementFailure = {
  kind: "out_of_page" | "covers_document_text" | "overlaps_placement";
  id: string;
  pageNumber: number;
  detail: string;
};

const DEFAULT_MIN_BAND_HEIGHT = 12;
const DEFAULT_HORIZONTAL_INSET = 24;
const DEFAULT_NOTE_FONT_SIZE = 8;
const MIN_NOTE_FONT_SIZE = 6;
const NOTE_LINE_GAP = 2;
const NOTE_PADDING = 1.5;
const STAMP_GAP = 2.5;
const COLLISION_PAD = 1;

export function rectsIntersect(a: PlacementRect, b: PlacementRect, pad = 0): boolean {
  if (a.pageNumber !== b.pageNumber) return false;
  return (
    a.x - pad < b.x + b.width &&
    a.x + a.width + pad > b.x &&
    a.y - pad < b.y + b.height &&
    a.y + a.height + pad > b.y
  );
}

function wordRect(word: PlacementWord): PlacementRect {
  return { pageNumber: word.pageNumber, x: word.x, y: word.y, width: word.width, height: word.height };
}

/**
 * Words whose measured boxes intersect `rect`, excluding any word that is
 * essentially contained by an `exclude` rect (e.g. the struck value itself).
 */
export function findCollidingWords(
  rect: PlacementRect,
  words: PlacementWord[],
  exclude: PlacementRect[] = []
): PlacementWord[] {
  return words.filter((word) => {
    if (word.pageNumber !== rect.pageNumber) return false;
    if (!rectsIntersect(rect, wordRect(word), COLLISION_PAD)) return false;
    return !exclude.some((ex) => rectsIntersect(ex, wordRect(word)));
  });
}

/**
 * Measure the horizontal whitespace bands of a page: maximal y-ranges in which
 * no word intersects the scan region. On a dense estimate page this finds the
 * gap between the last body row and the running footer; on sparse pages it
 * also finds large interior gaps. Bands are returned top-to-bottom.
 */
export function measureWhitespaceBands(
  words: PlacementWord[],
  page: PlacementPageGeometry,
  options?: { minBandHeight?: number; horizontalInset?: number }
): WhitespaceBand[] {
  const minBandHeight = options?.minBandHeight ?? DEFAULT_MIN_BAND_HEIGHT;
  const inset = options?.horizontalInset ?? DEFAULT_HORIZONTAL_INSET;
  const scanX0 = inset;
  const scanX1 = page.pageWidth - inset;
  const intervals = words
    .filter(
      (word) =>
        word.pageNumber === page.pageNumber &&
        word.x < scanX1 &&
        word.x + word.width > scanX0
    )
    .map((word) => [word.y, word.y + word.height] as const)
    .sort((a, b) => a[0] - b[0]);

  const merged: Array<[number, number]> = [];
  for (const [start, end] of intervals) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 0.5) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  const bands: WhitespaceBand[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start - cursor >= minBandHeight) {
      bands.push({
        pageNumber: page.pageNumber,
        x: scanX0,
        y: cursor,
        width: scanX1 - scanX0,
        height: start - cursor,
        atPageTop: cursor === 0,
      });
    }
    cursor = Math.max(cursor, end);
  }
  if (page.pageHeight - cursor >= minBandHeight) {
    bands.push({
      pageNumber: page.pageNumber,
      x: scanX0,
      y: cursor,
      width: scanX1 - scanX0,
      height: page.pageHeight - cursor,
      atPageBottom: true,
    });
  }
  return bands;
}

/**
 * Resolve where (and whether) an inline value stamp can be drawn beside a
 * struck value. If the stamp text would collide with any other measured word
 * (a neighboring column, a unit suffix) or leave the page, the placement
 * degrades to `mark_only` instead of covering document text.
 */
export function resolveValueStamp(
  request: ValueStampRequest,
  words: PlacementWord[],
  page: PlacementPageGeometry,
  measureText: MeasureText
): ValueStampPlacement {
  const textWidth = measureText(request.stampText, request.fontSize);
  const rect: PlacementRect = {
    pageNumber: request.targetRect.pageNumber,
    x: request.targetRect.x + request.targetRect.width + STAMP_GAP,
    y: request.targetRect.y - NOTE_PADDING,
    width: textWidth + NOTE_PADDING * 2,
    height: request.targetRect.height + NOTE_PADDING * 2,
  };
  if (rect.x + rect.width > page.pageWidth - 4) {
    return { mode: "mark_only", collidingText: ["<page edge>"] };
  }
  const colliding = findCollidingWords(rect, words, [request.targetRect]);
  if (colliding.length > 0) {
    return { mode: "mark_only", collidingText: colliding.map((word) => word.text ?? "") };
  }
  return { mode: "stamp", rect, fontSize: request.fontSize };
}

/**
 * First-fit stack keyed notes into a page's verified whitespace bands,
 * preferring the band closest to the bottom of the page (the reviewer's
 * margin). Notes that cannot fit at the minimum font size are returned as
 * `unplaced` — the caller routes those to the appendix.
 */
export function planKeyedNotes(
  requests: KeyedNoteRequest[],
  bandsByPage: Map<number, WhitespaceBand[]>,
  measureText: MeasureText,
  options?: { fontSize?: number; allowPageFallback?: boolean }
): { placed: PlannedKeyedNote[]; unplaced: KeyedNoteRequest[] } {
  const baseFontSize = options?.fontSize ?? DEFAULT_NOTE_FONT_SIZE;
  const placed: PlannedKeyedNote[] = [];
  const unplaced: KeyedNoteRequest[] = [];
  const cursors = new Map<WhitespaceBand, number>();

  for (const request of requests) {
    // Home page first; with fallback enabled, overflow spills to later pages'
    // bands (then earlier ones). Notes stay unambiguous — they carry their own
    // line-number keys — so an overflow page is better than a dropped note.
    const candidatePages = [request.pageNumber];
    if (options?.allowPageFallback) {
      const others = [...bandsByPage.keys()].filter((page) => page !== request.pageNumber);
      candidatePages.push(
        ...others.filter((page) => page > request.pageNumber).sort((a, b) => a - b),
        ...others.filter((page) => page < request.pageNumber).sort((a, b) => b - a)
      );
    }
    let planned: PlannedKeyedNote | null = null;
    for (const pageNumber of candidatePages) {
      // Lowest non-bottom band first (the margin above the footer); the strip
      // below the footer is the last resort on the page. The band above the
      // page header is NEVER used — a note there reads as the previous page's
      // content bleeding across.
      const bands = [...(bandsByPage.get(pageNumber) ?? [])]
        .filter((band) => !band.atPageTop)
        .sort((a, b) => Number(a.atPageBottom ?? false) - Number(b.atPageBottom ?? false) || b.y - a.y);
      for (let fontSize = baseFontSize; fontSize >= MIN_NOTE_FONT_SIZE && !planned; fontSize -= 1) {
        const lineHeight = fontSize + NOTE_PADDING * 2 + NOTE_LINE_GAP;
        for (const band of bands) {
          const width = measureText(request.text, fontSize) + NOTE_PADDING * 2;
          if (width > band.width) continue;
          const cursor = cursors.get(band) ?? band.y + NOTE_LINE_GAP;
          if (cursor + lineHeight > band.y + band.height) continue;
          planned = {
            request,
            fontSize,
            rect: { pageNumber: band.pageNumber, x: band.x, y: cursor, width, height: fontSize + NOTE_PADDING * 2 },
          };
          cursors.set(band, cursor + lineHeight);
          break;
        }
      }
      if (planned) break;
    }
    if (planned) placed.push(planned);
    else unplaced.push(request);
  }
  return { placed, unplaced };
}

/**
 * Independent audit of a finished plan. Verifies that every planned rect is
 * inside its page, covers no measured document text, and overlaps no other
 * planned rect. Returns the failures; an empty array is the ship gate.
 */
export function auditPlacements(
  planned: Array<{ id: string; rect: PlacementRect }>,
  words: PlacementWord[],
  pages: PlacementPageGeometry[]
): PlacementFailure[] {
  const failures: PlacementFailure[] = [];
  const pageByNumber = new Map(pages.map((page) => [page.pageNumber, page]));
  planned.forEach((item, index) => {
    const page = pageByNumber.get(item.rect.pageNumber);
    if (
      !page ||
      item.rect.x < 0 ||
      item.rect.y < 0 ||
      item.rect.x + item.rect.width > page.pageWidth ||
      item.rect.y + item.rect.height > page.pageHeight
    ) {
      failures.push({
        kind: "out_of_page",
        id: item.id,
        pageNumber: item.rect.pageNumber,
        detail: "placement extends beyond the page bounds",
      });
      return;
    }
    const colliding = findCollidingWords(item.rect, words);
    if (colliding.length > 0) {
      failures.push({
        kind: "covers_document_text",
        id: item.id,
        pageNumber: item.rect.pageNumber,
        detail: `would cover: ${colliding.map((word) => word.text ?? "?").slice(0, 4).join(" ")}`,
      });
    }
    for (let other = index + 1; other < planned.length; other += 1) {
      if (rectsIntersect(item.rect, planned[other].rect)) {
        failures.push({
          kind: "overlaps_placement",
          id: item.id,
          pageNumber: item.rect.pageNumber,
          detail: `overlaps placement ${planned[other].id}`,
        });
      }
    }
  });
  return failures;
}

/**
 * Full plan → audit → repair loop for keyed notes. Any note whose placement
 * fails the audit is removed from the plan and returned as unplaced; the
 * survivors are re-audited until the audit reports zero failures. Guaranteed
 * to terminate (each iteration strictly shrinks the plan) and guaranteed to
 * return a plan that audits clean.
 */
export function planVerifiedKeyedNotes(params: {
  requests: KeyedNoteRequest[];
  words: PlacementWord[];
  pages: PlacementPageGeometry[];
  measureText: MeasureText;
  fontSize?: number;
  allowPageFallback?: boolean;
}): { placed: PlannedKeyedNote[]; unplaced: KeyedNoteRequest[]; audits: PlacementFailure[][] } {
  const bandsByPage = new Map<number, WhitespaceBand[]>(
    params.pages.map((page) => [
      page.pageNumber,
      measureWhitespaceBands(params.words, page),
    ])
  );
  let { placed, unplaced } = planKeyedNotes(params.requests, bandsByPage, params.measureText, {
    fontSize: params.fontSize,
    allowPageFallback: params.allowPageFallback,
  });
  const audits: PlacementFailure[][] = [];
  for (;;) {
    const failures = auditPlacements(
      placed.map((note) => ({ id: note.request.id, rect: note.rect })),
      params.words,
      params.pages
    );
    audits.push(failures);
    if (failures.length === 0) break;
    const failedIds = new Set(failures.map((failure) => failure.id));
    unplaced = [...unplaced, ...placed.filter((note) => failedIds.has(note.request.id)).map((note) => note.request)];
    placed = placed.filter((note) => !failedIds.has(note.request.id));
  }
  return { placed, unplaced, audits };
}
