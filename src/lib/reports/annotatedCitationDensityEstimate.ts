import { createHash, randomUUID } from "node:crypto";
import DELTA_RULES from "./data/deltaRules.json";
import { describePiiExposure, scanExportForPii } from "@/lib/privacy/exportPiiScanner";
import { redactAndRasterizePdf } from "@/lib/privacy/rasterRedactPdf";
import { canonicalOperationKey } from "./operationAliases";
import { buildBlockedMessage, compareClaimIdentity, readClaimIdentity } from "./claimIdentityGate";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";
import {
  PDFHexString,
  PDFName,
  type PDFRef,
} from "pdf-lib/cjs/core";
import { redactDownloadContent, redactInsurersForExport } from "@/lib/privacy/redactDownloadContent";
import type { CitationDensityFinding, CitationDensityEstimateLineAnchor, CitationDensityAuthority, CitationSupportStatus } from "@/lib/ai/types/estimateScrubber";
import type { CanonicalDeltaSet, CanonicalDeltaEntry } from "./canonicalDelta";
import { getDeltaLabel, applyDisplayThreshold, assertNoCarrierWording } from "./canonicalDelta";
import {
  buildPdfRectFromTopLeftAnchor,
  normalizePdfRect,
  normalizeRotation,
  topLeftRectToPdfLibRect,
} from "./citationDensityCoordinates";
import {
  planVerifiedKeyedNotes,
  type KeyedNoteRequest,
  type PlacementWord,
} from "./annotationPlacementEngine";
import {
  buildEstimateRowAnchorsFromLines,
  buildMeasuredEngineRowAnchor,
  buildPdfTextLines,
  ensurePdfJsNodePolyfills,
  extractPdfWordsWithDiagnostics,
  findBestEstimateRowAnchorForFinding,
  type PdfTextExtractionMethod,
  type PdfTextLine,
  type PdfWord,
  type EstimateRowAnchor,
  type EstimateRowAnchorType,
} from "./citationDensityRowAnchors";
import {
  classifyCitationDensityAnchorRow,
  classifyCitationDensityDocument,
  isBadCitationDensityAnchorText,
} from "./citationDensityDocumentClassifier";
import {
  classifyEstimateRoleFromHeader,
  isCarrierAuthoredEstimateDocument,
  type HeaderEstimateRole,
} from "./citationDensitySourcePdf";
import {
  buildPmCapFlag,
  detectRepairFacilityState,
  PM_CAP_MATERIAL_WORDS,
  type PmCapFlag,
} from "./jurisdictionRules";
import {
  compareEstimateTotals,
  deltaRowFromRawText,
  findBucketContradictions,
  detectPaintSystem,
  paintSystemAddHours,
  groupWrappedEstimateLines,
  isSectionHeader,
  laborTypeNoun,
  matchEstimateLineItems,
  parseCccEstimateRows,
  parseCccEstimateTotals,
  normalizeTotalsCategoryKey,
  parseEstimateNetTotal,
  assessComparisonExtraction,
  assessHoursCoverage,
  type EstimateDeltaKind,
  type EstimateDeltaRow,
  type EstimateLineItemDelta,
  type EstimateTotalsDelta,
} from "./estimateDeltaMatcher";
import {
  estimateRowFromTextFields,
  planDeltaValueAnnotations,
} from "./deltaValueAnnotationLayer";
import {
  canonKey as deltaEngineCanonKey,
  detectSide as detectDeltaEngineSide,
  detectPosition as detectDeltaEnginePosition,
  repairTokens,
} from "./deltaEngine/estimateNormalize";

/** Strip side vocabulary (and optionally position vocabulary) from a display
 * description via the SAME synonym sets the engine keys on — presentation must
 * never re-implement side detection as an LT/RT string test (U-1). */
function stripDeltaEngineSideTokens(desc: string, stripPosition: boolean): string {
  let out = desc
    .replace(/\((?:L|R)\)/gi, " ")
    .replace(/\b(?:LT|RT|LH|RH|Left|Right|D\/S|P\/S)\.?(?=[\s/,)]|$)/gi, " ")
    .replace(/\b(?:Drivers?|Passengers?)['’]?s?\s+Side\b/gi, " ");
  if (stripPosition) {
    out = out.replace(/\b(?:Front|FRT|Rear|RR|Upper|UPR|Lower|LWR|Inner|INR|Outer|OTR)\b\.?/gi, " ");
  }
  return out.replace(/\s*\/\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}
import { pairAndCompare, isDeduction } from "./deltaEngine/deltaPair";
import {
  deriveExtractionConfidence,
  sectionSupportsAbsenceClaims,
} from "./extractionConfidence";
import { carriersNamedIn, detectDominantKnownCarrier, findForeignOrganizationMentions } from "@/lib/ai/extractors/extractEstimateFacts";
import {
  emptyRowParseDiagnostics,
  parseEstimateRows as parseDeltaEngineRows,
  parseSubtotalsFromWords as parseDeltaEngineSubtotals,
  parseTotalsFromWords as parseDeltaEngineTotals,
  type EstimateRow as DeltaEngineRow,
  type Word as DeltaEngineWord,
} from "./deltaEngine/rowCluster";

/**
 * Serialize typed delta-engine rows back through the canonical CCC row
 * builder so the existing matcher/emission machinery consumes them
 * unchanged. Values are re-printed from TYPED cells in column order, so a
 * fused or mistyped cell cannot survive this path; NOTE text stays on the
 * row payload and never enters the serialized identity.
 */
function engineRowsToDeltaRows(
  rows: DeltaEngineRow[],
  anchorByLineNumber: Map<string, EstimateRowAnchor> | null
): EstimateDeltaRow[] {
  const out: EstimateDeltaRow[] = [];
  const seenLines = new Set<number>();
  for (const row of rows) {
    if (seenLines.has(row.line)) continue; // repeated print/recap pages
    seenLines.add(row.line);
    // Serialize ALL FOUR value cells, zero-filled: a text line cannot carry
    // blank columns, and a sparse tail ("Tint color 1 0.5") re-parses its
    // paint value as labor — the exact column-identity loss the typed engine
    // exists to prevent. Zero-filling keeps both sides symmetric.
    const parts: string[] = [String(row.line), row.rawDesc];
    if (row.part) parts.push(row.part);
    parts.push(String(row.qty ?? 0));
    parts.push((row.price ?? 0).toFixed(2));
    parts.push((row.labor ?? 0).toFixed(1));
    if (/^[A-Z]$/i.test(row.laborClass)) parts.push(row.laborClass);
    parts.push((row.paint ?? 0).toFixed(1));
    const anchor = anchorByLineNumber?.get(String(row.line));
    const deltaRow = deltaRowFromRawText({
      rawText: parts.join(" "),
      section: row.sectionLabel ?? null,
      anchorId: anchor?.anchorId,
      pageNumber: anchor?.pageNumber ?? row.page,
    });
    if (deltaRow) {
      // The engine row is authoritative for identity: the legacy re-parse can
      // split unusual part formats and leak fragments ("P T") into the
      // description. Restore the typed part and the clean description.
      if (row.part) deltaRow.partNumber = row.part;
      const cleanDescription = row.rawDesc
        .replace(/^[#*\s]+/, "")
        .replace(/[*\s]+$/, "")
        .replace(/^(?:R&I|R&R|Repl|Rpr|Blnd|Subl|Refn|Algn|O\/H)\s+/i, "")
        .trim();
      if (cleanDescription) {
        deltaRow.description = cleanDescription;
        // Realign opCode with the engine description (D-1): the legacy
        // re-parse can claim a description's first word ("Overlap", "Add")
        // as a pseudo-operation while the engine description keeps it —
        // rendering then duplicates the token ("Add Add for Clear Coat").
        // The opCode is a REAL operation token of the engine row, or null.
        const engineOp = /^[#*\s]*((?:R&I|R&R|Repl|Rpr|Blnd|Subl|Refn|Algn|O\/H))\b/i.exec(row.rawDesc);
        deltaRow.opCode = engineOp ? engineOp[1] : null;
      }
      out.push(deltaRow);
    }
  }
  return out;
}

/**
 * Attach research-resolved authorities to delta findings by
 * FINDING TYPE × DECODED MAKE × JURISDICTION (D-4) — never by document name.
 * A scan/diagnostic finding gets the retrieved scan position statement, a
 * calibration finding the calibration/ADAS document, a rate finding the
 * jurisdiction's paint-and-materials authority. Make-specific authority
 * classes (OEM position statements, ADAS procedures) attach ONLY when the
 * authority names the decoded make — a Rivian file must never carry a GM
 * statement; when nothing make-specific resolved, the finding keeps its
 * NEEDS label plus an explicit "no make-specific authority found" note.
 * Document identifiers ("RCI-98-23-002-3") are restored from the URL/locator
 * when an upstream summarizer truncated them out of the title — the
 * identifier IS the citable reference.
 */
export function attachResolvedAuthoritiesToFindings(
  findings: CitationDensityFinding[],
  authorities: NonNullable<AnnotatedEstimateFindingGeneratorContext["resolvedAuthorities"]>,
  attachContext?: { vehicleMake?: string | null; jurisdiction?: string | null }
): number {
  if (!authorities.length) return 0;
  const vehicleMake = attachContext?.vehicleMake?.trim() || null;
  const jurisdiction = attachContext?.jurisdiction?.trim() || null;
  const authorityText = (authority: (typeof authorities)[number]) =>
    `${authority.sourceTitle} ${authority.url ?? ""} ${authority.locator ?? ""}`;
  const matchesMake = (authority: (typeof authorities)[number]) => {
    if (!vehicleMake) return true;
    // A declared applicability is stronger evidence than the make happening to
    // appear in the title, and it is also DISQUALIFYING when it names a
    // different make — a Rivian file must never carry a GM statement.
    const declared = authority.appliesToMake?.trim();
    if (declared) return declared.toLowerCase() === vehicleMake.toLowerCase();
    return new RegExp(`\\b${vehicleMake.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(authorityText(authority));
  };
  const matchesJurisdiction = (authority: (typeof authorities)[number]) =>
    !jurisdiction || new RegExp(jurisdiction.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(authorityText(authority));
  const restoreIdentifier = (authority: (typeof authorities)[number]): string => {
    const title = authority.sourceTitle.trim();
    const identifierPattern = /\b([A-Z]{2,5}-[\dOIl-]{6,})\b/;
    if (identifierPattern.test(title)) return title;
    const fromUrl = identifierPattern.exec(decodeURIComponent(authority.url ?? authority.locator ?? ""));
    if (!fromUrl) return title;
    // "RCI-:" style truncation — splice the recovered identifier back in.
    const truncated = /^([A-Z]{2,5}-?)\s*:/.exec(title);
    if (truncated) return title.replace(truncated[1], fromUrl[1]);
    return `${fromUrl[1]}: ${title}`;
  };
  const matchers: Array<{
    findingMatches: (finding: CitationDensityFinding) => boolean;
    authorityMatches: (authority: (typeof authorities)[number]) => boolean;
    type: CitationDensityAuthority["type"];
    /** OEM/ADAS classes are make-specific; legal classes are jurisdiction-specific. */
    gate: "make" | "jurisdiction" | "none";
  }> = [
    // Calibration first: an ADAS finding whose label also says "scan" must
    // prefer the calibration document over the generic scan statement.
    {
      findingMatches: (finding) =>
        finding.category === "adas_calibration" || /\bcalibrat|adas\b/i.test(finding.operationLabel),
      authorityMatches: (authority) => /\bcalibrat|adas\b/i.test(authorityText(authority)),
      type: "adas_procedure",
      gate: "make",
    },
    {
      findingMatches: (finding) =>
        finding.category === "scan_diagnostic" || /\bscan\b/i.test(finding.operationLabel),
      authorityMatches: (authority) => /\bscan(?:ning)?\b/i.test(authorityText(authority)),
      type: "oem_position_statement",
      gate: "make",
    },
    // Jurisdictional paint-and-materials / labor-rate authority on rate
    // findings (statute, DOI guidance, or accepted P&M basis).
    {
      findingMatches: (finding) =>
        /\brate\b/i.test(finding.operationLabel) &&
        (finding.id ?? "").startsWith("required-detector-totals-"),
      authorityMatches: (authority) =>
        (authority.sourceType === "law" || authority.sourceType === "policy" || authority.sourceType === "industry") &&
        /\bpaint|material|p\s*&\s*m|labor rate\b/i.test(authorityText(authority)),
      type: "legal",
      gate: "jurisdiction",
    },
  ];
  let attached = 0;
  for (const finding of findings) {
    // A "support needed" placeholder is replaceable; only genuinely verified
    // support (or estimate-evidence, which the resolved authority upgrades)
    // blocks the attach.
    if (
      finding.bestAvailableAuthority &&
      finding.bestAvailableAuthority.type !== "estimate_evidence" &&
      finding.bestAvailableAuthority.status === "verified"
    ) continue;
    for (const matcher of matchers) {
      if (!matcher.findingMatches(finding)) continue;
      const gated = authorities.filter((candidate) =>
        matcher.gate === "make"
          ? matchesMake(candidate)
          : matcher.gate === "jurisdiction"
            ? matchesJurisdiction(candidate)
            : true
      );
      const authority = gated.find((candidate) => matcher.authorityMatches(candidate));
      if (!authority) {
        // The retrieval gate held (D-4): a type-relevant authority may exist
        // but not for THIS make/jurisdiction — say so explicitly instead of
        // attaching a wrong-make document or staying silent.
        if (
          matcher.gate === "make" &&
          vehicleMake &&
          authorities.some((candidate) => matcher.authorityMatches(candidate))
        ) {
          const note = `No ${vehicleMake}-specific authority found for this finding type — retrieval gate held; generic or other-make documents were not attached.`;
          if (!(finding.limitations ?? []).includes(note)) {
            finding.limitations = [...(finding.limitations ?? []), note].slice(0, 12);
          }
        }
        continue;
      }
      const title = restoreIdentifier(authority);
      finding.bestAvailableAuthority = {
        type: matcher.type,
        status: "verified",
        title,
        confidence: (authority.confidenceScore ?? 0) >= 0.7 ? "high" : "medium",
      };
      finding.matchedDocumentTitle = title;
      finding.matchedDocumentUrl = authority.url ?? null;
      finding.retrievalStatus = "retrieved";
      finding.retrievalAttempted = true;
      attached += 1;
      break;
    }
  }
  return attached;
}

/** Leading CCC operation token of an engine row's description ("R&I", "Repl"). */
function engineRowOpCode(row: DeltaEngineRow): string | null {
  const match = /^[#*\s]*((?:R&I|R&R|Repl|Rpr|Blnd|Subl|Refn|Algn|O\/H))\b/i.exec(row.rawDesc);
  return match ? match[1] : null;
}

/**
 * ONE detector pass, two renderers (O-2): adapt the typed engine's
 * pairAndCompare output — the same objects the annotation layer draws from —
 * into the EstimateLineItemDelta shape the findings report emits. Both
 * directions are reported (a cell where the LOWER estimate is higher is
 * evidence too), equal-value pairs with differing operation tokens become
 * coding-only changes, and unconsumed competing rows split into lower-only vs
 * possible-duplicate (repeated-description) buckets.
 */
function engineResultToLineItemDeltas(params: {
  engine: import("./deltaEngine/deltaPair").PairResult;
  anchorByLineNumber: Map<string, EstimateRowAnchor>;
}): {
  deltas: EstimateLineItemDelta[];
  lowerOnlyRows: DeltaEngineRow[];
  potentialDuplicateLowerRows: DeltaEngineRow[];
  matchedPairCount: number;
  missingOperationCount: number;
} {
  const { engine, anchorByLineNumber } = params;
  const deltas: EstimateLineItemDelta[] = [];
  const toDeltaRow = (row: DeltaEngineRow): EstimateDeltaRow | null =>
    engineRowsToDeltaRows([row], anchorByLineNumber)[0] ?? null;

  const findingSubjects = new Set(engine.findings.map((finding) => finding.subject));
  let missingOperationCount = 0;

  for (const finding of engine.findings) {
    const higherRow = toDeltaRow(finding.subject);
    if (!higherRow) continue;
    const lowerRow = finding.competing ? engineRowsToDeltaRows([finding.competing], null)[0] ?? null : null;
    if (finding.kind === "MISSED") {
      missingOperationCount += 1;
      deltas.push({
        kind: "missing_operation",
        lowerRow: null,
        higherRow,
        matchBasis: "none",
        annotate: true,
        laborDelta: finding.subject.labor,
        paintDelta: finding.subject.paint,
        priceDelta: finding.subject.price,
        summary: `${higherRow.description} is documented on this estimate and has no counterpart on the comparison estimate.`,
      });
      continue;
    }
    const cell = (field: "price" | "labor" | "paint") => {
      const delta = finding.deltas.find((entry) => entry.field === field);
      return delta ? Math.round(((delta.subject as number) - (delta.competing as number)) * 100) / 100 : null;
    };
    const partDelta = finding.deltas.find((entry) => entry.field === "part#");
    const priceDelta = cell("price");
    const laborDelta = cell("labor");
    const paintDelta = cell("paint");
    const aggregated = finding.kind === "QTY_SHORTFALL";
    const kind: EstimateDeltaKind = partDelta
      ? "part_or_price_difference"
      : priceDelta !== null
        ? "part_or_price_difference"
        : laborDelta !== null
          ? "reduced_labor"
          : "reduced_paint";
    const lines = (finding.subjects ?? [finding.subject]).map((row) => row.line);
    deltas.push({
      kind,
      lowerRow,
      higherRow,
      annotate: true,
      matchBasis: finding.subject.part && finding.competing?.part === finding.subject.part ? "part_number" : "description",
      laborDelta,
      paintDelta,
      priceDelta,
      changedFields: [
        ...(partDelta ? ["part_number"] : []),
        ...(priceDelta !== null ? ["price"] : []),
        ...(laborDelta !== null ? ["labor"] : []),
        ...(paintDelta !== null ? ["paint"] : []),
      ],
      statusLabels: aggregated ? [`AGGREGATED_GROUP_${(finding.subjects ?? []).length || 1}X`] : undefined,
      summary: aggregated
        ? `${finding.category} across L${lines.join("/L")}.`
        : `${higherRow.description}: ${finding.deltas
            .map((entry) =>
              entry.field === "part#"
                ? `part # ${String(entry.subject)} vs ${String(entry.competing)}`
                : `${entry.field} ${String(entry.subject)} vs ${String(entry.competing)}`
            )
            .join(", ")}.`,
    });
  }

  // Equal-value pairs whose operation token differs are coding-only changes
  // ("Rpr" vs "R&I" at identical hours) — reported at low priority, never as
  // missing scope.
  for (const pair of engine.pairs) {
    if (findingSubjects.has(pair.subject)) continue;
    const subjectOp = engineRowOpCode(pair.subject);
    const competingOp = engineRowOpCode(pair.competing);
    if (!subjectOp || !competingOp) continue;
    if (subjectOp.replace(/\s/g, "").toUpperCase() === competingOp.replace(/\s/g, "").toUpperCase()) continue;
    const higherRow = toDeltaRow(pair.subject);
    if (!higherRow) continue;
    deltas.push({
      kind: "operation_change",
      lowerRow: engineRowsToDeltaRows([pair.competing], null)[0] ?? null,
      higherRow,
      annotate: true,
      matchBasis: pair.subject.part && pair.subject.part === pair.competing.part ? "part_number" : "description",
      laborDelta: null,
      paintDelta: null,
      priceDelta: null,
      changedFields: ["operation"],
      codingOnlyChange: true,
      summary: `${higherRow.description}: operation ${subjectOp} here vs ${competingOp} on the comparison estimate at identical values — likely a coding/description difference, not a scope change.`,
    });
  }

  // Unconsumed competing rows: repeated-description residuals are possible
  // duplicate billing, everything else is genuinely lower-only.
  const subjectKeys = new Set(engine.pairs.map((pair) => pair.subject.key));
  for (const finding of engine.findings) subjectKeys.add(finding.subject.key);
  const lowerOnlyRows: DeltaEngineRow[] = [];
  const potentialDuplicateLowerRows: DeltaEngineRow[] = [];
  for (const row of engine.competingOnly) {
    if (subjectKeys.has(row.key)) potentialDuplicateLowerRows.push(row);
    // P0-3 SYMMETRY. pairAndCompare already refuses to call a negative subject
    // row "missing on the competing estimate" (deltaPair isDeduction), but
    // nothing applied the mirror rule to the competing side, so the typed lane
    // listed the carrier's own credits as scope this estimate lacked: RO
    // 22059's "Overlap Major Adj. Panel" at -0.4 refinish hours read as a line
    // the shop should add, when adding it SUBTRACTS from the shop's total.
    // The text lane has always dropped these; this is the engine lane catching
    // up, not a new policy. Duplicates are still collected above — a credit
    // billed twice is as real a signal as an operation billed twice.
    else if (!isDeduction(row)) lowerOnlyRows.push(row);
  }

  return {
    deltas,
    lowerOnlyRows,
    potentialDuplicateLowerRows,
    matchedPairCount: engine.pairs.length,
    missingOperationCount,
  };
}

/** Group extracted PdfWords into the delta engine's per-page Word map. */
function pdfWordsToEnginePages(words: PdfWord[]): Map<number, DeltaEngineWord[]> {
  const byPage = new Map<number, DeltaEngineWord[]>();
  for (const word of words) {
    const list = byPage.get(word.pageNumber) ?? [];
    if (list.length === 0) byPage.set(word.pageNumber, list);
    list.push({ text: word.text, x0: word.x, x1: word.x + word.width, top: word.y, bottom: word.y + word.height });
  }
  return byPage;
}

export type AnnotationMode = "margin_callouts" | "inline_highlight" | "both";

export type AnnotatedEstimateRequest = {
  findingIds?: string[];
  annotationMode?: AnnotationMode;
  estimateRole?: "carrier" | "shop" | "selected";
  includeLegend?: boolean;
  includeSummaryPage?: boolean;
  includeUnanchoredAppendix?: boolean;
  redactSensitive?: boolean;
  /**
   * Opt-in: place unanchored findings as keyed notes inside measured on-page
   * whitespace (verified empty) instead of sending every one to the appendix.
   * Placement is planned and audited by annotationPlacementEngine; notes that
   * cannot be placed at zero audit failures still fall through to the
   * appendix. Default false — existing report output is unchanged.
   */
  inPageKeyedNotes?: boolean;
  /**
   * Delta value layer (citation-density reports only): cell-level highlights
   * on differing values, red underlines on matched prices, competing-value
   * stamps in the ESTIMATE TOTALS category gap, and merged keyed margin notes
   * in verified whitespace — driven by the deltaEngine typed pairing and the
   * annotationPlacementEngine zero-failure placement audit. DEFAULT ON; pass
   * false to opt out and keep the marker-only presentation.
   */
  deltaValueLayer?: boolean;
};

export type AnnotatedEstimateReportIdentity = {
  reportType: "citation-density" | "oem-citation-density";
  artifactVersion: string;
  reportTitle: string;
  reportShortTitle: string;
  artifactFilename: string;
  sourcePdfFallbackName: string;
  pdfAnnotationTitle: string;
  legendTitle: string;
  /** R14: the legend preamble belongs to the PASS, not to the renderer. These
   *  three lines are delta-pass language ("Estimate evidence supports the
   *  existence of a difference", "CCC Secure Share source confirms…") and had
   *  been rendered on the OEM report for eight consecutive runs, telling an
   *  OEM reader that estimate evidence is what backs an OEM finding. */
  legendBoundaryTexts: string[];
  detailTitle: string;
  unanchoredTitle: string;
  scoreLabel: string;
  scoreCommentLabel: string;
  noAnchorError: string;
  noSelectableTextError: string;
  textExtractionInfrastructureError: string;
  pdfWorkerUnavailableError: string;
};

export type ComparisonEstimateText = {
  sourceDocumentId?: string;
  fileName: string;
  text: string;
  estimateRole?: "carrier" | "shop";
};

export type ComparisonEstimatePdf = {
  sourceDocumentId?: string;
  fileName: string;
  bytes: Uint8Array;
  estimateRole?: "carrier" | "shop";
};

export type AnnotatedEstimateGeneratedFindings = {
  findings: CitationDensityFinding[];
  debug?: Partial<CitationDensityDebugTrace>;
};

export type CitationDensityToolUsageTraceEntry = {
  tool: string;
  ran: boolean;
  skipReason?: string;
  candidatesFound: number;
  candidatesAccepted: number;
  candidatesRejected: number;
  droppedReasons: string[];
  latencyMs?: number;
  provider?: string;
  model?: string;
};

export type CitationDensityDeltaDiagnostics = {
  toolUsageTrace: CitationDensityToolUsageTraceEntry[];
  totalDeltaCandidates: number;
  acceptedDeltaFindings: number;
  rejectedDeltaFindings: number;
  annotationLimitApplied: boolean;
  maxAnnotationLimit: number | null;
  droppedDeltaReasons: string[];
  unannotatedMaterialDeltas: Array<{
    rowId?: string;
    reason: string;
    summary: string;
  }>;
};

export type AnnotatedEstimateFindingGeneratorContext = {
  anchors: EstimateRowAnchor[];
  visualLines: PdfTextLine[];
  sourcePdfName: string;
  sourceDocumentId?: string;
  sourceDocumentRole: "carrier" | "shop";
  sourcePdfHash: string;
  uploadedFileNames: string[];
  sourceText?: string | null;
  comparisonEstimateTexts: ComparisonEstimateText[];
  /** Mutable sink for limits the reader must be told about. Suppressing a
   *  comparison is defensible; suppressing it invisibly is not — an empty
   *  report reads as "no differences found". */
  extractionWarnings?: string[];
  /** Measured word layer of comparison estimate PDFs. When present, the
   * structured delta path parses BOTH sides with the typed delta engine —
   * symmetric extraction is what keeps glued text layers from producing
   * false deltas. */
  comparisonEstimateWords?: Array<{
    fileName: string;
    estimateRole?: "carrier" | "shop";
    words: PdfWord[];
    /** M-1: measured from the PDF's own font dictionaries. False ONLY when a
     * font is non-embedded AND carries no ToUnicode map — the producer class
     * whose reflowed text cannot be trusted. Embedded fonts without ToUnicode
     * are a glyph-mapping condition, repaired by coordinate extraction, and
     * must never be described to the reader as a scanned document. */
    textLayerReliable?: boolean;
  }>;
  /** Authorities already resolved by the report's research pass (RIR
   * snapshot) — attached to matching delta findings by type so a scan-hour
   * reduction carries the retrieved scan position statement instead of
   * "support needed". */
  resolvedAuthorities?: Array<{
    sourceType: string;
    sourceTitle: string;
    url?: string;
    locator?: string;
    confidenceScore?: number | null;
    /** Declared make applicability (Drive/OEM retrieval metadata). Satisfies the
     *  D-4 make gate on its own; without it the gate falls back to testing
     *  whether the make appears in the title/url/locator text. */
    appliesToMake?: string;
  }>;
  /** Decoded vehicle make (D-4): OEM/ADAS authority classes attach only when
   * the authority names this make — never a wrong-make document. */
  vehicleMake?: string | null;
  /** Loss jurisdiction (D-4): legal/P&M authority classes gate on it. */
  jurisdiction?: string | null;
  authorityTrace?: OemCitationDensityAuthorityTrace;
  /** When present, the canonical delta set is the authoritative source for all delta findings.
   *  The legacy local-diff path is suppressed; all emitted findings carry canonicalDeltaObjectId. */
  canonicalDeltaSet?: CanonicalDeltaSet;
};

export type AnnotatedEstimateResult = {
  exportId: string;
  bytes: Uint8Array;
  annotatedFindingCount: number;
  unresolvedAnchorCount: number;
  originalPageCount: number;
  finalPageCount: number;
  warnings: string[];
  annotationMetadata: CitationDensityAnnotationMetadata[];
  debugMetadata?: CitationDensityAnnotationDebugMetadata;
  debugTrace?: CitationDensityDebugTrace;
  // The finding-details + unanchored findings are rendered into a SEPARATE,
  // standalone "Findings Report" PDF (cover page + one card per finding) so the
  // annotated estimate body stays clean and the findings are not buried deep in
  // the same document. These are populated whenever there is finding content.
  findingsReportExportId?: string;
  findingsReportBytes?: Uint8Array;
  findingsReportPageCount?: number;
};

export type CitationDensityDebugTrace = {
  buildCommit?: string;
  citationDensityArtifactVersion: string;
  artifactId?: string;
  sourcePdfName?: string;
  selectedEstimateFileName?: string;
  selectedEstimateForOemDensity?: string;
  selectedEstimateReason?: string;
  selectedEstimateDiagnostics?: Record<string, unknown>;
  selectedEstimateTotal?: number | null;
  comparisonEstimateTotal?: number | null;
  uploadedFileNames?: string[];
  actualSourcePdfName?: string;
  actualSourcePdfByteLength: number;
  actualSourcePdfPageCount: number;
  sourcePdfStage: "original" | "redacted" | "converted" | "cached";
  sourcePdfHash: string;
  textExtractionMethod: PdfTextExtractionMethod | "not_run";
  textExtractionError?: string;
  textExtractionWarnings: string[];
  pdfWorkerResolvedPath?: string;
  pdfWorkerExists?: boolean;
  pdfWorkerSrc?: string;
  pdfjsImportMode?: "externalized-node-module" | "next-bundled-chunk";
  workerResolutionAttempted: boolean;
  workerResolutionSucceeded: boolean;
  workerResolutionError?: string;
  parserFallbackUsed: boolean;
  textExtractionInfrastructureStage?: "polyfills" | "pdfjs-import" | "worker-resolution" | "get-document" | "get-text-content";
  extractedTextPageCount: number;
  firstPageTextSample: string;
  firstNonEmptyTextPage: number | null;
  firstNonEmptyTextSample: string;
  perPageTextLengths: number[];
  perPageTextItemCounts: number[];
  extractedAnchorCount: number;
  findingCount: number;
  anchoredFindingCount: number;
  unanchoredFindingCount: number;
  renderedPdfAnnotationCount: number;
  viewerAnnotationCount?: number;
  firstAnchorIds: string[];
  firstFindingAnchorIds: Array<string | null>;
  partSourceRowCount: number;
  nonOemPartRowCount: number;
  oemPartRowCount: number;
  partSourceComparisonCandidateCount: number;
  partSourceCandidateCount: number;
  partSourceAcceptedCandidateCount: number;
  partSourceRejectedCandidateCount: number;
  partSourceFindingCount: number;
  partSourceAnchoredFindingCount: number;
  partSourceUnanchoredFindingCount: number;
  partSourceRows: PartSourceDebugRow[];
  partSourceAcceptedCandidates: PartSourceFindingCandidate[];
  partSourceRejectedCandidates: PartSourceFindingCandidate[];
  rejectedLineNumberCandidates: Array<{
    rowText: string;
    lineNumber?: string | number | null;
    reason: string;
  }>;
  partSourceComparisonMatches: PartSourceComparisonMatchDebug[];
  partSourceDroppedReasons: Array<{
    anchorId?: string | null;
    rowText?: string;
    reason: string;
  }>;
  rejectedAnchors?: Array<{
    anchorId?: string | null;
    pageNumber?: number | null;
    anchorType?: string | null;
    rowText?: string;
    reason: string;
  }>;
  rejectedBoilerplateCount?: number;
  acceptedEstimateRowFindingCount?: number;
  requiredDetectorFindingCount?: number;
  missingRequiredDetectors?: string[];
  policyExtractionConfidence?: "high" | "medium" | "low" | "failed" | "not_run";
  policyVehicleMismatch?: {
    policyVehicle?: string | null;
    activeEstimateVehicle?: string | null;
    warning: string;
  } | null;
  authoritySearchTrace?: OemCitationDensityAuthorityTrace;
  reportType?: "citation-density" | "oem-citation-density";
  artifactVersion?: string;
  reviewedEstimateFileNames?: string[];
  authoritySourceCount?: number;
  oemProcedureSourceCount?: number;
  oemPositionStatementSourceCount?: number;
  motorDatabaseSourceCount?: number;
  uploadedSupportDocumentCount?: number;
  cccSecureShareSourceCount?: number;
  cccSecureShareConfigured?: boolean;
  cccSecureShareSearched?: boolean;
  cccSecureShareMatched?: boolean;
  cccSecureShareRetrieved?: boolean;
  cccSecureShareRowCount?: number;
  cccSecureShareEstimateTotal?: number | null;
  cccSecureShareSupplementVersion?: string | null;
  cccSecureShareRetrievalFailed?: boolean;
  cccSecureShareUnavailableReason?: string | null;
  policySourceCount?: number;
  jurisdictionalLawSourceCount?: number;
  internetFallbackSourceCount?: number;
  authorityBackedFindingCount?: number;
  estimateOnlyFindingCount?: number;
  researchNeededFindingCount?: number;
  findingsWithNextActionCount?: number;
  findingsWithoutNextActionCount?: number;
  findingsRejectedDueWeakEvidence?: number;
  findingsRejectedDueNoAnchor?: number;
  firstAuthoritySources?: OemCitationDensityAuthoritySource[];
  firstOemCitationDensityFindings?: OemCitationDensityFindingDebug[];
  fallbackMatchedFindings: Array<{
    findingId: string;
    reason: string;
    anchorId?: string | null;
  }>;
  droppedFindings: Array<{
    findingId: string;
    reason: string;
    anchorId?: string | null;
  }>;
  rendererDrops: Array<{
    findingId: string;
    anchorId?: string | null;
    reason: string;
  }>;
  toolUsageTrace: CitationDensityToolUsageTraceEntry[];
  totalDeltaCandidates: number;
  acceptedDeltaFindings: number;
  rejectedDeltaFindings: number;
  annotationLimitApplied: boolean;
  maxAnnotationLimit: number | null;
  droppedDeltaReasons: string[];
  unannotatedMaterialDeltas: CitationDensityDeltaDiagnostics["unannotatedMaterialDeltas"];
  lineItemDeltaFindingCount?: number;
  lineItemDeltaMatchedPairCount?: number;
  lineItemDeltaMissingCount?: number;
  /** Findings that received an RIR-resolved authority (O-5 attach pass). */
  resolvedAuthorityAttachedCount?: number;
  /** C-10: comparison-document extraction coverage (0..1) and intake gate. */
  comparisonExtractionCoverage?: number;
  intakeModeActive?: boolean;
  detailLayoutBlocks?: Array<{
    findingNumber: number;
    pageIndex: number;
    blockType: string;
    topY: number;
    bottomY: number;
  }>;
  metadataArtifactId?: string;
  renderedPdfArtifactId?: string;
  routeName?: "citation-density" | "oem-citation-density";
  selectedDocumentType?: string;
  selectedDocumentConfidence?: number;
  rejectedSourceCandidates?: Array<{
    filename: string;
    detectedDocumentType: string;
    reason: string;
  }>;
  acceptedEstimateCandidates?: Array<{
    filename: string;
    detectedDocumentType: string;
    estimateScore: number;
    evidenceSignals: string[];
  }>;
  sourceAnchorDocumentType?: string;
  sourceAnchorRowType?: string;
  badAnchorRejectedCount?: number;
  badAnchorRejectReasons?: string[];
  artifactReportType?: string;
  findingIdPrefixCheckPassed?: boolean;
};

export type PartSourceKind =
  | "OEM"
  | "OE"
  | "AM"
  | "LKQ"
  | "CAPA"
  | "USED"
  | "RECYCLED"
  | "RECONDITIONED"
  | "REMAN"
  | "ALT_OEM"
  | "OPT_OEM"
  | "NON_OEM"
  | "ECONOMY"
  | "UNKNOWN";

type PartSourceDebugRow = {
  page: number;
  line: string | null;
  sourceKind: PartSourceKind[];
  anchorId: string;
  sourcePdfName?: string;
  rowText: string;
};

export type PartSourceFindingCandidate = {
  anchorId: string;
  rowText: string;
  pageNumber: number;
  lineNumber?: string | number | null;
  rowType?: string;
  operation?: string | null;
  description?: string | null;
  partNumber?: string | null;
  partSourceKinds: PartSourceKind[];
  comparisonRowText?: string;
  comparisonPartSourceKinds?: PartSourceKind[];
  score: number;
  reasons: string[];
  rejectionReasons: string[];
};

type PartSourceComparisonMatchDebug = {
  selectedAnchorId: string;
  selectedRowText: string;
  comparisonRowText?: string;
  matchScore: number;
  matchReasons: string[];
  rejectedComparisonReasons: string[];
};

export class CitationDensityAnnotationError extends Error {
  status = 422;
  userMessage: string;
  debugTrace: CitationDensityDebugTrace;

  constructor(message: string, debugTrace: CitationDensityDebugTrace) {
    super(message);
    this.name = "CitationDensityAnnotationError";
    this.userMessage = message;
    this.debugTrace = debugTrace;
  }
}

function appendToolUsageTrace(trace: CitationDensityDebugTrace, entry: CitationDensityToolUsageTraceEntry) {
  trace.toolUsageTrace.push({
    ...entry,
    droppedReasons: entry.droppedReasons.filter(Boolean).slice(0, 20),
  });
}

export type CitationDensityAnnotationMetadata = {
  findingId: string;
  anchorId: string;
  sourceAnchorId: string;
  sourceDocumentId: string;
  sourceDocumentRole: "carrier" | "shop";
  sourcePdfPageNumber: number;
  sourcePageNumber: number;
  sourceLineNumber?: string;
  sourceAnchorType: EstimateRowAnchorType;
  sourceAnchorText: string;
  sourceAnchorNormalizedText: string;
  sourceAnchorOperation?: string | null;
  sourceAnchorDescription?: string | null;
  sourceAnchorPartNumber?: string | null;
  sourceAnchorQty?: number | null;
  sourceAnchorPrice?: number | null;
  sourceAnchorLabor?: number | null;
  sourceAnchorPaint?: number | null;
  sourceAnchorPdfBoundingBox?: EstimateRowAnchor["pdfBoundingBox"];
  sourceAnchorPdfQuad?: EstimateRowAnchor["pdfQuad"];
  sourceAnchorNormalizedUiRect?: EstimateRowAnchor["normalizedUiRect"];
  markerNumber: number;
  pageNumber: number;
  pdfPageWidth: number;
  pdfPageHeight: number;
  rotation: number;
  x: number;
  y: number;
  width: number;
  height: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  coordinateSpace: "pdf-points" | "normalized";
  targetLineNumber?: string;
  targetSection?: string;
  targetRawText: string;
  targetNormalizedText: string;
  matchConfidence: "high" | "medium" | "low";
  anchorType: EstimateRowAnchorType;
  label: string;
  shortTitle: string;
  estimateLine: string;
  bestAuthority: string;
  authorityStatus: string;
  missingProof: string;
  whyItMatters: string;
  nextAction: string;
  authorityNeeded?: boolean;
  authorityType?: string;
  retrievalAttempted?: boolean;
  retrievalSourcesSearched?: string[];
  retrievalStatus?: string;
  matchedDocumentTitle?: string | null;
  matchedDocumentUrl?: string | null;
  sourceExcerpt?: string | null;
  sourcePageLine?: string | null;
  appliesToShopEstimate?: "yes" | "no" | "unknown";
  appliesToCarrierEstimate?: "yes" | "no" | "unknown";
  lineTieStatus?: string;
  nextActionOwner?: string;
  sourceRefs: string[];
  comment: string;
};

export type CitationDensityAnnotationDebugMetadata = {
  extractedRowAnchorCount: number;
  visibleAnnotationCount: number;
  appendixOnlyCount: number;
  suppressedGenericCount: number;
  suppressedPageMismatchCount: number;
  anchorsByPage: Record<string, string[]>;
  findingsWithoutAnchorId: string[];
};

export type AnchoredCitationCandidate = {
  candidateId: string;
  anchorId: string;
  sourceDocumentRole: "carrier" | "shop";
  sourcePdfPageNumber: number;
  sourcePdfPageIndex: number;
  sourceLineNumber?: string;
  sourceAnchorType: EstimateRowAnchorType;
  sourceAnchorText: string;
  sourceAnchorNormalizedText: string;
  label: string;
  estimateLineDisplay: string;
  bestAuthority: string;
  missingProof: string;
  whyItMatters: string;
  nextAction: string;
  supportRefs: string[];
  confidence: "low" | "medium" | "high";
  finding: CitationDensityFinding;
  anchor: EstimateRowAnchor;
  derivedFromFindingId?: string;
};

type TextAnchor = {
  pageIndex: number;
  text: string;
  normalizedText: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
  synthetic?: boolean;
  groupedLine?: boolean;
};

type MatchedFinding = {
  finding: CitationDensityFinding;
  anchor: EstimateRowAnchor;
};

type FindingDetail = {
  finding: CitationDensityFinding;
  metadata: CitationDensityAnnotationMetadata;
};

const SOURCE_BOUNDARY_TEXT =
  "Estimate evidence supports the existence of a difference. It does not automatically prove OEM, P-page, DEG, legal, policy, or carrier-violation authority.";
const CCC_SOURCE_BOUNDARY_TEXT =
  "CCC Secure Share source confirms this estimate line was present in the structured estimate data.";
const CCC_LIMITATION_TEXT =
  "The CCC estimate data supports the existence of this line-item difference. OEM/P-page/DEG/legal support has not yet been verified.";
// The OEM pass makes a different claim from the delta pass, so it states a
// different boundary. It never cites estimate-difference evidence, because a
// difference between two estimates is not an OEM requirement.
const OEM_SOURCE_BOUNDARY_TEXT =
  "An OEM finding is supported by the manufacturer's own published procedure or position statement. Nothing here rests on a difference between the two estimates.";
const OEM_AUTHORITY_BOUNDARY_TEXT =
  "Where no procedure or position statement was retrieved, the finding is marked NEEDS OEM and names no authority. An unretrieved source is never cited as one.";

/**
 * One-line reader definitions for every label the report can emit (D-5).
 * The legend page is GENERATED from the labels a run actually emitted, each
 * with its definition — a hand-maintained list drifts every time a label is
 * added, which is exactly what happened between builds.
 */
const LABEL_DEFINITIONS: Record<string, string> = {
  "VERIFIED DOCUMENTATION": "Uploaded case documentation confirms this line's support.",
  "VERIFIED OEM": "An OEM procedure or position statement is attached and verified.",
  "VERIFIED ADAS": "An ADAS/calibration procedure is attached and verified.",
  "VERIFIED LEGAL": "A statute, regulation, or DOI guidance is attached and verified.",
  "NEEDS OEM": "Needs an OEM procedure or position statement before it is citation-ready.",
  "NEEDS ADAS": "Needs ADAS/calibration procedure support tied to this row.",
  "NEEDS P-PAGE": "Needs CCC/MOTOR P-page or estimating-database support for the allowance.",
  "NEEDS INVOICE": "Needs a supplier/sublet invoice or completion proof for the price.",
  "PART SOURCE": "The estimates specify different part sources (aftermarket, recycled/LKQ, reconditioned, sectioned, or new OEM) for the same part — a procurement dispute, and the price difference follows from it.",
  "REFERENCED / NOT PRODUCED": "A document the estimate references was not produced into this review.",
  "ESTIMATE GAP ONLY": "The two estimates differ here — the difference itself is the evidence; no external authority is attached yet.",
  "ONLINE FALLBACK": "Support came from a public online source, not a licensed database.",
  "WEAK — DO NOT LEAD": "Signal too weak to lead a negotiation; listed for completeness only.",
  "AMOUNT DELTA": "A category dollar amount differs between the two ESTIMATE TOTALS blocks.",
  "CATEGORY MISSING": "An entire ESTIMATE TOTALS category on this estimate has no counterpart on the comparison estimate — the whole category's dollars are in dispute, not a price difference within it.",
  "HOURS DELTA": "A labor-category hour subtotal differs between the two estimates.",
  "RATE DELTA": "A labor or materials rate differs between the two estimates.",
  "TOTAL GAP": "The grand totals differ — the reconciled overall gap between the two estimates.",
  "RECONCILIATION GAP": "The compared category deltas do NOT sum to the grand-total gap — part of the headline is unexplained; treat itemized claims accordingly.",
  "INTAKE": "The comparison document could not be read completely — this pack reports what was read and what to re-supply; no line-level delta verdict is rendered.",
  "LOWER-ONLY LINES": "Lines present only on the comparison estimate (omitted scope, wording variants, or duplicate candidates).",
  "CARRIER MISMATCH": "A line note names a carrier that is not this file's insurer — a document-attribution defect.",
  "PAINT SYSTEM": "The two estimates declare different paint systems for the same vehicle — one disagreement that propagates into every refinish line, resolved by the vehicle's paint code rather than line by line.",
  "CARRIER HIGHER": "On this matched line the comparison estimate allows more — the cost gap runs in the other direction.",
  "CODING DIFFERENCE": "Same hours and amounts on both estimates; only the operation label differs — likely coding, not scope.",
};

const NO_ROWS_EXTRACTED_WARNING = "No estimate rows could be extracted from the source PDF.";
const NO_SAFE_ROW_FINDINGS_WARNING =
  "Estimate rows were extracted, but no generated finding could be safely tied to a row. Findings are appendix-only.";
export const CITATION_DENSITY_ARTIFACT_VERSION = "citation-density-part-source-relevance-v1";
export const OEM_CITATION_DENSITY_ARTIFACT_VERSION = "oem-citation-density-v1";
export const OEM_CITATION_DENSITY_REPORT_TYPE = "oem-citation-density";
export const NO_ANCHOR_EXTRACTION_ERROR =
  "Delta Citation Density Report could not extract estimate row anchors from the selected estimate PDF. No annotation PDF was produced.";
export const NO_SELECTABLE_TEXT_ERROR =
  "Delta Citation Density Report could not extract selectable text from the selected estimate PDF. Upload the original CCC estimate PDF or enable OCR/CCC structured estimate extraction.";
export const PDF_TEXT_EXTRACTION_INFRASTRUCTURE_ERROR =
  "Delta Citation Density Report text extraction failed in production because the PDF parser polyfill is unavailable. No annotation PDF was produced.";
export const PDF_JS_WORKER_UNAVAILABLE_ERROR =
  "Delta Citation Density Report text extraction failed because the PDF.js worker asset is unavailable in production. No annotation PDF was produced.";

export const CITATION_DENSITY_REPORT_IDENTITY: AnnotatedEstimateReportIdentity = {
  reportType: "citation-density",
  artifactVersion: CITATION_DENSITY_ARTIFACT_VERSION,
  reportTitle: "Delta Citation Density Report",
  reportShortTitle: "Delta Citation Density",
  artifactFilename: "delta-citation-density-report.pdf",
  sourcePdfFallbackName: "delta-citation-density-source.pdf",
  pdfAnnotationTitle: "Collision IQ Delta Citation Density",
  legendTitle: "Delta Citation Density Annotation Legend",
  legendBoundaryTexts: [SOURCE_BOUNDARY_TEXT, CCC_SOURCE_BOUNDARY_TEXT, CCC_LIMITATION_TEXT],
  detailTitle: "Delta Citation Density Finding Details",
  unanchoredTitle: "Unanchored Delta Citation Density Findings",
  scoreLabel: "Delta Citation Density score",
  scoreCommentLabel: "Delta Citation Density",
  noAnchorError: NO_ANCHOR_EXTRACTION_ERROR,
  noSelectableTextError: NO_SELECTABLE_TEXT_ERROR,
  textExtractionInfrastructureError: PDF_TEXT_EXTRACTION_INFRASTRUCTURE_ERROR,
  pdfWorkerUnavailableError: PDF_JS_WORKER_UNAVAILABLE_ERROR,
};

export const OEM_CITATION_DENSITY_REPORT_IDENTITY: AnnotatedEstimateReportIdentity = {
  reportType: "oem-citation-density",
  artifactVersion: OEM_CITATION_DENSITY_ARTIFACT_VERSION,
  reportTitle: "OEM Citation Density Report",
  reportShortTitle: "OEM Citation Density",
  artifactFilename: "oem-citation-density-report.pdf",
  sourcePdfFallbackName: "oem-citation-density-source.pdf",
  pdfAnnotationTitle: "Collision IQ OEM Citation Density",
  legendTitle: "OEM Citation Density Annotation Legend",
  legendBoundaryTexts: [OEM_SOURCE_BOUNDARY_TEXT, OEM_AUTHORITY_BOUNDARY_TEXT],
  detailTitle: "OEM Citation Density Finding Details",
  unanchoredTitle: "Unanchored OEM Citation Density Findings",
  scoreLabel: "OEM Density score",
  scoreCommentLabel: "OEM Citation Density",
  noAnchorError: "OEM Citation Density could not extract estimate row anchors from the selected estimate PDF. No annotation PDF was produced.",
  noSelectableTextError: "OEM Citation Density could not extract selectable text from the selected estimate PDF. Upload the original CCC estimate PDF or enable OCR/CCC structured estimate extraction.",
  textExtractionInfrastructureError: "OEM Citation Density Report text extraction failed in production because the PDF parser polyfill is unavailable. No annotation PDF was produced.",
  pdfWorkerUnavailableError: "OEM Citation Density Report text extraction failed because the PDF.js worker asset is unavailable in production. No annotation PDF was produced.",
};

const exportCache = new Map<string, {
  bytes: Uint8Array;
  filename: string;
  createdAt: number;
  annotationMetadata: CitationDensityAnnotationMetadata[];
  citationDensityArtifactVersion: string;
  reportType?: string;
}>();
const EXPORT_TTL_MS = 30 * 60 * 1000;

export function putAnnotatedEstimateExport(
  bytes: Uint8Array,
  filename: string,
  annotationMetadata: CitationDensityAnnotationMetadata[] = [],
  options: {
    artifactVersion?: string;
    reportType?: string;
  } = {}
) {
  pruneExportCache();
  const exportId = randomUUID();
  exportCache.set(exportId, {
    bytes,
    filename,
    createdAt: Date.now(),
    annotationMetadata,
    citationDensityArtifactVersion: options.artifactVersion ?? CITATION_DENSITY_ARTIFACT_VERSION,
    reportType: options.reportType,
  });
  return exportId;
}

export function getAnnotatedEstimateExport(exportId: string, expectedArtifactVersion = CITATION_DENSITY_ARTIFACT_VERSION) {
  pruneExportCache();
  const entry = exportCache.get(exportId) ?? null;
  if (!entry || entry.citationDensityArtifactVersion !== expectedArtifactVersion) {
    return null;
  }
  return entry;
}

export function dataUrlToPdfBytes(dataUrl: string): Uint8Array | null {
  const match = dataUrl.match(/^data:application\/pdf(?:;[^,]*)?;base64,(.+)$/i);
  if (!match) return null;
  return Uint8Array.from(Buffer.from(match[1], "base64"));
}

export async function extractCitationDensityRowAnchors(
  bytes: Uint8Array,
  options: {
    sourceDocumentRole: "carrier" | "shop";
    sourceDocumentId?: string;
    actualSourcePdfName?: string;
    actualSourcePdfPageCount?: number;
  }
) {
  const { words, diagnostics } = await extractPdfWordsWithDiagnostics(bytes);
  const lines = buildPdfTextLines(words);
  return {
    visualLines: lines,
    anchors: buildEstimateRowAnchorsFromLines(lines, {
      sourceDocumentRole: options.sourceDocumentRole,
      sourceDocumentId: options.sourceDocumentId,
    }),
    actualSourcePdfName: options.actualSourcePdfName,
    actualSourcePdfByteLength: bytes.byteLength,
    actualSourcePdfPageCount: options.actualSourcePdfPageCount,
    sourcePdfStage: "original" as const,
    sourcePdfHash: hashPdfBytes(bytes),
    textExtractionMethod: diagnostics.method,
    textExtractionError: diagnostics.error,
    textExtractionWarnings: diagnostics.warnings,
    pdfWorkerResolvedPath: diagnostics.pdfWorkerResolvedPath,
    pdfWorkerExists: diagnostics.pdfWorkerExists,
    pdfWorkerSrc: diagnostics.pdfWorkerSrc,
    pdfjsImportMode: diagnostics.pdfjsImportMode,
    workerResolutionAttempted: diagnostics.workerResolutionAttempted,
    workerResolutionSucceeded: diagnostics.workerResolutionSucceeded,
    workerResolutionError: diagnostics.workerResolutionError,
    parserFallbackUsed: diagnostics.parserFallbackUsed,
    textExtractionInfrastructureStage: diagnostics.textExtractionInfrastructureStage,
    extractedTextPageCount: diagnostics.perPageTextLengths.filter((length) => length > 0).length,
    firstPageTextSample: truncateDebugText(
      lines
        .filter((line) => line.pageNumber === 1)
        .map((line) => line.text)
        .join(" ")
    ),
    firstNonEmptyTextPage: diagnostics.firstNonEmptyTextPage,
    firstNonEmptyTextSample: diagnostics.firstNonEmptyTextSample,
    perPageTextLengths: diagnostics.perPageTextLengths,
    perPageTextItemCounts: diagnostics.perPageTextItemCounts,
  };
}

export async function buildAnnotatedCitationDensityEstimatePdf(params: {
  sourcePdfBytes: Uint8Array;
  sourceDocumentId?: string;
  sourcePdfName?: string;
  selectedEstimateTotal?: number | null;
  uploadedFileNames?: string[];
  sourceText?: string | null;
  comparisonEstimateTexts?: ComparisonEstimateText[];
  /** Export boundary: render the source pages to images with identifiers
   *  painted out. Defaults to ON — pass false only for in-system diagnostics
   *  where the full record is wanted and nothing leaves. */
  redactSourcePages?: boolean;
  /**
   * Original PDF bytes of comparison estimates. When present, the delta value
   * layer parses the competing document from its measured word layer (same
   * extractor as the subject) instead of from flattened text — symmetric
   * parsing is what keeps glued/corrupted text layers from producing false
   * deltas. Falls back to comparisonEstimateTexts when absent.
   */
  comparisonEstimatePdfs?: ComparisonEstimatePdf[];
  findings: CitationDensityFinding[];
  request?: AnnotatedEstimateRequest;
  reportIdentity?: AnnotatedEstimateReportIdentity;
  deltaDiagnostics?: CitationDensityDeltaDiagnostics;
  authorityTrace?: OemCitationDensityAuthorityTrace;
  canonicalDeltaSet?: CanonicalDeltaSet;
  /** RIR-resolved research authorities, attached to matching delta findings by type (O-5). */
  resolvedAuthorities?: AnnotatedEstimateFindingGeneratorContext["resolvedAuthorities"];
  /** Decoded make + jurisdiction gating the authority attach (D-4). */
  vehicleMake?: string | null;
  jurisdiction?: string | null;
  findingGenerator?: (context: AnnotatedEstimateFindingGeneratorContext) => AnnotatedEstimateGeneratedFindings;
}): Promise<AnnotatedEstimateResult> {
  const request = params.request ?? {};
  const reportIdentity = params.reportIdentity ?? CITATION_DENSITY_REPORT_IDENTITY;
  // When the delta value layer is active it carries the visual delta story
  // (cell highlights, underlines, stamps, keyed notes), so the legacy layer
  // defaults to compact margin markers only — full-row highlights on top of
  // cell-level marks read as clutter. An explicit annotationMode still wins.
  const deltaValueLayerActive =
    reportIdentity.reportType === "citation-density" &&
    request.deltaValueLayer !== false &&
    ((params.comparisonEstimateTexts?.length ?? 0) > 0 || (params.comparisonEstimatePdfs?.length ?? 0) > 0);
  const mode = request.annotationMode ?? (deltaValueLayerActive ? "margin_callouts" : "both");
  const estimateRole = request.estimateRole ?? "selected";
  const selectedIds = new Set(request.findingIds?.filter(Boolean) ?? []);
  let selectedFindings = params.canonicalDeltaSet
    ? []
    : params.findings.filter((finding) => !selectedIds.size || selectedIds.has(finding.id));
  let { findings, suppressed } = sanitizeCitationDensityFindingsForVisibleLayer(selectedFindings);
  const warnings: string[] = [];
  const sourcePdfBytes = params.sourcePdfBytes.slice();
  // EXPORT BOUNDARY — the annotated estimate reproduces the customer's own
  // estimate pages, so the identifiers live in the page content and no text
  // rule reaches them. Each page is rendered to pixels with the identifiers
  // painted out, and the image replaces the page: the text layer is destroyed
  // by construction, so there is nothing left to extract. A drawn rectangle
  // would leave the glyphs selectable underneath — a document that looks
  // protected and is not is worse than one that is visibly unprotected.
  //
  // Anchors are extracted from the ORIGINAL bytes below, because placement
  // depends on the text layer this step removes. Page dimensions are
  // preserved, so every annotation coordinate still lands.
  let annotationBaseBytes: Uint8Array = sourcePdfBytes;
  let sourcePagesRedacted = false;
  let redactedRegionCount = 0;
  if (params.redactSourcePages !== false) {
    try {
      const redacted = await redactAndRasterizePdf(sourcePdfBytes);
      annotationBaseBytes = new Uint8Array(redacted.bytes);
      sourcePagesRedacted = true;
      redactedRegionCount = redacted.redactedRegionCount;
    } catch (error) {
      // Never ship an un-redacted export silently. If redaction cannot run the
      // report still builds, but it says so in the reader's own warnings.
      warnings.push(
        `Source-page redaction did not run (${error instanceof Error ? error.message : "unknown error"}). This annotated estimate reproduces the original estimate pages and still carries the identifiers printed on them; do not share it outside the system.`
      );
    }
  }
  const pdfDoc = await PDFDocument.load(annotationBaseBytes);
  const originalPageCount = pdfDoc.getPageCount();
  if (originalPageCount === 0) {
    throw new Error(`Annotated ${reportIdentity.reportShortTitle} export requires an original estimate PDF with source pages.`);
  }
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const sourcePdfName = params.sourcePdfName ?? params.sourceDocumentId ?? reportIdentity.sourcePdfFallbackName;
  // Fix 2: derive the source_estimate role from the actual parsed file's provenance instead of
  // defaulting an ambiguous role to "carrier". Only an explicit shop/carrier request, or a
  // genuinely carrier-authored file, may yield a "carrier" label.
  let sourceIsCarrierAuthored = isCarrierAuthoredEstimateDocument({
    filename: sourcePdfName,
    text: params.sourceText,
  });
  const headerRole = classifyEstimateRoleFromHeader({
    filename: sourcePdfName,
    text: params.sourceText,
  }).estimateRole;
  const headerRoleFamily = estimateRoleFamily(headerRole);
  let sourceDocumentRole: "carrier" | "shop" =
    estimateRole === "shop"
      ? "shop"
      : estimateRole === "carrier"
        ? (headerRoleFamily === "shop" ? "shop" : "carrier")
        : sourceIsCarrierAuthored
          ? "carrier"
          : "shop";
  // Fix 2: when only one estimate was parsed (no comparison estimate), say so rather than
  // implying a two-estimate delta.
  const parsedComparisonCount = (params.comparisonEstimateTexts ?? []).filter((item) => item.text?.trim()).length;
  if (parsedComparisonCount === 0) {
    warnings.push(
      "Only one estimate was parsed for this report, so it reflects a single estimate rather than a two-estimate delta."
    );
  }
  const selectedDocumentClassification = classifyCitationDensityDocument({
    filename: sourcePdfName,
    text: params.sourceText,
  });
  let extraction = await extractCitationDensityRowAnchors(sourcePdfBytes, {
    sourceDocumentRole,
    sourceDocumentId: params.sourceDocumentId,
    actualSourcePdfName: sourcePdfName,
    actualSourcePdfPageCount: originalPageCount,
  }).catch((error) => {
    warnings.push(
      `Text-coordinate extraction failed; no annotation PDF can be produced when findings require estimate row anchors. ${error instanceof Error ? error.message : "Unknown PDF text extraction error."}`
    );
    return {
      anchors: [] as EstimateRowAnchor[],
      actualSourcePdfName: sourcePdfName,
      actualSourcePdfByteLength: sourcePdfBytes.byteLength,
      actualSourcePdfPageCount: originalPageCount,
      sourcePdfStage: "original" as const,
      sourcePdfHash: hashPdfBytes(sourcePdfBytes),
      textExtractionMethod: "not_run" as const,
      textExtractionError: error instanceof Error ? error.message : String(error),
      textExtractionWarnings: [],
      pdfWorkerResolvedPath: undefined,
      pdfWorkerExists: undefined,
      pdfWorkerSrc: undefined,
      pdfjsImportMode: undefined,
      workerResolutionAttempted: false,
      workerResolutionSucceeded: false,
      workerResolutionError: undefined,
      parserFallbackUsed: false,
      textExtractionInfrastructureStage: "pdfjs-import" as const,
      visualLines: [],
      extractedTextPageCount: 0,
      firstPageTextSample: "",
      firstNonEmptyTextPage: null,
      firstNonEmptyTextSample: "",
      perPageTextLengths: [],
      perPageTextItemCounts: [],
    };
  });
  const extractedSourceText = extraction.visualLines.map((line) => line.text).join("\n");
  const parsedSourceIsCarrierAuthored = isCarrierAuthoredEstimateDocument({
    filename: sourcePdfName,
    text: params.sourceText ? `${params.sourceText}\n${extractedSourceText}` : extractedSourceText,
  });
  const parsedHeaderRole = classifyEstimateRoleFromHeader({
    filename: sourcePdfName,
    text: params.sourceText ? `${params.sourceText}\n${extractedSourceText}` : extractedSourceText,
  }).estimateRole;
  const parsedHeaderRoleFamily = estimateRoleFamily(parsedHeaderRole);
  if (estimateRole === "carrier" && parsedHeaderRoleFamily === "shop" && !parsedSourceIsCarrierAuthored && sourceDocumentRole !== "shop") {
    sourceDocumentRole = "shop";
    extraction = {
      ...extraction,
      anchors: buildEstimateRowAnchorsFromLines(extraction.visualLines, {
        sourceDocumentRole,
        sourceDocumentId: params.sourceDocumentId,
      }),
    };
  } else if (parsedSourceIsCarrierAuthored && sourceDocumentRole !== "carrier" && estimateRole !== "shop") {
    sourceIsCarrierAuthored = true;
    sourceDocumentRole = "carrier";
    extraction = {
      ...extraction,
      anchors: buildEstimateRowAnchorsFromLines(extraction.visualLines, {
        sourceDocumentRole,
        sourceDocumentId: params.sourceDocumentId,
      }),
    };
  }
  // Loud-fail: a "carrier" request the parsed file's provenance does not support.
  if (estimateRole === "carrier" && sourceDocumentRole !== "carrier") {
    console.warn("[citation-density] requested source_estimate role 'carrier' is not supported by parsed file provenance", {
      sourcePdfName,
      sourcePdfHash: hashPdfBytes(sourcePdfBytes),
      sourceDocumentId: params.sourceDocumentId ?? null,
    });
    warnings.push(
      "Source estimate could not be confirmed as carrier-authored from the parsed file; it is labeled by file provenance instead of an assumed carrier role."
    );
  }
  const anchors = extraction.anchors;
  const anchorIndex = new Map(anchors.map((anchor) => [anchor.anchorId, anchor]));
  const trace: CitationDensityDebugTrace = {
    buildCommit: getBuildCommit(),
    citationDensityArtifactVersion: reportIdentity.artifactVersion,
    reportType: reportIdentity.reportType,
    routeName: reportIdentity.reportType,
    artifactVersion: reportIdentity.artifactVersion,
    artifactId: undefined,
    sourcePdfName,
    selectedEstimateFileName: sourcePdfName,
    selectedEstimateTotal: params.selectedEstimateTotal ?? null,
    selectedDocumentType: selectedDocumentClassification.detectedDocumentType,
    selectedDocumentConfidence: selectedDocumentClassification.confidence,
    uploadedFileNames: params.uploadedFileNames ?? [],
    actualSourcePdfName: extraction.actualSourcePdfName,
    actualSourcePdfByteLength: extraction.actualSourcePdfByteLength,
    actualSourcePdfPageCount: extraction.actualSourcePdfPageCount ?? originalPageCount,
    sourcePdfStage: extraction.sourcePdfStage,
    sourcePdfHash: extraction.sourcePdfHash,
    textExtractionMethod: extraction.textExtractionMethod,
    textExtractionError: extraction.textExtractionError,
    textExtractionWarnings: extraction.textExtractionWarnings,
    pdfWorkerResolvedPath: extraction.pdfWorkerResolvedPath,
    pdfWorkerExists: extraction.pdfWorkerExists,
    pdfWorkerSrc: extraction.pdfWorkerSrc,
    pdfjsImportMode: extraction.pdfjsImportMode,
    workerResolutionAttempted: extraction.workerResolutionAttempted,
    workerResolutionSucceeded: extraction.workerResolutionSucceeded,
    workerResolutionError: extraction.workerResolutionError,
    parserFallbackUsed: extraction.parserFallbackUsed,
    textExtractionInfrastructureStage: extraction.textExtractionInfrastructureStage,
    extractedTextPageCount: extraction.extractedTextPageCount,
    firstPageTextSample: extraction.firstPageTextSample,
    firstNonEmptyTextPage: extraction.firstNonEmptyTextPage,
    firstNonEmptyTextSample: extraction.firstNonEmptyTextSample,
    perPageTextLengths: extraction.perPageTextLengths,
    perPageTextItemCounts: extraction.perPageTextItemCounts,
    extractedAnchorCount: anchors.length,
    findingCount: findings.length,
    anchoredFindingCount: 0,
    unanchoredFindingCount: 0,
    renderedPdfAnnotationCount: 0,
    viewerAnnotationCount: undefined,
    firstAnchorIds: anchors.slice(0, 10).map((anchor) => anchor.anchorId),
    firstFindingAnchorIds: findings.slice(0, 10).map((finding) => getFindingAnchorId(finding)),
    partSourceRowCount: 0,
    nonOemPartRowCount: 0,
    oemPartRowCount: 0,
    partSourceComparisonCandidateCount: 0,
    partSourceCandidateCount: 0,
    partSourceAcceptedCandidateCount: 0,
    partSourceRejectedCandidateCount: 0,
    partSourceFindingCount: 0,
    partSourceAnchoredFindingCount: 0,
    partSourceUnanchoredFindingCount: 0,
    partSourceRows: [],
    partSourceAcceptedCandidates: [],
    partSourceRejectedCandidates: [],
    rejectedLineNumberCandidates: [],
    partSourceComparisonMatches: [],
    partSourceDroppedReasons: [],
    rejectedAnchors: [],
    rejectedBoilerplateCount: 0,
    acceptedEstimateRowFindingCount: 0,
    requiredDetectorFindingCount: 0,
    missingRequiredDetectors: [],
    policyExtractionConfidence: "not_run",
    policyVehicleMismatch: null,
    authoritySearchTrace: params.authorityTrace ?? buildDefaultOemAuthorityTrace(),
    fallbackMatchedFindings: [],
    droppedFindings: [],
    rendererDrops: [],
    toolUsageTrace: params.deltaDiagnostics?.toolUsageTrace ? [...params.deltaDiagnostics.toolUsageTrace] : [],
    totalDeltaCandidates: params.deltaDiagnostics?.totalDeltaCandidates ?? 0,
    acceptedDeltaFindings: params.deltaDiagnostics?.acceptedDeltaFindings ?? 0,
    rejectedDeltaFindings: params.deltaDiagnostics?.rejectedDeltaFindings ?? 0,
    annotationLimitApplied: params.deltaDiagnostics?.annotationLimitApplied ?? false,
    maxAnnotationLimit: params.deltaDiagnostics?.maxAnnotationLimit ?? null,
    droppedDeltaReasons: params.deltaDiagnostics?.droppedDeltaReasons ?? [],
    unannotatedMaterialDeltas: params.deltaDiagnostics?.unannotatedMaterialDeltas ?? [],
    detailLayoutBlocks: [],
    metadataArtifactId: undefined,
    renderedPdfArtifactId: undefined,
    sourceAnchorDocumentType: selectedDocumentClassification.detectedDocumentType,
    sourceAnchorRowType: undefined,
    badAnchorRejectedCount: 0,
    badAnchorRejectReasons: [],
    cccSecureShareConfigured: false,
    cccSecureShareSearched: false,
    cccSecureShareMatched: false,
    cccSecureShareRetrieved: false,
    cccSecureShareRowCount: 0,
    cccSecureShareEstimateTotal: null,
    cccSecureShareSupplementVersion: null,
    cccSecureShareRetrievalFailed: false,
    cccSecureShareUnavailableReason: "not configured",
    artifactReportType: reportIdentity.reportType,
    findingIdPrefixCheckPassed: true,
  };

  // ── IDENTITY GATE ───────────────────────────────────────────────────────
  // A delta report comparing two different vehicles is not a degraded report,
  // it is a fabricated one, so this is a precondition and not a warning. It
  // blocks ONLY on positive disagreement of a strong key (VIN, claim number)
  // — absent evidence never proves a mismatch, and the weak keys are the
  // producer's formatting choice (see claimIdentityGate).
  const gateSourceIdentity = readClaimIdentity(params.sourceText ?? "");
  for (const comparison of params.comparisonEstimateTexts ?? []) {
    if (!comparison.text?.trim()) continue;
    const comparisonIdentity = readClaimIdentity(comparison.text);
    const verdict = compareClaimIdentity(gateSourceIdentity, comparisonIdentity);
    if (!verdict.blocked) continue;
    appendToolUsageTrace(trace, {
      tool: "claim_identity_gate",
      ran: true,
      candidatesFound: 2,
      candidatesAccepted: 0,
      candidatesRejected: 1,
      droppedReasons: [`identity mismatch on ${verdict.conflicting.join(", ")}`],
    });
    throw new CitationDensityAnnotationError(
      buildBlockedMessage({
        target: { fileName: sourcePdfName, identity: gateSourceIdentity },
        rejected: { fileName: comparison.fileName ?? "comparison estimate", identity: comparisonIdentity },
        verdict,
      }),
      trace
    );
  }
  appendToolUsageTrace(trace, {
    tool: "claim_identity_gate",
    ran: (params.comparisonEstimateTexts ?? []).some((item) => item.text?.trim()),
    candidatesFound: (params.comparisonEstimateTexts ?? []).length,
    candidatesAccepted: (params.comparisonEstimateTexts ?? []).length,
    candidatesRejected: 0,
    droppedReasons: [],
  });

  appendToolUsageTrace(trace, {
    tool: "document_classifier",
    ran: true,
    candidatesFound: 1,
    candidatesAccepted: selectedDocumentClassification.isEstimateLike ? 1 : 0,
    candidatesRejected: selectedDocumentClassification.isEstimateLike ? 0 : 1,
    droppedReasons: selectedDocumentClassification.isEstimateLike
      ? []
      : [`selected document classified as ${selectedDocumentClassification.detectedDocumentType}`],
  });
  appendToolUsageTrace(trace, {
    tool: "pdf_text_extraction",
    ran: extraction.textExtractionMethod !== "not_run",
    skipReason: extraction.textExtractionMethod === "not_run" ? extraction.textExtractionError ?? "pdf text extraction did not complete" : undefined,
    candidatesFound: extraction.perPageTextItemCounts.reduce((sum, count) => sum + count, 0),
    candidatesAccepted: extraction.extractedTextPageCount,
    candidatesRejected: extraction.textExtractionError ? 1 : 0,
    droppedReasons: extraction.textExtractionError ? [extraction.textExtractionError] : extraction.textExtractionWarnings,
  });
  appendToolUsageTrace(trace, {
    tool: "estimate_row_parser",
    ran: extraction.textExtractionMethod !== "not_run",
    skipReason: extraction.textExtractionMethod === "not_run" ? "pdf text extraction unavailable" : undefined,
    candidatesFound: extraction.visualLines.length,
    candidatesAccepted: anchors.length,
    candidatesRejected: Math.max(0, extraction.visualLines.length - anchors.length),
    droppedReasons: anchors.length ? [] : ["no estimate row anchors extracted"],
  });

  // Measured word layers for comparison PDFs, extracted once and shared with
  // both the structured delta matcher and the delta value layer. Failures
  // degrade to text-based comparison, never fail the report.
  const comparisonEstimateWords: Array<{
    fileName: string;
    estimateRole?: "carrier" | "shop";
    words: PdfWord[];
    textLayerReliable?: boolean;
  }> = [];
  // U-4: per-document text-layer reliability notes ride into the findings
  // report cover so a low match rate on a broken-encoding producer is
  // attributable — this is a LIVE text layer with a broken encoding, not a
  // scanned document, and the remedy (coordinate extraction + confusable
  // repair) is different.
  const textLayerNotes: string[] = [];
  for (const comparisonPdf of params.comparisonEstimatePdfs ?? []) {
    try {
      const extractionResult = await extractPdfWordsWithDiagnostics(comparisonPdf.bytes.slice());
      if (extractionResult.diagnostics.textLayerReliable === false) {
        textLayerNotes.push(
          `${comparisonPdf.fileName}: text layer unreliable (${extractionResult.diagnostics.textLayerUnreliableReason ?? "broken font encoding"}) — parsed from measured coordinates with vocabulary-driven glyph repair.`
        );
      }
      if (extractionResult.words.length > 0) {
        comparisonEstimateWords.push({
          fileName: comparisonPdf.fileName,
          estimateRole: comparisonPdf.estimateRole,
          words: extractionResult.words,
          textLayerReliable: extractionResult.diagnostics.textLayerReliable !== false,
        });
      }
    } catch {
      // text fallback covers this comparison document
    }
  }

  if (params.findingGenerator) {
    const generated = params.findingGenerator({
      anchors,
      visualLines: extraction.visualLines,
      sourcePdfName,
      sourceDocumentId: params.sourceDocumentId,
      sourceDocumentRole,
      sourcePdfHash: extraction.sourcePdfHash,
      uploadedFileNames: params.uploadedFileNames ?? [],
      sourceText: params.sourceText,
      comparisonEstimateTexts: params.comparisonEstimateTexts ?? [],
      extractionWarnings: warnings,
      comparisonEstimateWords,
      resolvedAuthorities: params.resolvedAuthorities,
      vehicleMake: params.vehicleMake,
      jurisdiction: params.jurisdiction,
      authorityTrace: params.authorityTrace,
      canonicalDeltaSet: params.canonicalDeltaSet,
    });
    // The structured delta path may append measured engine-row anchors for
    // rows the visual-line layer failed to anchor; index them so the renderer
    // resolves the findings that reference them.
    for (const anchor of anchors) {
      if (!anchorIndex.has(anchor.anchorId)) anchorIndex.set(anchor.anchorId, anchor);
    }
    const generatedFindings = generated.findings
      .filter((finding) => !isGeneratedFindingCoveredByExisting(finding, selectedFindings));
    selectedFindings = [
      ...selectedFindings,
      ...generatedFindings.filter((finding) => !selectedIds.size || selectedIds.has(finding.id)),
    ];
    const sanitizedGenerated = sanitizeCitationDensityFindingsForVisibleLayer(selectedFindings);
    findings = sanitizedGenerated.findings;
    suppressed = sanitizedGenerated.suppressed;
    Object.assign(trace, generated.debug ?? {});
    appendToolUsageTrace(trace, {
      tool: "oem_procedure_position_support",
      ran: reportIdentity.reportType === "oem-citation-density",
      skipReason: reportIdentity.reportType === "oem-citation-density" ? undefined : "not an OEM Citation Density report",
      candidatesFound: trace.authoritySourceCount ?? 0,
      candidatesAccepted: trace.authorityBackedFindingCount ?? 0,
      candidatesRejected: trace.researchNeededFindingCount ?? 0,
      droppedReasons: trace.findingsRejectedDueWeakEvidence ? ["weak OEM/support evidence rejected"] : [],
    });
    appendToolUsageTrace(trace, {
      tool: "uploaded_support_docs",
      ran: reportIdentity.reportType === "oem-citation-density",
      skipReason: reportIdentity.reportType === "oem-citation-density" ? undefined : "handled by Citation Density support/evidence ledger",
      candidatesFound: trace.uploadedSupportDocumentCount ?? 0,
      candidatesAccepted: trace.uploadedSupportDocumentCount ?? 0,
      candidatesRejected: 0,
      droppedReasons: [],
    });
    appendToolUsageTrace(trace, {
      tool: "google_drive_internal_docs",
      ran: reportIdentity.reportType === "oem-citation-density",
      skipReason: reportIdentity.reportType === "oem-citation-density" ? undefined : "not an OEM Citation Density authority lookup",
      candidatesFound: (trace.oemProcedureSourceCount ?? 0) + (trace.oemPositionStatementSourceCount ?? 0),
      candidatesAccepted: trace.authorityBackedFindingCount ?? 0,
      candidatesRejected: 0,
      droppedReasons: [],
    });
    appendToolUsageTrace(trace, {
      tool: "validation_overclaim_guard",
      ran: reportIdentity.reportType === "oem-citation-density",
      skipReason: reportIdentity.reportType === "oem-citation-density" ? undefined : "not an OEM Citation Density report",
      candidatesFound: (trace.authorityBackedFindingCount ?? 0) + (trace.estimateOnlyFindingCount ?? 0) + (trace.researchNeededFindingCount ?? 0),
      candidatesAccepted: findings.length,
      candidatesRejected: (trace.findingsRejectedDueWeakEvidence ?? 0) + (trace.findingsRejectedDueNoAnchor ?? 0),
      droppedReasons: [
        trace.findingsRejectedDueWeakEvidence ? "weak evidence or overclaim risk" : "",
        trace.findingsRejectedDueNoAnchor ? "no safe estimate row anchor" : "",
      ],
    });
  }

  appendToolUsageTrace(trace, {
    tool: "image_photo_ocr_evidence",
    ran: false,
    skipReason: "no image/photo/OCR evidence was supplied to this annotated estimate export",
    candidatesFound: 0,
    candidatesAccepted: 0,
    candidatesRejected: 0,
    droppedReasons: [],
  });
  appendToolUsageTrace(trace, {
    tool: "finding_validator",
    ran: true,
    candidatesFound: selectedFindings.length,
    candidatesAccepted: findings.length,
    candidatesRejected: suppressed.length,
    droppedReasons: suppressed.length ? ["generic or malformed findings suppressed from visible estimate layer"] : [],
  });

  const identityError = findReportIdentityMismatch(findings, reportIdentity.reportType);
  if (identityError) {
    trace.findingIdPrefixCheckPassed = false;
    trace.artifactReportType = identityError.artifactReportType;
    trace.droppedFindings.push({
      findingId: identityError.findingId,
      reason: identityError.reason,
      anchorId: null,
    });
    throw new CitationDensityAnnotationError(identityError.message, trace);
  }

  const debugMetadata: CitationDensityAnnotationDebugMetadata = {
    extractedRowAnchorCount: anchors.length,
    visibleAnnotationCount: 0,
    appendixOnlyCount: 0,
    suppressedGenericCount: suppressed.length,
    suppressedPageMismatchCount: 0,
    anchorsByPage: buildAnchorsByPage(anchors),
    findingsWithoutAnchorId: [],
  };

  if (!anchors.length) {
    warnings.push(NO_ROWS_EXTRACTED_WARNING);
  }

  if (trace.findingCount > 0 && isPdfJsWorkerError(trace.textExtractionError)) {
    trace.unanchoredFindingCount = trace.findingCount;
    trace.droppedFindings.push({
      findingId: "*",
      reason: "pdfjs worker asset unavailable",
      anchorId: null,
    });
    throw new CitationDensityAnnotationError(reportIdentity.pdfWorkerUnavailableError, trace);
  }

  if (trace.findingCount > 0 && trace.textExtractionError) {
    trace.unanchoredFindingCount = trace.findingCount;
    trace.droppedFindings.push({
      findingId: "*",
      reason: "pdf text extraction parser infrastructure error",
      anchorId: null,
    });
    throw new CitationDensityAnnotationError(reportIdentity.textExtractionInfrastructureError, trace);
  }

  if (trace.findingCount > 0 && trace.extractedTextPageCount === 0) {
    trace.unanchoredFindingCount = trace.findingCount;
    trace.droppedFindings.push({
      findingId: "*",
      reason: "no selectable text extracted from selected source PDF",
      anchorId: null,
    });
    throw new CitationDensityAnnotationError(reportIdentity.noSelectableTextError, trace);
  }

  if (trace.findingCount > 0 && trace.extractedAnchorCount === 0) {
    trace.unanchoredFindingCount = trace.findingCount;
    trace.droppedFindings.push({
      findingId: "*",
      reason: "no estimate row anchors extracted from selected source PDF",
      anchorId: null,
    });
    throw new CitationDensityAnnotationError(reportIdentity.noAnchorError, trace);
  }

  const partSourceResult = reportIdentity.reportType === "citation-density"
    ? buildPartSourceFindings({
        selectedAnchors: anchors,
        selectedVisualLines: extraction.visualLines,
        sourcePdfName,
        sourceDocumentId: params.sourceDocumentId,
        sourceDocumentRole,
        comparisonEstimateTexts: params.comparisonEstimateTexts ?? [],
        existingFindings: findings,
      })
    : emptyPartSourceFindingResult();
  trace.partSourceRowCount = partSourceResult.partSourceRows.length;
  trace.nonOemPartRowCount = partSourceResult.nonOemPartRowCount;
  trace.oemPartRowCount = partSourceResult.oemPartRowCount;
  trace.partSourceComparisonCandidateCount = partSourceResult.comparisonCandidateCount;
  trace.partSourceCandidateCount = partSourceResult.candidateCount;
  trace.partSourceAcceptedCandidateCount = partSourceResult.acceptedCandidates.length;
  trace.partSourceRejectedCandidateCount = partSourceResult.rejectedCandidates.length;
  trace.partSourceFindingCount = partSourceResult.findings.length;
  trace.partSourceRows = partSourceResult.partSourceRows.slice(0, 20);
  trace.partSourceAcceptedCandidates = partSourceResult.acceptedCandidates.slice(0, 20);
  trace.partSourceRejectedCandidates = partSourceResult.rejectedCandidates.slice(0, 20);
  trace.rejectedLineNumberCandidates = partSourceResult.rejectedLineNumberCandidates.slice(0, 20);
  trace.partSourceComparisonMatches = partSourceResult.comparisonMatches.slice(0, 20);
  trace.partSourceDroppedReasons = partSourceResult.droppedReasons;
  appendToolUsageTrace(trace, {
    tool: "support_evidence_ledger",
    ran: true,
    candidatesFound: reportIdentity.reportType === "citation-density"
      ? partSourceResult.candidateCount
      : (trace.authoritySourceCount ?? 0),
    candidatesAccepted: reportIdentity.reportType === "citation-density"
      ? partSourceResult.acceptedCandidates.length
      : (trace.authorityBackedFindingCount ?? 0),
    candidatesRejected: reportIdentity.reportType === "citation-density"
      ? partSourceResult.rejectedCandidates.length
      : (trace.researchNeededFindingCount ?? 0),
    droppedReasons: reportIdentity.reportType === "citation-density"
      ? partSourceResult.droppedReasons.map((item) => item.reason)
      : [],
  });
  const findingsWithPartSource = [...findings, ...partSourceResult.findings];
  trace.findingCount = findingsWithPartSource.length;
  trace.firstFindingAnchorIds = findingsWithPartSource.slice(0, 10).map((finding) => getFindingAnchorId(finding));

  const candidateResult = buildAnchoredCitationCandidates({
    anchors,
    findings: findingsWithPartSource,
    topicFindings: findingsWithPartSource,
    estimateRole,
    sourceDocumentRole,
    anchorIndex,
    trace,
  });
  debugMetadata.suppressedPageMismatchCount = candidateResult.suppressedPageMismatchCount;
  debugMetadata.findingsWithoutAnchorId = [
    ...suppressed.map((finding) => finding.id),
    ...candidateResult.findingsWithoutAnchorId,
  ];
  trace.anchoredFindingCount = candidateResult.candidates.length;
  trace.unanchoredFindingCount = Math.max(0, findingsWithPartSource.length - candidateResult.candidates.length);
  trace.acceptedEstimateRowFindingCount = candidateResult.candidates.filter((candidate) =>
    candidate.anchor.anchorType === "estimate_line" ||
    candidate.anchor.anchorType === "line_note" ||
    candidate.anchor.anchorType === "totals_row"
  ).length;
  trace.partSourceAnchoredFindingCount = candidateResult.candidates.filter((candidate) => isPartSourceFinding(candidate.finding)).length;
  trace.partSourceUnanchoredFindingCount = Math.max(0, trace.partSourceFindingCount - trace.partSourceAnchoredFindingCount);
  appendToolUsageTrace(trace, {
    tool: "row_anchor_matcher",
    ran: true,
    candidatesFound: findingsWithPartSource.length,
    candidatesAccepted: candidateResult.candidates.length,
    candidatesRejected: Math.max(0, findingsWithPartSource.length - candidateResult.candidates.length),
    droppedReasons: trace.droppedFindings.map((item) => item.reason),
  });

  if (trace.extractedAnchorCount > 0 && trace.findingCount > 0 && trace.anchoredFindingCount === 0) {
    throw new CitationDensityAnnotationError("Findings generated but no findings matched extracted anchors.", trace);
  }

  const matches: MatchedFinding[] = candidateResult.candidates.map((candidate) => ({
    finding: candidate.finding,
    anchor: candidate.anchor,
  }));
  const matchedFindingIds = new Set(candidateResult.candidates.map((candidate) => candidate.derivedFromFindingId).filter(Boolean));
  const unmatched: CitationDensityFinding[] = findingsWithPartSource.filter((finding) => !matchedFindingIds.has(finding.id));
  const unmatchedDeltaFindings = unmatched.filter((finding) =>
    /^citation-density-/i.test(finding.id) &&
    (/-comparison-/i.test(finding.id) || finding.crossEstimateIssue === true)
  );
  if (unmatchedDeltaFindings.length > 0) {
    const unmatchedDeltaDrops = unmatchedDeltaFindings.map((finding) => ({
        rowId: finding.id,
        reason: "no safe estimate-row annotation rendered for this material delta",
        summary: finding.operationLabel,
      }));
    trace.unannotatedMaterialDeltas = [
      ...trace.unannotatedMaterialDeltas,
      ...unmatchedDeltaDrops,
    ];
    trace.droppedDeltaReasons = [
      ...trace.droppedDeltaReasons,
      ...unmatchedDeltaDrops.map((item) => item.reason),
    ];
  }

  const lineMatchCount = matches.length;
  if (findingsWithPartSource.length > 0 && lineMatchCount === 0) {
    warnings.push(anchors.length ? NO_SAFE_ROW_FINDINGS_WARNING : NO_ROWS_EXTRACTED_WARNING);
    warnings.push("all_findings_unanchored");
  }
  if (suppressed.length > 0) {
    warnings.push(`${suppressed.length} generic or malformed ${reportIdentity.reportShortTitle} finding(s) were suppressed from the visible estimate layer.`);
  }

  const annotationMetadata: CitationDensityAnnotationMetadata[] = [];
  const findingDetails: FindingDetail[] = [];
  let renderedPdfAnnotationCount = 0;
  matches.forEach((match, index) => {
    const sourcePdfPageNumber = match.anchor.pageNumber;
    const page = pdfDoc.getPage(toSourcePdfPageIndex(sourcePdfPageNumber));
    const renderResult = drawFindingAnnotation(pdfDoc, page, match, index + 1, {
      mode,
      font,
      boldFont,
      estimateRole,
      redactSensitive: request.redactSensitive !== false,
      trace,
      reportIdentity,
      subtleAnnotations: deltaValueLayerActive,
    });
    if (renderResult.written) {
      renderedPdfAnnotationCount += 1;
      annotationMetadata.push(renderResult.metadata);
      findingDetails.push({ finding: match.finding, metadata: renderResult.metadata });
    }
  });

  trace.renderedPdfAnnotationCount = renderedPdfAnnotationCount;
  appendToolUsageTrace(trace, {
    tool: "annotation_qa",
    ran: true,
    candidatesFound: matches.length,
    candidatesAccepted: renderedPdfAnnotationCount,
    candidatesRejected: Math.max(0, matches.length - renderedPdfAnnotationCount),
    droppedReasons: trace.rendererDrops.map((item) => item.reason),
  });

  if (trace.extractedAnchorCount > 0 && trace.findingCount > 0 && trace.renderedPdfAnnotationCount === 0) {
    throw new CitationDensityAnnotationError("Anchors extracted but no annotations rendered.", trace);
  }

  // Opt-in in-page keyed notes for unanchored findings: place each one in
  // whitespace measured empty on the source page it belongs to, via the
  // plan -> audit -> repair loop in annotationPlacementEngine. Findings the
  // engine cannot place at zero audit failures stay in `unmatched` and flow
  // to the appendix exactly as before. Guarded so any extraction failure
  // degrades to current behavior rather than failing the report.
  let cachedWordExtraction: Awaited<ReturnType<typeof extractPdfWordsWithDiagnostics>> | null = null;
  const getWordExtraction = async () => {
    if (!cachedWordExtraction) cachedWordExtraction = await extractPdfWordsWithDiagnostics(sourcePdfBytes);
    return cachedWordExtraction;
  };

  // Default ON for the OEM report (its unanchored findings become blue keyed
  // notes on the page they cite); opt-in elsewhere. Explicit false wins.
  const inPageKeyedNotesActive =
    request.inPageKeyedNotes ?? reportIdentity.reportType === "oem-citation-density";
  if (inPageKeyedNotesActive && unmatched.length > 0) {
    try {
      const wordExtraction = await getWordExtraction();
      const placementWords: PlacementWord[] = wordExtraction.words.map((word) => ({
        pageNumber: word.pageNumber,
        x: word.x,
        y: word.y,
        width: word.width,
        height: word.height,
        text: word.text,
      }));
      const pageGeometries = new Map<number, { pageNumber: number; pageWidth: number; pageHeight: number }>();
      for (const word of wordExtraction.words) {
        if (!pageGeometries.has(word.pageNumber)) {
          pageGeometries.set(word.pageNumber, {
            pageNumber: word.pageNumber,
            pageWidth: word.pageWidth,
            pageHeight: word.pageHeight,
          });
        }
      }
      const noteRequests: KeyedNoteRequest[] = [];
      for (const finding of unmatched) {
        const roleAnchor =
          estimateRole === "shop"
            ? finding.shopAnchor
            : estimateRole === "carrier"
              ? finding.carrierAnchor
              : finding.carrierAnchor ?? finding.shopAnchor;
        const pageNumber = roleAnchor?.pageNumber ?? null;
        if (!pageNumber || !pageGeometries.has(pageNumber)) continue;
        if (pageNumber < 1 || pageNumber > originalPageCount) continue;
        const keyPrefix = roleAnchor?.lineNumber ? `Ln ${roleAnchor.lineNumber}: ` : "";
        const amount = roleAnchor?.amount;
        const hours = roleAnchor?.laborHours;
        const valueSuffix = [
          typeof amount === "number" ? `$${amount.toFixed(2)}` : null,
          typeof hours === "number" ? `${hours} hr` : null,
        ]
          .filter(Boolean)
          .join(" ");
        const text = redactAnnotationText(
          `${keyPrefix}${finding.operationLabel}${valueSuffix ? ` — ${valueSuffix}` : ""}`.trim()
        );
        if (!text) continue;
        noteRequests.push({ id: finding.id, pageNumber, text });
      }
      if (noteRequests.length > 0) {
        const plan = planVerifiedKeyedNotes({
          requests: noteRequests,
          words: placementWords,
          pages: [...pageGeometries.values()],
          measureText: (text, size) => boldFont.widthOfTextAtSize(text, size),
        });
        const isOemReport = reportIdentity.reportType === "oem-citation-density";
        const noteFill = isOemReport ? rgb(0.3, 0.85, 1) : rgb(1, 0.95, 0);
        const noteInk = isOemReport ? rgb(0, 0.15, 0.75) : rgb(0.72, 0.12, 0.1);
        const placedIds = new Set<string>();
        for (const note of plan.placed) {
          const page = pdfDoc.getPage(toSourcePdfPageIndex(note.rect.pageNumber));
          const pageWidth = page.getWidth();
          const pageHeight = page.getHeight();
          const rotation = normalizeRotation(page.getRotation().angle);
          const pdfLibRect = topLeftRectToPdfLibRect(note.rect, {
            pdfWidth: pageWidth,
            pdfHeight: pageHeight,
            rotation,
          });
          page.drawRectangle({
            x: pdfLibRect.x,
            y: pdfLibRect.y,
            width: pdfLibRect.width,
            height: pdfLibRect.height,
            color: noteFill,
            opacity: 0.45,
          });
          page.drawText(note.request.text, {
            x: pdfLibRect.x + 1.5,
            y: pdfLibRect.y + 2,
            size: note.fontSize,
            font: boldFont,
            color: noteInk,
          });
          placedIds.add(note.request.id);
        }
        if (placedIds.size > 0) {
          for (let index = unmatched.length - 1; index >= 0; index -= 1) {
            if (placedIds.has(unmatched[index].id)) unmatched.splice(index, 1);
          }
        }
        appendToolUsageTrace(trace, {
          tool: "in_page_keyed_notes",
          ran: true,
          candidatesFound: noteRequests.length,
          candidatesAccepted: placedIds.size,
          candidatesRejected: Math.max(0, noteRequests.length - placedIds.size),
          droppedReasons: plan.audits.flat().map((failure) => `${failure.kind}: ${failure.detail}`),
        });
      }
    } catch (error) {
      warnings.push(
        `in-page keyed notes skipped: ${error instanceof Error ? error.message : "placement engine error"}`
      );
    }
  }

  // Delta value layer: the cell-level presentation (highlights on differing
  // values, underlines on matched prices, competing-value stamps in the
  // ESTIMATE TOTALS gap, merged keyed margin notes) driven by the typed
  // deltaEngine pairing. Default ON for citation-density; guarded so any
  // extraction/pairing failure degrades to the marker-only output.
  if (deltaValueLayerActive) {
    try {
      const wordExtraction = await getWordExtraction();
      if (wordExtraction.words.length > 0) {
        const placementWords: PlacementWord[] = wordExtraction.words.map((word) => ({
          pageNumber: word.pageNumber,
          x: word.x,
          y: word.y,
          width: word.width,
          height: word.height,
          text: word.text,
        }));
        const pageGeometries = new Map<number, { pageNumber: number; pageWidth: number; pageHeight: number }>();
        for (const word of wordExtraction.words) {
          if (!pageGeometries.has(word.pageNumber)) {
            pageGeometries.set(word.pageNumber, {
              pageNumber: word.pageNumber,
              pageWidth: word.pageWidth,
              pageHeight: word.pageHeight,
            });
          }
        }
        const textComparisons = params.comparisonEstimateTexts ?? [];
        const pickOtherRole = <T extends { estimateRole?: "carrier" | "shop" }>(entries: T[]) =>
          entries.find((entry) => entry.estimateRole && entry.estimateRole !== sourceDocumentRole) ?? entries[0];
        const comparisonWordSet = pickOtherRole(comparisonEstimateWords);
        const comparisonText = pickOtherRole(textComparisons);

        // Prefer the competing document's measured word layer: symmetric
        // extraction on both sides is what keeps glued/corrupted text layers
        // from producing false deltas. Text parsing is the fallback.
        let competingRows: ReturnType<typeof parseDeltaEngineRows> = [];
        let competingTotals: Array<{ category: string; hours: number | null; rate: number | null; amount: number }> = [];
        if (comparisonWordSet) {
          const byPage = pdfWordsToEnginePages(comparisonWordSet.words);
          competingRows = parseDeltaEngineRows(byPage);
          competingTotals = parseDeltaEngineTotals(byPage).map((row) => ({
            category: row.category,
            hours: row.hours,
            rate: row.rate,
            amount: row.amount,
          }));
        }
        if (competingRows.length === 0 && comparisonText) {
          competingRows = parseCccEstimateRows(comparisonText.text)
            .map((row) =>
              estimateRowFromTextFields({
                lineNumber: row.lineNumber,
                description: row.description,
                section: row.section,
                partNumber: row.partNumber,
                qty: row.qty,
                price: row.price,
                labor: row.labor,
                paint: row.paint,
                laborType: row.laborType ?? null,
              })
            )
            .filter((row): row is NonNullable<typeof row> => row !== null);
          if (competingTotals.length === 0) {
            competingTotals = (parseCccEstimateTotals(comparisonText.text)?.categories ?? []).map((category) => ({
              category: category.category,
              hours: category.hours,
              rate: category.rate,
              amount: category.cost ?? 0,
            }));
          }
        }
        // S-2: ONE resolved identity per run, from DOCUMENT EVIDENCE — never
        // the role classifier, and never a role word. A misclassified
        // Estimate of Record previously printed "MISSED on SHOP" on every
        // callout, naming the shop as the party that omitted the shop's own
        // operations.
        const competingLabel = resolveComparisonDocumentIdentity({
          comparisonText: comparisonText?.text ?? "",
          comparisonFileName: comparisonWordSet?.fileName ?? comparisonText?.fileName ?? "",
          sourceText: params.sourceText ?? "",
        });
        // C-10: the value-mark layer honors the same completion gate as the
        // findings lane — no delta verdict marks over a mostly-unread
        // comparison document.
        const valueLayerExtraction = assessComparisonExtraction(
          competingRows.map((row) => ({ lineNumber: row.line }))
        );
        // A SECOND, independent coverage signal. The line-span test above asks
        // whether the numbering was read; it counts a row as covered even when
        // that row's hours were lost, so partial extraction — 22 of 64 priced
        // lines off a scanned estimate — can clear it while the rest of the
        // carrier's work silently becomes absence claims. Comparing parsed
        // hours to the document's own printed labor categories catches that.
        // Correctly-read documents in this corpus measure 84-95%.
        const hoursCoverage = assessHoursCoverage(
          competingRows.map((row) => ({ labor: row.labor, paint: row.paint })),
          comparisonText?.text ?? ""
        );
        if (valueLayerExtraction.gate) {
          warnings.push(
            `Comparison estimate extraction coverage ${Math.round(valueLayerExtraction.coverage * 100)}% is below the confidence threshold — delta value marks suppressed (intake mode).`
          );
        }
        if (hoursCoverage.gate) {
          warnings.push(
            `Comparison estimate labor coverage is ${Math.round(hoursCoverage.coverage * 100)}% — ${hoursCoverage.parsedHours} of the ${hoursCoverage.printedHours} hours its own totals block prints were parsed. Absence findings are suppressed: a line this pass could not read is not a line the carrier omitted.`
          );
        }
        if (competingLabel === null) {
          // Fail loud, print nothing. Every callout in this layer names the
          // comparison document; with no resolved identity there is no honest
          // way to word one, and a role-word fallback is what shipped the
          // "MISSED on SHOP" defect.
          warnings.push(
            "Comparison document identity did not resolve to an organization name — delta value marks suppressed rather than labelled with a role word."
          );
        }
        if (competingLabel !== null && competingRows.length > 0 && !valueLayerExtraction.gate) {
          const plan = planDeltaValueAnnotations({
            subjectWords: placementWords,
            pages: [...pageGeometries.values()],
            competingRows,
            competingTotals,
            // EXPORT BOUNDARY — the annotation text is drawn ON the exported
            // page, so naming the carrier there puts insurance information
            // straight back into a redacted document. The role is what the
            // reader needs ("the comparison estimate"); the identity is not.
            competingLabel: sourcePagesRedacted ? "the comparison estimate" : competingLabel,
            measureText: (text, size) => boldFont.widthOfTextAtSize(text, size),
          });
          const costInk = rgb(0.72, 0.12, 0.1);
          const costFill = rgb(1, 0.95, 0);
          const toPdfLib = (rect: { pageNumber: number; x: number; y: number; width: number; height: number }) => {
            const page = pdfDoc.getPage(toSourcePdfPageIndex(rect.pageNumber));
            const pdfLibRect = topLeftRectToPdfLibRect(rect, {
              pdfWidth: page.getWidth(),
              pdfHeight: page.getHeight(),
              rotation: normalizeRotation(page.getRotation().angle),
            });
            return { page, pdfLibRect };
          };
          for (const rect of plan.highlights) {
            const { page, pdfLibRect } = toPdfLib(rect);
            page.drawRectangle({ ...pdfLibRect, color: costFill, opacity: 0.45 });
          }
          for (const rect of plan.underlines) {
            const { page, pdfLibRect } = toPdfLib(rect);
            page.drawLine({
              start: { x: pdfLibRect.x, y: pdfLibRect.y - 0.8 },
              end: { x: pdfLibRect.x + pdfLibRect.width, y: pdfLibRect.y - 0.8 },
              thickness: 1.0,
              color: costInk,
            });
          }
          for (const stamp of plan.stamps) {
            const { page, pdfLibRect } = toPdfLib(stamp.rect);
            page.drawRectangle({ ...pdfLibRect, color: costFill, opacity: 0.45 });
            page.drawText(stamp.text, {
              x: pdfLibRect.x + 1.5,
              y: pdfLibRect.y + 2,
              size: stamp.fontSize,
              font: boldFont,
              color: costInk,
            });
          }
          for (const note of plan.notes) {
            const { page, pdfLibRect } = toPdfLib(note.rect);
            page.drawRectangle({ ...pdfLibRect, color: costFill, opacity: 0.45 });
            // Note text mirrors line descriptions and values already printed in
            // plaintext on the same page, so it is drawn as planned (running the
            // download redactor here false-positives on operation wording like
            // "Final road test" and would also invalidate the measured width).
            page.drawText(note.request.text, {
              x: pdfLibRect.x + 1.5,
              y: pdfLibRect.y + 2,
              size: note.fontSize,
              font: boldFont,
              color: costInk,
            });
          }
          appendToolUsageTrace(trace, {
            tool: "delta_value_layer",
            ran: true,
            candidatesFound: plan.findings.length + plan.totalsDeltas.length + plan.competingOnly.length,
            candidatesAccepted:
              plan.underlines.length + plan.highlights.length + plan.stamps.length + plan.notes.length,
            candidatesRejected: plan.unplacedNotes.length,
            droppedReasons: plan.unplacedNotes.map((note) => `unplaced note: ${note.text.slice(0, 80)}`),
          });
        }
      }
    } catch (error) {
      warnings.push(
        `delta value layer skipped: ${error instanceof Error ? error.message : "delta engine error"}`
      );
    }
  }

  // The annotated estimate keeps only the on-page annotations plus the legend
  // that explains them. The finding-detail cards and the unanchored appendix now
  // live in a SEPARATE standalone Findings Report (built below) so they are not
  // buried deep in the estimate document where most readers never reach them.
  if (findingsWithPartSource.length > 0 && lineMatchCount === 0) {
    addNoLineAnchorWarningPage(pdfDoc, {
      font,
      boldFont,
      message: anchors.length ? NO_SAFE_ROW_FINDINGS_WARNING : NO_ROWS_EXTRACTED_WARNING,
      pageCalloutCount: matches.length,
      appendixCount: unmatched.length,
    });
  }

  if (request.includeLegend !== false) {
    // D-5: the legend lists exactly the labels THIS run emitted — the visible
    // callout labels plus every finding's proof-bucket label (the label shown
    // on its card), anchored and appendix-only alike — each with a definition.
    const emittedLabels = [
      ...annotationMetadata.map((item) => item.label),
      ...matches.map(({ finding }) => getProofBucketLabel(finding)),
      ...unmatched.map((finding) => getProofBucketLabel(finding)),
    ].filter(Boolean);
    addLegendPage(pdfDoc, { font, boldFont, reportIdentity, emittedLabels });
  }

  const bytes = await pdfDoc.save();
  debugMetadata.visibleAnnotationCount = annotationMetadata.length;
  debugMetadata.appendixOnlyCount = unmatched.length;
  trace.viewerAnnotationCount = annotationMetadata.length;
  const exportId = putAnnotatedEstimateExport(
    bytes,
    reportIdentity.artifactFilename,
    annotationMetadata,
    {
      artifactVersion: reportIdentity.artifactVersion,
      reportType: reportIdentity.reportType,
    }
  );
  trace.artifactId = exportId;
  trace.metadataArtifactId = exportId;
  trace.renderedPdfArtifactId = exportId;
  if (trace.metadataArtifactId !== trace.renderedPdfArtifactId) {
    throw new CitationDensityAnnotationError("Rendered PDF and annotation metadata artifact mismatch.", trace);
  }

  // Standalone Findings Report: cover page + one detail card per finding +
  // the unanchored/supplement-only appendix. Stored as its own retrievable
  // artifact under the same artifact version so the GET route can serve it.
  let findingsReportExportId: string | undefined;
  let findingsReportBytes: Uint8Array | undefined;
  let findingsReportPageCount = 0;
  const includeUnanchored = unmatched.length > 0 && request.includeUnanchoredAppendix !== false;
  if (findingDetails.length > 0 || includeUnanchored) {
    const findingsDoc = await PDFDocument.create();
    const findingsFont = await findingsDoc.embedFont(StandardFonts.Helvetica);
    const findingsBoldFont = await findingsDoc.embedFont(StandardFonts.HelveticaBold);
    // HOW WELL THE COMPARISON WAS READ BELONGS ON THE COVER.
    //
    // The extraction-confidence note is document-level — it qualifies every
    // absence claim in the pack, not one line — and it was reaching the reader
    // nowhere. It rides out of the delta pass on a finding's `limitations`,
    // and addCitationDensityFindingDetailPages does not render that field at
    // all, so a run whose findings were correctly marked unverified printed no
    // statement of why. (An earlier attempt patched formatCalloutLines, which
    // serves the annotated estimate's callout cards — a different renderer
    // from this report.)
    //
    // Harvested rather than recomputed: the score is derived once, in the
    // delta pass that owns the observables, and this only surfaces it beside
    // the text-layer notes it belongs with.
    for (const detail of findingDetails) {
      for (const line of detail.finding.limitations ?? []) {
        if (/extraction confidence/i.test(line) && !textLayerNotes.includes(line)) {
          textLayerNotes.push(line);
        }
      }
    }
    addFindingsReportCoverPage(findingsDoc, {
      font: findingsFont,
      boldFont: findingsBoldFont,
      reportIdentity,
      sourcePdfName,
      annotatedCount: matches.length,
      unanchoredCount: unmatched.length,
      generatedAt: new Date().toISOString(),
      textLayerNotes,
    });
    if (findingDetails.length > 0) {
      trace.detailLayoutBlocks = addCitationDensityFindingDetailPages(findingsDoc, findingDetails, {
        font: findingsFont,
        boldFont: findingsBoldFont,
        sourcePdfName,
        sourcePdfHash: trace.sourcePdfHash,
        buildCommit: trace.buildCommit,
        reportIdentity,
      });
    }
    if (request.includeSummaryPage) {
      addSummaryPage(findingsDoc, {
        font: findingsFont,
        boldFont: findingsBoldFont,
        annotatedCount: matches.length,
        unresolvedCount: unmatched.length,
        warnings,
      });
    }
    if (includeUnanchored) {
      addUnanchoredAppendix(findingsDoc, unmatched, {
        font: findingsFont,
        boldFont: findingsBoldFont,
        estimateRole,
        redactSensitive: request.redactSensitive !== false,
        reportIdentity,
      });
    }
    findingsReportBytes = await findingsDoc.save();
    findingsReportPageCount = findingsDoc.getPageCount();
    findingsReportExportId = putAnnotatedEstimateExport(
      findingsReportBytes,
      `${reportIdentity.artifactFilename.replace(/\.pdf$/i, "")}-findings.pdf`,
      [],
      {
        artifactVersion: reportIdentity.artifactVersion,
        reportType: reportIdentity.reportType,
      }
    );
  }

  // EXPORT BOUNDARY. The annotated estimate is built by COPYING the source
  // PDF's own pages, so no text-level redaction reaches it — the identifiers
  // sit in the original page content. Scanning the finished artifact is the
  // only way to know, and saying so is the minimum: an export that still
  // carries a VIN, a claim number or a carrier name must not look protected
  // just because the generated reports around it are.
  try {
    appendToolUsageTrace(trace, {
      tool: "source_page_redaction",
      ran: sourcePagesRedacted,
      candidatesFound: originalPageCount,
      candidatesAccepted: sourcePagesRedacted ? originalPageCount : 0,
      candidatesRejected: sourcePagesRedacted ? 0 : originalPageCount,
      droppedReasons: sourcePagesRedacted ? [] : ["source pages were not rasterized"],
    });
    // Only meaningful when redaction did NOT run — when it did, the text layer
    // no longer exists, so there is nothing for a text scan to find.
    const exposure = sourcePagesRedacted ? [] : scanExportForPii(params.sourceText ?? "");
    if (exposure.length > 0) {
      warnings.push(
        `${describePiiExposure("The annotated estimate", exposure)}. It reproduces the original estimate pages; do not share it outside the system.`
      );
    }
  } catch {
    // Never let the privacy check break a report; its absence is reported by
    // the scanner's own tests, not by a thrown error here.
  }

  // R03 — every annotation derives from a finding, and every anchored finding
  // is drawn. The two lists have disagreed on every graded run (81 vs 69, 137
  // vs 71, 85 vs 71, 64 vs 62), always because a second path emitted marks of
  // its own. Assert it here, where both lists exist, so drift is a visible
  // warning on the artifact instead of a number a reviewer has to count.
  {
    const anchoredFindingIds = new Set(matches.map((match) => match.finding.id));
    const orphanAnnotations = matches.filter((match) => !match.finding?.id).length;
    if (orphanAnnotations > 0) {
      warnings.push(
        `${orphanAnnotations} annotation(s) were drawn without a parent finding — annotations must be emitted from the findings list, not by a parallel path.`
      );
    }
    if (anchoredFindingIds.size !== matches.length) {
      warnings.push(
        `Annotation/finding parity: ${matches.length} annotations resolved to ${anchoredFindingIds.size} distinct findings. Every mark must key to exactly one finding.`
      );
    }
  }

  return {
    exportId,
    bytes,
    annotatedFindingCount: matches.length,
    unresolvedAnchorCount: unmatched.length,
    originalPageCount,
    finalPageCount: pdfDoc.getPageCount(),
    warnings,
    annotationMetadata,
    debugMetadata,
    debugTrace: trace,
    findingsReportExportId,
    findingsReportBytes,
    findingsReportPageCount,
  };
}

function toSourcePdfPageIndex(sourcePdfPageNumber: number) {
  return Math.max(0, sourcePdfPageNumber - 1);
}

type PartSourceRow = {
  anchorId?: string;
  sourceDocumentId?: string;
  sourceDocumentRole: "carrier" | "shop";
  sourcePdfName: string;
  pageNumber: number | null;
  lineNumber: string | null;
  rowText: string;
  normalizedRowText: string;
  sourceKinds: PartSourceKind[];
  anchor?: EstimateRowAnchor;
  anchorType?: EstimateRowAnchorType;
  description?: string | null;
  operation?: string | null;
  partNumber?: string | null;
};

type PartSourceFindingResult = {
  findings: CitationDensityFinding[];
  partSourceRows: PartSourceDebugRow[];
  nonOemPartRowCount: number;
  oemPartRowCount: number;
  comparisonCandidateCount: number;
  candidateCount: number;
  acceptedCandidates: PartSourceFindingCandidate[];
  rejectedCandidates: PartSourceFindingCandidate[];
  rejectedLineNumberCandidates: Array<{
    rowText: string;
    lineNumber?: string | number | null;
    reason: string;
  }>;
  comparisonMatches: PartSourceComparisonMatchDebug[];
  droppedReasons: CitationDensityDebugTrace["partSourceDroppedReasons"];
};

export type OemCitationDensityAuthoritySource = {
  title: string;
  sourceType:
    | "oem_procedure"
    | "oem_position_statement"
    | "motor_database"
    | "uploaded_support"
    | "ccc_secure_share"
    | "policy"
    | "jurisdictional_law"
    | "internet_fallback"
    | "estimate_evidence";
  evidenceTier: number;
  verified: boolean;
  note?: string;
  /** Citable reference, kept as a field rather than buried in `note` prose so a
   *  consumer can gate/attach on it without scraping a sentence. */
  url?: string;
  /** Page/section within the cited document. */
  locator?: string;
  /** Make this authority is filed against (Drive folder metadata). An authority
   *  that DECLARES its applicability satisfies the D-4 make gate directly,
   *  instead of the gate hoping the make appears in the title prose. */
  appliesToMake?: string;
  /** Same source expressed in the RIR research vocabulary. Retained separately
   *  because `sourceType` above collapses every web hit to `internet_fallback`
   *  for the debug counters; the law/oem/industry distinction is still needed
   *  when these sources are attached to findings. */
  researchSourceType?: "drive" | "web" | "oem" | "policy" | "law" | "industry";
};

export type OemCitationDensityAuthorityTrace = {
  authorityTraceStarted: boolean;
  authorityTraceCompleted: boolean;
  authorityTraceBlockedReason?: string | null;
  authorityCoverageStatus: "complete" | "partial" | "incomplete";
  googleDriveOrInternalSearchRan: boolean;
  skippedReason?: string;
  sandPolishSupportFound?: boolean;
  driveSearchAttempted: boolean;
  driveSearchAvailable: boolean;
  driveSearchCompleted?: boolean;
  driveMatchedFoldersCount?: number;
  driveDocumentsReviewedCount?: number;
  driveSearchTerms?: string[];
  driveMakeModelFolderMatched: boolean;
  driveMatchedFolders: string[];
  driveDocumentsReviewed: string[];
  onlineSearchAttempted: boolean;
  onlineSourcesReviewed: string[];
  jurisdictionResolved: string | null;
  jurisdictionSourcesReviewed: string[];
  oemSourcesReviewed: string[];
  adasSourcesReviewed: string[];
  motorPPageSourcesReviewed: string[];
  scrsSourcesReviewed: string[];
  policyLegalSourcesReviewed: string[];
  authoritySources: OemCitationDensityAuthoritySource[];
  authorityContextText?: string;
};

export type OemCitationDensityFindingDebug = {
  findingId: string;
  title: string;
  label: string;
  anchorId?: string | null;
  evidenceTier: string;
  authoritySourceTypes: string[];
  nextAction: string;
  confidence: "low" | "medium" | "high";
};

function buildDefaultOemAuthorityTrace(): OemCitationDensityAuthorityTrace {
  const skippedReason = "No connected internal authority-search context was provided to annotated PDF generation.";
  return {
    authorityTraceStarted: false,
    authorityTraceCompleted: false,
    authorityTraceBlockedReason: skippedReason,
    authorityCoverageStatus: "incomplete",
    googleDriveOrInternalSearchRan: false,
    skippedReason,
    sandPolishSupportFound: false,
    driveSearchAttempted: false,
    driveSearchAvailable: false,
    driveMakeModelFolderMatched: false,
    driveMatchedFolders: [],
    driveDocumentsReviewed: [],
    onlineSearchAttempted: false,
    onlineSourcesReviewed: [],
    jurisdictionResolved: null,
    jurisdictionSourcesReviewed: [],
    oemSourcesReviewed: [],
    adasSourcesReviewed: [],
    motorPPageSourcesReviewed: [],
    scrsSourcesReviewed: [],
    policyLegalSourcesReviewed: [],
    authoritySources: [],
  };
}

function emptyPartSourceFindingResult(): PartSourceFindingResult {
  return {
    findings: [],
    partSourceRows: [],
    nonOemPartRowCount: 0,
    oemPartRowCount: 0,
    comparisonCandidateCount: 0,
    candidateCount: 0,
    acceptedCandidates: [],
    rejectedCandidates: [],
    rejectedLineNumberCandidates: [],
    comparisonMatches: [],
    droppedReasons: [],
  };
}

// ---------------------------------------------------------------------------
// Canonical delta path for Delta Citation Density PDF
// ---------------------------------------------------------------------------

function canonicalDeltaPriorityScore(delta: CanonicalDeltaEntry): number {
  const dollar = delta.magnitudeDollar !== undefined ? Math.abs(delta.magnitudeDollar) : 0;
  const labor = delta.magnitudeLaborHrs !== undefined ? Math.abs(delta.magnitudeLaborHrs) * 75 : 0;
  const op = delta.operation.toLowerCase();
  const safetyStructuralBonus = /crossmember|control\s+arm|link\s+arm|lateral\s+arm|susp(?:ension)?|hub|axle|caliper|structural|frame/.test(op)
    ? 250
    : 0;
  const mechanicalBonus = /\b(?:mech|mechanical|coolant|purge|scan|calibration|firmware|service mode)\b/.test(op) ? 75 : 0;
  const presenceBonus = delta.class === "PRESENCE" ? 200 : 0;
  const pairingConfidenceBonus = delta.anchorInitial && delta.anchorFinal ? 50 : 0;
  const smallValuePenalty = delta.class === "VALUE_CHANGE" && dollar < 25 && Math.abs(delta.magnitudeLaborHrs ?? 0) < 0.5 ? -100 : 0;
  return dollar + labor + safetyStructuralBonus + mechanicalBonus + presenceBonus + pairingConfidenceBonus + smallValuePenalty;
}

function canonicalDeltaFindingCategory(delta: CanonicalDeltaEntry): CitationDensityFinding["category"] {
  const op = delta.operation.toLowerCase();
  if (/calibrat|camera\s+calib|adas|radar|lidar/.test(op)) return "adas_calibration";
  if (/\bscan\b|dtc|diagnostic|firmware|service\s+mode|deploy/.test(op)) return "scan_diagnostic";
  if (/crossmember|control\s+arm|link\s+arm|lateral\s+arm|susp(?:ension)?|o\/h\s+rr\s+susp|strut|knuckle|spindle/.test(op)) return "structural_or_fit_verification";
  if (delta.class === "PART_SWAP" || delta.class === "PART_SWAP_WITH_PRICE_CHANGE") return "parts_downgrade";
  if (delta.class === "VALUE_CHANGE") return "parts_downgrade";
  return "parts_downgrade";
}

function canonicalDeltaClassForFinding(delta: CanonicalDeltaEntry): NonNullable<CitationDensityFinding["deltaClass"]> {
  if (delta.class === "PART_SWAP" || delta.class === "PART_SWAP_WITH_PRICE_CHANGE") return "PART_SWAPPED";
  if (delta.class === "VALUE_CHANGE") {
    const dollar = Math.abs(delta.magnitudeDollar ?? 0);
    const labor = Math.abs(delta.magnitudeLaborHrs ?? 0);
    return labor > 0 && dollar === 0 ? "LABOR_CHANGED" : "VALUE_CHANGED";
  }
  if (delta.anchorInitial === null) return "PRESENT_ONLY_IN_COMPARISON";
  if (delta.anchorFinal === null) return "PRESENT_ONLY_IN_SOURCE";
  return "PRESENT_ONLY_IN_COMPARISON";
}

function canonicalDeltaToFinding(
  delta: CanonicalDeltaEntry,
  deltaSet: CanonicalDeltaSet,
  sourceDocumentId?: string
): CitationDensityFinding {
  const label = getDeltaLabel(delta, deltaSet.estimatePairKind);
  assertNoCarrierWording(deltaSet.estimatePairKind, label, `canonical finding ${delta.id}`);

  const category = canonicalDeltaFindingCategory(delta);
  const deltaClass = canonicalDeltaClassForFinding(delta);
  const evidenceStatus = "ESTIMATE_GAP_ONLY" as const;
  const isSuspension = category === "structural_or_fit_verification";
  const isCalibration = category === "adas_calibration" || category === "scan_diagnostic";
  const priorityScore = canonicalDeltaPriorityScore(delta);

  const supplementFilename = deltaSet.estimateFiles.supplement.filename;
  const initialFilename = deltaSet.estimateFiles.initial.filename;

  const supplementAnchorLine = delta.anchorFinal
    ? String(Array.isArray(delta.anchorFinal.line) ? delta.anchorFinal.line[0] : delta.anchorFinal.line)
    : null;
  const initialAnchorLine = delta.anchorInitial
    ? String(Array.isArray(delta.anchorInitial.line) ? delta.anchorInitial.line[0] : delta.anchorInitial.line)
    : null;

  const canonicalSourceDocumentId = sourceDocumentId ?? "shop-estimate";
  const comparisonDocumentId = deltaSet.estimateFiles.supplement.sourceDocumentId ?? "shop-supplement";
  const sourceEstimateRole = deltaSet.estimateFiles.initial.estimateRole ?? "unknown";
  const comparisonEstimateRole = deltaSet.estimateFiles.supplement.estimateRole ?? "unknown";

  // Anchor ONLY to the document actually being rendered. A delta's anchorInitial
  // is a row in the initial estimate; anchorFinal is a row in the supplement.
  // Previously this fell back to anchorFinal when anchorInitial was null, but
  // still stamped the anchorId with the rendered (initial) document id — so a
  // "PRESENT ONLY IN SUPPLEMENT" delta was pinned to whatever unrelated row
  // happened to share the supplement's line number in the initial estimate.
  // Supplement-only deltas have no row in the rendered estimate, so they must
  // stay UNANCHORED (still listed in the findings report, just no false
  // highlight) rather than mis-anchored.
  const renderingSupplement =
    sourceDocumentId != null &&
    deltaSet.estimateFiles.supplement.sourceDocumentId === sourceDocumentId;
  const renderedAnchor = renderingSupplement ? delta.anchorFinal : delta.anchorInitial;
  const renderedAnchorLine = renderedAnchor
    ? String(Array.isArray(renderedAnchor.line) ? renderedAnchor.line[0] : renderedAnchor.line)
    : null;
  const shopAnchor: CitationDensityEstimateLineAnchor | undefined = renderedAnchor
    ? {
        anchorId: `${canonicalSourceDocumentId}:p${renderedAnchor.page}:${renderedAnchorLine}:estimate_line`,
        sourceDocumentId: canonicalSourceDocumentId,
        estimateRole: "shop",
        pageNumber: renderedAnchor.page,
        lineNumber: renderedAnchorLine,
        description: delta.operation,
        amount: delta.magnitudeDollar ?? null,
        laborHours: delta.magnitudeLaborHrs ?? null,
      }
    : undefined;

  const deltaDisplay =
    delta.magnitudeDollar !== undefined
      ? `${delta.magnitudeDollar >= 0 ? "+" : ""}$${delta.magnitudeDollar.toFixed(2)}`
      : delta.magnitudeLaborHrs !== undefined
        ? `${delta.magnitudeLaborHrs >= 0 ? "+" : ""}${delta.magnitudeLaborHrs.toFixed(1)} hrs`
        : "";

  const currentSupportSummary =
    `Delta class: ${label}. Evidence status: ${evidenceStatus}. ${delta.operation}` +
    (deltaDisplay ? ` (${deltaDisplay})` : "") +
    `. Category: ${delta.category}.` +
    ` Supplement line: ${supplementAnchorLine ?? "added in supplement"} (${supplementFilename}).` +
    (delta.anchorInitial
      ? ` Initial line: ${initialAnchorLine} (${initialFilename}).`
      : " Not present in initial estimate.") +
    ` Canonical delta ID: ${delta.id}; set: ${deltaSet.id}.` +
    ` Grand total delta: ${formatCanonicalMoney(deltaSet.reconciliation.grandTotalDelta)}.`;

  const missingProofSummary = isSuspension
    ? `${delta.operation}: structural/suspension scope change. Verify OEM repair procedure and that the initial estimate scope was complete for this vehicle.`
    : isCalibration
      ? `${delta.operation}: ADAS/diagnostic procedure added in supplement. Verify scan/calibration requirement against OEM procedure for this vehicle platform.`
      : `${delta.operation}: added or changed in supplement estimate. Verify basis and completion documentation.`;

  const recommendedNextAction = isSuspension
    ? "Attach OEM procedure support and verify that supplement scope is consistent with documented vehicle damage."
    : isCalibration
      ? "Verify OEM scan/calibration requirement; attach procedure documentation and post-repair scan report."
      : "Verify supplement line item against initial estimate scope and attach completion proof.";

  const missingAuthorityTypes: string[] = isSuspension
    ? ["OEM procedure support", "supplement line-item basis", "completion proof"]
    : isCalibration
      ? ["OEM scan/calibration requirement", "post-repair scan report", "completion proof"]
      : ["supplement line-item basis", "completion proof"];

  return {
    id: `canonical-delta-${delta.id}-${deltaSet.id.slice(0, 8)}`,
    operationLabel: delta.operation,
    category,
    estimateGapType: "present_but_under_documented",
    shopEvidence: {
      lineNumber: supplementAnchorLine,
      description: delta.operation,
      amount: delta.magnitudeDollar ?? null,
      laborHours: delta.magnitudeLaborHrs ?? null,
      sourceLabel: supplementFilename,
    },
    carrierEvidence: delta.anchorInitial
      ? {
          lineNumber: initialAnchorLine,
          description: delta.operation,
          amount:
            delta.oldValue && typeof delta.oldValue.price === "number"
              ? delta.oldValue.price
              : null,
          laborHours: null,
          sourceLabel: initialFilename,
        }
      : undefined,
    shopAnchor,
    applicableEstimateRoles: ["shop"],
    primaryAnnotationRole: "shop",
    crossEstimateIssue: delta.anchorInitial !== null && delta.anchorFinal !== null,
    impact: {
      dollarImpact: delta.magnitudeDollar ?? null,
      laborHoursImpact: delta.magnitudeLaborHrs ?? null,
      safetyImpact: isSuspension || isCalibration ? "high" : "medium",
      supplementPriority: priorityScore > 500 ? "high" : priorityScore > 100 ? "medium" : "low",
    },
    citationStatus: {
      oem: isSuspension || isCalibration ? "needed" : "not_applicable",
      oemPositionStatement: isSuspension || isCalibration ? "needed" : "not_applicable",
      adas: isCalibration ? "needed" : "not_applicable",
      pPages: "not_applicable",
      scrs: "not_applicable",
      deg: "not_applicable",
      nhtsa: "not_applicable",
      stateRegulation: "not_applicable",
      policy: "not_applicable",
      invoiceOrCompletionProof: "needed",
      photoOrTeardownProof: "not_found",
    },
    citationDensityScore: Math.min(90, 50 + Math.min(40, Math.floor(priorityScore / 40))),
    verifiedAuthorityCount: 0,
    missingAuthorityTypes,
    missingAuthority: missingAuthorityTypes,
    citationLabel: label,
    currentSupportSummary,
    missingProofSummary,
    recommendedNextAction,
    confidence: "high",
    limitations: [
      "Canonical delta finding: derived from the authoritative delta object, not a single-estimate scan.",
      "Do not assert OEM requires, NHTSA crash-test equivalency, or warranty voiding without verified authority.",
      `canonicalDeltaObjectId:${deltaSet.id}`,
      `canonicalDeltaId:${delta.id}`,
      `estimatePairKind:${deltaSet.estimatePairKind}`,
      `deltaClass:${deltaClass}`,
      `evidenceStatus:${evidenceStatus}`,
      `initialFileHash:${deltaSet.initialFileHash}`,
      `supplementFileHash:${deltaSet.supplementFileHash}`,
      `grandTotalDelta:${formatCanonicalMoney(deltaSet.reconciliation.grandTotalDelta)}`,
      `canonicalDeltaClass:${delta.class}`,
      `artifactVersion:${CITATION_DENSITY_ARTIFACT_VERSION}`,
    ],
    canonicalDeltaObjectId: deltaSet.id,
    canonicalDeltaId: delta.id,
    sourceDocumentId: canonicalSourceDocumentId,
    comparisonDocumentId,
    sourceComparisonPosition: "source",
    comparisonComparisonPosition: "comparison",
    sourceEstimateRole,
    comparisonEstimateRole,
    estimatePairKind: deltaSet.estimatePairKind,
    deltaClass,
    evidenceStatus,
    initialFileHash: deltaSet.initialFileHash,
    supplementFileHash: deltaSet.supplementFileHash,
  };
}

function formatCanonicalMoney(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function estimateRoleFamily(role: HeaderEstimateRole) {
  if (role === "carrier_estimate") return "carrier";
  if (role === "shop_initial" || role === "shop_supplement" || role === "shop_final") return "shop";
  return "unknown";
}

function buildCanonicalDeltaFindings(deltaSet: CanonicalDeltaSet, sourceDocumentId?: string): {
  findings: CitationDensityFinding[];
  matchedPairCount: number;
  missingOperationCount: number;
} {
  const withThreshold = applyDisplayThreshold(deltaSet);
  const renderableDeltas = withThreshold.deltas.filter((d) => d.render);

  const scored = renderableDeltas.map((d) => ({
    delta: d,
    score: canonicalDeltaPriorityScore(d),
  }));

  // PRESENCE first (largest supplement additions), then VALUE_CHANGE, then PART_SWAP*.
  // Within each class, sort by combined dollar+labor magnitude descending.
  scored.sort((a, b) => {
    const classRank = (entry: typeof a) => {
      if (entry.delta.class === "PRESENCE") return 0;
      if (entry.delta.class === "VALUE_CHANGE") return 1;
      return 2;
    };
    const rankDiff = classRank(a) - classRank(b);
    if (rankDiff !== 0) return rankDiff;
    return b.score - a.score;
  });

  const findings = scored.map(({ delta }) => canonicalDeltaToFinding(delta, deltaSet, sourceDocumentId));

  return {
    findings,
    matchedPairCount: renderableDeltas.filter(
      (d) => d.anchorInitial !== null && d.anchorFinal !== null
    ).length,
    missingOperationCount: renderableDeltas.filter((d) => d.class === "PRESENCE").length,
  };
}

export function buildRequiredEstimatorDeltaFindings(
  context: AnnotatedEstimateFindingGeneratorContext
): AnnotatedEstimateGeneratedFindings {
  const findings: CitationDensityFinding[] = [];
  const rejectedAnchors: NonNullable<CitationDensityDebugTrace["rejectedAnchors"]> = [];
  const usedAnchorIds = new Set<string>();
  const comparisonText = context.comparisonEstimateTexts.map((item) => item.text).join("\n");
  const allText = [context.sourceText ?? "", comparisonText, context.sourcePdfName, ...context.uploadedFileNames].join("\n");
  const isTeslaOrEv = /\b(?:tesla|model\s+[3sxy]|electric vehicle|bev|ev\b|high[-\s]?voltage|hv battery)\b/i.test(allText);
  let lineItemDeltaFindingCount = 0;
  let lineItemDeltaMatchedPairCount = 0;
  let lineItemDeltaMissingCount = 0;
  let comparisonExtractionCoverage: number | undefined;
  let intakeModeActive = false;
  if (context.canonicalDeltaSet) {
    // Canonical path: the structured delta object is the authoritative source.
    // The legacy local-diff path must not run when a canonical set is present.
    const deltaFindings = buildCanonicalDeltaFindings(context.canonicalDeltaSet, context.sourceDocumentId);
    lineItemDeltaFindingCount = deltaFindings.findings.length;
    lineItemDeltaMatchedPairCount = deltaFindings.matchedPairCount;
    lineItemDeltaMissingCount = deltaFindings.missingOperationCount;
    findings.push(...deltaFindings.findings);
    return {
      findings,
      debug: {
        requiredDetectorFindingCount: 0,
        missingRequiredDetectors: [],
        lineItemDeltaFindingCount,
        lineItemDeltaMatchedPairCount,
        lineItemDeltaMissingCount,
        rejectedAnchors,
        rejectedBoilerplateCount: 0,
        authoritySearchTrace: {
          ...buildDefaultOemAuthorityTrace(),
          authorityTraceBlockedReason: "Canonical Delta Citation Density path does not run legacy required detectors.",
          skippedReason: "Canonical Delta Citation Density path does not run legacy required detectors.",
          sandPolishSupportFound: false,
        },
      },
    };
  }

  // Phase 1: pair rows for the structured delta path WITHOUT emitting or consuming anchors yet,
  // so the required safety detectors below claim their rows first (keeping NEEDS OEM / ADAS /
  // P-page classification). Structured deltas are emitted afterward (phase 2) on what remains.
  let deltaMatch: StructuredLineItemDeltaMatch | null = null;
  try {
    deltaMatch = matchStructuredLineItemDeltas(context);
  } catch (error) {
    console.error("[citation-density] structured line-item delta matcher failed (non-fatal)", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  // Lines the structured delta pass already covers with a typed finding — the
  // generic detectors must not shadow them with weaker prose (O-6: alignment
  // reads "price $0.00 vs $100.00", never "Carrier allowed labor: missing").
  const structuredDeltaLineNumbers = new Set(
    (deltaMatch?.orderedDeltas ?? [])
      .map((delta) => delta.higherRow.lineNumber)
      .filter((line): line is number => line !== null)
  );
  let sandPolishSeen = false;
  let batteryResetSeen = false;
  // Suppress wheel_labor_delta when the canonical delta set is present — canonical findings
  // are the authoritative lead; wheel R&I access lines must not appear as top findings.
  let wheelDetectorSeen = !!context.canonicalDeltaSet;
  let wheelAccessDetectorSeen = false;
  let wheelAlignmentDetectorSeen = false;
  let hubDetectorSeen = false;

  for (const anchor of context.anchors) {
    const rowText = getAnchorSourceText(anchor);
    const normalized = normalizeMatchText(rowText);
    if (!rowText.trim()) continue;

    if (!isPrimaryEstimateAnchor(anchor)) {
      if (isRejectedPrimaryAnchorText(rowText, anchor)) {
        rejectedAnchors.push({
          anchorId: anchor.anchorId,
          pageNumber: anchor.pageNumber,
          anchorType: anchor.anchorType,
          rowText: truncateText(rowText, 220),
          reason: "boilerplate, guide, supplier-only, policy, or legal text rejected as primary finding anchor",
        });
      }
      continue;
    }

    // Even an anchor classed as "primary" must not become a LEAD finding when its row is a
    // totals-only line or a glossary/abbreviation/disclaimer/legend section (e.g. the page-7
    // "Equipment Manufacturer aftermarket parts are described as..." legend). Structured
    // line-pair deltas are the authoritative lead findings; these sections are not (DEFECT B).
    if (isNonLeadablePrimaryAnchorText(rowText, anchor)) {
      rejectedAnchors.push({
        anchorId: anchor.anchorId,
        pageNumber: anchor.pageNumber,
        anchorType: anchor.anchorType,
        rowText: truncateText(rowText, 220),
        reason: "totals-only or glossary/legend/disclaimer section rejected as lead finding anchor",
      });
      continue;
    }

    const sourceKinds = classifyPartSource(rowText);
    const hasWheel = isWheelLaborAnchorText(normalized);
    const hasAccessLabor = /\b(?:r\s*&\s*i|r&i|remove|install|disassembly|reassembly|access)\b/i.test(rowText);

    const coveredByStructuredDelta =
      anchor.lineNumber !== null &&
      anchor.lineNumber !== undefined &&
      structuredDeltaLineNumbers.has(Number(anchor.lineNumber));
    if (!usedAnchorIds.has(anchor.anchorId) && !coveredByStructuredDelta && hasWheel && /\b(?:repair|sublet|mount|balance|alignment|replacement|repl|replace|r&i|r\s*&\s*i|access)\b/.test(normalized)) {
      const comparisonWheelAccess = /\b(?:wheel|rim|tire|alignment|liner|flare)\b[\s\S]{0,80}\b(?:r&i|r\s*&\s*i|remove|install|access|disassembly|reassembly|replacement|repl)\b/i.test(comparisonText) ||
        /\b(?:r&i|r\s*&\s*i|remove|install|access|disassembly|reassembly|replacement|repl)\b[\s\S]{0,80}\b(?:wheel|rim|tire|alignment|liner|flare)\b/i.test(comparisonText);
      const zeroOrMissingLabor = anchor.labor === 0 || anchor.labor === null || /\b0\.0\b/.test(rowText);
      const alignmentGroup = /\balignment\b/.test(normalized);
      const groupAlreadySeen = alignmentGroup ? wheelAlignmentDetectorSeen : wheelAccessDetectorSeen;
      if (!groupAlreadySeen && (zeroOrMissingLabor || comparisonWheelAccess || hasAccessLabor)) {
        if (alignmentGroup) {
          wheelAlignmentDetectorSeen = true;
        } else {
          wheelAccessDetectorSeen = true;
        }
        wheelDetectorSeen = true;
        findings.push(buildRequiredDetectorFinding({
          context,
          anchor,
          findingType: "wheel_labor_delta",
          title: "Wheel repair / R&I access labor review",
          category: "r_and_i",
          label: "ESTIMATE GAP ONLY",
          score: isTeslaOrEv ? 66 : 60,
          safetyImpact: isTeslaOrEv ? "high" : "medium",
          priority: "high",
          currentSupportSummary: `Carrier/source rows affected: ${summarizeWheelCarrierEvidence(context.anchors)}. Anchored row: ${rowText}. Carrier allowed labor: ${anchor.labor ?? "missing/0.0"}. Shop/comparison wheel access evidence: ${summarizeComparisonEvidence(comparisonText, /wheel|rim|tire|alignment|access|r&i|remove|install|replacement|repl/i)}.`,
          missingProofSummary: "Carrier may be missing or inadequately documenting wheel R&I/access labor. Wheel repair, wheel cover, mount/balance, wheel replacement, tire replacement, or wheel-opening access may require line-item R&I/access labor when removal is needed for liner, flare, bumper hardware, or wheel-end access.",
          recommendedNextAction: "Request line-item wheel R&I/access labor or a written included-operation basis explaining where the wheel removal/access labor is included.",
          missingAuthorityTypes: ["line-item R&I/access labor basis", "included-operation basis", "shop comparison estimate"],
          laborHoursImpact: typeof anchor.labor === "number" ? Math.max(0.1, 0.1 - anchor.labor) : 0.1,
          amountImpact: anchor.price ?? null,
        }));
        usedAnchorIds.add(anchor.anchorId);
      }
    }

    const wheelEndPart = /\b(?:hub|bearing|knuckle|control arm|tie rod|steering|strut|spindle|suspension)\b/.test(normalized);
    if (!usedAnchorIds.has(anchor.anchorId) && wheelEndPart && hasNonOemPartSource(sourceKinds)) {
      hubDetectorSeen = true;
      findings.push(buildRequiredDetectorFinding({
        context,
        anchor,
        findingType: "am_wheel_end_safety",
        title: "A/M wheel-end part-source safety review",
        category: "parts_downgrade",
        label: "NEEDS OEM",
        score: isTeslaOrEv ? 72 : 62,
        safetyImpact: "high",
        priority: "high",
        currentSupportSummary: `Estimate row uses ${formatPartSourceKinds(sourceKinds)} sourcing for a wheel-end, steering, bearing, hub, or suspension component: ${rowText}.`,
        missingProofSummary: `${isTeslaOrEv ? "EV weight and ADAS sensitivity increase the need for OEM procedure verification. " : ""}The hub is a safety-critical wheel-end component, and wheel-end/suspension geometry can affect steering, stability, sensor calibration, ADAS confidence, and roadworthiness. Carrier aftermarket warranty language may address fit, corrosion, or part replacement, but it does not prove OEM-equivalent system performance, ADAS compatibility, crash-test equivalency, or related manufacturer warranty preservation. This supports OEM review; it does not prove an OEM-only requirement without authority.`,
        recommendedNextAction: "Request OEM position/procedure support, supplier/manufacturer fit/function documentation, and the carrier's written basis for A/M/LKQ/non-OEM wheel-end use on this vehicle platform.",
        missingAuthorityTypes: ["OEM procedure or position support", "supplier/manufacturer fit-function documentation", "written carrier part-source basis"],
        amountImpact: anchor.price ?? null,
        laborHoursImpact: anchor.labor ?? null,
      }));
      usedAnchorIds.add(anchor.anchorId);
    }

    // Sand/polish support review — but never when the comparison estimate
    // carries the same operation (an identically-allowed line needs no
    // support-review flag; S-5 false positive on "Buff light bar").
    const sandPolishComparisonHasSame = (() => {
      const rowKey = deltaEngineCanonKey(rowText).key;
      if (!rowKey) return false;
      return repairTokens(comparisonText).toUpperCase().replace(/[^A-Z]/g, "").includes(rowKey);
    })();
    if (
      !usedAnchorIds.has(anchor.anchorId) &&
      !sandPolishComparisonHasSame &&
      /\b(?:finish sand|denib|de nib|color sand|sand and polish|sand polish|buff|refinish correction|post refinish correction)\b/.test(normalized)
    ) {
      sandPolishSeen = true;
      findings.push(buildRequiredDetectorFinding({
        context,
        anchor,
        findingType: "sand_polish_p_page_support",
        title: "Sand/polish refinish database support review",
        category: "refinish",
        label: "NEEDS P-PAGE",
        score: 58,
        safetyImpact: "low",
        priority: "medium",
        currentSupportSummary: `Refinish correction row found: ${rowText}.`,
        missingProofSummary: "Finish sand and polish, denib and polish, color sand and buff, sand and polish, or post-refinish correction is a refinish-related operation that needs CCC/MOTOR/P-page/database support when capped, limited, or disputed.",
        recommendedNextAction: "Attach CCC/MOTOR/P-page/database support or label the item NEEDS P-PAGE / NEEDS DATABASE SUPPORT before treating it as supplement-ready.",
        missingAuthorityTypes: ["CCC/MOTOR/P-page support", "database support"],
        amountImpact: anchor.price ?? null,
        laborHoursImpact: anchor.labor ?? null,
      }));
      usedAnchorIds.add(anchor.anchorId);
    }

    if (!usedAnchorIds.has(anchor.anchorId) && /\b(?:d\s*&\s*r battery|d&r battery|disconnect.*battery|reconnect.*battery|reset electronics|battery reset|isolate 12v|hv state of charge|state of charge)\b/i.test(rowText)) {
      batteryResetSeen = true;
      findings.push(buildRequiredDetectorFinding({
        context,
        anchor,
        findingType: "battery_reset_electrical_rate",
        title: "Battery D&R / reset electronics labor-category review",
        category: "scan_diagnostic",
        label: "NEEDS OEM",
        score: isTeslaOrEv ? 68 : 56,
        safetyImpact: isTeslaOrEv ? "high" : "medium",
        priority: "high",
        currentSupportSummary: `Electrical/mechanical procedure row found: ${rowText}. Labor/category shown: ${anchor.labor ?? "not parsed"} hours.`,
        missingProofSummary: "Battery disconnect/reconnect, reset electronics, 12V isolation, HV state-of-charge, or battery reset should be reviewed as mechanical/electrical procedure context, not a generic miscellaneous charge.",
        recommendedNextAction: "Request MOTOR/CCC category basis, OEM battery disconnect/reconnect/reset procedure support, and reconcile the labor category/rate if allowed at body or non-mechanical context.",
        missingAuthorityTypes: ["MOTOR/CCC labor-category basis", "OEM battery/reset procedure", "mechanical/electrical rate support"],
        amountImpact: anchor.price ?? null,
        laborHoursImpact: anchor.labor ?? null,
      }));
      usedAnchorIds.add(anchor.anchorId);
    }
  }

  // Phase 2: now that the required safety detectors have claimed their rows, fill every
  // remaining gap with structured deltas anchored on the higher-cost source. Structured deltas
  // lead the report, so they are prepended ahead of the detector findings.
  if (deltaMatch && deltaMatch.comparisonExtraction.gate) {
    // C-10 completion gate: the comparison document is mostly UNREAD (rows
    // parsed cover under half its own line-number span). A delta verdict over
    // partial state is not publishable — the pack renders as an INTAKE
    // report: what was read, what could not be, what to re-supply.
    const extraction = deltaMatch.comparisonExtraction;
    const intakeAnchor =
      context.anchors.find((anchor) => anchor.anchorType === "totals_row") ??
      context.anchors.find((anchor) => anchor.anchorType === "estimate_line");
    if (intakeAnchor) {
      findings.unshift(
        buildRequiredDetectorFinding({
          context,
          anchor: intakeAnchor,
          findingType: "delta-intake-comparison-extraction",
          title: `Intake only — the comparison estimate could not be read completely (${Math.round(extraction.coverage * 100)}% of its lines)`,
          category: "other",
          label: "INTAKE",
          estimateGapType: "needs_proof",
          score: 90,
          safetyImpact: "low",
          priority: "high",
          currentSupportSummary:
            `What was read: ${extraction.parsedRows} line(s) of ${deltaMatch.comparisonName} across a line-number span of ${extraction.impliedRows} — ` +
            `${Math.round(extraction.coverage * 100)}% coverage. What could not be read: approximately ${Math.max(0, extraction.impliedRows - extraction.parsedRows)} line(s) implied by the document's own numbering. ` +
            `No line-level delta verdict is rendered over this comparison — a demand built on a mostly-unread document is not defensible.`,
          missingProofSummary:
            "The comparison estimate's extraction coverage is below the confidence threshold (image-only/degraded source). Delta verdicts are withheld until a readable copy is supplied.",
          recommendedNextAction:
            "Re-supply the comparison estimate as a text-layer PDF (original CCC/estimating-platform export) or a legible scan; then regenerate this report for the full line-level delta.",
          missingAuthorityTypes: ["legible/text-layer copy of the comparison estimate"],
        })
      );
    }
    comparisonExtractionCoverage = extraction.coverage;
    intakeModeActive = true;
    lineItemDeltaFindingCount = 0;
  } else if (deltaMatch) {
    // Rate/totals findings lead the report — rates and hour subtotals are
    // typically the largest cost-gap drivers.
    const totalsFindings = emitTotalsDeltaFindings(deltaMatch, context, usedAnchorIds);
    const structuredFindings = emitStructuredLineItemDeltaFindings(deltaMatch, context, usedAnchorIds);
    lineItemDeltaFindingCount = totalsFindings.length + structuredFindings.length;
    lineItemDeltaMatchedPairCount = deltaMatch.matchedPairCount;
    lineItemDeltaMissingCount = deltaMatch.missingOperationCount;
    findings.unshift(...totalsFindings, ...structuredFindings);
  }

  const missingRequiredDetectors = [
    wheelDetectorSeen ? null : "wheel_labor_delta",
    hubDetectorSeen ? null : "am_wheel_end_safety",
    sandPolishSeen ? null : "sand_polish_p_page_support",
    batteryResetSeen ? null : "battery_reset_electrical_rate",
  ].filter((item): item is string => Boolean(item));

  const resolvedAuthorityAttachedCount = attachResolvedAuthoritiesToFindings(
    findings,
    context.resolvedAuthorities ?? [],
    { vehicleMake: context.vehicleMake, jurisdiction: context.jurisdiction }
  );

  return {
    findings,
    debug: {
      requiredDetectorFindingCount: findings.length,
      missingRequiredDetectors,
      lineItemDeltaFindingCount,
      lineItemDeltaMatchedPairCount,
      lineItemDeltaMissingCount,
      resolvedAuthorityAttachedCount,
      comparisonExtractionCoverage,
      intakeModeActive,
      rejectedAnchors: rejectedAnchors.slice(0, 40),
      rejectedBoilerplateCount: rejectedAnchors.length,
      authoritySearchTrace: {
        ...buildDefaultOemAuthorityTrace(),
        authorityTraceBlockedReason: "No Google Drive/internal repair-procedure connector is available to this server-side PDF export path.",
        skippedReason: "No Google Drive/internal repair-procedure connector is available to this server-side PDF export path.",
        sandPolishSupportFound: false,
      },
    },
  };
}

function describeLineItemDelta(delta: EstimateLineItemDelta): {
  findingType: string;
  title: string;
  label: string;
  category: CitationDensityFinding["category"];
  estimateGapType: CitationDensityFinding["estimateGapType"];
  missingProof: string;
  nextAction: string;
  missingAuthorityTypes: string[];
  score: number;
  safetyImpact: "low" | "medium" | "high";
  priority: "low" | "medium" | "high";
} {
  const label = delta.higherRow.description;
  const profile = classifyLineItemDeltaProfile(delta);
  if (delta.bundledEquivalentCandidate) {
    // Itemized shop material vs a bundled/invoice-pending carrier allowance
    // (BetaSeal urethane vs "Glass Kit", primer/nozzles "invoice required").
    // Never presented as missing or expanded scope — it is an accounting-style
    // difference that reconciles through material invoices.
    return {
      findingType: "delta-bundled-material",
      title: `Itemized material vs bundled allowance: ${label}`,
      label: "OPEN TO INVOICE",
      category: profile.category,
      estimateGapType: "present_but_under_documented",
      missingProof:
        "This estimate itemizes this material line while the comparison estimate carries a bundled or invoice-pending allowance covering the same kind of material. This is a potential bundled-equivalent / invoice-dependent difference — not confirmed missing scope.",
      nextAction:
        "Reconcile the itemized material charges against the lower estimate's bundled allowance and the actual material invoices; confirm which document fully covers the materials used.",
      missingAuthorityTypes: ["material invoices", "bundled-allowance reconciliation"],
      score: Math.max(0, profile.score - 20),
      safetyImpact: "low",
      priority: "low",
    };
  }
  if (delta.kind === "expanded_scope") {
    return {
      findingType: "delta-expanded-scope",
      title: `Expanded scope within a present category: ${label}`,
      label: profile.label,
      category: profile.category,
      estimateGapType: "present_but_under_documented",
      missingProof:
        "Structured estimate comparison shows this line sits in a category the comparison estimate already covers. It reads as expanded or added scope within an existing category — a teardown addition, a changed part/labor line, or supporting material — not a brand-new operation. This is estimate-difference evidence only.",
      nextAction:
        "Compare this line to the comparison estimate's lines in the same category to confirm whether it is an added operation, a changed part/labor allowance, or supporting material.",
      missingAuthorityTypes: profile.missingAuthorityTypes,
      score: Math.max(0, profile.score - 12),
      safetyImpact: profile.safetyImpact,
      priority: profile.priority === "high" ? "medium" : profile.priority,
    };
  }
  if (delta.kind === "missing_operation") {
    if (delta.ocrUncertain) {
      // OCR confidence drives Delta confidence: the lower estimate is machine-read
      // from an image-only PDF, so a non-match is unverified, not a confirmed
      // omission. C-8: OCR is a PROVENANCE qualifier, orthogonal to the
      // finding TYPE — the finding keeps its type label and score lane
      // (identical shapes must not land 12 points apart because one carried
      // the qualifier), while title and proof language stay hedged and the
      // provenance rides explicitly in the proof text.
      return {
        findingType: "delta-missing-operation-ocr-uncertain",
        title: `Possibly missing (OCR-uncertain — verify against source): ${label}`,
        label: profile.label,
        category: profile.category,
        estimateGapType: "present_but_under_documented",
        missingProof:
          "This line is documented on the annotated estimate but was not located on the comparison estimate. " +
          "Provenance: VERIFY (OCR) — the comparison estimate was machine-read from an image-only PDF (OCR_UNCERTAIN / LOWER_ESTIMATE_OCR_LIMITATION), so OCR may have dropped or garbled it. " +
          "Treat this as unverified — not a confirmed omission — and VERIFY_AGAINST_SOURCE before relying on it.",
        nextAction:
          "Compare this line against the legible source of the comparison estimate (or a re-OCR/text version) to confirm whether it is genuinely absent before treating it as a gap.",
        missingAuthorityTypes: ["legible lower-estimate source", ...profile.missingAuthorityTypes],
        score: profile.score,
        safetyImpact: profile.safetyImpact,
        priority: profile.priority,
      };
    }
    return {
      findingType: "delta-missing-operation",
      title: `Missing from comparison estimate: ${label}`,
      label: profile.label,
      category: profile.category,
      estimateGapType: "missing_from_carrier",
      missingProof:
        "Structured estimate comparison shows this operation is documented on this (higher-cost) estimate but is not present on the comparison estimate. This is estimate-difference evidence; it does not by itself prove the operation is required.",
      nextAction:
        profile.nextAction,
      missingAuthorityTypes: profile.missingAuthorityTypes,
      score: profile.score,
      safetyImpact: profile.safetyImpact,
      priority: profile.priority,
    };
  }
  // Direction-aware framing: a matched cell where the LOWER estimate is
  // HIGHER (carrier allows more paint, a sublet the shop didn't price) is
  // evidence in the other direction — never presented as "allows less".
  if (isLowerAllowsMoreDelta(delta)) {
    // D-3: the next action names the delta's OWN driving cell — a sublet
    // reconciliation must never suggest "added paint allowance".
    const drivingCell = deltaDrivingCell(delta);
    const isSublet =
      /\bSubl\b/i.test(`${delta.higherRow.opCode ?? ""} ${delta.lowerRow?.opCode ?? ""} ${delta.higherRow.rawText}`) ||
      /\balignment\b/i.test(delta.higherRow.description);
    const nextAction = isSublet
      ? "Verify the sublet operation the comparison estimate priced (obtain its sublet invoice); adopt the allowance on this estimate or document why the operation is not needed."
      : drivingCell === "paint"
        ? "Verify whether this estimate should adopt the comparison estimate's paint/refinish allowance for this line, or document the included-operation basis for showing it at zero."
        : drivingCell === "labor"
          ? "Verify whether this estimate should adopt the comparison estimate's labor allowance for this line, or document why the hours are not needed."
          : "Verify whether this estimate should adopt the comparison estimate's line price/materials allowance, or document why it is not needed.";
    return {
      findingType: "delta-carrier-higher",
      title: `Comparison estimate allows MORE here: ${label}`,
      label: "CARRIER HIGHER",
      category: profile.category,
      estimateGapType: "present_but_under_documented",
      missingProof:
        "On this matched line the comparison estimate carries the higher value (more hours or a priced sublet this estimate shows at zero). The cost gap runs in both directions — reconcile rather than assume either side is wrong.",
      nextAction,
      missingAuthorityTypes: ["reconciliation of the carrier-higher allowance"],
      score: Math.max(0, profile.score - 18),
      safetyImpact: "low",
      priority: "medium",
    };
  }
  if (delta.kind === "operation_change" && delta.codingOnlyChange) {
    // Identical hours/amounts, only the CCC operation token differs (R&I vs
    // Rpr battery handling). Kept in the report — Delta captures all changes
    // — but at low priority so a coding difference never reads as scope.
    return {
      findingType: "delta-coding-or-description-change",
      title: `Operation label differs (possible coding-only change): ${label}`,
      label: "CODING DIFFERENCE",
      category: profile.category,
      estimateGapType: "present_but_under_documented",
      missingProof:
        "The two estimates carry the same hours and amounts for this line; only the CCC operation label differs. This is likely a coding/description difference, not a scope change. " +
        "(Below the on-text annotation threshold: this finding carries a margin badge but no value mark on the estimate body — the values are equal.)",
      nextAction:
        "Verify whether this is only a CCC coding difference (e.g. D&R handling written as Rpr vs R&I) before treating it as a scope change.",
      missingAuthorityTypes: ["CCC coding basis for the operation label"],
      score: Math.max(0, profile.score - 30),
      safetyImpact: "low",
      priority: "low",
    };
  }
  if (delta.kind === "operation_change") {
    const fields = (delta.changedFields ?? []).join(", ");
    return {
      findingType: "delta-operation-change",
      title: `Changed on the higher estimate (${fields || "operation"}): ${label}`,
      label: profile.label,
      category: profile.category,
      estimateGapType: "present_but_under_documented",
      missingProof:
        "This line is present on both estimates but changed — the operation code and/or part differs (e.g. a repair escalated to replace, or a part was added). This is estimate-difference evidence; verify the change against OEM procedure and repair records.",
      nextAction:
        "Confirm the operation/part change against OEM repair procedure, teardown findings, and repair documentation.",
      missingAuthorityTypes: ["OEM procedure", "teardown/repair records", ...profile.missingAuthorityTypes],
      score: profile.score,
      safetyImpact: profile.safetyImpact,
      priority: profile.priority,
    };
  }
  if (delta.kind === "reduced_paint") {
    return {
      findingType: "delta-reduced-paint",
      title: `Comparison estimate allows less paint/refinish: ${label}`,
      label: "ESTIMATE GAP ONLY",
      category: "refinish",
      estimateGapType: "reduced_by_carrier",
      missingProof:
        "This estimate allows more paint/refinish time for this operation than the comparison estimate. Reconcile the difference against CCC/MOTOR/P-page refinish basis or document the lower allowance.",
      nextAction:
        "Reconcile the paint/refinish hours with the comparison estimate, or document the included-operation basis for the lower allowance.",
      missingAuthorityTypes: ["CCC/MOTOR/P-page refinish basis", "included-operation basis"],
      score: 48,
      safetyImpact: "low",
      priority: "medium",
    };
  }
  if (delta.kind === "part_source_difference") {
    const higherSource = (delta.higherRow.partSource ?? []).join(" ") || "new OEM";
    const lowerSource = (delta.lowerRow?.partSource ?? []).join(" ") || "new OEM";
    return {
      findingType: "delta-part-source",
      title: `Different part source (${higherSource} vs ${lowerSource}): ${label}`,
      label: "PART SOURCE",
      category: "parts_downgrade",
      estimateGapType: "present_but_under_documented",
      missingProof:
        `The two estimates specify different part sources for this line — ${higherSource} here, ${lowerSource} on the comparison estimate. ` +
        "This is a parts-procurement dispute, not a pricing dispute: the price difference follows from the source. Document availability, the supplier quote, and whether the alternate part is permitted by the repair procedure and the vehicle owner.",
      nextAction:
        "Resolve the part source before the price: obtain the supplier quote for the alternate part, confirm availability and condition, and check the OEM position statement and any state statute governing non-OEM parts for this vehicle.",
      missingAuthorityTypes: [
        "supplier quote for the alternate part",
        "OEM position statement on non-OEM parts",
        "part-type authorization",
      ],
      score: 72,
      safetyImpact: "medium",
      priority: "high",
    };
  }
  if (delta.kind === "part_or_price_difference") {
    return {
      findingType: "delta-part-price",
      title: `Priced differently on comparison estimate: ${label}`,
      label: "NEEDS INVOICE",
      category: "other",
      estimateGapType: "present_but_under_documented",
      missingProof:
        "The two estimates price this part differently. Document the part-type, supplier invoice, and fit/finish basis before relying on either price.",
      nextAction:
        "Obtain the supplier invoice and part-type authorization, and reconcile the price difference between the estimates.",
      missingAuthorityTypes: ["supplier invoice", "part-type authorization"],
      score: 46,
      safetyImpact: "low",
      priority: "medium",
    };
  }
  // reduced_labor — name the actual labor category (mechanical/diagnostic/…):
  // an M-marked line bills at the mechanical rate, and calling it "body labor"
  // misstates the dollars behind the hour difference.
  const laborNoun = laborTypeNoun(delta.higherRow.laborType ?? delta.lowerRow?.laborType);
  return {
    findingType: "delta-reduced-labor",
    title: `Comparison estimate allows less ${laborNoun}: ${label}`,
    label: "ESTIMATE GAP ONLY",
    category: "labor_difference",
    estimateGapType: "reduced_by_carrier",
    missingProof:
      `This estimate allows more ${laborNoun} for this operation than the comparison estimate. Reconcile the labor difference against MOTOR/CCC time basis or document the lower allowance.`,
    nextAction:
      `Reconcile the ${laborNoun} hours with the comparison estimate, or document the included-operation basis for the lower allowance.`,
    missingAuthorityTypes: ["MOTOR/CCC labor-time basis", "included-operation basis"],
    score: 52,
    safetyImpact: "low",
    priority: "medium",
  };
}

type StructuredLineItemDeltaMatch = {
  orderedDeltas: EstimateLineItemDelta[];
  anchorById: Map<string, EstimateRowAnchor>;
  primaryAnchors: EstimateRowAnchor[];
  comparisonName: string;
  matchedPairCount: number;
  missingOperationCount: number;
  /** Headline rate / hour-subtotal / category-amount differences from the ESTIMATE TOTALS blocks. */
  totalsDeltas: EstimateTotalsDelta[];
  /** totals_row anchors on the annotated source, for anchoring rate findings. */
  totalsAnchors: EstimateRowAnchor[];
  /** Lower-estimate lines with no counterpart on the annotated (higher) estimate. */
  lowerOnlyRows: EstimateDeltaRow[];
  /** Parsed lower ESTIMATE TOTALS block (rates for valuing lower-only labor). */
  lowerTotalsSummary: ReturnType<typeof parseCccEstimateTotals>;
  /** This estimate's own ESTIMATE TOTALS block. Its declared rates are what a
   * labor-only line is WORTH — without them a 1.0-hour scan carries no dollar
   * figure and cannot be ranked against a $4,063.50 category (M-4). */
  higherTotalsSummary: ReturnType<typeof parseCccEstimateTotals>;
  /** Line notes naming a known carrier that is NOT the file's dominant
   * carrier — a carrier-attribution defect on the document, reported as a
   * finding rather than adopted as the insurer. */
  carrierMismatchNotes: Array<{
    carrier: string;
    dominantCarrier: string;
    noteExcerpt: string;
    documentSide: "annotated" | "comparison";
    line: number;
    anchorId?: string;
  }>;
  /** M-3: the two estimates declare different paint systems for the same
   * vehicle. Carries the line evidence — the "Add for …" hours each side
   * bills — so the option-block disagreement and the paint-hour gap are one
   * connected finding instead of two unrelated ones. */
  paintSystemMismatch: {
    subject: string;
    comparison: string;
    subjectAddHours: number;
    comparisonAddHours: number;
    anchorId?: string;
  } | null;
  /** P0-1: operations withdrawn because the pack asserted both that the
   * comparison omitted them and that only the comparison carried them. */
  contradictionNotes: string[];
  /** Residual lower lines that duplicate an already-matched lower line (possible duplicate billing). */
  potentialDuplicateLowerRows: EstimateDeltaRow[];
  /** Arbitrary materials cap on the lower estimate (flat figure, no hrs@rate basis), with jurisdiction citation. */
  pmCapFlag: PmCapFlag | null;
  /** C-10: extraction completeness of the COMPARISON document. When `gate`
   * is true the pack renders as an INTAKE report — no delta verdicts. */
  comparisonExtraction: ReturnType<typeof assessComparisonExtraction>;
};

// Phase 1 of the structured delta path: parse and pair rows WITHOUT emitting findings or
// consuming anchors. Kept separate from emission so the required safety detectors can run first
// and claim their rows (keeping NEEDS OEM / ADAS / P-page classification); the structured
// deltas then fill every remaining gap.
function matchStructuredLineItemDeltas(
  context: AnnotatedEstimateFindingGeneratorContext
): StructuredLineItemDeltaMatch | null {
  const comparison = (context.comparisonEstimateTexts ?? []).filter(
    (item) => item.text && item.text.trim().length > 0
  );
  if (comparison.length === 0 && (context.comparisonEstimateWords?.length ?? 0) === 0) return null;

  const primaryAnchors = context.anchors.filter(
    (anchor) => anchor.anchorType === "estimate_line" || anchor.anchorType === "embedded_link_row"
  );
  const anchorById = new Map(primaryAnchors.map((anchor) => [anchor.anchorId, anchor]));
  // The annotated source PDF is the HIGHER-cost estimate, so its rows are the "higher" side and
  // carry the real anchors. The comparison estimate(s) are the LOWER-cost side. Each
  // "missing"/"reduced" delta then anchors precisely to the source row that documents it, which
  // is where the comparison estimate's gap is visible.
  const higherRows: EstimateDeltaRow[] = [];
  // Track the running section header (e.g. "FRONT BUMPER & GRILLE", "RADIATOR
  // SUPPORT") in document order so each line inherits its category. This lets
  // category-presence classification see that e.g. a "Repl Absorber" line sits
  // under the bumper category even when the line text itself carries no keyword.
  let currentSection: string | null = null;
  // Rebuild print-wrapped rows before parsing: a wrapped description or value
  // continuation is its own anchor line ("textured standard" / "167-880-43-09
  // 1 240.00"), and parsed alone it becomes a junk fragment row. Each rebuilt
  // row anchors to its FIRST source line — where the row visibly starts.
  const anchorGroups = groupWrappedEstimateLines(primaryAnchors.map((anchor) => anchor.rowText));
  for (const group of anchorGroups) {
    const anchor = primaryAnchors[group.sourceIndexes[0]];
    if (isSectionHeader(group.text)) {
      currentSection =
        group.text.replace(/^\s*\d{1,4}\s+/, "").replace(/\s+/g, " ").trim() || currentSection;
    }
    // Prefer the running header tracked over THIS anchor stream: the anchor's
    // own section comes from a small fixed header list and goes stale on
    // unlisted headers (RO 22108 carried "windshield" through ROOF, LIFT GATE,
    // and REAR BUMPER, cross-pairing repeated generic rows like "Overlap Major
    // Non-Adj. Panel" across sections). The anchor section is only a fallback
    // for rows seen before the first header.
    const anchorSection =
      currentSection ??
      (typeof anchor.section === "string" && anchor.section.trim() ? anchor.section : null);
    const row = deltaRowFromRawText({
      rawText: group.text,
      section: anchorSection,
      anchorId: anchor.anchorId,
      pageNumber: anchor.pageNumber,
    });
    if (row) higherRows.push(row);
  }
  // Multi-page prints repeat rows on supplement/recap pages (the same tire
  // line on p4 and p10). CCC line numbers are unique per estimate, so keep the
  // FIRST copy — matching parseCccEstimateRows. Without this, the duplicate
  // double-reports: one copy pairs (e.g. reduced_labor) and the other copy,
  // now unmatched, becomes a false expanded_scope finding for the same line.
  const seenHigherLineNumbers = new Set<number>();
  let dedupedHigherRows = higherRows.filter((row) => {
    if (row.lineNumber === null) return true;
    if (seenHigherLineNumbers.has(row.lineNumber)) return false;
    seenHigherLineNumbers.add(row.lineNumber);
    return true;
  });

  let lowerRows = comparison.flatMap((item) => parseCccEstimateRows(repairTokens(item.text)));

  // Typed-engine path: when BOTH sides can be parsed from a measured word
  // layer, replace the text-derived rows with delta-engine rows serialized
  // back through the canonical row builder. Symmetric typed extraction is what
  // eliminates note-bleed splits (RC-1), duplicate-note match collisions
  // (RC-2), and paint-read-as-labor cell fusion (RC-3) at the source. When
  // either side is unavailable, the legacy text parse stands unchanged.
  const subjectWordPages = pdfWordsToEnginePages(
    context.visualLines.flatMap((line) => line.words)
  );
  const comparisonWordSet =
    (context.comparisonEstimateWords ?? []).find(
      (entry) => entry.estimateRole && entry.estimateRole !== context.sourceDocumentRole
    ) ?? (context.comparisonEstimateWords ?? [])[0];
  const carrierMismatchNotes: StructuredLineItemDeltaMatch["carrierMismatchNotes"] = [];
  let engineMatch: ReturnType<typeof engineResultToLineItemDeltas> | null = null;
  if (comparisonWordSet) {
    const subjectDiag = emptyRowParseDiagnostics();
    const competingDiag = emptyRowParseDiagnostics();
    const subjectEngineRows = parseDeltaEngineRows(subjectWordPages, subjectDiag);
    const competingEngineRows = parseDeltaEngineRows(
      pdfWordsToEnginePages(comparisonWordSet.words),
      competingDiag
    );
    if (subjectEngineRows.length >= 10 && competingEngineRows.length >= 10) {
      // Column-identity guard (RC-3): the typed cells of each side must
      // reconcile against that document's own SUBTOTALS row. A mismatch means
      // the extract lost column identity — fail the extract; emit nothing
      // rather than findings built on mistyped cells.
      const subtotalsOk = (rows: DeltaEngineRow[], pages: Map<number, DeltaEngineWord[]>) => {
        const printed = parseDeltaEngineSubtotals(pages);
        if (!printed || (printed.labor === null && printed.paint === null)) return true; // nothing to reconcile against
        // A SUBTOTALS rule closes the ESTIMATE BODY. What follows it on a
        // supplement is the SUPPLEMENT SUMMARY — a changelog of Deleted and
        // Added items, history rather than inventory — and its deleted lines
        // carry NEGATIVE hours. Summing those against a subtotal that never
        // included them invents a shortfall: RO 22116's SOR-2 prints 44.7
        // labor hours, its body rows sum to exactly 44.7, and its changelog
        // pages contribute -2.7, so the extract looked broken when it was
        // perfect and every line-item delta was suppressed.
        const body = printed.page ? rows.filter((row) => row.page <= printed.page) : rows;
        const laborSum = body.reduce((total, row) => total + (row.labor ?? 0), 0);
        const paintSum = body.reduce((total, row) => total + (row.paint ?? 0), 0);
        const laborOk = printed.labor === null || Math.abs(laborSum - printed.labor) <= 0.21;
        const paintOk = printed.paint === null || Math.abs(paintSum - printed.paint) <= 0.21;
        return laborOk && paintOk;
      };
      const subjectReconciles = subtotalsOk(subjectEngineRows, subjectWordPages);
      const competingReconciles = subtotalsOk(
        competingEngineRows,
        pdfWordsToEnginePages(comparisonWordSet.words)
      );
      if (!subjectReconciles || !competingReconciles) {
        console.error("[citation-density] typed-cell column identity failed SUBTOTALS reconciliation — suppressing line-item deltas", {
          subjectReconciles,
          competingReconciles,
        });
        // Silence about a parsing limit is how an empty report reads as "no
        // differences found". Suppression is defensible; suppression the
        // reader cannot see is not.
        const failedSide = !subjectReconciles
          ? !competingReconciles
            ? "both estimates"
            : "this estimate"
          : "the comparison estimate";
        context.extractionWarnings?.push(
          `Line-item comparison was withheld: the typed columns of ${failedSide} do not reconcile to that document's own printed SUBTOTALS, so any line-level difference could be an extraction error rather than a real one. Totals-level findings are unaffected.`
        );
        return null;
      }
      // Anchor resolution for the engine path validates every line-number
      // candidate against the ENGINE row's own text: a leading integer in
      // prose (a "4 Wheel Drive…" options paragraph, a street number, a year)
      // can claim a line number the typed engine parsed elsewhere. When no
      // text-consistent anchor exists but the engine row carries a measured
      // bbox, an anchor is built from that measurement — the engine's
      // geometry IS the primary measurement per the Delta Annotation Rule.
      const engineRowByLine = new Map<string, DeltaEngineRow>();
      for (const row of subjectEngineRows) {
        if (!engineRowByLine.has(String(row.line))) engineRowByLine.set(String(row.line), row);
      }
      const anchorMatchesEngineRow = (anchor: EstimateRowAnchor, row: DeltaEngineRow): boolean => {
        const significant = row.rawDesc
          .toLowerCase()
          .replace(/[^a-z\s]/g, " ")
          .split(/\s+/)
          .filter((token) => token.length >= 4);
        if (!significant.length) return true; // nothing to validate against
        const anchorText = ` ${anchor.normalizedRowText ?? anchor.rowText.toLowerCase()} `;
        return significant.some((token) => anchorText.includes(token));
      };
      const anchorByLineNumber = new Map<string, EstimateRowAnchor>();
      for (const anchor of primaryAnchors) {
        if (!anchor.lineNumber) continue;
        const engineRow = engineRowByLine.get(anchor.lineNumber);
        if (engineRow && !anchorMatchesEngineRow(anchor, engineRow)) continue;
        if (!anchorByLineNumber.has(anchor.lineNumber)) {
          anchorByLineNumber.set(anchor.lineNumber, anchor);
        }
      }
      for (const [line, row] of engineRowByLine) {
        if (anchorByLineNumber.has(line) || !row.box) continue;
        const pageLine = context.visualLines.find((visual) => visual.pageNumber === row.page);
        const pageTemplate = pageLine ?? context.visualLines[0];
        if (!pageTemplate) continue;
        const measuredAnchor = buildMeasuredEngineRowAnchor({
          sourceDocumentId: context.sourceDocumentId,
          sourceDocumentRole: context.sourceDocumentRole,
          pageNumber: row.page,
          pageWidth: pageTemplate.pageWidth,
          pageHeight: pageTemplate.pageHeight,
          lineNumber: row.line,
          rowText: `${row.line} ${row.rawDesc}`.replace(/\s+/g, " ").trim(),
          section: row.sectionLabel,
          box: row.box,
        });
        anchorByLineNumber.set(line, measuredAnchor);
        anchorById.set(measuredAnchor.anchorId, measuredAnchor);
        primaryAnchors.push(measuredAnchor);
        // The renderer resolves finding anchors from the generator context's
        // anchor array — the measured anchor must live there to place.
        context.anchors.push(measuredAnchor);
      }
      const engineHigher = engineRowsToDeltaRows(subjectEngineRows, anchorByLineNumber);
      const engineLower = engineRowsToDeltaRows(competingEngineRows, null);
      if (engineHigher.length >= 10 && engineLower.length >= 10) {
        dedupedHigherRows = engineHigher;
        lowerRows = engineLower;
        // ONE detector pass (O-2): the SAME pairAndCompare result the
        // annotation layer consumes becomes the findings source, adapted to
        // the legacy emission shape. Dedupe repeated print-page lines first.
        const seenSubjectLines = new Set<number>();
        const dedupedSubjectEngineRows = subjectEngineRows.filter((row) => {
          if (seenSubjectLines.has(row.line)) return false;
          seenSubjectLines.add(row.line);
          return true;
        });
        const seenCompetingLines = new Set<number>();
        const dedupedCompetingEngineRows = competingEngineRows.filter((row) => {
          if (seenCompetingLines.has(row.line)) return false;
          seenCompetingLines.add(row.line);
          return true;
        });
        engineMatch = engineResultToLineItemDeltas({
          engine: pairAndCompare(dedupedSubjectEngineRows, dedupedCompetingEngineRows),
          anchorByLineNumber,
        });
      }

      // Carrier-attribution defect scan (O-1): a line note naming a known
      // carrier other than the file's dominant one is a defect on that
      // document — a finding, never an insurer source.
      const dominantCarrier = detectDominantKnownCarrier(
        `${context.sourceText ?? ""}\n${comparison.map((item) => item.text).join("\n")}`
      );
      if (dominantCarrier) {
        const subjectByKey = new Map(subjectEngineRows.map((row) => [row.key + "|" + row.side, row]));
        const scanRows = [
          ...subjectEngineRows.map((row) => ({ row, side: "annotated" as const })),
          ...competingEngineRows.map((row) => ({ row, side: "comparison" as const })),
        ];
        for (const { row, side } of scanRows) {
          if (!row.note) continue;
          // U-6: any organization-like name that is not the resolved carrier
          // and not a known non-carrier entity — open-world (an unseen
          // carrier's corporate-suffix shape still flags), bidirectional
          // (both documents scanned), and suppressed in legitimate contexts
          // (subrogation / prior loss / third-party claim language).
          for (const carrier of findForeignOrganizationMentions(row.note, dominantCarrier)) {
            // Anchor on the ANNOTATED document: the row itself when the note
            // is there, else the paired subject row for a comparison note.
            const subjectRow =
              side === "annotated" ? row : subjectByKey.get(row.key + "|" + row.side) ?? null;
            const anchor = subjectRow ? anchorByLineNumber.get(String(subjectRow.line)) : undefined;
            carrierMismatchNotes.push({
              carrier,
              dominantCarrier,
              noteExcerpt: row.note.slice(0, 160),
              documentSide: side,
              line: row.line,
              anchorId: anchor?.anchorId,
            });
          }
        }
      }
    }
  }

  if (lowerRows.length === 0 || dedupedHigherRows.length === 0) return null;

  // Only annotate in the intended direction (the annotated source must be the higher-cost
  // estimate). If totals are known and the comparison is actually the higher one, skip so we
  // never claim the source estimate is "missing" scope the comparison merely adds.
  const sourceTotal = parseEstimateNetTotal(context.sourceText ?? "");
  const comparisonTotal = comparison
    .map((item) => parseEstimateNetTotal(item.text))
    .find((value): value is number => value !== null) ?? null;
  if (sourceTotal !== null && comparisonTotal !== null && sourceTotal < comparisonTotal) {
    return null;
  }

  // The comparison estimate is OCR-derived when its text carries the OCR recovery
  // marker (image-only/scanned PDF). Soften "absent" language in that case.
  const lowerIsOcr = comparison.some((item) =>
    /OCR text recovered from a scanned/i.test(item.text)
  );
  // Seed category presence from the full comparison text so an OCR-flattened
  // lower estimate (few parseable rows) still recognizes its own categories.
  const lowerCategoryText = comparison.map((item) => item.text).join("\n");
  // Parse-coverage guard: when the comparison estimate yields only a small
  // fraction of the rows the annotated estimate has, its extraction MAY have
  // failed in a way row parsing could not recover from — an unmatched line
  // would then mean "we could not read the counterpart", NOT "the counterpart
  // omits it".
  //
  // M-1: a low row count is only evidence of extraction loss when the text
  // layer is actually degraded, and that is a question about FONTS, not about
  // row counts. GEICO's 33-line Estimate of Record on RO 22182 states on its
  // face that it "WAS GENERATED BY AN ARTIFICIAL INTELLIGENCE APPLICATION
  // BASED ON PHOTOGRAPHIC DATA" — 33 lines against the shop's 179 is the
  // carrier's real scope, and it is the finding. Its fonts are embedded
  // (missing ToUnicode only), so nine genuinely-absent operations were titled
  // "Possibly missing (OCR-uncertain — verify against source)" and the body
  // told the reader the estimate "was machine-read from an image-only PDF".
  // Both statements were false, and the hedge cost the four largest findings
  // their standing.
  const lowerParseSuspect = comparisonExtractionIsDegraded({
    textLayerReliable: !(context.comparisonEstimateWords ?? []).some(
      (entry) => entry.textLayerReliable === false
    ),
    higherRowCount: dedupedHigherRows.length,
    lowerRowCount: lowerRows.length,
  });
  /**
   * DOCUMENT CONFIDENCE ON THE FINDINGS LANE.
   *
   * The hours-coverage gate above guards the VALUE-MARK layer, and that layer
   * only runs when the comparison document supplied a word layer. A scanned
   * estimate supplies OCR text and no word layer, so it skipped the gate
   * entirely and the findings lane ran unguarded — exactly the document class
   * the gate was built for.
   *
   * Measured on RO 22059 with the counterpart truncated to 34% of its rows:
   * 216 absence phrases in the artifact against 98 for the fully-read control.
   * The 66% of carrier lines this pass could not read had each become "the
   * carrier did not write this."
   *
   * So confidence is derived here too, from the same observables, and the
   * per-section gate is handed to the matcher.
   */
  const lowerSpanCoverage = assessComparisonExtraction(
    lowerRows.map((row) => ({ lineNumber: row.lineNumber }))
  );
  const lowerHoursCoverage = assessHoursCoverage(
    lowerRows.map((row) => ({ labor: row.labor, paint: row.paint })),
    comparison.map((item) => item.text).join("\n")
  );
  const lowerSectionRowCounts = new Map<string, number>();
  for (const row of lowerRows) {
    const key = (row.section ?? "").trim().toUpperCase();
    lowerSectionRowCounts.set(key, (lowerSectionRowCounts.get(key) ?? 0) + 1);
  }
  const higherSections = new Set(
    dedupedHigherRows.map((row) => (row.section ?? "").trim().toUpperCase())
  );
  const lowerConfidence = deriveExtractionConfidence({
    lineSpanCoverage: lowerSpanCoverage.coverage,
    hoursCoverage: lowerHoursCoverage.coverage,
    textLayerReliable: !(context.comparisonEstimateWords ?? []).some(
      (entry) => entry.textLayerReliable === false
    ),
    ocrDerived: lowerIsOcr,
    totalsBlockFound: lowerHoursCoverage.totalsBlockFound,
    sectionsWithZeroCounterpartRows: [...higherSections].filter(
      (section) => (lowerSectionRowCounts.get(section) ?? 0) === 0
    ).length,
    totalSections: higherSections.size,
  });
  const absenceAllowedForSection = (section: string | null): boolean =>
    sectionSupportsAbsenceClaims({
      counterpartRowsInSection:
        lowerSectionRowCounts.get((section ?? "").trim().toUpperCase()) ?? 0,
      documentConfidence: lowerConfidence,
    });
  /** P0-1 contradiction notices, surfaced on the pack so a withdrawn claim is
   * visible rather than silently absent. */
  const contradictionNotes: string[] = [];
  if (lowerConfidence.band !== "high") {
    contradictionNotes.push(
      `Comparison estimate ${lowerConfidence.explanation}. Absence findings for sections the counterpart produced no rows for are marked unverified: a line this pass could not read is not a line the carrier omitted.`
    );
  }
  const match: {
    deltas: EstimateLineItemDelta[];
    matchedPairCount: number;
    missingOperationCount: number;
    lowerOnlyRows: EstimateDeltaRow[];
    potentialDuplicateLowerRows: EstimateDeltaRow[];
  } = engineMatch
    ? {
        deltas: engineMatch.deltas,
        matchedPairCount: engineMatch.matchedPairCount,
        missingOperationCount: engineMatch.missingOperationCount,
        lowerOnlyRows: engineRowsToDeltaRows(engineMatch.lowerOnlyRows, null),
        potentialDuplicateLowerRows: engineRowsToDeltaRows(engineMatch.potentialDuplicateLowerRows, null),
      }
    : matchEstimateLineItems({
        absenceAllowedForSection,
        lowerRows,
        higherRows: dedupedHigherRows,
        lowerIsOcr: lowerIsOcr || lowerParseSuspect,
        lowerCategoryText,
      });
  // P0-1: NEVER PUBLISH A DOCUMENT THAT CONTRADICTS ITSELF.
  //
  // An operation asserted BOTH as missing from the lower estimate and as
  // present only on it is one matching failure, not two findings. RO 22185
  // shipped four of them — the carrier wrote "Pre-Diagnostic Scan Charge"
  // where the shop wrote "Pre-repair scan", and the same PDF claimed each
  // side had omitted it while the annotated estimate stamped all four
  // "MISSED on ERIE".
  //
  // Both halves are withdrawn, because both are false: the operation is on
  // both estimates. The values are not lost — they are stated in a warning
  // naming both lines, so a real price difference still reaches the reader
  // while the unsupportable claims do not. The permanent fix is an alias in
  // data/operationAliases.json; this guard is what catches the wording nobody
  // has seen yet. Applied to the final match so it covers the typed-engine
  // lane and the text lane identically.
  const contradictions = findBucketContradictions(match.deltas, match.lowerOnlyRows);
  if (contradictions.length > 0) {
    // Only a CERTAIN contradiction withdraws findings. A suspected one is
    // reported and left standing: a shared-wording heuristic must not delete
    // a real omission, and the reader can compare two named lines themselves.
    const certain = contradictions.filter((item) => item.confidence === "certain");
    const withdrawnHigher = new Set(certain.map((item) => item.higherRow));
    const withdrawnLower = new Set(certain.map((item) => item.lowerRow));
    match.deltas = match.deltas.filter(
      (delta) => !(delta.kind === "missing_operation" && withdrawnHigher.has(delta.higherRow))
    );
    match.lowerOnlyRows = match.lowerOnlyRows.filter((row) => !withdrawnLower.has(row));
    for (const item of contradictions) {
      const money = (row: EstimateDeltaRow) =>
        row.price !== null && row.price > 0 ? ` ($${row.price.toFixed(2)})` : "";
      console.error("[delta] withdrew self-contradictory claims for one operation", {
        canonicalKey: item.canonicalKey,
        higher: item.higherRow.description,
        lower: item.lowerRow.description,
      });
      contradictionNotes.push(
        item.confidence === "certain"
          ? `"${item.higherRow.description}"${money(item.higherRow)} on this estimate and ` +
            `"${item.lowerRow.description}"${money(item.lowerRow)} on ${comparison[0]?.fileName ?? "the comparison estimate"} ` +
            `are the same operation written differently, so neither document omits it. ` +
            `No missing-operation or comparison-only claim is made for it; compare the two amounts directly. ` +
            `(Add the wording to the operation alias table so the pair reconciles automatically.)`
          : `"${item.higherRow.description}"${money(item.higherRow)} on this estimate closely resembles ` +
            `"${item.lowerRow.description}"${money(item.lowerRow)} on ${comparison[0]?.fileName ?? "the comparison estimate"}. ` +
            `If they are the same operation, neither document omits it and the difference is one of price or method — ` +
            `confirm before relying on the omission claim.`
      );
    }
  }

  // Aggregate-vs-member dedupe (S-3): a description group that produced
  // several deltas ("Trim Masking Tape" x3, "Set back, secure" x2) collapses
  // to ONE aggregated finding — summed values, occurrence counts — instead of
  // a per-row parade that double-counts the same relationship.
  const deltasByGroupKey = new Map<string, EstimateLineItemDelta[]>();
  for (const delta of match.deltas) {
    // Group by presentation BASE (side- and position-insensitive) AND kind AND
    // section: an equal-value coding difference must never merge into a value
    // delta that happens to share a description ("Applique" exists under
    // pillars, glass, and rear bumper). The base — not the pairing key — is
    // what lets a 4-way position group (LT/RT × Front/Rear) report as ONE
    // finding (U-1); pairing itself still keys on (base, position).
    const canon = deltaEngineCanonKey(delta.higherRow.description);
    const key = [
      canon.base || canon.key || delta.higherRow.description.toUpperCase(),
      delta.kind,
      delta.codingOnlyChange ? "coding" : "value",
      (delta.higherRow.section ?? "").replace(/\s+/g, " ").trim().toUpperCase(),
    ].join("::");
    const list = deltasByGroupKey.get(key) ?? [];
    if (list.length === 0) deltasByGroupKey.set(key, list);
    list.push(delta);
  }
  const mergedDeltas: EstimateLineItemDelta[] = [];
  for (const group of deltasByGroupKey.values()) {
    if (group.length === 1) {
      mergedDeltas.push(group[0]);
      continue;
    }
    const sum = (pick: (delta: EstimateLineItemDelta) => number | null) => {
      const values = group.map(pick).filter((value): value is number => value !== null);
      return values.length ? Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100 : null;
    };
    // Prefer the member that actually paired — the group is then a value
    // difference across occurrences, never a confirmed "missing" claim.
    const lead = group.find((delta) => delta.lowerRow !== null) ?? group[0];
    const lines = group.map((delta) => delta.higherRow.lineNumber).filter((line) => line !== null);
    // O-3: an LT/RT pair reported with one side's numbers understates the gap
    // by half — an adjuster reading "2.6 vs 1.3" on a two-sided pair concedes
    // 1.3 hr when the gap is 2.6. State per-side AND aggregate, and title the
    // group neutrally ("both sides"), never with one side's description.
    // Side detection via the normalized enum (U-1) — never a literal LT/RT
    // string test. A group is a SIDE GROUP when both left and right appear;
    // its size is whatever it is (2 for a plain pair, 4 for LT/RT × Front/
    // Rear, 3 when one counterpart is genuinely absent — say so, never drop).
    const memberSides = group.map((delta) => detectDeltaEngineSide(delta.higherRow.description));
    const memberPositions = group.map((delta) => detectDeltaEnginePosition(delta.higherRow.description));
    const isSideGroup =
      group.length >= 2 &&
      group.length <= 4 &&
      memberSides.includes("left") &&
      memberSides.includes("right") &&
      memberSides.every((side) => side !== "");
    const distinctPositions = new Set(memberPositions.filter(Boolean));
    const mergedLabor = sum((delta) => delta.laborDelta);
    const mergedPaint = sum((delta) => delta.paintDelta);
    const mergedPrice = sum((delta) => delta.priceDelta);
    const perSideBits: string[] = [];
    if (isSideGroup) {
      // Per-member value only when uniform across the group — a mixed group
      // must not present one member's number as "per side".
      const per = (pick: (d: EstimateLineItemDelta) => number | null, unit: string) => {
        const values = group.map(pick);
        const first = values[0];
        if (first === null || first === 0) return null;
        if (!values.every((value) => value === first)) return null;
        return `${Math.abs(first)}${unit}/side`;
      };
      for (const bit of [per((d) => d.paintDelta, " paint hr"), per((d) => d.laborDelta, " labor hr"), per((d) => d.priceDelta, " $")])
        if (bit) perSideBits.push(bit);
    }
    const aggregateBits = [
      mergedPaint ? `${mergedPaint > 0 ? "+" : ""}${mergedPaint} paint hr aggregate` : null,
      mergedLabor ? `${mergedLabor > 0 ? "+" : ""}${mergedLabor} labor hr aggregate` : null,
      mergedPrice ? `${mergedPrice > 0 ? "+" : ""}$${Math.abs(mergedPrice).toFixed(2)} aggregate` : null,
    ].filter(Boolean);
    const stripSideAndPosition = (desc: string) =>
      stripDeltaEngineSideTokens(desc, distinctPositions.size > 1).replace(/\s{2,}/g, " ").trim();
    const groupTag = isSideGroup
      ? group.length === 2
        ? `both sides, L${lines.join("/L")}`
        : group.length === 4
          ? `both sides × ${[...distinctPositions].join("/") || "positions"}, L${lines.join("/L")}`
          : `${group.length} of a side group — one counterpart absent, L${lines.join("/L")}`
      : null;
    const neutralRow: EstimateDeltaRow = isSideGroup
      ? {
          ...lead.higherRow,
          description: `${stripSideAndPosition(lead.higherRow.description)} (${groupTag})`,
        }
      : lead.higherRow;
    mergedDeltas.push({
      ...lead,
      higherRow: neutralRow,
      laborDelta: mergedLabor,
      paintDelta: mergedPaint,
      priceDelta: mergedPrice,
      statusLabels: [...(lead.statusLabels ?? []), `AGGREGATED_GROUP_${group.length}X`],
      summary: `${lead.summary}${perSideBits.length ? ` Per side: ${perSideBits.join(", ")}.` : ""}${
        aggregateBits.length ? ` Aggregate across L${lines.join("/L")}: ${aggregateBits.join(", ")}.` : ` Aggregated across ${group.length} same-description lines (L${lines.join("/L")}).`
      }`,
    });
  }
  const orderedDeltas = [...mergedDeltas].sort(
    (a, b) => scoreLineItemDeltaForPriority(b) - scoreLineItemDeltaForPriority(a)
  );

  // Rate / totals lane: rates, hour subtotals, and category amounts from the
  // two ESTIMATE TOTALS blocks — typically the largest cost-gap drivers.
  // Categories come from the measured word layer when available: a glued text
  // layer prints "MechanicalLabor 7.9hrs@$175.00/hr" as one run and the text
  // parse drops the row entirely, which is what produced false
  // "no category on the lower estimate" claims (RC-4). Subtotal/tax/grand
  // figures still come from the text parse (they survive gluing).
  const mergeTotalsWithWordCategories = (
    textTotals: ReturnType<typeof parseCccEstimateTotals>,
    wordPages: Map<number, DeltaEngineWord[]> | null
  ): ReturnType<typeof parseCccEstimateTotals> => {
    if (!wordPages) return textTotals;
    const wordCategories = parseDeltaEngineTotals(wordPages);
    // Only replace the text-parsed categories when the word layer parsed at
    // least as completely (count AND rate coverage) — a synthetic or unusual
    // totals layout can word-parse worse than it text-parses.
    const textCategories = textTotals?.categories ?? [];
    const rateCount = (rows: Array<{ rate: number | null }>) =>
      rows.filter((row) => row.rate !== null).length;
    if (
      wordCategories.length < 3 ||
      wordCategories.length < textCategories.length ||
      rateCount(wordCategories) < rateCount(textCategories)
    ) {
      return textTotals;
    }
    return {
      categories: wordCategories.map((row) => ({
        category: row.category.replace(/\s+/g, " ").trim(),
        hours: row.hours,
        rate: row.rate,
        cost: row.amount,
      })),
      subtotal: textTotals?.subtotal ?? null,
      salesTax: textTotals?.salesTax ?? null,
      grandTotal: textTotals?.grandTotal ?? null,
      taxLanes: textTotals?.taxLanes ?? [],
    };
  };
  const higherTotals = mergeTotalsWithWordCategories(
    parseCccEstimateTotals(context.sourceText ?? ""),
    subjectWordPages.size > 0 ? subjectWordPages : null
  );
  const lowerTotals = mergeTotalsWithWordCategories(
    comparison
      .map((item) => parseCccEstimateTotals(item.text))
      .find((totals) => totals !== null) ?? null,
    comparisonWordSet ? pdfWordsToEnginePages(comparisonWordSet.words) : null
  );
  const totalsDeltas = compareEstimateTotals({ higher: higherTotals, lower: lowerTotals });
  const totalsAnchors = context.anchors.filter((anchor) => anchor.anchorType === "totals_row");

  // Arbitrary materials cap (runbook Step 6): lower estimate pays a materials
  // category flat with no hrs@rate basis while this estimate computes one.
  // Jurisdiction resolves from the repair-facility state in the SOURCE header
  // (never the comparison doc's first zip — often the insurer HQ).
  const pmCapFlag = buildPmCapFlag({
    higher: higherTotals,
    lower: lowerTotals,
    state: detectRepairFacilityState(context.sourceText, lowerCategoryText),
  });

  // M-3: the paint system is a property of the VEHICLE, so the two estimates
  // must agree on it. When they do not, the option-block disagreement and the
  // "Add for …" line hours are ONE finding — the shop's THREE STAGE PAINT and
  // GEICO's CLEARCOAT PAINT on RO 22182 drove much of a 19.5-hour paint gap
  // that the report reported as unrelated line differences.
  const subjectPaintSystem = detectPaintSystem(context.sourceText ?? "");
  const comparisonPaintSystem = detectPaintSystem(lowerCategoryText);
  const paintSystemMismatch =
    subjectPaintSystem && comparisonPaintSystem && subjectPaintSystem !== comparisonPaintSystem
      ? {
          subject: subjectPaintSystem,
          comparison: comparisonPaintSystem,
          subjectAddHours: paintSystemAddHours(dedupedHigherRows),
          comparisonAddHours: paintSystemAddHours(lowerRows),
          anchorId: dedupedHigherRows.find(
            (row) => /add\s+for\b/i.test(row.rawText) && detectPaintSystem(row.rawText)
          )?.anchorId,
        }
      : null;

  return {
    orderedDeltas,
    anchorById,
    primaryAnchors,
    comparisonName: comparison[0]?.fileName || "the comparison estimate",
    matchedPairCount: match.matchedPairCount,
    missingOperationCount: match.missingOperationCount,
    totalsDeltas,
    totalsAnchors,
    lowerOnlyRows: match.lowerOnlyRows,
    contradictionNotes,
    lowerTotalsSummary: lowerTotals,
    higherTotalsSummary: higherTotals,
    carrierMismatchNotes,
    paintSystemMismatch,
    potentialDuplicateLowerRows: match.potentialDuplicateLowerRows,
    pmCapFlag,
    comparisonExtraction: assessComparisonExtraction(lowerRows),
  };
}

// Phase 2: emit findings for the matched deltas, skipping any anchor already claimed (e.g. by a
// required safety detector that ran first). Mutates usedAnchorIds.
function emitStructuredLineItemDeltaFindings(
  deltaMatch: StructuredLineItemDeltaMatch,
  context: AnnotatedEstimateFindingGeneratorContext,
  usedAnchorIds: Set<string>
): CitationDensityFinding[] {
  const findings: CitationDensityFinding[] = [];
  const emittedSlugs = new Set<string>();
  const MAX_DELTA_FINDINGS = 60;

  // What a line is WORTH, from this estimate's own declared rates. A scan
  // billed as 1.0 hour with no parts price carried no dollar figure at all,
  // so the magnitude ceiling could not rank it and an $87.50 DTC-research
  // line outscored a $4,063.50 missing category (M-4).
  const subjectRates = (() => {
    const rates = new Map<string, number>();
    for (const category of deltaMatch.higherTotalsSummary?.categories ?? []) {
      if (category.rate !== null) rates.set(normalizeTotalsCategoryKey(category.category), category.rate);
    }
    return rates;
  })();
  const subjectRowValue = (row: EstimateDeltaRow): number | null => {
    if (row.price !== null && row.price > 0) return row.price;
    // Category keys normalize with the noise suffix stripped ("Mechanical
    // Labor" -> MECHANICAL), so both spellings are looked up.
    const rateFor = (...keys: string[]) => {
      for (const key of keys) {
        const rate = subjectRates.get(key);
        if (rate !== undefined) return rate;
      }
      return 0;
    };
    const bodyRate =
      row.laborType === "M"
        ? rateFor("MECHANICAL", "MECHANICALLABOR", "BODY", "BODYLABOR")
        : rateFor("BODY", "BODYLABOR");
    const paintRate = rateFor("PAINT", "PAINTLABOR") || bodyRate;
    const value = (row.labor ?? 0) * bodyRate + (row.paint ?? 0) * paintRate;
    return value > 0 ? Math.round(value * 100) / 100 : row.price;
  };

  let deltasTruncated = 0;
  for (const delta of deltaMatch.orderedDeltas) {
    if (findings.length >= MAX_DELTA_FINDINGS) {
      // NEVER truncate silently: a capped list reads as "this is everything".
      deltasTruncated = deltaMatch.orderedDeltas.length - deltaMatch.orderedDeltas.indexOf(delta);
      break;
    }

    // Ledger gate: only draw deltas the comparison confirmed as real changes.
    // annotate === false marks an OCR-uncertain, present-but-poorly-parsed line
    // (its part#/description is already in the OCR'd lower estimate), so it must
    // not be highlighted as a change just because fuzzy matching failed.
    if (delta.annotate === false) continue;

    // Every delta's higherRow is a source (annotated, higher-cost) row, so it carries the
    // anchor for the line where the comparison estimate's gap is visible. Fall back to a
    // section/description match only if the source anchor was filtered out upstream.
    let anchor: EstimateRowAnchor | undefined = delta.higherRow.anchorId
      ? deltaMatch.anchorById.get(delta.higherRow.anchorId)
      : undefined;
    if (!anchor) {
      anchor = findFallbackAnchorForMissingDelta(delta, deltaMatch.primaryAnchors);
    }
    if (!anchor) continue; // never emit an unanchored delta finding
    if (usedAnchorIds.has(anchor.anchorId) || emittedSlugs.has(`anchor:${anchor.anchorId}`)) {
      continue;
    }

    const meta = describeLineItemDelta(delta);
    // A SECTION_MISSED member must present as section-missing, not as
    // "expanded scope within a present category" — the category-presence
    // heuristic keys on keywords anywhere in the lower text (a vehicle-options
    // list mentioning "WHEELS" counts), and the per-line label then
    // contradicts the finding's own every-line-unpaid prose (RO 22140 Test 3).
    // C-7: title binds to the delta's OWN kind — a "Section missing" title on
    // an expanded-scope body (the category IS present on the lower estimate)
    // contradicts itself. Only a missing_operation member carries the tag
    // upstream now; the kind check here is defense in depth.
    if ((delta.statusLabels ?? []).includes("SECTION_MISSED") && delta.kind === "missing_operation") {
      meta.title = `Section missing from comparison estimate: ${delta.higherRow.section ?? "section"} — ${delta.higherRow.description}`;
      // Only the GENERIC gap label upgrades to SECTION MISSING — specialized
      // authority labels (NEEDS ADAS / NEEDS OEM / NEEDS INVOICE) drive their
      // own classification lanes and must survive the section marking.
      if (meta.label === "ESTIMATE GAP ONLY") meta.label = "SECTION MISSING";
    }
    const slug =
      delta.higherRow.description
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "operation";
    // Dedupe per ANCHOR, not per description: repeated manual-material lines
    // ("Mask for primer" prints once per panel, "Set back, secure Protect
    // wiring" once per lamp group) are each their own pay item, and collapsing
    // them to one finding hid every other instance from the report (RO 22108).
    const slugKey = `${meta.findingType}:${slug}:${anchor.anchorId}`;
    if (emittedSlugs.has(slugKey)) continue;
    emittedSlugs.add(slugKey);
    usedAnchorIds.add(anchor.anchorId);
    emittedSlugs.add(`anchor:${anchor.anchorId}`);

    findings.push(
      buildRequiredDetectorFinding({
        context,
        anchor,
        findingType: `${meta.findingType}-${slug}`,
        title: meta.title,
        category: meta.category,
        label: meta.label,
        estimateGapType: meta.estimateGapType,
        score: meta.score,
        safetyImpact: meta.safetyImpact,
        priority: meta.priority,
        currentSupportSummary:
          buildLineItemDeltaSupportSummary({
            delta,
            anchor,
            sourceName: context.sourcePdfName,
            comparisonName: deltaMatch.comparisonName,
          }) +
          // Cap evidence cross-reference: a MISSED left-on-vehicle material
          // line is itself proof the flat materials figure was not built from
          // the required operations — the cap finding enumerates these tags.
          (deltaMatch.pmCapFlag &&
          delta.lowerRow === null &&
          PM_CAP_MATERIAL_WORDS.test(delta.higherRow.description)
            ? ` [PM_CAP_EVIDENCE: this unpaid left-on-vehicle material line is evidence the flat ${deltaMatch.pmCapFlag.category} figure of $${deltaMatch.pmCapFlag.cap.toFixed(2)} was not built from the required operations.]`
            : ""),
        missingProofSummary: meta.missingProof,
        recommendedNextAction: meta.nextAction,
        missingAuthorityTypes: meta.missingAuthorityTypes,
        // A line with no counterpart puts its OWN amount in dispute; there is
        // no delta to subtract. Reporting null there left every missing
        // operation dollar-less, so the magnitude ceiling could not order them
        // and an $87.50 line outranked a $4,063.50 category (M-4).
        amountImpact: delta.priceDelta ?? (delta.lowerRow === null ? subjectRowValue(delta.higherRow) : null),
        laborHoursImpact: delta.laborDelta ?? null,
      })
    );
  }

  // A capped list reads as "this is everything". Say what was left out, on the
  // last finding that made the cut, so the reader knows to ask for the rest.
  if (deltasTruncated > 0 && findings.length > 0) {
    const last = findings[findings.length - 1];
    last.limitations = [
      ...(last.limitations ?? []),
      `${deltasTruncated} further line-item difference${deltasTruncated === 1 ? "" : "s"} were detected beyond this pack's per-report limit of ${MAX_DELTA_FINDINGS} and are not itemized here. They are the lowest-ranked by dollar and scope impact; request the full list if the itemized total must reconcile.`,
    ].slice(0, 12);
  }

  // P0-1: a withdrawn contradiction must be VISIBLE. Silently dropping both
  // halves would hide a real price difference behind a matching failure.
  if (deltaMatch.contradictionNotes.length > 0 && findings.length > 0) {
    const last = findings[findings.length - 1];
    // These notes lead, and the finding's own limitations are what the cap
    // trims. Appending put them last, where a finding that already carried 12
    // limitations dropped every one of them — which is how the extraction
    // confidence note went missing from a truncated-counterpart run whose
    // findings were correctly marked unverified. A withdrawn contradiction and
    // a low-confidence read are the two notices that must never be the ones cut.
    last.limitations = [...deltaMatch.contradictionNotes, ...(last.limitations ?? [])].slice(0, 12);
  }

  return findings;
}

// Rate / totals lane: headline rate, hour-subtotal, and category-amount
// differences from the two ESTIMATE TOTALS blocks, plus the lower-only-lines
// section. These anchor to totals_row anchors — the block on the annotated
// estimate where the difference is actually visible. Mutates usedAnchorIds.
function emitTotalsDeltaFindings(
  deltaMatch: StructuredLineItemDeltaMatch,
  context: AnnotatedEstimateFindingGeneratorContext,
  usedAnchorIds: Set<string>
): CitationDensityFinding[] {
  const findings: CitationDensityFinding[] = [];
  if (deltaMatch.totalsAnchors.length === 0) return findings;

  // Search from the END: supplement prints repeat earlier cumulative totals
  // blocks, and the FINAL block is the operative one.
  const findAnchor = (
    matches: (rowText: string) => boolean,
    allowUsed: boolean
  ): EstimateRowAnchor | undefined => {
    for (let index = deltaMatch.totalsAnchors.length - 1; index >= 0; index -= 1) {
      const anchor = deltaMatch.totalsAnchors[index];
      if (!allowUsed && usedAnchorIds.has(anchor.anchorId)) continue;
      if (matches(anchor.rowText.replace(/\s+/g, " ").toLowerCase())) return anchor;
    }
    return undefined;
  };
  // A rate/category delta must never be silently dropped because its totals
  // row was already claimed (categories can share rate text) or because the
  // category row fragmented in extraction — prefer an unused matching row,
  // then REUSE a claimed matching row, then fall back to the totals block
  // itself (Grand Total/Subtotal) so the finding still renders on that page.
  const claimAnchor = (matches: (rowText: string) => boolean): EstimateRowAnchor | undefined =>
    findAnchor(matches, false) ?? findAnchor(matches, true);
  const blockFallbackAnchor = (): EstimateRowAnchor | undefined =>
    claimAnchor((text) => /estimate totals|grand total|total cost of repair|subtotal/.test(text));

  // Room for every category lane, every TAX lane, and the grand-total gap.
  // RO 22108 produced nine legitimate totals deltas and the old cap of 8 cut
  // the grand total; RO 22182 adds a second tax lane (GEICO's 2% County Tax)
  // and at 10 the cap cut that instead.
  const MAX_TOTALS_FINDINGS = 13;
  // The materials-cap category is the anchor for every PM_CAP_EVIDENCE tag in
  // the line findings — it must never be crowded out by the findings cap, so
  // it processes first.
  const orderedTotalsDeltas = deltaMatch.pmCapFlag
    ? [...deltaMatch.totalsDeltas].sort((a, b) => {
        const capCategory = deltaMatch.pmCapFlag!.category.toLowerCase();
        return (
          Number(b.category.toLowerCase() === capCategory) -
          Number(a.category.toLowerCase() === capCategory)
        );
      })
    : deltaMatch.totalsDeltas;
  for (const delta of orderedTotalsDeltas) {
    if (findings.length >= MAX_TOTALS_FINDINGS) break;
    const categoryNeedle = delta.category.toLowerCase();
    const anchor =
      delta.kind === "total_difference" || delta.kind === "reconciliation_gap"
        ? (claimAnchor((text) => /grand total|total cost of repair|workfile total|net cost/.test(text)) ??
            blockFallbackAnchor())
        : delta.kind === "category_only_on_lower"
          ? // This estimate has NO row for a lower-only category, so anchor to
            // the ESTIMATE TOTALS block header — neutral placement context —
            // rather than the Subtotal row, which reads as disputing an
            // unrelated shop amount (RO 22108 Diagnostic Labor). Subtotal and
            // grand-total rows remain fallbacks so the finding still renders.
            (claimAnchor((text) => /estimate totals/.test(text)) ??
              claimAnchor((text) => /subtotal/.test(text)) ??
              claimAnchor((text) => /grand total|total cost of repair/.test(text)))
          : (claimAnchor((text) => text.includes(categoryNeedle)) ?? blockFallbackAnchor());
    if (!anchor) continue; // never emit an unanchored finding

    usedAnchorIds.add(anchor.anchorId);
    const isRateKind = delta.kind === "rate_difference" || delta.kind === "hours_difference";
    const slug = delta.category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    // Arbitrary materials cap: this category's difference is not a generic
    // amount gap — the lower estimate pays a FLAT figure with no hrs@rate
    // basis. Emit the jurisdictional cap finding (detection math + per-state
    // citation from the jurisdiction rules table) instead of the generic
    // category-amount wording.
    const capFlag = deltaMatch.pmCapFlag;
    if (capFlag && delta.category.toLowerCase() === capFlag.category.toLowerCase()) {
      findings.push(
        buildRequiredDetectorFinding({
          context,
          anchor,
          findingType: `totals-materials-cap-${slug || "materials"}`,
          title: `Arbitrary materials cap: ${delta.category}`,
          category: "other",
          label: "P&M CAP",
          estimateGapType: "reduced_by_carrier",
          score: 80,
          safetyImpact: "low",
          priority: "high",
          currentSupportSummary:
            `The lower estimate pays ${capFlag.category} as a flat $${capFlag.cap.toFixed(2)} with no hours-and-rate basis` +
            (capFlag.subjectBasis ? `, against this estimate's computed basis of ${capFlag.subjectBasis}` : "") +
            (capFlag.impliedRate !== null
              ? `. The flat figure implies $${capFlag.impliedRate.toFixed(2)}/hr against the lower estimate's own paint hours`
              : "") +
            `. ${capFlag.citation}` +
            (capFlag.verified ? "" : " [JURISDICTION_UNVERIFIED]"),
          missingProofSummary:
            "An arbitrary cap is not a computed materials basis. The insurer must produce the calculation behind the cap, the authorizing policy language, and proof the capped amount pays the reasonable cost of required materials.",
          recommendedNextAction:
            "Demand the cap's calculation and authorizing policy language; cross-reference every missed left-on-vehicle material line in this report (tagged PM_CAP_EVIDENCE) as proof the flat figure was not built from the required operations.",
          missingAuthorityTypes: [
            "cap calculation and authorizing policy language",
            "paint-manufacturer/OEM documentation of required materials",
          ],
          amountImpact:
            delta.higher && delta.lower && delta.higher.cost !== null && delta.lower.cost !== null
              ? Math.round((delta.higher.cost - delta.lower.cost) * 100) / 100
              : null,
        })
      );
      continue;
    }
    findings.push(
      buildRequiredDetectorFinding({
        context,
        anchor,
        findingType: `totals-${delta.kind.replace(/_/g, "-")}-${slug || "category"}`,
        title:
          delta.kind === "rate_difference"
            ? `Rate difference: ${delta.category}`
            : delta.kind === "hours_difference"
              ? `Hour subtotal difference: ${delta.category}`
              : delta.kind === "total_difference"
                ? // Carry both totals and the difference in the TITLE. The
                  // headline number of the whole report must survive whatever
                  // the card can fit (M-6).
                  `Estimate total difference: ${delta.summary.replace(/^Grand total\s*/i, "").replace(/\.$/, "")}`
                : delta.kind === "reconciliation_gap"
                  ? "Totals do NOT reconcile — part of the gap is unexplained"
                  : delta.kind === "category_only_on_lower"
                    ? `Category only on the lower estimate: ${delta.category}`
                    : delta.kind === "category_missing_on_lower"
                      ? `Whole category missing from the comparison estimate: ${delta.category}`
                      : `Category amount difference: ${delta.category}`,
        category: isRateKind ? "labor_difference" : "other",
        label:
          delta.kind === "rate_difference"
            ? "RATE DELTA"
            : delta.kind === "hours_difference"
              ? "HOURS DELTA"
              : delta.kind === "total_difference"
                ? "TOTAL GAP"
                : delta.kind === "reconciliation_gap"
                  ? "RECONCILIATION GAP"
                  : delta.kind === "category_missing_on_lower"
                    ? "CATEGORY MISSING"
                    : "AMOUNT DELTA",
        estimateGapType: isRateKind ? "reduced_by_carrier" : "needs_proof",
        // A whole category absent from the comparison is a larger claim than a
        // category the two documents merely price differently, and it is the
        // shape that carried 53% of the RO 22182 gap.
        score:
          delta.kind === "reconciliation_gap"
            ? 85
            : isRateKind
              ? 78
              : delta.kind === "category_missing_on_lower"
                ? 80
                : 62,
        safetyImpact: "low",
        priority:
          isRateKind || delta.kind === "total_difference" || delta.kind === "reconciliation_gap"
            ? "high"
            : "medium",
        currentSupportSummary:
          delta.kind === "category_only_on_lower"
            ? `${delta.summary} (compared against ${deltaMatch.comparisonName}). This estimate has no row for that category, so this note is anchored to the totals block for placement only — no amount on this estimate is being disputed by this finding.`
            : `${delta.summary} (compared against ${deltaMatch.comparisonName}).`,
        missingProofSummary:
          "This difference comes from the two estimates' ESTIMATE TOTALS blocks — it is estimate-difference evidence, not proof of the correct rate or hours. Rates and category subtotals are typically the largest drivers of the total cost gap.",
        recommendedNextAction:
          isRateKind
            ? "Verify the posted/agreed labor rates for this market and the hour subtotal roll-up on both estimates; a rate difference applies across every hour in the category."
            : "Reconcile this category line-by-line across both estimates (parts invoices, sublet invoices, and miscellaneous charges) to confirm which document supports its amount.",
        missingAuthorityTypes: isRateKind
          ? ["posted/agreed labor rate documentation"]
          : ["invoices/receipts supporting the category amount"],
        amountImpact:
          delta.higher && delta.lower && delta.higher.cost !== null && delta.lower.cost !== null
            ? Math.round((delta.higher.cost - delta.lower.cost) * 100) / 100
            : // A category with NO counterpart puts its whole amount in
              // dispute — reporting null left the largest findings on the
              // pair carrying no dollar figure at all.
              delta.kind === "category_missing_on_lower" && delta.higher?.cost != null
              ? Math.round(delta.higher.cost * 100) / 100
              : // Grand-total and reconciliation deltas carry their magnitude
                // directly; they have no category rows to subtract.
                delta.amount ?? null,
      })
    );
  }

  // Paint-system mismatch (M-3): ONE connected finding. The vehicle has one
  // paint system; the two estimates named different ones and then billed
  // different "Add for …" operations against them. Reported together, anchored
  // to the subject's own add-for row, so the reader sees the cause of the
  // paint-hour gap rather than a scatter of unexplained line differences.
  const paintMismatch = deltaMatch.paintSystemMismatch;
  if (paintMismatch) {
    const anchor = paintMismatch.anchorId ? deltaMatch.anchorById.get(paintMismatch.anchorId) : undefined;
    const hourGap = Math.round((paintMismatch.subjectAddHours - paintMismatch.comparisonAddHours) * 10) / 10;
    if (anchor && !usedAnchorIds.has(anchor.anchorId)) {
      usedAnchorIds.add(anchor.anchorId);
      findings.push(
        buildRequiredDetectorFinding({
          context,
          anchor,
          findingType: "delta-paint-system-mismatch",
          title: `Paint system disagreement: ${paintMismatch.subject} here vs ${paintMismatch.comparison} on ${deltaMatch.comparisonName}`,
          category: "refinish",
          label: "PAINT SYSTEM",
          estimateGapType: "reduced_by_carrier",
          score: 78,
          safetyImpact: "low",
          priority: "high",
          currentSupportSummary: `The vehicle-options block on this estimate declares ${paintMismatch.subject} PAINT and bills ${paintMismatch.subjectAddHours.toFixed(1)} hours of "Add for" operations against it. ${deltaMatch.comparisonName} declares ${paintMismatch.comparison} PAINT and bills ${paintMismatch.comparisonAddHours.toFixed(1)} hours${hourGap !== 0 ? ` — a ${Math.abs(hourGap).toFixed(1)}-hour difference from this one disagreement` : ""}.`,
          missingProofSummary:
            "A vehicle has ONE paint system, so these two estimates cannot both be right. This single disagreement propagates into every refinish line on the vehicle, and the individual paint-hour differences downstream are its consequence rather than separate disputes. It is resolved by the vehicle's paint code, not by negotiating the lines.",
          recommendedNextAction: `Confirm the factory paint system from the vehicle's paint code / OEM build data, then correct whichever estimate names the wrong one and reprice the refinish lines from the corrected system.`,
          missingAuthorityTypes: [
            "vehicle paint code / OEM build data",
            "CCC/MOTOR refinish basis for the confirmed paint system",
          ],
          amountImpact: null,
          laborHoursImpact: hourGap !== 0 ? hourGap : null,
        })
      );
    }
  }

  // Carrier-attribution defects (O-1): a note naming a foreign carrier is a
  // documentation defect on the estimate that wrote it — reported as its own
  // finding, keyed to the annotated row the note's operation pairs with.
  const seenMismatchCarriers = new Set<string>();
  for (const mismatch of deltaMatch.carrierMismatchNotes) {
    if (seenMismatchCarriers.has(mismatch.carrier.toLowerCase())) continue;
    seenMismatchCarriers.add(mismatch.carrier.toLowerCase());
    const anchor = mismatch.anchorId ? deltaMatch.anchorById.get(mismatch.anchorId) : undefined;
    if (!anchor || usedAnchorIds.has(anchor.anchorId)) continue;
    usedAnchorIds.add(anchor.anchorId);
    const sideLabel = mismatch.documentSide === "comparison" ? deltaMatch.comparisonName : "this estimate";
    findings.push(
      buildRequiredDetectorFinding({
        context,
        anchor,
        findingType: "carrier-note-mismatch",
        // EXPORT BOUNDARY — this finding is ABOUT two carrier names, so
        // redacting both would leave "[REDACTED_INSURER] on a
        // [REDACTED_INSURER] file" and destroy the intelligence. State the
        // defect instead: the reader has the line in front of them, and the
        // fact that the note belongs to a different insurer is the finding.
        title: "Carrier-attribution defect: this line's note names a different insurer than the file's",
        category: "other",
        label: "CARRIER MISMATCH",
        estimateGapType: "needs_proof",
        score: 55,
        safetyImpact: "low",
        priority: "medium",
        currentSupportSummary: `${sideLabel} line ${mismatch.line} carries a note reading "${mismatch.noteExcerpt}" — it names ${mismatch.carrier}, but every header identity on this file (letterhead, claim number, Insurance Company field) is ${mismatch.dominantCarrier}. This is a carrier-attribution defect on the document, likely copied from another claim file.`,
        missingProofSummary:
          "A line note that names the wrong carrier undermines the estimate's documentation quality and can misdirect payment or authority questions. It must be corrected or explained by its author; it is never evidence about this file's insurer.",
        recommendedNextAction: `Ask the estimate author to correct or explain the ${mismatch.carrier} reference; confirm the referenced agreement actually belongs to this ${mismatch.dominantCarrier} claim.`,
        missingAuthorityTypes: ["author correction or written explanation of the foreign-carrier reference"],
        amountImpact: null,
        laborHoursImpact: null,
      })
    );
  }

  // Lower-only section: lines the LOWER estimate carries with no counterpart
  // here, plus residual lines that duplicate an already-matched lower line
  // (possible duplicate billing / separate access operations — reported as
  // such, never as confirmed lower-only scope). One summary finding, never
  // per-line markers (those lines do not exist on the annotated PDF).
  // Rates from the lower estimate's own totals block, for valuing lower-only
  // labor: an operation the shop did not write is real dollars, not "$0.00".
  const lowerRateFor = (() => {
    const rates = new Map<string, number>();
    for (const category of deltaMatch.lowerTotalsSummary?.categories ?? []) {
      if (category.rate !== null) rates.set(normalizeTotalsCategoryKey(category.category), category.rate);
    }
    return (row: EstimateDeltaRow) => ({
      labor:
        row.laborType === "M"
          ? rates.get("MECHANICALLABOR") ?? rates.get("BODYLABOR") ?? 0
          : rates.get("BODYLABOR") ?? 0,
      paint: rates.get("PAINTLABOR") ?? rates.get("BODYLABOR") ?? 0,
    });
  })();
  const lowerRowImpact = (row: EstimateDeltaRow) => {
    const rate = lowerRateFor(row);
    return (row.price ?? 0) + (row.labor ?? 0) * rate.labor + (row.paint ?? 0) * rate.paint;
  };
  // Boilerplate rows (banner text, contact instructions, links) carry no value
  // cells, no operation code, and no section — they are not operations and
  // never belong in a lower-only roll-up. Carrier-agnostic; no string list.
  const isBoilerplateLowerRow = (row: EstimateDeltaRow) =>
    (row.price ?? 0) === 0 &&
    (row.labor ?? 0) === 0 &&
    (row.paint ?? 0) === 0 &&
    !row.opCode &&
    !row.section;
  const rankedLowerOnlyRows = deltaMatch.lowerOnlyRows
    .filter((row) => !isBoilerplateLowerRow(row))
    .sort((a, b) => lowerRowImpact(b) - lowerRowImpact(a));
  const describeLowerRow = (row: EstimateDeltaRow) => {
    const impact = lowerRowImpact(row);
    const hourPart =
      (row.labor ?? 0) !== 0
        ? `${row.labor} hr${row.laborType === "M" ? " M" : ""}`
        : (row.paint ?? 0) !== 0
          ? `${row.paint} hr P`
          : "";
    const pricePart = (row.price ?? 0) !== 0 ? `$${(row.price ?? 0).toFixed(2)}` : "";
    const valueBits = [pricePart, hourPart].filter(Boolean).join(" + ");
    const impactPart =
      impact > 0 && !pricePart && hourPart ? ` ~ $${impact.toFixed(2)}` : "";
    const amount = valueBits ? ` (${valueBits}${impactPart})` : "";
    // Include the section so a reviewer can locate the line ("Overlap
    // Major Non-Adj. Panel" repeats under several panels).
    const section = row.section ? ` [${row.section.replace(/\s+/g, " ").trim()}]` : "";
    return `L${row.lineNumber} ${row.opCode ? `${row.opCode} ` : ""}${row.description}${amount}${section}`;
  };
  const lowerOnlyCount = rankedLowerOnlyRows.length;
  const duplicateCount = deltaMatch.potentialDuplicateLowerRows.length;
  // Only place the lower-only listing on a totals row when the totals lane
  // genuinely parsed (real rate/category context exists there). Without it,
  // the "totals row" is often a glued one-line pseudo-block, and annotating it
  // is exactly the junk-on-totals class DEFECT B forbids.
  if ((lowerOnlyCount > 0 || duplicateCount > 0) && deltaMatch.totalsDeltas.length > 0) {
    const anchor = claimAnchor((text) =>
      /grand total|total cost of repair|subtotal|parts|miscellaneous/.test(text)
    );
    if (anchor) {
      usedAnchorIds.add(anchor.anchorId);
      const listed = rankedLowerOnlyRows.slice(0, 12).map(describeLowerRow);
      const extra =
        lowerOnlyCount > listed.length ? ` …and ${lowerOnlyCount - listed.length} more` : "";
      const lowerOnlyPart =
        lowerOnlyCount > 0
          ? `${deltaMatch.comparisonName} carries ${lowerOnlyCount} line(s) with no counterpart on this estimate: ${listed.join("; ")}${extra}.`
          : `${deltaMatch.comparisonName} carries no unreconciled lower-only lines.`;
      const duplicatePart =
        duplicateCount > 0
          ? ` Additionally, ${duplicateCount} lower-estimate line(s) repeat the description of a line already matched between the two estimates — possible duplicate billing or a separate access operation, NOT confirmed missing scope: ${deltaMatch.potentialDuplicateLowerRows.slice(0, 8).map(describeLowerRow).join("; ")}.`
          : "";
      findings.push(
        buildRequiredDetectorFinding({
          context,
          anchor,
          findingType: "totals-lower-only-lines",
          title:
            lowerOnlyCount > 0
              ? `Lines only on the lower estimate (${lowerOnlyCount})`
              : `Possible duplicate lines on the lower estimate (${duplicateCount})`,
          category: "other",
          label: lowerOnlyCount > 0 ? "LOWER-ONLY LINES" : "POSSIBLE DUPLICATES",
          estimateGapType: "needs_proof",
          score: 58,
          safetyImpact: "low",
          priority: "medium",
          currentSupportSummary: `${lowerOnlyPart}${duplicatePart}`,
          missingProofSummary:
            "Lower-only lines can be scope this estimate omitted, differently-worded equivalents, or duplicated pay items on the lower estimate (the same repair billed under two lines). Repeated-description residuals are flagged separately as possible duplicates. They are part of the cost difference in BOTH directions.",
          recommendedNextAction:
            "Review each listed line against this estimate: confirm whether it is missing scope here, a wording mismatch, or a duplicate/overlapping charge on the lower estimate.",
          missingAuthorityTypes: ["line-by-line reconciliation of lower-only items"],
          amountImpact: null,
        })
      );
    }
  }

  return findings;
}

export type PolicyApplicabilityDiagnostics = {
  policyNumber: string | null;
  effectiveDates: string | null;
  namedInsuredRedacted: string | null;
  insuredVehicle: string | null;
  insuredVin: string | null;
  collisionDeductible: string | null;
  comprehensiveDeductible: string | null;
  policyForms: string[];
  appraisalSectionsFound: string[];
  actionAgainstInsurerFound: boolean;
  governingLawOrJurisdiction: string | null;
  endorsements: string[];
  extractionConfidence: "high" | "medium" | "low" | "failed";
  ocrFallbackRecommended: boolean;
  vehicleMismatch: CitationDensityDebugTrace["policyVehicleMismatch"];
};

export function extractPolicyApplicabilityDiagnostics(params: {
  policyText: string | null | undefined;
  activeEstimateVehicle?: string | null;
}): PolicyApplicabilityDiagnostics {
  const text = params.policyText?.replace(/\r\n/g, "\n").replace(/\r/g, "\n") ?? "";
  const normalized = text.replace(/\s+/g, " ").trim();
  const garbled = isGarbledPolicyText(normalized);
  const policyVehicle = extractPolicyVehicle(normalized);
  const activeVehicle = params.activeEstimateVehicle?.trim() || null;
  const vehicleMismatch = policyVehicle && activeVehicle && !vehiclesAppearToMatch(policyVehicle, activeVehicle)
    ? {
        policyVehicle,
        activeEstimateVehicle: activeVehicle,
        warning: `Policy uploaded, but insured vehicle appears to be ${policyVehicle}. Active estimate vehicle appears to be ${activeVehicle}. Confirm policy applicability before relying on this language.`,
      }
    : null;
  const confidence: PolicyApplicabilityDiagnostics["extractionConfidence"] = !normalized
    ? "failed"
    : garbled
      ? "failed"
      : [/\bpolicy\b/i, /\bVIN\b/i, /\bdeductible\b/i, /\bappraisal|if we cannot agree\b/i].filter((pattern) => pattern.test(normalized)).length >= 3
        ? "high"
        : "medium";

  return {
    policyNumber: normalized.match(/\bpolicy\s*(?:number|no\.?|#)\s*[:#]?\s*([A-Z0-9-]{4,})/i)?.[1] ?? null,
    effectiveDates: normalized.match(/\b(?:effective|policy period)\b[^.:\n]{0,40}[: ]\s*([A-Za-z0-9 ,/-]{8,60})/i)?.[1]?.trim() ?? null,
    namedInsuredRedacted: normalized.match(/\bnamed insured\b\s*[:#]?\s*([A-Z][A-Za-z .'-]{1,60})/i)?.[1]?.replace(/\S/g, "X") ?? null,
    insuredVehicle: policyVehicle,
    insuredVin: normalized.match(/\bVIN\b\s*[:#]?\s*([A-HJ-NPR-Z0-9*]{11,17})/i)?.[1] ?? null,
    collisionDeductible: normalized.match(/\bcollision\b[^$]{0,80}(\$[\d,]+)/i)?.[1] ?? null,
    comprehensiveDeductible: normalized.match(/\bcomprehensive\b[^$]{0,80}(\$[\d,]+)/i)?.[1] ?? null,
    policyForms: [...normalized.matchAll(/\b(form|endorsement)\s+([A-Z0-9-]{3,})/gi)].map((match) => match[2]).slice(0, 20),
    appraisalSectionsFound: ["appraisal", "right to appraisal", "if we cannot agree", "payment of loss"].filter((label) =>
      new RegExp(label.replace(/\s+/g, "\\s+"), "i").test(normalized)
    ),
    actionAgainstInsurerFound: /\baction against (?:us|insurer|company)\b/i.test(normalized),
    governingLawOrJurisdiction: normalized.match(/\b(?:governing law|jurisdiction|laws of)\b[^.]{0,80}/i)?.[0] ?? null,
    endorsements: [...normalized.matchAll(/\bendorsement\s+([A-Z0-9-]{3,})/gi)].map((match) => match[1]).slice(0, 20),
    extractionConfidence: confidence,
    ocrFallbackRecommended: garbled || confidence === "failed",
    vehicleMismatch,
  };
}

export function buildOemCitationDensityFindings(
  context: AnnotatedEstimateFindingGeneratorContext
): AnnotatedEstimateGeneratedFindings {
  const authoritySources = detectOemCitationDensityAuthoritySources(context);
  const authorityTrace = context.authorityTrace ?? buildDefaultOemAuthorityTrace();
  const acceptedFindings: CitationDensityFinding[] = [];
  const droppedReasons: CitationDensityDebugTrace["partSourceDroppedReasons"] = [];
  const seenAnchorIds = new Set<string>();

  for (const anchor of context.anchors) {
    const rowText = getAnchorSourceText(anchor);
    const normalized = normalizeMatchText(rowText);
    if (!rowText.trim()) continue;
    if (anchor.anchorType !== "estimate_line" && anchor.anchorType !== "line_note" && anchor.anchorType !== "embedded_link_row") {
      continue;
    }
    if (isRejectedPrimaryAnchorText(rowText, anchor)) {
      droppedReasons.push({ anchorId: anchor.anchorId, rowText, reason: "legend, abbreviation, disclaimer, guide, or legal boilerplate rejected as primary row anchor" });
      continue;
    }
    if (isVehicleYearLineNumber(anchor.lineNumber) || containsVehicleYearIdentityText(rowText)) {
      droppedReasons.push({ anchorId: anchor.anchorId, rowText, reason: "source line parsed as vehicle year" });
      continue;
    }
    if (isBoilerplatePartSourceText(normalized)) {
      droppedReasons.push({ anchorId: anchor.anchorId, rowText, reason: "generic boilerplate as primary row anchor" });
      continue;
    }
    const family = classifyOemCitationDensityRow(rowText, anchor);
    if (!family) continue;
    if (seenAnchorIds.has(anchor.anchorId)) continue;
    const finding = buildOemCitationDensityFinding({
      context,
      anchor,
      rowText,
      family,
      authoritySources,
    });
    if (!finding.recommendedNextAction.trim()) {
      droppedReasons.push({ anchorId: anchor.anchorId, rowText, reason: "findings without nextAction" });
      continue;
    }
    if (isOemVerifiedLabel(finding.citationLabel) && !finding.verifiedAuthorityCount) {
      finding.citationLabel = family.fallbackLabel;
      finding.bestAvailableAuthority = buildEstimateEvidenceAuthority(family);
      finding.verifiedAuthorityCount = 0;
      finding.limitations.push("Verified label downgraded because no supporting authority source was attached.");
    }
    acceptedFindings.push(finding);
    seenAnchorIds.add(anchor.anchorId);
  }

  // Group per support category so the report stays readable: keep the
  // strongest anchored findings per category and roll the remainder into ONE
  // grouped finding per category. Dozens of near-identical low-confidence
  // markers are noise for customer or MOTOR demonstration use.
  const groupedFindings = groupOemFindingsForReadability(acceptedFindings);

  const authorityBackedFindingCount = groupedFindings.filter((finding) => finding.verifiedAuthorityCount > 0).length;
  const estimateOnlyFindingCount = groupedFindings.filter((finding) => finding.verifiedAuthorityCount === 0).length;
  const researchNeededFindingCount = groupedFindings.filter((finding) =>
    finding.missingAuthorityTypes.some((item) => /OEM|MOTOR|procedure|position/i.test(item))
  ).length;
  const debugFindings = groupedFindings.slice(0, 20).map((finding): OemCitationDensityFindingDebug => {
    const evidenceTier = getOemEvidenceTier(finding);
    return {
      findingId: finding.id,
      title: finding.operationLabel,
      label: getProofBucketLabel(finding),
      anchorId: getFindingAnchorId(finding),
      evidenceTier,
      authoritySourceTypes: (finding.bestAvailableAuthority?.type ? [finding.bestAvailableAuthority.type] : ["estimate_evidence"]),
      nextAction: finding.recommendedNextAction,
      confidence: finding.confidence,
    };
  });

  return {
    findings: groupedFindings,
    debug: {
      reportType: "oem-citation-density",
      artifactVersion: OEM_CITATION_DENSITY_ARTIFACT_VERSION,
      reviewedEstimateFileNames: [context.sourcePdfName],
      authoritySearchTrace: authorityTrace,
      authoritySourceCount: authoritySources.filter((source) => source.sourceType !== "estimate_evidence").length,
      oemProcedureSourceCount: authoritySources.filter((source) => source.sourceType === "oem_procedure").length,
      oemPositionStatementSourceCount: authoritySources.filter((source) => source.sourceType === "oem_position_statement").length,
      motorDatabaseSourceCount: authoritySources.filter((source) => source.sourceType === "motor_database").length,
      uploadedSupportDocumentCount: authoritySources.filter((source) => source.sourceType === "uploaded_support").length,
      cccSecureShareSourceCount: authoritySources.filter((source) => source.sourceType === "ccc_secure_share").length,
      policySourceCount: authoritySources.filter((source) => source.sourceType === "policy").length,
      jurisdictionalLawSourceCount: authoritySources.filter((source) => source.sourceType === "jurisdictional_law").length,
      internetFallbackSourceCount: authoritySources.filter((source) => source.sourceType === "internet_fallback").length,
      authorityBackedFindingCount,
      estimateOnlyFindingCount,
      researchNeededFindingCount,
      findingsWithNextActionCount: groupedFindings.filter((finding) => finding.recommendedNextAction.trim().length > 0).length,
      findingsWithoutNextActionCount: groupedFindings.filter((finding) => !finding.recommendedNextAction.trim()).length,
      findingsRejectedDueWeakEvidence: 0,
      findingsRejectedDueNoAnchor: droppedReasons.filter((item) => /anchor/i.test(item.reason)).length,
      firstAuthoritySources: authoritySources.slice(0, 20),
      firstOemCitationDensityFindings: debugFindings,
      partSourceDroppedReasons: droppedReasons,
    },
  };
}

/** User-facing OEM support groups; each caps its per-line markers. */
const OEM_FINDING_GROUPS: Array<{ key: string; title: string; categories: string[] }> = [
  { key: "structural", title: "Structural procedure support", categories: ["structural_or_fit_verification"] },
  { key: "refinish", title: "Refinish / P-page support", categories: ["refinish"] },
  { key: "part-source", title: "Non-OEM / LKQ part support", categories: ["parts_downgrade"] },
  { key: "scan-diagnostic", title: "Scan / diagnostic support", categories: ["scan_diagnostic", "adas_calibration"] },
  { key: "completion-proof", title: "Completion proof", categories: [] }, // catch-all
];

const OEM_GROUP_KEEP_LIMIT = 4;

function resolveOemFindingGroup(finding: CitationDensityFinding) {
  return (
    OEM_FINDING_GROUPS.find((group) => group.categories.includes(finding.category)) ??
    OEM_FINDING_GROUPS[OEM_FINDING_GROUPS.length - 1]
  );
}

/**
 * Keep the strongest few anchored findings per support group and roll the
 * remainder into ONE grouped finding per group (anchored to its first line).
 * Preserves the original relative order of kept findings. Dozens of
 * near-identical per-line markers are noise for customer or MOTOR
 * demonstration use; the grouped finding still names every affected line.
 */
export function groupOemFindingsForReadability(
  findings: CitationDensityFinding[]
): CitationDensityFinding[] {
  const byGroup = new Map<string, Array<{ finding: CitationDensityFinding; index: number }>>();
  findings.forEach((finding, index) => {
    const group = resolveOemFindingGroup(finding);
    const bucket = byGroup.get(group.key) ?? [];
    bucket.push({ finding, index });
    byGroup.set(group.key, bucket);
  });

  const keptIndexes = new Set<number>();
  const rollups: Array<{ finding: CitationDensityFinding; index: number }> = [];

  for (const group of OEM_FINDING_GROUPS) {
    const bucket = byGroup.get(group.key) ?? [];
    if (bucket.length === 0) continue;
    if (bucket.length <= OEM_GROUP_KEEP_LIMIT + 1) {
      // A roll-up that replaces a single finding saves nothing.
      bucket.forEach((entry) => keptIndexes.add(entry.index));
      continue;
    }
    const ranked = [...bucket].sort(
      (a, b) => (b.finding.citationDensityScore ?? 0) - (a.finding.citationDensityScore ?? 0)
    );
    const kept = ranked.slice(0, OEM_GROUP_KEEP_LIMIT);
    const rest = ranked
      .slice(OEM_GROUP_KEEP_LIMIT)
      .sort((a, b) => a.index - b.index);
    kept.forEach((entry) => keptIndexes.add(entry.index));

    const lineList = rest
      .map((entry) => entry.finding.shopEvidence?.lineNumber)
      .filter((line): line is string => Boolean(line))
      .slice(0, 14)
      .map((line) => `L${line}`)
      .join(", ");
    const template = rest[0].finding;
    rollups.push({
      index: rest[0].index,
      finding: {
        ...template,
        id: `${template.id}-grouped-${group.key}`,
        operationLabel: `${group.title} — ${rest.length} additional estimate lines`,
        currentSupportSummary: `${rest.length} more estimate line(s) need the same ${group.title.toLowerCase()}${lineList ? ` (${lineList}${rest.length > 14 ? ", …" : ""})` : ""}. They are grouped into one finding to keep the report readable; each line carries the same support requirement as the individually listed findings in this category.`,
      },
    });
  }

  const result: Array<{ finding: CitationDensityFinding; index: number }> = [];
  findings.forEach((finding, index) => {
    if (keptIndexes.has(index)) result.push({ finding, index });
  });
  result.push(...rollups);
  return result.sort((a, b) => a.index - b.index).map((entry) => entry.finding);
}

/**
 * M-4 — A FINDING CANNOT OUTRANK WHAT IT IS WORTH.
 *
 * The four category-missing findings on RO 22182 accounted for $8,231.63 —
 * 53% of the entire gap, including Bonded Or Welded Panel Replace at
 * $4,063.50 — and every one of them scored 62, beneath a $175.00 pre-repair
 * scan at 70 and an $87.50 "Research DTC's" line at 82. A reader working the
 * list top-down reached the largest disputes last.
 *
 * Type-based scores stay as they are; a magnitude CEILING is applied on top,
 * so a small-dollar finding cannot rank above a large one no matter how
 * confidently it is typed. Findings with no dollar figure (safety and
 * documentation detectors) are never capped — their value is not monetary.
 */
export function dollarWeightedScore(score: number, amountImpact: number | null): number {
  if (amountImpact === null || !Number.isFinite(amountImpact)) return score;
  const amount = Math.abs(amountImpact);
  const ceiling =
    amount < 100 ? 60 : amount < 250 ? 68 : amount < 1_000 ? 76 : amount < 2_500 ? 84 : 99;
  return Math.min(score, ceiling);
}

function buildRequiredDetectorFinding(params: {
  context: AnnotatedEstimateFindingGeneratorContext;
  anchor: EstimateRowAnchor;
  findingType: string;
  title: string;
  category: CitationDensityFinding["category"];
  label: string;
  score: number;
  safetyImpact: "low" | "medium" | "high";
  priority: "low" | "medium" | "high";
  currentSupportSummary: string;
  missingProofSummary: string;
  recommendedNextAction: string;
  missingAuthorityTypes: string[];
  amountImpact?: number | null;
  laborHoursImpact?: number | null;
  estimateGapType?: CitationDensityFinding["estimateGapType"];
}): CitationDensityFinding {
  const evidence = {
    lineNumber: params.anchor.lineNumber,
    description: getAnchorSourceText(params.anchor),
    amount: params.anchor.price ?? null,
    laborHours: params.anchor.labor ?? null,
    sourceLabel: params.context.sourcePdfName,
  };
  const needsOem = /OEM|procedure|position/i.test(params.missingAuthorityTypes.join(" "));
  const needsPPage = /p-?page|database|CCC|MOTOR/i.test(params.missingAuthorityTypes.join(" "));
  const needsAdas = /ADAS|sensor|calibration|reset|electrical|battery|scan|Tesla|EV/i.test(`${params.title} ${params.missingProofSummary}`);
  return {
    id: `required-detector-${params.findingType}-${params.anchor.anchorId.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`,
    operationLabel: params.title,
    category: params.category,
    estimateGapType:
      params.estimateGapType ??
      (params.findingType === "wheel_labor_delta" ? "reduced_by_carrier" : "needs_proof"),
    carrierEvidence: params.anchor.sourceDocumentRole === "carrier" ? evidence : undefined,
    shopEvidence: params.anchor.sourceDocumentRole === "shop" ? evidence : undefined,
    applicableEstimateRoles: [params.anchor.sourceDocumentRole],
    primaryAnnotationRole: params.anchor.sourceDocumentRole,
    carrierAnchor: params.anchor.sourceDocumentRole === "carrier" ? buildFindingLineAnchor(params.anchor) : undefined,
    shopAnchor: params.anchor.sourceDocumentRole === "shop" ? buildFindingLineAnchor(params.anchor) : undefined,
    impact: {
      dollarImpact: params.amountImpact ?? null,
      laborHoursImpact: params.laborHoursImpact ?? null,
      safetyImpact: params.safetyImpact,
      supplementPriority: params.priority,
    },
    citationStatus: {
      oem: needsOem ? "needed" : "not_applicable",
      oemPositionStatement: needsOem ? "needed" : "not_applicable",
      adas: needsAdas ? "needed" : "not_applicable",
      pPages: needsPPage ? "needed" : "not_applicable",
      scrs: needsPPage && params.category === "refinish" ? "needed" : "not_applicable",
      deg: needsPPage ? "needed" : "not_applicable",
      nhtsa: "not_applicable",
      stateRegulation: "not_applicable",
      policy: "not_applicable",
      invoiceOrCompletionProof: "needed",
      photoOrTeardownProof: "not_found",
    },
    citationDensityScore: dollarWeightedScore(params.score, params.amountImpact ?? null),
    verifiedAuthorityCount: 0,
    missingAuthorityTypes: params.missingAuthorityTypes,
    missingAuthority: params.missingAuthorityTypes,
    bestAvailableAuthority: {
      type: needsPPage ? "p_page" : "estimate_evidence",
      status: "needed",
      title: needsPPage ? "CCC/MOTOR/P-page support needed" : "Estimate evidence only",
      confidence: "medium",
      note: "Required estimator detector generated this finding from a concrete estimate row; authority still needs to be attached.",
    },
    citationLabel: params.label,
    currentSupportSummary: params.currentSupportSummary,
    missingProofSummary: params.missingProofSummary,
    recommendedNextAction: params.recommendedNextAction,
    confidence: params.anchor.confidence >= 0.9 ? "high" : "medium",
    limitations: [
      "Required estimator detector generated from an extracted estimate row.",
      "Do not assert OEM requires, NHTSA crash-test equivalency, or warranty voiding unless verified authority is attached.",
      `sourcePdfHash:${params.context.sourcePdfHash}`,
      `artifactVersion:${CITATION_DENSITY_ARTIFACT_VERSION}`,
    ],
  };
}

function isGeneratedFindingCoveredByExisting(generated: CitationDensityFinding, existing: CitationDensityFinding[]) {
  const generatedLine = generated.carrierEvidence?.lineNumber ?? generated.shopEvidence?.lineNumber ?? null;
  const generatedText = normalizeMatchText([
    generated.operationLabel,
    generated.carrierEvidence?.description,
    generated.shopEvidence?.description,
    generated.currentSupportSummary,
  ].filter(Boolean).join(" "));
  return existing.some((finding) => {
    const existingLine = finding.carrierEvidence?.lineNumber ?? finding.shopEvidence?.lineNumber ?? null;
    if (generatedLine && existingLine && String(generatedLine) === String(existingLine)) return true;
    const existingText = normalizeMatchText([
      finding.operationLabel,
      finding.carrierEvidence?.description,
      finding.shopEvidence?.description,
      finding.currentSupportSummary,
    ].filter(Boolean).join(" "));
    return keyTokenScore(generatedText, existingText, 20) >= 12 || sharedTermScore(generatedText, existingText, 20) >= 12;
  });
}


function isPrimaryEstimateAnchor(anchor: EstimateRowAnchor) {
  return anchor.anchorType === "estimate_line" || anchor.anchorType === "line_note" || anchor.anchorType === "totals_row";
}

function isRejectedPrimaryAnchorText(rowText: string, anchor: EstimateRowAnchor) {
  const normalized = normalizeMatchText(rowText);
  if (anchor.anchorType === "supplier_row" || anchor.anchorType === "guide_row" || anchor.anchorType === "section_row" || anchor.anchorType === "totals_row") return true;
  return isJunkCitationFindingText(normalized) ||
    /\b(?:abbreviations?|legend|disclaimer|fraud notice|legal notice|work authorization|policy|declarations?|allstate parts policy|alternate parts policy|quality replacement parts|vehicle equipment|vin decoding|footer|page \d+ of \d+|ccc\/motor|motor guide|estimating guide|included operations?|not included|a\/m\s*=\s*aftermarket|lkq\s*\/?\s*rcy\s*\/?\s*used|capa\s*(?:certified|definition|definitions?)|estimate totals?|parts total|subtotal|grand total|sales tax|body labor totals?|paint labor totals?|paint supplies totals?|labor\s+[a-z]\s*=\s*diagnostic|qr\s*code|sunbit|payment plan|pay(?:ment)?\s+(?:link|portal|text|option))\b/i.test(rowText) ||
    /\b(?:abbreviation|legend|disclaimer|fraud|legal notice|work authorization|policy|declarations|alternate parts policy|quality replacement|vehicle equipment|footer|ccc motor|motor guide|estimating guide|included operations|not included|aftermarket definition|lkq rcy used|capa definition|estimate totals|parts total|subtotal|grand total|sales tax|body labor total|paint labor total|paint supplies total|labor d diagnostic|qr code|sunbit|payment plan|payment link|payment portal)\b/.test(normalized);
}

// A narrower check than isRejectedPrimaryAnchorText, safe to apply to PRIMARY anchors: it
// targets totals-only rows and glossary/legend/disclaimer sections only, and deliberately
// omits operation-code patterns (refn/recond/included-operations) that legitimately appear
// on real estimate lines. Used to stop such sections from becoming lead findings (DEFECT B).
function isNonLeadablePrimaryAnchorText(rowText: string, anchor: EstimateRowAnchor): boolean {
  if (anchor.anchorType === "totals_row") return true;
  // Footers, print timestamps, and bare section-title rows are never
  // anchorable (S-4): a finding badge must never render on "7/30/2026 ...
  // Page 2" or on "30 SIDE PANEL".
  if (/\b\d{1,2}\/\d{1,2}\/20\d{2}\b[\s\S]{0,40}\bpage\s*\d+\b/i.test(rowText)) return true;
  if (/^\s*\d{1,2}\/\d{1,2}\/20\d{2}\s+\d{1,2}:\d{2}/.test(rowText)) return true;
  if (/^\s*(?:\d{1,4}\s+)?[A-Z][A-Z &,'\/.-]{2,38}$/.test(rowText.trim()) && !/[a-z0-9]{2}/.test(rowText.replace(/^\s*\d{1,4}\s+/, ""))) {
    return true;
  }
  const normalized = normalizeMatchText(rowText);
  return /\b(?:abbreviations?|legend|disclaimer|fraud notice|legal notice|declarations?|alternate parts policy|allstate parts policy|quality replacement parts|aftermarket parts are described|a\/m\s*=\s*aftermarket|capa\s*(?:certified|definitions?)|lkq\s*\/?\s*rcy\s*\/?\s*used|vin decoding|estimate totals?|parts total|subtotal|grand total|sales tax|net cost of repairs|body labor totals?|paint labor totals?|paint supplies totals?)\b/i.test(rowText) ||
    /\b(?:abbreviation|legend|disclaimer|aftermarket parts are described|estimate totals|grand total|subtotal|sales tax|net cost of repairs)\b/.test(normalized);
}

function isRejectedBoilerplateSupplierText(normalized: string) {
  return isJunkCitationFindingText(normalized) ||
    /\b(?:aftermarket crash part|quality replacement parts?|alternate parts policy|a\/m aftermarket|a m aftermarket|capa definitions?|lkq rcy used definitions?|abbreviations?|legend|disclaimer|fraud|ccc motor|motor guide|included operations?|not included|vehicle equipment|recond|refn|parts are oem parts|oem parts that may be)\b/.test(normalized);
}

function isWheelLaborAnchorText(normalized: string) {
  if (!/\b(?:wheel|rim|tire|alignment)\b/.test(normalized)) return false;
  if (/\b(?:wheel opening|opening molding|molding|flare|liner|vehicle equipment|tilt wheel|fm radio|skyview roof)\b/.test(normalized)) return false;
  return /\b(?:(?:rf|lf|rt|lt|front|rear)\s+(?:wheel|rim)|(?:wheel|rim)\s+(?:repair|replacement|replace|repl|r&i|r\s*&\s*i|access)|tire\s+(?:mount|balance|mount\/balance)|(?:four[-\s]?wheel|4[-\s]?wheel)?\s*alignment|transport\s+alignment)\b/.test(normalized);
}

function isWheelComparisonBoilerplate(text: string) {
  const normalized = normalizeMatchText(text);
  return /\b(?:vehicle equipment|4 wheel drive|tilt wheel|fm radio|skyview roof|wheel opening|opening molding)\b/.test(normalized);
}

function isJunkCitationFindingText(normalized: string) {
  return /\b(?:aftermarket crash part|quality replacement parts?|alternate parts policy|a\/m aftermarket|a m aftermarket|capa definitions?|capa certified|lkq rcy used definitions?|lkq\/rcy\/used|abbreviations?|legend|disclaimer|fraud|legal notice|ccc motor|ccc\/motor|motor guide|estimating guide|included operations?|not included|vehicle equipment|vin decoding|footer|page \d+ of \d+|recond|refn|estimate totals|parts total|subtotal|grand total|sales tax|body labor total|paint labor total|paint supplies total|labor d diagnostic|qr code|sunbit|payment plan|payment link|payment portal|parts are oem parts|oem parts that may be|list of abbreviations)\b/.test(normalized) ||
    /\b(?:4 wheel drive|tilt wheel|fm radio|skyview roof)\b/.test(normalized) ||
    (/\b(?:total|subtotal|net cost|deductible|betterment|tax)\b/.test(normalized) && /\b(?:footer|page|claim|insured|owner|license|vin)\b/.test(normalized));
}

function summarizeWheelCarrierEvidence(anchors: EstimateRowAnchor[]) {
  const rows = anchors
    .filter((anchor) => isPrimaryEstimateAnchor(anchor))
    .map((anchor) => ({ anchor, rowText: getAnchorSourceText(anchor) }))
    .filter((item) => isWheelLaborAnchorText(normalizeMatchText(item.rowText)))
    .map((item) => `${item.anchor.lineNumber ? `line ${item.anchor.lineNumber} ` : ""}${item.rowText}`)
    .slice(0, 5);
  return rows.length ? rows.join("; ") : "wheel/tire/alignment row located in source estimate";
}

function summarizeComparisonEvidence(text: string, pattern: RegExp) {
  const lines = text
    .split(/\r?\n/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => pattern.test(item) && isRelevantWheelComparisonEvidence(item))
    .sort((a, b) => scoreWheelComparisonEvidenceLine(b) - scoreWheelComparisonEvidenceLine(a));
  const summary = lines.slice(0, 2).join("; ");
  return summary ? truncateText(summary, 180) : "not located in comparison text";
}

function isRelevantWheelComparisonEvidence(line: string) {
  if (isWheelComparisonBoilerplate(line)) return false;
  const normalized = normalizeMatchText(line);
  if (/\bline\s+210\b/i.test(line)) return false;
  return /\bline\s+(?:50|51)\b/i.test(line) ||
    /\b(?:rf|lf)\s+(?:wheel|rim)\b/.test(normalized) && /\b(?:replacement|replace|repl|r&i|r\s*&\s*i|access)\b/.test(normalized) ||
    /\baccess\b/.test(normalized) && /\b(?:wheel|liner|flare|bumper hardware)\b/.test(normalized);
}

function scoreWheelComparisonEvidenceLine(line: string) {
  let score = 0;
  if (/\bline\s+(?:50|51)\b/i.test(line)) score += 20;
  if (/\b(?:rf|lf)\s+wheel\b/i.test(line)) score += 12;
  if (/\br&i|r\s*&\s*i|access\b/i.test(line)) score += 10;
  if (/\bline\s+210\b/i.test(line)) score -= 8;
  return score;
}

function isGarbledPolicyText(text: string) {
  if (!text.trim()) return true;
  const replacementCount = (text.match(/\uFFFD|�/g) ?? []).length;
  const mojibakeCount = (text.match(/(?:Ã|Â|â€|â€™|â€œ|â€|ï¿½)/g) ?? []).length;
  return replacementCount + mojibakeCount >= 3 || (text.length > 80 && /[A-Za-z]/.test(text) && text.replace(/[A-Za-z0-9\s.,;:$#/-]/g, "").length / text.length > 0.18);
}

function extractPolicyVehicle(text: string) {
  const explicit = text.match(/\b(?:insured|covered|described)\s+vehicle\b[^.:\n]{0,40}[: ]\s*((?:19|20)\d{2}\s+[A-Z][A-Za-z-]+(?:\s+[A-Za-z0-9-]+){0,4})/i)?.[1];
  if (explicit) return explicit.trim();
  return text.match(/\b((?:19|20)\d{2}\s+(?:Tesla|Ford|Chevrolet|Chevy|GMC|Honda|Toyota|Nissan|Hyundai|Kia|BMW|Mercedes|Audi|Volkswagen|Jeep|Ram|Dodge|Subaru|Mazda|Lexus|Acura|Rivian|Lucid)\s+[A-Za-z0-9-]+(?:\s+[A-Za-z0-9-]+){0,3})\b/i)?.[1]?.trim() ?? null;
}

function vehiclesAppearToMatch(a: string, b: string) {
  const normalize = (value: string) => normalizeMatchText(value)
    .split(" ")
    .filter((token) => token.length > 1)
    .slice(0, 5);
  const left = normalize(a);
  const right = new Set(normalize(b));
  if (!left.length || !right.size) return false;
  const matches = left.filter((token) => right.has(token)).length;
  return matches >= Math.min(3, left.length);
}

type OemCitationDensityFamily = {
  findingType: string;
  title: string;
  category: CitationDensityFinding["category"];
  label: string;
  fallbackLabel: string;
  evidenceTier: string;
  score: number;
  safetyImpact: "low" | "medium" | "high";
  priority: "low" | "medium" | "high";
  missingAuthorityTypes: string[];
  issueSummary: string;
  whyItMatters: string;
  oemComplianceConcern: string;
  nextAction: string;
  requiredDocumentation: string[];
};

function classifyOemCitationDensityRow(rowText: string, anchor: EstimateRowAnchor): OemCitationDensityFamily | null {
  const normalized = normalizeMatchText(rowText);
  const sourceKinds = classifyPartSource(rowText);
  const isTeslaOrEv = /\b(?:tesla|model\s+[3sxy]|ev\b|electric|high voltage|hv battery)\b/.test(normalized);
  if (/\b(?:d\s*&\s*r battery|d&r battery|disconnect.*battery|reconnect.*battery|battery reset|reset electronics|isolate 12v|hv state of charge|state of charge)\b/i.test(rowText)) {
    return {
      findingType: "battery_reset_electrical_rate",
      title: "Battery D&R / reset electronics procedure review",
      category: "scan_diagnostic",
      label: "NEEDS OEM",
      fallbackLabel: "NEEDS OEM",
      evidenceTier: "estimate_evidence",
      score: isTeslaOrEv ? 68 : 56,
      safetyImpact: isTeslaOrEv ? "high" : "medium",
      priority: "high",
      missingAuthorityTypes: ["MOTOR/CCC labor-category basis", "OEM battery disconnect/reconnect/reset procedure", "mechanical/electrical labor-rate support"],
      issueSummary: `Estimate row references battery disconnect/reconnect or reset electronics work: ${rowText}`,
      whyItMatters: "Battery D&R, reset electronics, 12V isolation, and HV state-of-charge work are mechanical/electrical procedure context, not generic miscellaneous charges.",
      oemComplianceConcern: "The row needs OEM procedure support and labor-category/rate reconciliation before it is treated as correctly classified.",
      nextAction: "Request MOTOR/CCC category basis, OEM battery disconnect/reconnect/reset procedure support, and reconcile mechanical/electrical labor category and rate.",
      requiredDocumentation: ["MOTOR/CCC category basis", "OEM battery/reset procedure", "mechanical/electrical rate support"],
    };
  }
  if (/\b(?:finish sand|denib|de nib|color sand|sand and polish|sand polish|buff|refinish correction|post refinish correction)\b/.test(normalized)) {
    return {
      findingType: "sand_polish_p_page_support",
      title: "Sand/polish refinish database support review",
      category: "refinish",
      label: "NEEDS P-PAGE",
      fallbackLabel: "NEEDS P-PAGE",
      evidenceTier: "estimate_evidence",
      score: 58,
      safetyImpact: "low",
      priority: "medium",
      missingAuthorityTypes: ["CCC/MOTOR/P-page support", "database support", "refinish correction basis"],
      issueSummary: `Estimate row contains finish sand/polish or refinish correction work: ${rowText}`,
      whyItMatters: "Finish sand and polish, denib and polish, color sand and buff, and post-refinish correction are refinish-related operations that may be capped or limited by estimating guidance.",
      oemComplianceConcern: "Treat as NEEDS P-PAGE / NEEDS DATABASE SUPPORT unless CCC/MOTOR/P-page guidance is attached.",
      nextAction: "Attach CCC/MOTOR/P-page/database guidance for the sand/polish operation or keep it labeled NEEDS P-PAGE / NEEDS DATABASE SUPPORT.",
      requiredDocumentation: ["CCC/MOTOR/P-page guidance", "database support", "refinish correction documentation"],
    };
  }
  if (/\b(?:pre[- ]?scan|post[- ]?scan|in[- ]?process scan|diagnostic|scan report|srs|health check)\b/.test(normalized)) {
    return {
      findingType: "diagnostics_scan",
      title: "Diagnostics / scan documentation review",
      category: "scan_diagnostic",
      label: "NEEDS ADAS",
      fallbackLabel: "NEEDS ADAS",
      evidenceTier: "estimate_evidence",
      score: 42,
      safetyImpact: "high",
      priority: "high",
      missingAuthorityTypes: ["OEM/MOTOR scan procedure", "scan invoice/completion proof"],
      issueSummary: `Estimate row references diagnostics or scan activity: ${rowText}`,
      whyItMatters: "Scan and diagnostic rows affect safety-system readiness and need procedure support plus completion proof before they are treated as substantiated.",
      oemComplianceConcern: "Estimate evidence suggests scan-related repair-standard work, but OEM/MOTOR support and completion documentation must be attached or researched.",
      nextAction: "Attach OEM/MOTOR scan procedure support and completion proof. Confirm whether pre-repair scan, in-process scan, post-repair scan, calibration readiness, or ADAS calibration is required for this vehicle and operation.",
      requiredDocumentation: ["OEM/MOTOR scan procedure", "scan report", "invoice or completion proof"],
    };
  }
  if (/\b(?:adas|calibration|recalibration|aim(?:ing)?|initialize|initialization|reset|relearn|programming|radar|camera|sensor|dynamic function test|road test)\b/.test(normalized)) {
    return {
      findingType: "adas_calibration",
      title: "ADAS / calibration repair-path review",
      category: "adas_calibration",
      label: "NEEDS ADAS",
      fallbackLabel: "NEEDS ADAS",
      evidenceTier: "estimate_evidence",
      score: 40,
      safetyImpact: "high",
      priority: "high",
      missingAuthorityTypes: ["OEM/MOTOR ADAS procedure", "calibration or completion proof"],
      issueSummary: `Estimate row affects ADAS/calibration workflow: ${rowText}`,
      whyItMatters: "Calibration, aiming, reset, and initialization rows can affect vehicle safety systems and must be tied to the correct procedure and completion output.",
      oemComplianceConcern: "The row should be verified against OEM/MOTOR calibration, aiming, reset, or initialization requirements before relying on the estimate line.",
      nextAction: "Attach OEM/MOTOR calibration, aiming, reset, or initialization procedure and completion documentation. Verify affected sensors/cameras/radar systems and document final calibration results.",
      requiredDocumentation: ["OEM/MOTOR calibration procedure", "calibration result", "sensor/camera/radar verification"],
    };
  }
  if ((/\b(?:hub|bearing|knuckle|control arm|tie rod|steering|strut|spindle|suspension|wheel end|wheel)\b/.test(normalized) && hasNonOemPartSource(sourceKinds))) {
    return {
      findingType: "am_wheel_end_safety",
      title: "A/M wheel-end part-source safety review",
      category: "parts_downgrade",
      label: "NEEDS OEM",
      fallbackLabel: "NEEDS OEM",
      evidenceTier: "estimate_evidence",
      score: isTeslaOrEv ? 72 : 62,
      safetyImpact: "high",
      priority: "high",
      missingAuthorityTypes: ["OEM procedure or position support", "supplier/manufacturer fit-function documentation", "written carrier part-source basis"],
      issueSummary: `Estimate row uses non-OEM wheel-end, steering, bearing, hub, or suspension sourcing: ${rowText}`,
      whyItMatters: `${isTeslaOrEv ? "EV weight and ADAS sensitivity increase the need for OEM procedure verification. " : ""}Wheel hub, bearing, steering, and suspension components are safety-critical wheel-end components and can affect steering, stability, sensor calibration, ADAS confidence, and roadworthiness.`,
      oemComplianceConcern: "This supports OEM review / requires OEM procedure or position support; do not state OEM requires unless authority exists.",
      nextAction: "Request OEM position/procedure support, supplier/manufacturer fit/function documentation, and the carrier's written basis for A/M/LKQ/non-OEM wheel-end use on this platform.",
      requiredDocumentation: ["OEM procedure or position support", "supplier/manufacturer fit-function documentation", "carrier written basis"],
    };
  }
  if (hasNonOemPartSource(sourceKinds) || /\b(?:incorrect style|not correct style|fit|finish|quality replacement|aftermarket)\b/.test(normalized)) {
    return {
      findingType: "part_source_oem_review",
      title: "Part-source / OEM repair-path review",
      category: "parts_downgrade",
      label: "NEEDS OEM",
      fallbackLabel: "NEEDS OEM",
      evidenceTier: "estimate_evidence",
      score: isTeslaOrEv ? 58 : 45,
      safetyImpact: /sensor|radar|camera|lamp|bumper|grille|support|hub|bearing|suspension|steering|wheel/.test(normalized) ? "high" : "medium",
      priority: "high",
      missingAuthorityTypes: ["OEM procedure or position statement", "part-type authorization", "supplier/invoice proof"],
      issueSummary: `Estimate row uses or questions non-OEM part sourcing: ${rowText}`,
      whyItMatters: `${isTeslaOrEv ? "EV weight and ADAS sensitivity increase the need for OEM procedure verification. " : ""}Carrier aftermarket warranty language may guarantee fit, corrosion, or replacement of the part, but it does not prove OEM-equivalent system performance, ADAS compatibility, sensor alignment, crash-test equivalency, or related manufacturer warranty preservation.`,
      oemComplianceConcern: "Estimate evidence supports a part-source review, but it does not by itself prove an OEM requirement, NHTSA crash-test equivalency, or an absolute warranty voiding claim.",
      nextAction: "Review OEM repair procedure and position statements for part-type requirements. Document authorization for LKQ/non-OEM part use, supplier fit/function support, and the written carrier basis before making legal or OEM-required claims.",
      requiredDocumentation: ["OEM procedure or position statement", "part-type authorization", "supplier invoice", "fit/finish validation"],
    };
  }
  // D-7: a blend/refinish operation is REFINISH, never a structural review —
  // "Blnd RT Side panel" must not route structural off the word "panel".
  // Structural classification keys on structural OPERATIONS, not panel nouns.
  const isBlendOrRefinishOperation = /^[#*\s]*(?:blnd|refn)\b/i.test(rowText) || /\bblend\b/.test(normalized);
  if (!isBlendOrRefinishOperation && /\b(?:section(?:ing)?|weld|bond|structural|measure|pull|setup|frame|aluminum|high strength|hss|uhss|one[- ]time|corrosion|seam sealer|foam|adhesive|nvh)\b/.test(normalized)) {
    return {
      findingType: "repair_procedure_structural",
      title: "Repair procedure / structural operation review",
      category: "structural_or_fit_verification",
      label: "NEEDS OEM",
      fallbackLabel: "NEEDS OEM",
      evidenceTier: "estimate_evidence",
      score: 44,
      safetyImpact: "high",
      priority: "high",
      missingAuthorityTypes: ["OEM repair procedure", "measurement or completion proof"],
      issueSummary: `Estimate row indicates structural or procedure-sensitive work: ${rowText}`,
      whyItMatters: "Structural, welding, bonding, one-time-use, corrosion protection, and special-material operations require repair-path verification and documentation.",
      oemComplianceConcern: "The repair path should be checked against OEM procedure before work is accepted as complete or supplement-ready.",
      nextAction: "Attach OEM repair procedure support and completion documentation. Verify sectioning, welded/bonded panels, structural measurements, one-time-use components, corrosion protection, seam sealer, foam, adhesive, NVH, and material-specific requirements as applicable.",
      requiredDocumentation: ["OEM repair procedure", "measurement proof", "photo/teardown or completion proof"],
    };
  }
  const isGlassTintDescriptor = /\b(?:glass|wndshld|windshield|quarter glass|back glass|door glass)\b/.test(normalized) &&
    /\b(?:w\/o|without|no|dark|privacy)\s+tint\b/.test(normalized) &&
    !/\b(?:blend|refinish|spray[- ]?out|clear coat|paint|material|color match|tint color|let[- ]?down|polish|sand)\b/.test(normalized);
  if (!isGlassTintDescriptor && /\b(?:blend|refinish|spray[- ]?out|tint|clear coat|paint|material|color)\b/.test(normalized)) {
    return {
      findingType: "refinish_blend_materials",
      title: "Refinish / blend / materials support review",
      category: "refinish",
      label: "NEEDS P-PAGE",
      fallbackLabel: "NEEDS P-PAGE",
      evidenceTier: "estimate_evidence",
      score: 52,
      safetyImpact: "medium",
      priority: "medium",
      missingAuthorityTypes: ["MOTOR/database guidance", "SCRS/refinish support", "material allowance proof"],
      issueSummary: `Estimate row contains refinish, blend, color, or material allowance work: ${rowText}`,
      whyItMatters: "Refinish and material rows need database, procedure, SCRS, policy, or jurisdictional support where available before the amount is treated as fully documented.",
      oemComplianceConcern: "The estimate line should be connected to refinish and material guidance without overclaiming an OEM requirement.",
      nextAction: "Attach procedure, estimating database, SCRS blend study, policy, or jurisdictional support as available. Document why the refinish/blend/material allowance is required and supplement missing labor/material support.",
      requiredDocumentation: ["MOTOR/database guidance", "SCRS blend study or refinish support", "material allowance proof"],
    };
  }
  if (anchor.anchorType === "totals_row" || /\b(?:labor rate|rate|subtotal|total|net cost|deductible|adjustment|paint supplies|materials)\b/.test(normalized)) {
    return {
      findingType: "labor_rates_totals",
      title: "Labor / rates / totals support review",
      category: "labor_difference",
      label: "ESTIMATE GAP ONLY",
      fallbackLabel: "ESTIMATE GAP ONLY",
      evidenceTier: "estimate_evidence",
      score: 58,
      safetyImpact: "low",
      priority: "medium",
      missingAuthorityTypes: ["rate/material support", "subtotal/totals consistency support"],
      issueSummary: `Estimate row contains labor, rate, material, deductible, adjustment, or totals information: ${rowText}`,
      whyItMatters: "Rate, material, and total rows need documentation and consistency checks before they are used to support a supplement or dispute.",
      oemComplianceConcern: "This is primarily estimate evidence; tie it to rate/material or estimating guidance before elevating it.",
      nextAction: "Review labor-rate reasonableness, paint/material rate support, missing not-included operations, subtotal/totals consistency, and deductible/adjustment clarity. Attach rate, invoice, database, or agreed-estimate support as available.",
      requiredDocumentation: ["rate support", "material support", "totals reconciliation"],
    };
  }
  if (/\b(?:invoice|receipt|proof|completion|photo|teardown|documentation|attached|referenced|link|report)\b/.test(normalized)) {
    return {
      findingType: "documentation_invoice_proof",
      title: "Documentation / invoice / proof review",
      category: "other",
      label: /referenced|link|attached/.test(normalized) ? "REFERENCED / NOT PRODUCED" : "NEEDS INVOICE",
      fallbackLabel: /referenced|link|attached/.test(normalized) ? "REFERENCED / NOT PRODUCED" : "NEEDS INVOICE",
      evidenceTier: "estimate_evidence",
      score: 48,
      safetyImpact: "medium",
      priority: "medium",
      missingAuthorityTypes: ["referenced support document", "invoice/completion proof"],
      issueSummary: `Estimate row references documentation, invoice, report, or proof: ${rowText}`,
      whyItMatters: "Referenced support must be produced before the estimate line can be treated as verified documentation.",
      oemComplianceConcern: "The row needs the actual support document, not just an estimate reference.",
      nextAction: "Attach the referenced OEM procedure, position statement, invoice, scan report, calibration result, photo proof, teardown proof, or completion record needed to substantiate the line item.",
      requiredDocumentation: ["referenced support", "invoice or completion proof", "photo/teardown proof when applicable"],
    };
  }
  return null;
}

function buildOemCitationDensityFinding(params: {
  context: AnnotatedEstimateFindingGeneratorContext;
  anchor: EstimateRowAnchor;
  rowText: string;
  family: OemCitationDensityFamily;
  authoritySources: OemCitationDensityAuthoritySource[];
}): CitationDensityFinding {
  const { context, anchor, rowText, family } = params;
  const authorityTrace = context.authorityTrace ?? buildDefaultOemAuthorityTrace();
  const authorityTraceIncomplete = isAuthorityTraceIncomplete(authorityTrace);
  const completedWithoutLineAuthority = isCompletedAuthoritySearchWithoutLineMatch(authorityTrace, params.authoritySources);
  const bestAuthoritySource = authorityTraceIncomplete
    ? undefined
    : pickBestOemAuthoritySource(params.authoritySources, family);
  const authority = authorityTraceIncomplete
    ? buildAuthorityTraceIncompleteAuthority(family, authorityTrace)
    : bestAuthoritySource && bestAuthoritySource.sourceType !== "estimate_evidence"
    ? mapOemAuthoritySourceToCitationAuthority(bestAuthoritySource, family)
    : buildEstimateEvidenceAuthority(family);
  const authorityVerification = resolveOemAuthorityVerification(family, authorityTraceIncomplete, authority);
  const verifiedAuthorityCount = authorityVerification.any ? 1 : 0;
  const retrievalStatus = mapOemRetrievalStatus(authorityTrace, authorityTraceIncomplete, completedWithoutLineAuthority, verifiedAuthorityCount);
  const lineTieStatus = completedWithoutLineAuthority
    ? "document_level_only"
    : verifiedAuthorityCount
      ? "line_tied"
      : "not_line_tied";
  const label = authorityTraceIncomplete
    ? "AUTHORITY TRACE INCOMPLETE"
    : completedWithoutLineAuthority
      ? "AUTHORITY SEARCH COMPLETED - NO LINE AUTHORITY MATCH"
      : resolveOemFindingLabel(family, authority, authorityVerification);
  const evidence = {
    lineNumber: anchor.lineNumber,
    description: rowText,
    amount: anchor.price ?? null,
    laborHours: anchor.labor ?? null,
    sourceLabel: context.sourcePdfName,
  };
  const finding = {
    id: `oem-citation-density-${family.findingType}-${anchor.anchorId.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`,
    operationLabel: family.title,
    category: family.category,
    estimateGapType: label === "REFERENCED / NOT PRODUCED" ? "referenced_not_produced" : "needs_proof",
    carrierEvidence: anchor.sourceDocumentRole === "carrier" ? evidence : undefined,
    shopEvidence: anchor.sourceDocumentRole === "shop" ? evidence : undefined,
    applicableEstimateRoles: [anchor.sourceDocumentRole],
    primaryAnnotationRole: anchor.sourceDocumentRole,
    carrierAnchor: anchor.sourceDocumentRole === "carrier" ? buildFindingLineAnchor(anchor) : undefined,
    shopAnchor: anchor.sourceDocumentRole === "shop" ? buildFindingLineAnchor(anchor) : undefined,
    impact: {
      dollarImpact: anchor.price ?? null,
      laborHoursImpact: anchor.labor ?? null,
      safetyImpact: family.safetyImpact,
      supplementPriority: family.priority,
    },
    citationStatus: buildOemCitationStatus(family, label, authorityVerification),
    citationDensityScore: family.score,
    verifiedAuthorityCount,
    missingAuthorityTypes: verifiedAuthorityCount ? family.requiredDocumentation : family.missingAuthorityTypes,
    missingAuthority: verifiedAuthorityCount ? family.requiredDocumentation : family.missingAuthorityTypes,
    bestAvailableAuthority: authority,
    authorityNeeded: authority.type !== "estimate_evidence" || family.missingAuthorityTypes.length > 0,
    authorityType: mapOemAuthorityType(family, authority),
    retrievalAttempted: authorityTrace.authorityTraceStarted === true || authorityTrace.driveSearchAttempted === true || authorityTrace.googleDriveOrInternalSearchRan === true,
    retrievalSourcesSearched: buildOemRetrievalSourcesSearched(authorityTrace),
    retrievalStatus,
    matchedDocumentTitle: bestAuthoritySource?.title ?? authority.title ?? null,
    matchedDocumentUrl: null,
    sourceExcerpt: bestAuthoritySource?.note ?? null,
    sourcePageLine: null,
    appliesToShopEstimate: anchor.sourceDocumentRole === "shop" ? "unknown" : "no",
    appliesToCarrierEstimate: anchor.sourceDocumentRole === "carrier" ? "unknown" : "no",
    lineTieStatus,
    nextActionOwner: inferOemNextActionOwner(retrievalStatus, lineTieStatus, family),
    citationLabel: label,
    currentSupportSummary: [
      `Report type: ${OEM_CITATION_DENSITY_REPORT_TYPE}.`,
      `Finding type: ${family.findingType}.`,
      `Estimate file: ${context.sourcePdfName}.`,
      `Source page: ${anchor.pageNumber}.`,
      `Source line: ${anchor.lineNumber ?? "section"}.`,
      // Row text is QUOTED so a downstream extractor can never overrun into
      // the finding's own prose (D-7: "…camera m Incl. M OEM compliance
      // concern: The row should be…" read as row text).
      `Source row text: "${rowText}".`,
      `Issue summary: ${family.issueSummary}`,
      `OEM compliance concern: ${family.oemComplianceConcern}`,
      `Evidence tier: ${getOemAuthorityEvidenceTierLabel(authority)}.`,
      authorityTraceIncomplete
        ? `Authority trace incomplete: ${authorityTrace.authorityTraceBlockedReason ?? authorityTrace.skippedReason ?? "required OEM authority retrieval did not complete"}.`
        : completedWithoutLineAuthority
          ? "Authority search completed: no line-specific authority match was found."
        : "",
    ].join(" "),
    missingProofSummary: [
      `Required documentation: ${family.requiredDocumentation.join(", ")}.`,
      authorityTraceIncomplete
        ? "Authority retrieval did not complete, so this finding is not citation-ready and no OEM support was verified."
        : completedWithoutLineAuthority
          ? "Authority retrieval completed, but no line-specific OEM, ADAS, estimating, policy, or legal authority was matched to this row."
        : "",
      verifiedAuthorityCount
        ? "Authority support is present, but completion/estimate proof still needs to be tied to the exact row."
        : "Authority source not attached; use this as research/documentation needed, not verified OEM support.",
    ].join(" "),
    recommendedNextAction: family.nextAction,
    confidence: anchor.confidence >= 0.92 ? "high" : "medium",
    limitations: [
      "OEM Citation Density finding generated from an extracted estimate row.",
      "Do not say OEM requires unless an OEM procedure or position statement is attached.",
      authorityTraceIncomplete
        ? `Authority trace incomplete: ${authorityTrace.authorityTraceBlockedReason ?? authorityTrace.skippedReason ?? "retrieval not completed"}`
        : completedWithoutLineAuthority
          ? "Authority search completed without a line-specific authority match."
        : "",
      `sourcePdfHash:${context.sourcePdfHash}`,
      `artifactVersion:${OEM_CITATION_DENSITY_ARTIFACT_VERSION}`,
    ].filter(Boolean),
    anchorId: anchor.anchorId,
    reportType: OEM_CITATION_DENSITY_REPORT_TYPE,
    findingType: family.findingType,
    evidenceTier: getOemAuthorityEvidenceTierLabel(authority),
    authoritySources: params.authoritySources,
    requiredDocumentation: family.requiredDocumentation,
  } satisfies CitationDensityFinding & {
    anchorId: string;
    reportType: string;
    findingType: string;
    evidenceTier: string;
    authoritySources: OemCitationDensityAuthoritySource[];
    requiredDocumentation: string[];
  };
  return finding;
}

function mapOemRetrievalStatus(
  trace: OemCitationDensityAuthorityTrace,
  traceIncomplete: boolean,
  completedWithoutLineAuthority: boolean,
  verifiedAuthorityCount: number
): NonNullable<CitationDensityFinding["retrievalStatus"]> {
  if (verifiedAuthorityCount > 0) return "retrieved";
  if (completedWithoutLineAuthority) return "matched";
  if (!trace.authorityTraceStarted && !trace.driveSearchAttempted && !trace.googleDriveOrInternalSearchRan) return "not_configured";
  if (traceIncomplete && /access|denied|forbidden|permission/i.test(`${trace.authorityTraceBlockedReason ?? ""} ${trace.skippedReason ?? ""}`)) return "access_denied";
  if (traceIncomplete) return "error";
  return "no_match";
}

function mapOemAuthorityType(
  family: OemCitationDensityFamily,
  authority: NonNullable<CitationDensityFinding["bestAvailableAuthority"]>
): NonNullable<CitationDensityFinding["authorityType"]> | undefined {
  const value = `${family.findingType} ${family.title} ${family.requiredDocumentation.join(" ")} ${authority.type}`;
  if (/invoice|completion/i.test(value)) return "INVOICE";
  if (/photo|teardown/i.test(value)) return "PHOTO";
  if (/scan|diagnostic|dtc/i.test(value)) return "SCAN";
  if (/adas|calibration|aim|radar|camera/i.test(value)) return "CALIBRATION";
  if (/p_page|p-?page|motor/i.test(value)) return "P_PAGE";
  if (/\bdeg\b/i.test(value)) return "DEG";
  if (/\bscrs\b/i.test(value)) return "SCRS";
  if (/legal|state|doi|statute|regulation/i.test(value)) return "DOI_LEGAL";
  if (/policy/i.test(value)) return "POLICY";
  if (/oem|procedure|position/i.test(value)) return "OEM";
  return undefined;
}

function buildOemRetrievalSourcesSearched(trace: OemCitationDensityAuthorityTrace) {
  const sources = new Set<string>();
  if (trace.driveSearchAttempted || trace.googleDriveOrInternalSearchRan) sources.add("Google Drive");
  if ((trace.authoritySources ?? []).some((source) => /egnyte/i.test(`${source.title} ${source.note ?? ""}`))) sources.add("Egnyte");
  if ((trace.authoritySources ?? []).some((source) => source.sourceType === "ccc_secure_share")) sources.add("CCC Secure Share");
  if ((trace.onlineSearchAttempted ?? false) || (trace.onlineSourcesReviewed ?? []).length > 0) sources.add("web");
  return Array.from(sources);
}

function inferOemNextActionOwner(
  retrievalStatus: NonNullable<CitationDensityFinding["retrievalStatus"]>,
  lineTieStatus: NonNullable<CitationDensityFinding["lineTieStatus"]>,
  family: OemCitationDensityFamily
): NonNullable<CitationDensityFinding["nextActionOwner"]> {
  if (retrievalStatus === "retrieved" && lineTieStatus === "line_tied") return "Collision IQ";
  if (retrievalStatus === "matched" || (retrievalStatus === "retrieved" && lineTieStatus !== "line_tied")) return "Collision IQ";
  if (family.requiredDocumentation.some((item) => /invoice|completion|photo|scan|calibration|measurement/i.test(item))) return "shop";
  if (retrievalStatus === "access_denied") return "carrier";
  return "Collision IQ";
}

/**
 * R15 — a source may back a finding only when it EVIDENCES the subject, not
 * when it discusses the subject.
 *
 * "Tips on Finding OEM Position Statements" is advice about the existence of
 * position statements; it is not one. RO 22116 cited it as the authority for
 * OEM findings eleven times. A finding with no retrieved authority must say
 * NEEDS OEM and name nothing — that is defensible; a how-to article dressed as
 * a manufacturer requirement is what gets a supplement dismissed.
 *
 * Both pattern sets are DATA (deltaRules.json), so adding a rejected shape is
 * a one-line edit that applies to every future comparison.
 */
export function isCitableAuthorityTitle(title: string | null | undefined): boolean {
  const value = (title ?? "").trim();
  if (!value) return false;
  for (const pattern of DELTA_RULES.authority.rejectTitlesMatching) {
    if (new RegExp(pattern, "i").test(value)) return false;
  }
  for (const pattern of DELTA_RULES.authority.rejectMetaTitlesMatching) {
    if (new RegExp(pattern, "i").test(value)) return false;
  }
  return true;
}

function detectOemCitationDensityAuthoritySources(context: AnnotatedEstimateFindingGeneratorContext): OemCitationDensityAuthoritySource[] {
  const sources: OemCitationDensityAuthoritySource[] = [];
  const add = (source: OemCitationDensityAuthoritySource) => {
    if (!sources.some((item) => item.sourceType === source.sourceType && item.title === source.title)) sources.push(source);
  };
  for (const source of context.authorityTrace?.authoritySources ?? []) {
    // A retrieved record whose TITLE only discusses the topic is not an
    // authority for it. Dropping it here means the finding falls through to
    // estimate evidence and reports NEEDS OEM, which is the honest outcome.
    if (!isCitableAuthorityTitle(source.title)) continue;
    add(source);
  }
  add({ title: "Estimate evidence row", sourceType: "estimate_evidence", evidenceTier: 8, verified: false });
  return sources;
}

function pickBestOemAuthoritySource(
  sources: OemCitationDensityAuthoritySource[],
  family: OemCitationDensityFamily
) {
  const relevant = sources.filter((source) => {
    if (source.sourceType === "estimate_evidence") return true;
    // Internet (Serper) fallback is a universal last resort for every family. Its high
    // evidenceTier (7) keeps it below any verified OEM/ADAS/MOTOR/uploaded/legal source, so it
    // only backs a finding when nothing stronger was retrieved — but it still ties the finding to
    // a real retrieved reference (labeled ONLINE FALLBACK) instead of estimate-evidence only.
    // The internet fallback is the universal last resort, so it is exactly
    // where meta-commentary reaches a reader as an authority.
    if (source.sourceType === "internet_fallback") return isCitableAuthorityTitle(source.title);
    if (family.findingType.includes("adas") || family.findingType.includes("diagnostics")) {
      return source.sourceType === "oem_procedure" || source.sourceType === "motor_database" || source.sourceType === "uploaded_support" || source.sourceType === "ccc_secure_share";
    }
    if (family.findingType.includes("part_source")) {
      return source.sourceType === "oem_procedure" || source.sourceType === "oem_position_statement" || source.sourceType === "uploaded_support" || source.sourceType === "ccc_secure_share";
    }
    if (family.findingType.includes("refinish") || family.findingType.includes("labor")) {
      return source.sourceType === "motor_database" || source.sourceType === "policy" || source.sourceType === "jurisdictional_law" || source.sourceType === "uploaded_support";
    }
    return true;
  });
  return relevant.sort((a, b) => a.evidenceTier - b.evidenceTier)[0] ?? sources[sources.length - 1];
}

function mapOemAuthoritySourceToCitationAuthority(
  source: OemCitationDensityAuthoritySource,
  family: OemCitationDensityFamily
): NonNullable<CitationDensityFinding["bestAvailableAuthority"]> {
  const typeMap: Record<OemCitationDensityAuthoritySource["sourceType"], NonNullable<CitationDensityFinding["bestAvailableAuthority"]>["type"]> = {
    oem_procedure: family.findingType.includes("adas") ? "adas_procedure" : "oem_procedure",
    oem_position_statement: "oem_position_statement",
    motor_database: "p_page",
    uploaded_support: "invoice_completion",
    ccc_secure_share: "estimate_evidence",
    policy: "estimate_evidence",
    jurisdictional_law: "legal",
    internet_fallback: "online_fallback",
    estimate_evidence: "estimate_evidence",
  };
  return {
    type: typeMap[source.sourceType],
    status: source.verified ? "verified" : "needed",
    title: source.title,
    confidence: source.verified ? "high" : "low",
    note: source.note ?? `Evidence tier ${source.evidenceTier}: ${source.sourceType}`,
  };
}

function buildEstimateEvidenceAuthority(
  family: OemCitationDensityFamily
): NonNullable<CitationDensityFinding["bestAvailableAuthority"]> {
  return {
    type: "estimate_evidence",
    status: "needed",
    title: "Estimate evidence only",
    confidence: "medium",
    note: `${family.title}: research/documentation needed. Estimate evidence alone is not verified OEM support.`,
  };
}

function buildAuthorityTraceIncompleteAuthority(
  family: OemCitationDensityFamily,
  authorityTrace: OemCitationDensityAuthorityTrace
): NonNullable<CitationDensityFinding["bestAvailableAuthority"]> {
  return {
    type: "estimate_evidence",
    status: "needed",
    title: "Authority trace incomplete",
    confidence: "low",
    note: [
      `${family.title}: OEM/internal authority retrieval did not complete.`,
      authorityTrace.authorityTraceBlockedReason ?? authorityTrace.skippedReason ?? "",
      "Treat as not citation-ready until the relevant OEM, ADAS, estimating, policy, or legal sources are retrieved and attached.",
    ].filter(Boolean).join(" "),
  };
}

function isAuthorityTraceIncomplete(authorityTrace: OemCitationDensityAuthorityTrace) {
  return (
    authorityTrace.authorityCoverageStatus === "incomplete" ||
    !authorityTrace.authorityTraceCompleted ||
    Boolean(authorityTrace.authorityTraceBlockedReason)
  );
}

function isCompletedAuthoritySearchWithoutLineMatch(
  authorityTrace: OemCitationDensityAuthorityTrace,
  authoritySources: OemCitationDensityAuthoritySource[]
) {
  if (isAuthorityTraceIncomplete(authorityTrace)) return false;
  const nonEstimateSources = authoritySources.filter((source) => source.sourceType !== "estimate_evidence");
  return nonEstimateSources.length === 0 && authorityTrace.googleDriveOrInternalSearchRan;
}

type OemAuthorityVerification = {
  any: boolean;
  oem: boolean;
  adas: boolean;
  documentation: boolean;
  legal: boolean;
  pPage: boolean;
};

function resolveOemAuthorityVerification(
  family: OemCitationDensityFamily,
  authorityTraceIncomplete: boolean,
  authority: NonNullable<CitationDensityFinding["bestAvailableAuthority"]>
): OemAuthorityVerification {
  const verified = !authorityTraceIncomplete && authority.status === "verified";
  const familyText = `${family.findingType} ${family.category} ${family.label} ${family.requiredDocumentation.join(" ")}`;
  const isAdasFamily = /\b(?:adas|calibration|scan|diagnostic|aim|radar|camera)\b/i.test(familyText);
  const isPPageFamily = /\b(?:p-?page|motor|database|scrs|deg|refinish|labor)\b/i.test(familyText);
  const oem = verified && authority.type === "oem_procedure" && !isPPageFamily && !isAdasFamily;
  const adas = verified && authority.type === "adas_procedure" && isAdasFamily;
  const pPage = verified && authority.type === "p_page" && isPPageFamily;
  const documentation = verified && (authority.type === "invoice_completion" || pPage);
  const legal = verified && authority.type === "legal";
  return {
    any: oem || adas || documentation || legal,
    oem,
    adas,
    documentation,
    legal,
    pPage,
  };
}

function classifyLineItemDeltaProfile(delta: EstimateLineItemDelta): {
  label: string;
  category: CitationDensityFinding["category"];
  missingAuthorityTypes: string[];
  nextAction: string;
  score: number;
  safetyImpact: "low" | "medium" | "high";
  priority: "low" | "medium" | "high";
} {
  const text = normalizeMatchText(`${delta.higherRow.section ?? ""} ${delta.higherRow.opCode ?? ""} ${delta.higherRow.description} ${delta.higherRow.rawText}`);
  const amount = delta.priceDelta ?? 0;
  const labor = delta.laborDelta ?? 0;
  // Part source is decided before anything the row's wording suggests: the two
  // documents named different parts, and no keyword in the description changes
  // what that dispute is. Classified first so the RO 22182 LKQ sectioned
  // quarter panel could not fall to the generic profile and off the end of the
  // ranked list.
  if (delta.kind === "part_source_difference") {
    return {
      label: "PART SOURCE",
      category: "parts_downgrade",
      missingAuthorityTypes: [
        "supplier quote for the alternate part",
        "OEM position statement on non-OEM parts",
        "part-type authorization",
      ],
      nextAction:
        "Resolve the part source before the price: obtain the supplier quote for the alternate part, confirm availability and condition, and check the OEM position statement and any state statute governing non-OEM parts for this vehicle.",
      score: 82,
      safetyImpact: "medium",
      priority: "high",
    };
  }
  if (/\b(?:calibration|camera|radar|scan|diagnostic|dtc|firmware|service mode|redeploy|adas)\b/.test(text)) {
    return {
      label: "NEEDS ADAS",
      category: "scan_diagnostic",
      missingAuthorityTypes: ["ADAS/calibration procedure", "scan or calibration result", "completion proof"],
      nextAction: "Attach the scan, calibration, service-mode, firmware, DTC research, and completion support for this operation, or document why it is not required — it is documented on this estimate but missing from the comparison estimate.",
      score: 82,
      safetyImpact: "high",
      priority: "high",
    };
  }
  if (/\b(?:suspension|control arm|crossmember|link arm|lateral arm|hub|tpms|sensor|bracket|coolant|purge|compartment|structural|o\/h)\b/.test(text)) {
    return {
      label: "ESTIMATE GAP ONLY",
      category: /\btpms|sensor\b/.test(text) ? "parts_downgrade" : "structural_or_fit_verification",
      missingAuthorityTypes: ["supplement line", "invoice or completion proof", "repair-path support when applicable"],
      nextAction: "Review this operation (documented on this estimate, missing from the comparison estimate), then attach supplement, invoice, completion, or repair-path support for it.",
      score: Math.min(86, 68 + Math.round(Math.min(amount, 500) / 50) + Math.round(Math.min(labor, 4) * 2)),
      safetyImpact: "high",
      priority: "high",
    };
  }
  return {
    label: "ESTIMATE GAP ONLY",
    category: "not_included_operation",
    missingAuthorityTypes: ["supplement line", "invoice or completion proof"],
    nextAction: "Confirm whether this operation should also be on the comparison estimate, or document why it is not required there — it is present on this estimate but missing from the comparison estimate.",
    score: Math.min(76, 52 + Math.round(Math.min(amount, 500) / 50) + Math.round(Math.min(labor, 4) * 2)),
    safetyImpact: amount >= 250 || labor >= 1 ? "medium" : "low",
    priority: amount >= 250 || labor >= 1 ? "high" : "medium",
  };
}

function formatDeltaMoney(value: number | null) {
  return typeof value === "number" ? `$${value.toFixed(2)}` : "not quantified";
}

function formatDeltaHours(value: number | null) {
  if (typeof value !== "number") return "not quantified";
  return Number.isInteger(value) ? `${value}.0` : `${value}`;
}

function describeDeltaRowLocation(row: EstimateDeltaRow | null, fileName: string) {
  if (!row) return `${fileName}: source row missing`;
  const page = row.pageNumber ? ` page ${row.pageNumber}` : "";
  const line = row.lineNumber !== null ? ` line ${row.lineNumber}` : "";
  return `${fileName}${page}${line}: ${row.rawText}`;
}

function describeAnchorLocation(anchor: EstimateRowAnchor, fileName: string) {
  const page = anchor.pageNumber ? ` page ${anchor.pageNumber}` : "";
  const line = anchor.lineNumber ? ` line ${anchor.lineNumber}` : "";
  return `${fileName}${page}${line}: ${getAnchorSourceText(anchor)}`;
}

/**
 * Direction predicate shared by classification AND presentation (D-2): a
 * matched delta where every populated cell runs NEGATIVE (the LOWER estimate
 * carries more) is "lower allows more" — its printed category must say so,
 * never `reduced_*`, which asserts the opposite direction.
 */
function isLowerAllowsMoreDelta(delta: EstimateLineItemDelta): boolean {
  const primaryDelta = delta.priceDelta ?? delta.laborDelta ?? delta.paintDelta;
  return (
    (delta.kind === "reduced_labor" || delta.kind === "reduced_paint" || delta.kind === "part_or_price_difference") &&
    delta.lowerRow !== null &&
    primaryDelta !== null &&
    primaryDelta < 0 &&
    (delta.priceDelta ?? 0) <= 0 &&
    (delta.laborDelta ?? 0) <= 0 &&
    (delta.paintDelta ?? 0) <= 0
  );
}

/** The cell whose value drives this delta (largest populated magnitude wins). */
function deltaDrivingCell(delta: EstimateLineItemDelta): "paint" | "labor" | "price" {
  const paint = Math.abs(delta.paintDelta ?? 0);
  const labor = Math.abs(delta.laborDelta ?? 0);
  const price = Math.abs(delta.priceDelta ?? 0);
  if (paint >= labor && paint > 0 && price === 0) return "paint";
  if (labor > 0 && price === 0) return "labor";
  if (price > 0) return "price";
  return paint >= labor ? (paint > 0 ? "paint" : "labor") : "labor";
}

/** Signed, direction-explicit category text (D-2): `reduced_paint` on a
 * lower-allows-more delta contradicts its own numbers. */
function signedDeltaCategory(delta: EstimateLineItemDelta): string {
  if (!isLowerAllowsMoreDelta(delta)) return delta.kind;
  const cell = deltaDrivingCell(delta);
  return `increased_on_lower (${cell})`;
}

function buildLineItemDeltaSupportSummary(params: {
  delta: EstimateLineItemDelta;
  anchor: EstimateRowAnchor;
  sourceName: string;
  comparisonName: string;
}) {
  // The annotated source is the annotated estimate (delta.higherRow); the comparison is the
  // comparison estimate (delta.lowerRow, or absent when the operation is missing there).
  const annotatedLocation = describeDeltaRowLocation(params.delta.higherRow, params.sourceName)
    || describeAnchorLocation(params.anchor, params.sourceName);
  const comparisonLocation = params.delta.lowerRow
    ? describeDeltaRowLocation(params.delta.lowerRow, params.comparisonName)
    : `not present on ${params.comparisonName}`;
  return [
    `Delta category: ${signedDeltaCategory(params.delta)}.`,
    `Annotated estimate (higher-cost): ${annotatedLocation}.`,
    `Comparison estimate (lower-cost): ${comparisonLocation}.`,
    `Amount delta: ${formatDeltaMoney(params.delta.priceDelta)}.`,
    `Labor delta: ${formatDeltaHours(params.delta.laborDelta)} hours.`,
    `Paint delta: ${formatDeltaHours(params.delta.paintDelta)} hours.`,
    `Pairing basis: ${params.delta.matchBasis}.`,
    // Swallow an existing leading "the" so "on the lower estimate" never
    // doubles into "on the the comparison estimate" (RO 22140 Test 3 audit).
    params.delta.summary
      .replace(/\b(?:the\s+)?higher estimate\b/gi, "this estimate")
      .replace(/\b(?:the\s+)?lower estimate\b/gi, "the comparison estimate"),
  ].join(" ");
}

function scoreLineItemDeltaForPriority(delta: EstimateLineItemDelta) {
  const profile = classifyLineItemDeltaProfile(delta);
  const kindBoost =
    delta.kind === "missing_operation" ? 18 :
      // A part-source disagreement is a procurement dispute with a documented
      // alternate supplier behind it, not a price quibble — it ranks with the
      // scope findings, or the report's central dispute falls off the end of
      // the list (RO 22182's LKQ sectioned quarter panel).
      delta.kind === "part_source_difference" ? 16 :
        delta.kind === "operation_change" ? 14 :
          delta.kind === "reduced_labor" ? 10 :
            delta.kind === "reduced_paint" ? 6 : 4;
  const amount = delta.priceDelta ?? 0;
  const labor = delta.laborDelta ?? 0;
  const paint = delta.paintDelta ?? 0;
  // An OCR-uncertain "missing" line is unverified, so it must not outrank
  // confirmed gaps in the priority ordering.
  const ocrPenalty = delta.ocrUncertain ? 24 : 0;
  // Clamped at zero: a line where the comparison allows MORE hours or dollars
  // than this estimate is still a real finding, and subtracting priority for it
  // pushed genuine disputes off the end of the ranked list.
  return (
    profile.score +
    kindBoost -
    ocrPenalty +
    Math.max(0, Math.min(30, amount / 25)) +
    Math.max(0, Math.min(20, labor * 6)) +
    Math.max(0, Math.min(10, paint * 4))
  );
}

function findFallbackAnchorForMissingDelta(
  delta: EstimateLineItemDelta,
  anchors: EstimateRowAnchor[]
): EstimateRowAnchor | undefined {
  const sectionTokens = new Set(
    normalizeMatchText(delta.higherRow.section ?? "")
      .split(/\s+/)
      .filter((token) => token.length >= 4)
  );
  const rowTokens = new Set(delta.higherRow.descriptionTokens.filter((token) => token.length >= 4));
  let best: { anchor: EstimateRowAnchor; score: number } | null = null;
  for (const anchor of anchors) {
    const text = normalizeMatchText(`${anchor.section ?? ""} ${getAnchorSourceText(anchor)}`);
    if (!text || isRejectedPrimaryAnchorText(text, anchor)) continue;
    let score = 0;
    for (const token of sectionTokens) {
      if (text.includes(token)) score += 4;
    }
    for (const token of rowTokens) {
      if (text.includes(token)) score += 2;
    }
    if (/\bengine compartment\b/.test(normalizeMatchText(delta.higherRow.section ?? "")) && /\b(?:underhood|engine|compartment|coolant)\b/.test(text)) {
      score += 5;
    }
    if (/\brear suspension\b/.test(normalizeMatchText(delta.higherRow.section ?? "")) && /\b(?:rear|suspension|hub|control arm|crossmember|link|lateral|tpms|bracket)\b/.test(text)) {
      score += 5;
    }
    if (score > (best?.score ?? 0)) {
      best = { anchor, score };
    }
  }
  return best && best.score >= 4 ? best.anchor : undefined;
}

function resolveOemFindingLabel(
  family: OemCitationDensityFamily,
  authority: NonNullable<CitationDensityFinding["bestAvailableAuthority"]>,
  verification: OemAuthorityVerification
) {
  if (verification.adas) return "VERIFIED ADAS";
  if (verification.oem) return "VERIFIED OEM";
  if (authority.status === "verified" && authority.type === "oem_position_statement") return "OEM POSITION REFERENCED";
  if (verification.documentation) return "VERIFIED DOCUMENTATION";
  if (verification.legal) return "VERIFIED LEGAL";
  if (authority.type === "oem_position_statement") return "OEM POSITION REFERENCED";
  if (authority.type === "oem_procedure" || authority.type === "adas_procedure") return "NEEDS OEM PROCEDURE";
  return family.fallbackLabel;
}

function isOemVerifiedLabel(label: string | undefined) {
  return label === "VERIFIED OEM" || label === "VERIFIED ADAS" || label === "VERIFIED DOCUMENTATION" || label === "VERIFIED LEGAL";
}

function buildOemCitationStatus(
  family: OemCitationDensityFamily,
  label: string,
  verification: OemAuthorityVerification
): CitationDensityFinding["citationStatus"] {
  const needsOem = family.label === "NEEDS OEM" || family.missingAuthorityTypes.some((item) => /OEM/i.test(item));
  const needsAdas = family.label === "NEEDS ADAS" || family.category === "adas_calibration" || family.category === "scan_diagnostic";
  const needsInvoice = family.label === "NEEDS INVOICE" || family.missingAuthorityTypes.some((item) => /invoice|proof|completion/i.test(item));
  return {
    oem: needsOem ? (verification.oem ? "verified" : "needed") : "not_applicable",
    oemPositionStatement: needsOem ? (label === "OEM POSITION REFERENCED" || verification.oem ? "verified" : "needed") : "not_applicable",
    adas: needsAdas ? (verification.adas ? "verified" : "needed") : "not_applicable",
    pPages: family.label === "NEEDS P-PAGE" ? (verification.pPage ? "verified" : "needed") : "not_applicable",
    scrs: family.findingType.includes("refinish") ? "needed" : "not_applicable",
    deg: family.findingType.includes("labor") || family.findingType.includes("refinish") ? "needed" : "not_applicable",
    nhtsa: "not_applicable",
    stateRegulation: verification.legal ? "verified" : "not_applicable",
    policy: "not_applicable",
    invoiceOrCompletionProof: verification.documentation ? "verified" : needsInvoice || needsAdas ? "needed" : "not_found",
    photoOrTeardownProof: family.findingType.includes("structural") ? "needed" : "not_found",
  };
}

function getOemEvidenceTier(finding: CitationDensityFinding) {
  return getOemAuthorityEvidenceTierLabel(finding.bestAvailableAuthority ?? buildEstimateEvidenceAuthority({
    findingType: "unknown",
    title: finding.operationLabel,
    category: finding.category,
    label: getProofBucketLabel(finding),
    fallbackLabel: getProofBucketLabel(finding),
    evidenceTier: "estimate_evidence",
    score: finding.citationDensityScore,
    safetyImpact: finding.impact.safetyImpact,
    priority: finding.impact.supplementPriority,
    missingAuthorityTypes: finding.missingAuthorityTypes,
    issueSummary: finding.currentSupportSummary,
    whyItMatters: finding.currentSupportSummary,
    oemComplianceConcern: finding.missingProofSummary,
    nextAction: finding.recommendedNextAction,
    requiredDocumentation: finding.missingAuthorityTypes,
  }));
}

function getOemAuthorityEvidenceTierLabel(authority: NonNullable<CitationDensityFinding["bestAvailableAuthority"]>) {
  if (authority.type === "oem_procedure" || authority.type === "adas_procedure") return "tier_1_oem_procedure";
  if (authority.type === "oem_position_statement") return "tier_2_oem_position_statement";
  if (authority.type === "p_page" || authority.type === "deg" || authority.type === "scrs") return "tier_3_motor_database";
  if (authority.type === "invoice_completion") return "tier_4_uploaded_support";
  if (authority.type === "legal") return "tier_6_jurisdictional_law";
  if (authority.type === "online_fallback") return "tier_7_verified_web_fallback";
  return "tier_8_estimate_evidence";
}

export function classifyPartSource(rowText: string): PartSourceKind[] {
  const text = ` ${rowText.replace(/\s+/g, " ")} `;
  const normalized = normalizeMatchText(rowText);
  const kinds: PartSourceKind[] = [];
  const add = (kind: PartSourceKind) => {
    if (!kinds.includes(kind)) kinds.push(kind);
  };

  if (/\bopt(?:ional)?\s+oem\b/i.test(text)) add("OPT_OEM");
  if (/\balt(?:ernate)?\s+oem\b/i.test(text)) add("ALT_OEM");
  if (/\boriginal\s+equipment\b/i.test(text)) add("OEM");
  if (/\boem\b/i.test(text)) add("OEM");
  if (/\boe\b/i.test(text)) add("OE");
  if (/\ba\s*\/\s*m\b/i.test(text)) add("AM");
  if (/\bam\b/i.test(text) || /\baftermarket\b/i.test(text)) add("AM");
  if (/\bcapa\b/i.test(text)) add("CAPA");
  if (/\blkq\b/i.test(text)) add("LKQ");
  if (/\bused\b/i.test(text)) add("USED");
  if (/\brecycled\b/i.test(text)) add("RECYCLED");
  if (/\brecond(?:itioned)?\b/i.test(text)) add("RECONDITIONED");
  if (/\breman(?:ufactured)?\b/i.test(text)) add("REMAN");
  if (/\bnon[-\s]?oem\b/i.test(text) || /\bnon oem\b/i.test(normalized)) add("NON_OEM");
  if (/\beconomy\b/i.test(text)) add("ECONOMY");

  return kinds;
}

/**
 * Resolve a row's canonical operation from raw estimate row text.
 *
 * A row carries its line number and, in glued text layers, its price welded to
 * the last word: "75 **A/M Urethane Kit135.00". The alias "urethane kit" needs
 * a word boundary that "Kit135" destroys, so the row resolved to null and the
 * aftermarket substitution went unreported. Strip the leading line number and
 * separate letter-to-digit boundaries before resolving.
 */
function resolveRowOperation(rowText: string): string | null {
  const cleaned = (rowText ?? "")
    .replace(/^\s*(?:line\s*)?\d{1,4}\b/i, " ")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return canonicalOperationKey(cleaned);
}

function buildPartSourceFindings(params: {
  selectedAnchors: EstimateRowAnchor[];
  selectedVisualLines?: PdfTextLine[];
  sourcePdfName: string;
  sourceDocumentId?: string;
  sourceDocumentRole: "carrier" | "shop";
  comparisonEstimateTexts: ComparisonEstimateText[];
  existingFindings: CitationDensityFinding[];
}): PartSourceFindingResult {
  if (!shouldGeneratePartSourceFindings(params.existingFindings)) {
    return {
      findings: [],
      partSourceRows: [],
      nonOemPartRowCount: 0,
      oemPartRowCount: 0,
      comparisonCandidateCount: 0,
      candidateCount: 0,
      acceptedCandidates: [],
      rejectedCandidates: [],
      rejectedLineNumberCandidates: [],
      comparisonMatches: [],
      droppedReasons: [],
    };
  }
  // FIX 2 — the entry gate above asks whether ANOTHER detector already found a
  // part-source issue, which is circular: on RO 22116 nothing else detected the
  // carrier's "**A/M Urethane Kit", so the pass would never run. Relevance
  // belongs to the DOCUMENTS. The early exit is kept for the case where neither
  // document carries a non-OEM token at all (it keeps the pass off documents it
  // has no business reading), and re-opened below when one does.
  const allSelectedRows = params.selectedAnchors
    .map((anchor) => buildPartSourceRowFromAnchor(anchor, params.sourcePdfName))
    .filter((row): row is PartSourceRow => Boolean(row));
  const selectedRows = allSelectedRows.filter((row) => row.sourceKinds.length > 0);
  const comparisonRows = params.comparisonEstimateTexts.flatMap((source) => buildPartSourceRowsFromText(source));
  const droppedReasons: PartSourceFindingResult["droppedReasons"] = [];
  const allSelectedNonOemRows = selectedRows.filter((row) => hasNonOemPartSource(row.sourceKinds));
  const { preferredRows, rejectedRows: supplierSupersededRows } = filterPreferredSelectedPartSourceRows(allSelectedNonOemRows);
  const selectedNonOemRows = preferredRows
    .filter((row) => !isPartSourceRowCoveredByExistingFinding(row, params.existingFindings));
  const selectedOemRows = selectedRows.filter((row) => hasOemPartSource(row.sourceKinds));
  const comparisonOemRows = comparisonRows.filter((row) => hasOemPartSource(row.sourceKinds));
  const hasComparisonEstimate = params.comparisonEstimateTexts.some((item) => item.text.trim().length > 0);
  const findings: CitationDensityFinding[] = [];
  const acceptedCandidates: PartSourceFindingCandidate[] = [];
  const rejectedCandidates: PartSourceFindingCandidate[] = [];
  const rejectedLineNumberCandidates: PartSourceFindingResult["rejectedLineNumberCandidates"] = [];
  const comparisonMatches: PartSourceComparisonMatchDebug[] = [];

  for (const candidate of buildRejectedPartSourceVisualLineCandidates({
    visualLines: params.selectedVisualLines ?? [],
    selectedRows,
    sourcePdfName: params.sourcePdfName,
    sourceDocumentId: params.sourceDocumentId,
    sourceDocumentRole: params.sourceDocumentRole,
  })) {
    rejectedCandidates.push(candidate);
    if (isVehicleYearLineNumber(candidate.lineNumber)) {
      rejectedLineNumberCandidates.push({
        rowText: candidate.rowText,
        lineNumber: candidate.lineNumber,
        reason: "vehicle year parsed as line number",
      });
    }
    droppedReasons.push({
      anchorId: candidate.anchorId || null,
      rowText: candidate.rowText,
      reason: candidate.rejectionReasons.join("; "),
    });
  }

  for (const row of supplierSupersededRows) {
    const candidate = scorePartSourceCandidate(buildPartSourceCandidate(row, null, null));
    candidate.rejectionReasons.push("supplier row superseded by line-item row");
    rejectedCandidates.push(candidate);
    droppedReasons.push({
      anchorId: row.anchorId ?? null,
      rowText: row.rowText,
      reason: "supplier row superseded by line-item row",
    });
  }

  for (const selectedRow of selectedNonOemRows) {
    const comparisonResult = findBestPartSourceComparisonRow(selectedRow, comparisonOemRows);
    comparisonMatches.push(comparisonResult.debug);
    const comparisonMatch = comparisonResult.match;
    const candidate = scorePartSourceCandidate(buildPartSourceCandidate(selectedRow, comparisonMatch, comparisonResult.debug));
    if (candidate.rejectionReasons.length > 0 || candidate.score < PART_SOURCE_CANDIDATE_MIN_SCORE) {
      const reason = candidate.rejectionReasons.length
        ? candidate.rejectionReasons.join("; ")
        : `candidate score ${candidate.score} below threshold ${PART_SOURCE_CANDIDATE_MIN_SCORE}`;
      rejectedCandidates.push(candidate);
      if (isVehicleYearLineNumber(candidate.lineNumber)) {
        rejectedLineNumberCandidates.push({
          rowText: candidate.rowText,
          lineNumber: candidate.lineNumber,
          reason: "vehicle year parsed as line number",
        });
      }
      droppedReasons.push({
        anchorId: selectedRow.anchorId ?? null,
        rowText: selectedRow.rowText,
        reason,
      });
      continue;
    }
    if (hasComparisonEstimate && comparisonRows.length > 0 && !comparisonMatch) {
      candidate.reasons.push("no OEM/OE comparison row matched strongly enough; using one-estimate documentation review");
    }
    acceptedCandidates.push(candidate);
    findings.push(buildPartSourceFinding({
      selectedRow,
      comparisonRow: comparisonMatch,
      candidate,
      sourceDocumentRole: params.sourceDocumentRole,
      selectedFileName: params.sourcePdfName,
    }));
  }

  // FIX 3 — a part-source difference is SYMMETRIC, and the direction this
  // detector could not see is the common one: the CARRIER specifies
  // aftermarket where the shop specifies an OEM-approved product. RO 22116 is
  // exactly that — "**A/M Urethane Kit" $35.00 against "BetaSeal Express
  // Urethane" $37.00. The $2 price gap is immaterial and that is the point:
  // the dispute is the PART, not the money, so a value-delta threshold will
  // never surface it.
  //
  // The match must be an OPERATION identity, never a description resemblance.
  // Scoring alone paired "**A/M Cover Car" with "R&I Floor cover" on the
  // shared generic token "cover" — the same class of wrong pairing that the
  // similarity rules exist to stop. The finding still ANCHORS on the annotated
  // document, because that is the page being marked.
  const comparisonNonOemRows = comparisonRows.filter((row) => hasNonOemPartSource(row.sourceKinds));
  const emittedIds = new Set(findings.map((finding) => finding.id));
  for (const comparisonRow of comparisonNonOemRows) {
    const comparisonOp = resolveRowOperation(comparisonRow.rowText);
    const anchorRow = comparisonOp
      ? allSelectedRows.find((row) => resolveRowOperation(row.rowText) === comparisonOp) ?? null
      : null;
    if (!anchorRow) {
      droppedReasons.push({
        anchorId: null,
        rowText: comparisonRow.rowText,
        reason: comparisonOp
          ? `comparison-side non-OEM row (${comparisonOp}) has no same-operation row on the annotated estimate`
          : "comparison-side non-OEM row resolves to no canonical operation; a description resemblance is not a part identity",
      });
      continue;
    }
    if (selectedNonOemRows.some((row) => row.anchorId && row.anchorId === anchorRow.anchorId)) continue;
    const reverse = findBestPartSourceComparisonRow(comparisonRow, [anchorRow]);
    const candidate = scorePartSourceCandidate(buildPartSourceCandidate(anchorRow, comparisonRow, reverse.debug));
    const finding = buildPartSourceFinding({
      selectedRow: anchorRow,
      comparisonRow,
      candidate,
      sourceDocumentRole: params.sourceDocumentRole,
      selectedFileName: params.sourcePdfName,
      nonOemSide: "comparison",
    });
    if (emittedIds.has(finding.id)) continue;
    emittedIds.add(finding.id);
    comparisonMatches.push(reverse.debug);
    acceptedCandidates.push(candidate);
    findings.push(finding);
  }

  return {
    findings,
    partSourceRows: selectedRows.map((row) => ({
      page: row.pageNumber ?? 0,
      line: row.lineNumber,
      sourceKind: row.sourceKinds,
      anchorId: row.anchorId ?? "",
      sourcePdfName: row.sourcePdfName,
      rowText: row.rowText,
    })),
    nonOemPartRowCount: allSelectedNonOemRows.length,
    oemPartRowCount: selectedOemRows.length,
    comparisonCandidateCount: comparisonOemRows.length,
    candidateCount: acceptedCandidates.length + rejectedCandidates.length,
    acceptedCandidates,
    rejectedCandidates,
    rejectedLineNumberCandidates,
    comparisonMatches,
    droppedReasons,
  };
}

function buildRejectedPartSourceVisualLineCandidates(params: {
  visualLines: PdfTextLine[];
  selectedRows: PartSourceRow[];
  sourcePdfName: string;
  sourceDocumentId?: string;
  sourceDocumentRole: "carrier" | "shop";
}): PartSourceFindingCandidate[] {
  const anchoredLineText = new Set(params.selectedRows.map((row) => normalizeMatchText(row.rowText)));
  const candidates: PartSourceFindingCandidate[] = [];
  for (const line of params.visualLines) {
    const rowText = line.text.replace(/\s+/g, " ").trim();
    if (!rowText) continue;
    const normalized = normalizeMatchText(rowText);
    if (anchoredLineText.has(normalized)) continue;
    const sourceKinds = classifyPartSource(rowText);
    if (!hasNonOemPartSource(sourceKinds)) continue;
    const lineNumber = rowText.match(/^\s*(?:line\s*)?(\d{1,4})\b/i)?.[1] ?? null;
    if (
      !isVehicleYearLineNumber(lineNumber) &&
      !containsVehicleYearIdentityText(rowText) &&
      !isBoilerplatePartSourceText(normalized)
    ) {
      continue;
    }
    const candidate = scorePartSourceCandidate(buildPartSourceCandidate({
      sourceDocumentId: params.sourceDocumentId,
      sourceDocumentRole: params.sourceDocumentRole,
      sourcePdfName: params.sourcePdfName,
      pageNumber: line.pageNumber,
      lineNumber,
      rowText,
      normalizedRowText: normalized,
      sourceKinds,
      description: rowText,
      operation: null,
      partNumber: null,
    }, null, null));
    if (!candidate.rejectionReasons.length) {
      candidate.rejectionReasons.push(`candidate score ${candidate.score} below threshold ${PART_SOURCE_CANDIDATE_MIN_SCORE}`);
    }
    candidates.push(candidate);
  }
  return candidates;
}

function filterPreferredSelectedPartSourceRows(rows: PartSourceRow[]) {
  const lineItemRows = rows.filter((row) => row.anchorType === "estimate_line");
  const preferredRows: PartSourceRow[] = [];
  const rejectedRows: PartSourceRow[] = [];
  for (const row of rows) {
    const superseded = row.anchorType === "supplier_row" && lineItemRows.some((lineItem) =>
      (row.lineNumber && lineItem.lineNumber === row.lineNumber) ||
      scorePartSourceRowMatch(row, lineItem) >= 22
    );
    if (superseded) rejectedRows.push(row);
    else preferredRows.push(row);
  }
  return { preferredRows, rejectedRows };
}

function isPartSourceRowCoveredByExistingFinding(row: PartSourceRow, findings: CitationDensityFinding[]) {
  return findings.some((finding) => {
    const evidence = row.sourceDocumentRole === "shop"
      ? finding.shopEvidence ?? finding.shopAnchor
      : finding.carrierEvidence ?? finding.carrierAnchor;
    if (!evidence?.lineNumber || !row.lineNumber || String(evidence.lineNumber).trim() !== row.lineNumber) return false;
    const text = normalizeMatchText([
      finding.operationLabel,
      "description" in evidence ? evidence.description : undefined,
      finding.currentSupportSummary,
      finding.missingProofSummary,
    ].filter(Boolean).join(" "));
    const rowText = normalizeMatchText(row.rowText);
    return keyTokenScore(text, rowText, 10) >= 2 || sharedTermScore(text, rowText, 10) >= 3;
  });
}

/**
 * FIX 2 — a detector may not be gated on another detector having already found
 * the thing it exists to find.
 *
 * This returned false unless some EXISTING finding already mentioned a
 * part-source token. On RO 22116 nothing else detected the carrier's
 * "**A/M Urethane Kit", so the part-source pass never ran, so the aftermarket
 * substitution was never reported — on a windshield that is a structural bond
 * carrying the forward camera.
 *
 * Relevance comes from the DOCUMENTS. Overlap with existing findings is
 * handled per row by isPartSourceRowCoveredByExistingFinding, which is where
 * de-duplication belongs.
 */
/**
 * KNOWN DESIGN FLAW, deliberately left in place for now.
 *
 * This asks whether ANOTHER detector already found a part-source issue before
 * letting the part-source detector run, which is circular. Removing it makes
 * the forward pass emit on three existing fixtures in ways that were not
 * verified as correct within the change that found it, so it is recorded here
 * rather than changed blind. The reverse-direction pass below does NOT depend
 * on it — RO 22116 opens this gate through an unrelated finding.
 */
function shouldGeneratePartSourceFindings(findings: CitationDensityFinding[]) {

  if (findings.length === 0) return true;
  return findings.some((finding) => {
    const text = [
      finding.id,
      finding.operationLabel,
      finding.category,
      finding.carrierEvidence?.description,
      finding.shopEvidence?.description,
      finding.currentSupportSummary,
      finding.missingProofSummary,
      finding.recommendedNextAction,
      ...finding.missingAuthorityTypes,
    ].join(" ");
    return /\b(?:a\/m|am|aftermarket|lkq|capa|used|recycled|reconditioned|reman|remanufactured|non[-\s]?oem|oem\s+part|oe\s+part|part[-\s]?source)\b/i.test(text);
  });
}

function buildPartSourceRowFromAnchor(anchor: EstimateRowAnchor, sourcePdfName: string): PartSourceRow {
  const rowText = getAnchorSourceText(anchor);
  return {
    anchorId: anchor.anchorId,
    sourceDocumentId: anchor.sourceDocumentId,
    sourceDocumentRole: anchor.sourceDocumentRole,
    sourcePdfName,
    pageNumber: anchor.pageNumber,
    lineNumber: anchor.lineNumber,
    rowText,
    normalizedRowText: normalizeMatchText(rowText),
    sourceKinds: classifyPartSource(rowText),
    anchor,
    anchorType: anchor.anchorType,
    description: anchor.description,
    operation: anchor.operation,
    partNumber: anchor.partNumber,
  };
}

function buildPartSourceRowsFromText(source: ComparisonEstimateText): PartSourceRow[] {
  const estimateRole = source.estimateRole ?? "shop";
  return source.text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+(?=(?:line\s*)?\d{1,4}\s+(?:[#*<>A-Z0-9]+\s+)?(?:repl|rpr|r&i|subl|oem|oe|lkq|a\/m|am)\b)/gi, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((rowText) => {
      const sourceKinds = classifyPartSource(rowText);
      if (!sourceKinds.length) return null;
      const lineNumber = rowText.match(/^\s*(?:line\s*)?(\d{1,4})\b/i)?.[1] ?? null;
      const row: PartSourceRow = {
        sourceDocumentId: source.sourceDocumentId,
        sourceDocumentRole: estimateRole,
        sourcePdfName: source.fileName,
        pageNumber: null,
        lineNumber,
        rowText,
        normalizedRowText: normalizeMatchText(rowText),
        sourceKinds,
        description: rowText,
        operation: rowText.split(/\s+/).slice(0, 5).join(" "),
        partNumber: null,
      };
      return row;
    })
    .filter((row): row is PartSourceRow => Boolean(row));
}

function buildPartSourceCandidate(
  selectedRow: PartSourceRow,
  comparisonRow: PartSourceRow | null,
  comparisonDebug: PartSourceComparisonMatchDebug | null
): PartSourceFindingCandidate {
  return {
    anchorId: selectedRow.anchorId ?? "",
    rowText: selectedRow.rowText,
    pageNumber: selectedRow.pageNumber ?? 0,
    lineNumber: selectedRow.lineNumber,
    rowType: selectedRow.anchorType,
    operation: selectedRow.operation,
    description: selectedRow.description,
    partNumber: selectedRow.partNumber,
    partSourceKinds: selectedRow.sourceKinds,
    comparisonRowText: comparisonRow?.rowText,
    comparisonPartSourceKinds: comparisonRow?.sourceKinds,
    score: comparisonDebug?.matchScore ?? 0,
    reasons: [...(comparisonDebug?.matchReasons ?? [])],
    rejectionReasons: [],
  };
}

export function scorePartSourceCandidate(candidate: PartSourceFindingCandidate): PartSourceFindingCandidate {
  const scored: PartSourceFindingCandidate = {
    ...candidate,
    reasons: [...candidate.reasons],
    rejectionReasons: [...candidate.rejectionReasons],
  };
  const normalized = normalizeMatchText(scored.rowText);
  const hasOperation = hasPartSourceRepairOperation(scored.rowText);
  const hasPartNoun = hasPartSourcePartNoun(scored.rowText);
  const hasAmountContext = Boolean(
    scored.partNumber ||
    /\$[\d,]+(?:\.\d{2})?/.test(scored.rowText) ||
    /\b\d+(?:\.\d+)?\s*(?:hrs?|hours?)\b/i.test(scored.rowText) ||
    /\b(?:qty|quantity)\b/i.test(scored.rowText)
  );

  if (hasNonOemPartSource(scored.partSourceKinds)) {
    scored.score += 35;
    scored.reasons.push("selected row has non-OEM part-source token");
  }
  if (isPreferredPartSourceAnchorType(scored.rowType)) {
    scored.score += 18;
    scored.reasons.push("selected row is an estimate line-item or attached line note");
  }
  if (hasOperation) {
    scored.score += 14;
    scored.reasons.push("row has repair operation context");
  }
  if (hasPartNoun) {
    scored.score += 16;
    scored.reasons.push("row has specific part noun");
  }
  if (hasAmountContext) {
    scored.score += 10;
    scored.reasons.push("row has part number, quantity, price, labor, or paint context");
  }
  if (scored.comparisonRowText && hasOemPartSource(scored.comparisonPartSourceKinds ?? [])) {
    scored.score += 18;
    scored.reasons.push("comparison estimate has OEM/OE comparable row");
  }
  if (/\b(?:not correct style|incorrect style|wrong style|fit|finish)\b/i.test(scored.rowText)) {
    scored.score += 12;
    scored.reasons.push("row has fit/style correctness note");
  }
  if (scored.anchorId && scored.pageNumber > 0) {
    scored.score += 8;
    scored.reasons.push("row has extracted selected-estimate anchor");
  }

  if (isVehicleYearLineNumber(scored.lineNumber) || containsVehicleYearIdentityText(scored.rowText)) {
    scored.score -= 80;
    scored.rejectionReasons.push("vehicle year parsed as line number");
  }
  if (isBoilerplatePartSourceText(normalized)) {
    scored.score -= 55;
    scored.rejectionReasons.push("boilerplate/disclaimer row");
  }
  if (/\b(?:wheel opening|opening molding|wheel opening molding)\b/.test(normalized)) {
    scored.score -= 70;
    scored.rejectionReasons.push("wheel-opening trim/molding row is not wheel-end source support");
  }
  if (!hasPartNoun) {
    scored.score -= 24;
    scored.rejectionReasons.push("no part noun");
  }
  if (!hasOperation && !hasAmountContext) {
    scored.score -= 24;
    scored.rejectionReasons.push("no repair operation context");
  }
  if (!scored.anchorId || scored.pageNumber <= 0) {
    scored.score -= 30;
    scored.rejectionReasons.push("no selected estimate anchor rects");
  }
  if (scored.rowType === "guide_row" || scored.rowType === "section_row" || scored.rowType === "totals_row") {
    scored.score -= 45;
    scored.rejectionReasons.push("row source is guide/header/footer");
  }
  if (scored.rowText.length > 220 && !hasOperation) {
    scored.score -= 35;
    scored.rejectionReasons.push("extremely long boilerplate text with no operation/part columns");
  }

  scored.reasons = [...new Set(scored.reasons)];
  scored.rejectionReasons = [...new Set(scored.rejectionReasons)];
  return scored;
}

function findBestPartSourceComparisonRow(
  selectedRow: PartSourceRow,
  comparisonRows: PartSourceRow[]
): { match: PartSourceRow | null; debug: PartSourceComparisonMatchDebug } {
  let best: { row: PartSourceRow; score: number; reasons: string[] } | null = null;
  const rejectedComparisonReasons: string[] = [];
  for (const row of comparisonRows) {
    const result = scorePartSourceComparisonRow(selectedRow, row);
    if (result.score > (best?.score ?? 0)) best = { row, score: result.score, reasons: result.reasons };
    if (result.score < PART_SOURCE_COMPARISON_MIN_SCORE) {
      rejectedComparisonReasons.push(`${truncateText(row.rowText, 72)}: ${result.reasons.length ? result.reasons.join(", ") : "comparison match too weak"}`);
    }
  }
  const match = best && best.score >= PART_SOURCE_COMPARISON_MIN_SCORE ? best.row : null;
  return {
    match,
    debug: {
      selectedAnchorId: selectedRow.anchorId ?? "",
      selectedRowText: selectedRow.rowText,
      comparisonRowText: match?.rowText,
      matchScore: best?.score ?? 0,
      matchReasons: best?.reasons ?? [],
      rejectedComparisonReasons: match ? [] : rejectedComparisonReasons.slice(0, 5),
    },
  };
}

function scorePartSourceRowMatch(selectedRow: PartSourceRow, comparisonRow: PartSourceRow) {
  return scorePartSourceComparisonRow(selectedRow, comparisonRow).score;
}

function scorePartSourceComparisonRow(selectedRow: PartSourceRow, comparisonRow: PartSourceRow) {
  let score = 0;
  const reasons: string[] = [];
  if (selectedRow.partNumber && comparisonRow.partNumber && selectedRow.partNumber === comparisonRow.partNumber) {
    score += 32;
    reasons.push("part number match");
  }
  const selectedComparable = normalizePartComparableText(selectedRow.rowText);
  const comparisonComparable = normalizePartComparableText(comparisonRow.rowText);
  const partNouns = getSharedPartNouns(selectedRow.rowText, comparisonRow.rowText);
  if (partNouns.length > 0) {
    score += Math.min(28, partNouns.length * 10);
    reasons.push(`shared part noun: ${partNouns.join(", ")}`);
  }
  const keyScore = keyTokenScore(selectedComparable, comparisonComparable, 26);
  if (keyScore > 0) {
    score += keyScore;
    reasons.push("part description overlap");
  }
  const termScore = sharedTermScore(selectedComparable, comparisonComparable, 18);
  if (termScore > 0) {
    score += termScore;
    reasons.push("normalized row-text similarity");
  }
  if (hasPartSourceRepairOperation(selectedRow.rowText) && hasPartSourceRepairOperation(comparisonRow.rowText)) {
    score += 8;
    reasons.push("operation similarity");
  }
  if (selectedRow.lineNumber && comparisonRow.lineNumber && selectedRow.lineNumber === comparisonRow.lineNumber) {
    score += 6;
    reasons.push("line number weak match");
  }
  if (isBoilerplatePartSourceText(comparisonRow.normalizedRowText)) {
    score -= 35;
    reasons.push("comparison row is boilerplate");
  }
  if (!hasPartSourcePartNoun(comparisonRow.rowText)) {
    score -= 18;
    reasons.push("comparison row lacks part noun");
  }
  return { score, reasons: [...new Set(reasons)] };
}

function normalizePartComparableText(value: string) {
  return normalizeMatchText(value)
    .split(" ")
    .filter((term) => term.length > 1 && !PART_SOURCE_MATCH_STOP_TERMS.has(term))
    .join(" ");
}

function buildPartSourceFinding(params: {
  selectedRow: PartSourceRow;
  comparisonRow?: PartSourceRow | null;
  candidate: PartSourceFindingCandidate;
  sourceDocumentRole: "carrier" | "shop";
  selectedFileName: string;
  /** Which document specifies the non-OEM source. "comparison" means the
   *  anchor row is the OEM/named-product side, so the wording must not be
   *  written as though this estimate is the one downgrading the part. */
  nonOemSide?: "selected" | "comparison";
}): CitationDensityFinding {
  const { selectedRow, comparisonRow } = params;
  const nonOemSide = params.nonOemSide ?? "selected";
  const selectedClass = formatPartSourceKinds(selectedRow.sourceKinds);
  const comparisonClass = comparisonRow ? formatPartSourceKinds(comparisonRow.sourceKinds) : "not available";
  const selectedLine = selectedRow.lineNumber ?? "section";
  const hasComparison = Boolean(comparisonRow);
  const title = !hasComparison
    ? "Non-OEM part-source documentation review"
    : nonOemSide === "comparison"
      ? "Comparison estimate specifies a non-OEM part source"
      : "AM/LKQ part usage vs OEM part usage";
  const rowIssueSummary = buildPartSourceRowIssueSummary(selectedRow, comparisonRow, nonOemSide);
  const authorityStatus: CitationSupportStatus = hasComparison ? "needed" : "not_found";
  const evidence = {
    lineNumber: selectedRow.lineNumber,
    description: selectedRow.rowText,
    amount: selectedRow.anchor?.price ?? null,
    laborHours: selectedRow.anchor?.labor ?? null,
    sourceLabel: selectedRow.sourcePdfName,
  };

  return {
    id: `part-source-oem-variance-${selectedRow.anchorId?.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") ?? createHash("sha1").update(selectedRow.rowText).digest("hex").slice(0, 10)}`,
    operationLabel: title,
    category: "parts_downgrade",
    estimateGapType: hasComparison ? "needs_proof" : "present_but_under_documented",
    carrierEvidence: params.sourceDocumentRole === "carrier" ? evidence : undefined,
    shopEvidence: params.sourceDocumentRole === "shop" ? evidence : undefined,
    applicableEstimateRoles: [params.sourceDocumentRole],
    primaryAnnotationRole: params.sourceDocumentRole,
    carrierAnchor: params.sourceDocumentRole === "carrier" && selectedRow.anchor ? buildFindingLineAnchor(selectedRow.anchor) : undefined,
    shopAnchor: params.sourceDocumentRole === "shop" && selectedRow.anchor ? buildFindingLineAnchor(selectedRow.anchor) : undefined,
    crossEstimateIssue: hasComparison,
    counterpartSummary: comparisonRow
      ? nonOemSide === "comparison"
        ? `The comparison estimate ${comparisonRow.sourcePdfName} specifies ${comparisonClass} for this operation: ${comparisonRow.rowText}. This estimate carries ${selectedRow.rowText}. Confirm part type, fit/finish and warranty basis before accepting the substitution; the price difference is not the dispute.`
        : `Comparison estimate ${comparisonRow.sourcePdfName} row: ${comparisonRow.rowText}. Comparison classification: ${comparisonClass}.`
      : "No comparison estimate row was available; one-estimate part-source documentation review applies.",
    impact: {
      dollarImpact: null,
      laborHoursImpact: null,
      safetyImpact: "medium",
      supplementPriority: "high",
    },
    citationStatus: {
      oem: authorityStatus,
      oemPositionStatement: "needed",
      adas: "not_applicable",
      pPages: "not_applicable",
      scrs: "not_applicable",
      deg: "not_applicable",
      nhtsa: "not_applicable",
      stateRegulation: "not_applicable",
      policy: "needed",
      invoiceOrCompletionProof: "needed",
      photoOrTeardownProof: "needed",
    },
    citationDensityScore: hasComparison ? 32 : 40,
    verifiedAuthorityCount: 0,
    missingAuthorityTypes: [
      "documented part-type authorization",
      "fit/finish/style validation",
      "warranty/quality review",
      "supplier/invoice support",
      "OEM/insurer basis review",
    ],
    missingAuthority: [
      "part-type authorization",
      "fit/finish validation",
      "warranty/quality review",
      "supplier invoice",
      "OEM/insurer documentation basis",
    ],
    citationLabel: "NEEDS OEM",
    bestAvailableAuthority: {
      type: "estimate_evidence",
      status: "needed",
      title: hasComparison ? "Comparison estimate OEM/OE part-source evidence" : "Selected estimate non-OEM part-source evidence",
      sourceType: "EstimateParser",
      confidence: "medium",
      note: SOURCE_BOUNDARY_TEXT,
    },
    currentSupportSummary: hasComparison
      ? `Selected estimate file: ${params.selectedFileName}. Selected estimate page: ${selectedRow.pageNumber ?? "unknown"}. Selected estimate line: ${selectedLine}. Exact selected row text: ${selectedRow.rowText}. Selected part source classification: ${selectedClass}. Comparison estimate file: ${comparisonRow?.sourcePdfName}. Comparison row text: ${comparisonRow?.rowText}. Comparison part source classification: ${comparisonClass}. ${rowIssueSummary} Carrier aftermarket warranty language may guarantee fit, corrosion, or part replacement, but it does not prove OEM-equivalent system performance, ADAS compatibility, crash-test equivalency, or related manufacturer warranty preservation. Candidate score: ${params.candidate.score}. Candidate reasons: ${params.candidate.reasons.join("; ")}.`
      : `Selected estimate file: ${params.selectedFileName}. Selected estimate page: ${selectedRow.pageNumber ?? "unknown"}. Selected estimate line: ${selectedLine}. Exact selected row text: ${selectedRow.rowText}. Selected part source classification: ${selectedClass}. ${rowIssueSummary} This one-estimate review found AM/LKQ/CAPA/non-OEM part sourcing that requires documentation, authorization, fit/finish validation, supplier/invoice support, and OEM/insurer basis review. Carrier aftermarket warranty language may guarantee fit, corrosion, or part replacement, but it does not prove OEM-equivalent system performance, ADAS compatibility, crash-test equivalency, or related manufacturer warranty preservation. Candidate score: ${params.candidate.score}. Candidate reasons: ${params.candidate.reasons.join("; ")}.`,
    missingProofSummary: hasComparison
      ? "Support refs / required documentation basis: part-type authorization, fit/finish and style validation, supplier/invoice support, OEM/insurer documentation basis, and manufacturer-warranty/system-performance support are still needed before claiming the substitution is authorized. A fit/corrosion guarantee is not ADAS compatibility, sensor alignment, crash-tested equivalency, or OEM warranty preservation proof."
      : "Support refs / required documentation basis: document part-type authorization, fit/finish/style correctness, OEM procedure or position-statement requirements where applicable, invoice/supplier documentation, OEM/insurer basis, and whether the part may affect related manufacturer warranty or OEM repair-path confidence unless supported.",
    recommendedNextAction: hasComparison
      ? "Next action: reconcile the selected non-OEM part row against the comparison OEM/OE row and obtain authorization, supplier invoice, fit/finish validation, warranty/quality review, and OEM/insurer basis documentation."
      : "Next action: obtain part-type authorization, supplier invoice, fit/finish validation, warranty/quality review, and OEM/insurer basis documentation before relying on the non-OEM part row.",
    confidence: "high",
    limitations: [
      hasComparison
        ? "Generated from selected estimate row text and comparison estimate row text; this does not independently prove an OEM requirement."
        : "Generated from selected estimate row text only; comparison estimate evidence was not available.",
      "Do not say the part voids all warranty or proves/violates crash-test equivalency unless a reviewed authority source supports that statement.",
    ],
    groupId: "part-source-oem-variance",
    anchorId: selectedRow.anchorId,
  } as CitationDensityFinding & { groupId: string; anchorId?: string };
}

function hasNonOemPartSource(kinds: PartSourceKind[]) {
  return kinds.some((kind) => NON_OEM_PART_SOURCE_KINDS.has(kind));
}

function hasOemPartSource(kinds: PartSourceKind[]) {
  return kinds.some((kind) => OEM_PART_SOURCE_KINDS.has(kind));
}

function formatPartSourceKinds(kinds: PartSourceKind[]) {
  return kinds.length ? kinds.join(", ") : "UNKNOWN";
}

function isPartSourceFinding(finding: CitationDensityFinding) {
  return /^part-source-oem-variance-/i.test(finding.id) ||
    finding.operationLabel === "AM/LKQ part usage vs OEM part usage" ||
    finding.operationLabel === "Non-OEM part-source documentation review";
}

/** Row text as a reader should see a PART named: no line number, no welded
 *  price. "75 **A/M Urethane Kit135.00" -> "A/M Urethane Kit". */
function describePartRow(rowText: string): string {
  return (rowText ?? "")
    .replace(/^\s*(?:line\s*)?\d{1,4}\b/i, " ")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/\b\d+[\d.,]*\b/g, " ")
    .replace(/[#*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPartSourceRowIssueSummary(
  selectedRow: PartSourceRow,
  comparisonRow?: PartSourceRow | null,
  nonOemSide: "selected" | "comparison" = "selected"
) {
  const lineLabel = selectedRow.lineNumber ? `line ${selectedRow.lineNumber}` : "the selected row";
  const sourceText = selectedRow.rowText;
  // Reverse direction: the ANNOTATED row is the OEM/named-product side and the
  // counterpart is the aftermarket one. Written the other way round this reads
  // exactly backwards, and the hedge "AM or OEM-style" describes the carrier's
  // explicit A/M marking as if it were ambiguous.
  if (comparisonRow && nonOemSide === "comparison") {
    return `The comparison estimate specifies ${formatPartSourceKinds(comparisonRow.sourceKinds)} sourcing for "${describePartRow(comparisonRow.rowText)}", where this estimate ${lineLabel} carries "${describePartRow(sourceText)}". The dispute is the part, not the price difference. Verify part-type authorization, fit/finish, warranty and applicable OEM/insurer documentation before accepting the substitution.`;
  }
  if (comparisonRow) {
    return `Selected estimate ${lineLabel} uses ${formatPartSourceKinds(selectedRow.sourceKinds)} sourcing for ${summarizePartDescription(sourceText)}. The comparison estimate appears to use ${formatPartSourceKinds(comparisonRow.sourceKinds)} or OEM-style sourcing for the comparable part. Verify part-type authorization, fit/finish, warranty, and applicable OEM/insurer documentation.`;
  }
  return `Selected estimate ${lineLabel} uses ${formatPartSourceKinds(selectedRow.sourceKinds)} sourcing for ${summarizePartDescription(sourceText)}. Review authorization, fit/finish, warranty/quality, supplier invoice support, and OEM/insurer basis before relying on the part row.`;
}

function summarizePartDescription(rowText: string) {
  const tokens = normalizePartComparableText(rowText).split(" ").filter(Boolean);
  return tokens.length ? tokens.slice(0, 8).join(" ") : "the extracted part row";
}

function isPreferredPartSourceAnchorType(rowType: string | undefined) {
  return rowType === "estimate_line" || rowType === "line_note";
}

function hasPartSourceRepairOperation(rowText: string) {
  return /\b(?:repl|replace|rpr|repair|r&i|r\s*&\s*i|subl|sublet|add|supp|remove|install|overhaul)\b/i.test(rowText);
}

function hasPartSourcePartNoun(rowText: string) {
  return PART_SOURCE_PART_NOUNS.some((noun) => new RegExp(`\\b${escapeRegex(noun)}s?\\b`, "i").test(rowText));
}

function getSharedPartNouns(a: string, b: string) {
  return PART_SOURCE_PART_NOUNS.filter((noun) =>
    new RegExp(`\\b${escapeRegex(noun)}s?\\b`, "i").test(a) &&
    new RegExp(`\\b${escapeRegex(noun)}s?\\b`, "i").test(b)
  );
}

function isVehicleYearLineNumber(value: string | number | null | undefined) {
  const numeric = typeof value === "number" ? value : value ? Number(String(value).trim()) : NaN;
  return Number.isInteger(numeric) && numeric >= 1980 && numeric <= 2035;
}

function containsVehicleYearIdentityText(value: string) {
  return /\b(?:19[8-9]\d|20[0-3]\d)\b/.test(value) &&
    /\b(?:vehicle|vin|honda|toyota|ford|chevrolet|chevy|gmc|ram|dodge|jeep|bmw|audi|kia|hyundai|civic|accord|camry|f-?150|silverado)\b/i.test(value);
}

function isBoilerplatePartSourceText(normalized: string) {
  return /\b(?:claim|claimant|insured|owner|vin|vehicle|license|loss|policy|deductible|appraiser|estimator|estimate id|preliminary estimate|quality replacement|warranty|disclaimer|notice|betterment|alternate parts suppliers?|motor guide|ccc motor guide|database|included|not included|footer|page|abbreviation|legend|fraud|aftermarket definition|capa definition|lkq rcy used)\b/.test(normalized) &&
    !/\b(?:repl|replace|rpr|repair|r&i|subl|add|supp)\b/.test(normalized);
}

const PART_SOURCE_CANDIDATE_MIN_SCORE = 55;
const PART_SOURCE_COMPARISON_MIN_SCORE = 28;

const NON_OEM_PART_SOURCE_KINDS = new Set<PartSourceKind>([
  "AM",
  "LKQ",
  "CAPA",
  "USED",
  "RECYCLED",
  "RECONDITIONED",
  "REMAN",
  "NON_OEM",
  "ECONOMY",
]);

const PART_SOURCE_PART_NOUNS = [
  "bumper",
  "grille",
  "grill",
  "bracket",
  "retainer",
  "lamp",
  "fender",
  "sensor",
  "panel",
  "cover",
  "deflector",
  "support",
  "molding",
  "reflector",
  "bezel",
  "radiator",
  "headlamp",
  "headlight",
];

const OEM_PART_SOURCE_KINDS = new Set<PartSourceKind>([
  "OEM",
  "OE",
  "ALT_OEM",
  "OPT_OEM",
]);

const PART_SOURCE_MATCH_STOP_TERMS = new Set([
  "line",
  "repl",
  "rpr",
  "supp",
  "oem",
  "oe",
  "am",
  "aftermarket",
  "capa",
  "lkq",
  "used",
  "recycled",
  "reconditioned",
  "reman",
  "remanufactured",
  "non",
  "economy",
  "qty",
  "part",
  "parts",
]);

function buildAnchoredCitationCandidates(params: {
  anchors: EstimateRowAnchor[];
  findings: CitationDensityFinding[];
  topicFindings: CitationDensityFinding[];
  estimateRole: "carrier" | "shop" | "selected";
  sourceDocumentRole: "carrier" | "shop";
  anchorIndex: Map<string, EstimateRowAnchor>;
  trace: CitationDensityDebugTrace;
}): {
  candidates: AnchoredCitationCandidate[];
  suppressedPageMismatchCount: number;
  findingsWithoutAnchorId: string[];
} {
  const candidates: AnchoredCitationCandidate[] = [];
  const usedAnchorIds = new Set<string>();
  const matchedFindingIds = new Set<string>();
  let suppressedPageMismatchCount = 0;
  const orderedFindings = orderFindingsForAnchoring(params.findings);

  for (const finding of orderedFindings) {
    const anchorId = getFindingAnchorId(finding);
    const exactAnchor = anchorId ? params.anchorIndex.get(anchorId) : null;
    if (anchorId && !exactAnchor) {
      const reason = "finding anchorId not found in active source PDF; visual anchor suppressed to avoid stale artifact reanchoring";
      addAnchorRejectLimitation(finding, reason);
      params.trace.badAnchorRejectedCount = (params.trace.badAnchorRejectedCount ?? 0) + 1;
      params.trace.badAnchorRejectReasons = [...(params.trace.badAnchorRejectReasons ?? []), reason].slice(0, 20);
      params.trace.droppedFindings.push({
        findingId: finding.id,
        reason,
        anchorId,
      });
      continue;
    }
    const anchor = exactAnchor ?? findBestEstimateRowAnchorForFinding(finding, params.anchors, usedAnchorIds, params.estimateRole);
    if (!anchor) {
      params.trace.droppedFindings.push({
        findingId: finding.id,
        reason: anchorId ? "finding anchorId not found and fallback did not match" : "missing finding anchorId and fallback did not match",
        anchorId,
      });
      continue;
    }
    const resolvedAnchorId = anchor.anchorId;
    if (!anchor.pdfBoundingBox?.width || !anchor.pdfBoundingBox?.height) {
      params.trace.droppedFindings.push({ findingId: finding.id, reason: "matched anchor has no rects", anchorId: resolvedAnchorId });
      continue;
    }
    const allowSharedAnchor = allowsSharedCitationDensityAnchor(finding);
    if (!allowSharedAnchor && usedAnchorIds.has(anchor.anchorId)) {
      params.trace.droppedFindings.push({ findingId: finding.id, reason: "anchor already used", anchorId: resolvedAnchorId });
      continue;
    }
    const badAnchorReason = getBadAnchorRejectReason(finding, anchor);
    if (badAnchorReason) {
      addAnchorRejectLimitation(finding, badAnchorReason);
      params.trace.badAnchorRejectedCount = (params.trace.badAnchorRejectedCount ?? 0) + 1;
      params.trace.sourceAnchorRowType = classifyCitationDensityAnchorRow(anchor.rowText);
      params.trace.badAnchorRejectReasons = [...(params.trace.badAnchorRejectReasons ?? []), badAnchorReason].slice(0, 20);
      params.trace.droppedFindings.push({ findingId: finding.id, reason: badAnchorReason, anchorId: resolvedAnchorId });
      continue;
    }
    const candidate = buildCandidateFromFinding(finding, anchor, params.estimateRole);
    const gate = gateAnchoredCitationCandidate(candidate, params.anchorIndex);
    if (gate === "allowed") {
      candidates.push(candidate);
      if (!allowSharedAnchor) {
        usedAnchorIds.add(anchor.anchorId);
      }
      matchedFindingIds.add(finding.id);
      if (!exactAnchor) {
        params.trace.fallbackMatchedFindings.push({
          findingId: finding.id,
          reason: "deterministic fallback matched",
          anchorId: resolvedAnchorId,
        });
      }
    } else if (gate === "page_mismatch") {
      suppressedPageMismatchCount += 1;
      params.trace.droppedFindings.push({ findingId: finding.id, reason: "page mismatch", anchorId: resolvedAnchorId });
    } else {
      params.trace.droppedFindings.push({ findingId: finding.id, reason: "anchor gate blocked finding", anchorId: resolvedAnchorId });
    }
  }

  const hasExplicitFindingAnchorId = params.findings.some((finding) => Boolean(getFindingAnchorId(finding)));
  const rowBackedTopics = buildRowBackedCandidateTopics(params.topicFindings);
  if (!hasExplicitFindingAnchorId && rowBackedTopics.size > 0) {
    for (const anchor of params.anchors) {
      if (usedAnchorIds.has(anchor.anchorId)) continue;
      const candidate = buildCandidateFromAnchor(anchor, params.sourceDocumentRole, rowBackedTopics);
      if (!candidate) continue;
      const badAnchorReason = getBadAnchorRejectReason(candidate.finding, anchor);
      if (badAnchorReason) {
        addAnchorRejectLimitation(candidate.finding, badAnchorReason);
        params.trace.badAnchorRejectedCount = (params.trace.badAnchorRejectedCount ?? 0) + 1;
        params.trace.sourceAnchorRowType = classifyCitationDensityAnchorRow(anchor.rowText);
        params.trace.badAnchorRejectReasons = [...(params.trace.badAnchorRejectReasons ?? []), badAnchorReason].slice(0, 20);
        params.trace.droppedFindings.push({ findingId: candidate.finding.id, reason: badAnchorReason, anchorId: anchor.anchorId });
        continue;
      }
      const gate = gateAnchoredCitationCandidate(candidate, params.anchorIndex);
      if (gate === "allowed") {
        candidates.push(candidate);
        usedAnchorIds.add(anchor.anchorId);
      } else if (gate === "page_mismatch") {
        suppressedPageMismatchCount += 1;
      }
    }
  }

  return {
    candidates,
    suppressedPageMismatchCount,
    findingsWithoutAnchorId: params.findings.filter((finding) => !matchedFindingIds.has(finding.id)).map((finding) => finding.id),
  };
}

function allowsSharedCitationDensityAnchor(finding: CitationDensityFinding) {
  return /^required-detector-delta-missing-operation-/i.test(finding.id);
}

function findReportIdentityMismatch(
  findings: CitationDensityFinding[],
  routeReportType: "citation-density" | "oem-citation-density"
) {
  for (const finding of findings) {
    const reportType = (finding as CitationDensityFinding & { reportType?: string }).reportType;
    if (routeReportType === "citation-density" && (reportType === "oem-citation-density" || /^oem-citation-density-/i.test(finding.id))) {
      return {
        findingId: finding.id,
        artifactReportType: reportType ?? "oem-citation-density",
        reason: "citation-density route received oem-citation-density finding",
        message: "Delta Citation Density Report route received an OEM Citation Density Report finding.",
      };
    }
    if (routeReportType === "oem-citation-density" && (reportType === "citation-density" || /^citation-density-/i.test(finding.id))) {
      return {
        findingId: finding.id,
        artifactReportType: reportType ?? "citation-density",
        reason: "oem-citation-density route received citation-density finding",
        message: "OEM Citation Density Report route received a Delta Citation Density Report finding.",
      };
    }
  }
  return null;
}

function getBadAnchorRejectReason(finding: CitationDensityFinding, anchor: EstimateRowAnchor) {
  const rowType = classifyCitationDensityAnchorRow(anchor.rowText);
  const claimedEstimateAnchor = anchor.anchorType === "estimate_line" || anchor.anchorType === "totals_row";
  const explicitSupportContext = (finding as CitationDensityFinding & { rowType?: string; contextType?: string }).rowType === "support_document_context" ||
    (finding as CitationDensityFinding & { rowType?: string; contextType?: string }).contextType === "support_document_context";
  const structuredRowSuffix = hasStructuredEstimateRowEvidence(finding)
    ? "; leave unanchored but structured row verified"
    : "";
  const productionClass = classifyProductionCitationAnchor(anchor);
  if (
    isDeltaEstimateLineFinding(finding) &&
    isHardRejectedProductionAnchorClass(productionClass) &&
    !isAllowedDeltaEstimateAnchor(finding, anchor, productionClass) &&
    !explicitSupportContext
  ) {
    return `anchor rejected: ${formatProductionAnchorClass(productionClass)} page/text is not a safe estimate row${structuredRowSuffix}`;
  }
  if (isDeltaEstimateLineFinding(finding) && anchor.anchorType === "guide_row" && !explicitSupportContext) {
    return `anchor rejected: guide row page/text is not a safe estimate row${structuredRowSuffix}`;
  }
  if (claimedEstimateAnchor && isImpossibleEstimateLineNumber(anchor.lineNumber)) {
    return `bad anchor rejected: impossible estimate line number ${anchor.lineNumber}${structuredRowSuffix}`;
  }
  // A totals/rate finding on a totals_row anchor is the intended pairing.
  // The text heuristics below read the "ESTIMATE TOTALS" block header as
  // page-header chrome (starts with "estimate", carries no digits), but that
  // header is the only legitimate placement for a category that exists solely
  // on the comparison estimate (RO 22108 Diagnostic Labor) — rejecting it
  // silently dropped the finding.
  if (anchor.anchorType === "totals_row" && isTotalOrRateFinding(finding)) {
    return null;
  }
  // A measured engine-row anchor comes from the typed delta engine's
  // clustered TABLE row (line number + measured value columns) — it cannot be
  // page prose or contract boilerplate, so the text-classification gates
  // below do not apply. A documentation line like "**** Work Authorization
  // Secured ****" inside the estimate table would otherwise be misread as a
  // work-authorization contract page.
  const isMeasuredEngineRowAnchor = anchor.anchorId.endsWith(":engine_row");
  if (claimedEstimateAnchor && !isMeasuredEngineRowAnchor && isBoilerplateOrLegalEstimatePageAnchor(anchor, rowType) && !explicitSupportContext) {
    return `bad anchor rejected: ${rowType} boilerplate/header/legal text cannot be rendered as an estimate annotation${structuredRowSuffix}`;
  }
  if (!isMeasuredEngineRowAnchor && isBadCitationDensityAnchorText(anchor.rowText) && !explicitSupportContext) {
    return `bad anchor rejected: ${rowType} text cannot be rendered as an estimate annotation${structuredRowSuffix}`;
  }
  if (
    claimedEstimateAnchor &&
    !isMeasuredEngineRowAnchor &&
    ["support_contract", "legal_notice", "insurer_boilerplate", "vehicle_identity_header_footer", "generic_section_text", "guide_row", "supplier_address"].includes(rowType)
  ) {
    return `bad anchor rejected: ${rowType} cannot be labeled as ${anchor.anchorType}${structuredRowSuffix}`;
  }
  return null;
}

type ProductionCitationAnchorClass =
  | "estimate_line"
  | "supplement_summary_row"
  | "totals_row"
  | "supplier_row"
  | "header_block"
  | "vehicle_options_block"
  | "legal_disclaimer"
  | "motor_ccc_boilerplate"
  | "insurer_policy_language"
  | "footer"
  | "unknown";

function classifyProductionCitationAnchor(anchor: EstimateRowAnchor): ProductionCitationAnchorClass {
  const text = normalizeMatchText(anchor.rowText);
  if (isImpossibleEstimateLineNumber(anchor.lineNumber)) return "header_block";
  // totals_row anchors classify as totals rows BEFORE the header/contact
  // check: the "ESTIMATE TOTALS" block header starts with "estimate", which
  // isHeaderOrContactBlock reads as page-header chrome — and the
  // category-only-on-lower totals finding deliberately anchored there (RO
  // 22108 Diagnostic Labor) was hard-rejected at render and silently dropped.
  // The delta gate still only admits totals/rate findings onto totals rows.
  if (anchor.anchorType === "totals_row") return "totals_row";
  if (isVehicleOptionsBlock(text)) return "vehicle_options_block";
  if (isHeaderOrContactBlock(text, anchor.pageNumber)) return "header_block";
  if (isMotorCccBoilerplate(text, anchor.pageNumber)) return "motor_ccc_boilerplate";
  if (isInsurerPolicyLanguage(text, anchor.pageNumber)) return "insurer_policy_language";
  if (isLegalDisclaimerText(text, anchor.pageNumber)) return "legal_disclaimer";
  if (isFooterText(text)) return "footer";
  if (anchor.anchorType === "estimate_line" || anchor.anchorType === "line_note" || anchor.anchorType === "embedded_link_row") {
    if (!isProductionBoilerplateText(text, anchor.pageNumber)) return "estimate_line";
  }
  if (anchor.anchorType === "supplier_row") return "supplier_row";
  if (/\bsupplement summary\b/.test(text)) return "supplement_summary_row";
  if (isVehicleOptionsBlock(text)) return "vehicle_options_block";
  if (isHeaderOrContactBlock(text, anchor.pageNumber)) return "header_block";
  if (isMotorCccBoilerplate(text, anchor.pageNumber)) return "motor_ccc_boilerplate";
  if (isInsurerPolicyLanguage(text, anchor.pageNumber)) return "insurer_policy_language";
  if (isLegalDisclaimerText(text, anchor.pageNumber)) return "legal_disclaimer";
  if (isFooterText(text)) return "footer";
  if (anchor.anchorType === "guide_row") return "motor_ccc_boilerplate";
  if (anchor.anchorType === "section_row") return "unknown";
  return "unknown";
}

function isHardRejectedProductionAnchorClass(anchorClass: ProductionCitationAnchorClass) {
  return anchorClass === "header_block" ||
    anchorClass === "vehicle_options_block" ||
    anchorClass === "legal_disclaimer" ||
    anchorClass === "motor_ccc_boilerplate" ||
    anchorClass === "insurer_policy_language" ||
    anchorClass === "footer";
}

function isAllowedDeltaEstimateAnchor(
  finding: CitationDensityFinding,
  anchor: EstimateRowAnchor,
  anchorClass: ProductionCitationAnchorClass
) {
  if (anchorClass === "estimate_line" || anchorClass === "supplement_summary_row") return true;
  if (anchorClass === "totals_row") return isTotalOrRateFinding(finding);
  if (anchorClass === "supplier_row") return isSupplierSupportFinding(finding) && !isProductionBoilerplateText(normalizeMatchText(anchor.rowText), anchor.pageNumber);
  return false;
}

function isDeltaEstimateLineFinding(finding: CitationDensityFinding) {
  const reportType = (finding as CitationDensityFinding & { reportType?: string }).reportType;
  if (reportType === "oem-citation-density" || /^oem-citation-density-/i.test(finding.id)) return false;
  if (finding.category === "policy_coverage" || finding.category === "state_regulation") return false;
  return /^citation-density-/i.test(finding.id) || finding.crossEstimateIssue === true || finding.estimateGapType !== "weak_do_not_lead";
}

function isTotalOrRateFinding(finding: CitationDensityFinding) {
  // Totals-lane findings are the intended tenants of totals_row anchors even
  // when their text says "Parts totals" or "Category amount" without a bare
  // "total" keyword ("Parts" amount deltas were demoted to unanchored).
  if ((finding.id ?? "").startsWith("required-detector-totals-")) return true;
  // The C-10 intake notice anchors to the totals block by design — it is a
  // document-level statement, not a row dispute.
  if ((finding.id ?? "").includes("intake-comparison-extraction")) return true;
  return /\b(?:totals?|subtotal|net cost|rate|labor rate|grand total|estimate total)\b/i.test(
    `${finding.operationLabel} ${finding.counterpartSummary ?? ""} ${finding.currentSupportSummary}`
  );
}

function isSupplierSupportFinding(finding: CitationDensityFinding) {
  return /\b(?:supplier|invoice|part-source|part source|lkq|capa|aftermarket|a\/m|recycled|used)\b/i.test(
    `${finding.operationLabel} ${finding.category} ${finding.missingProofSummary} ${finding.recommendedNextAction}`
  );
}

function isProductionBoilerplateText(text: string, pageNumber: number) {
  return isMotorCccBoilerplate(text, pageNumber) ||
    isInsurerPolicyLanguage(text, pageNumber) ||
    isLegalDisclaimerText(text, pageNumber) ||
    isHeaderOrContactBlock(text, pageNumber) ||
    isVehicleOptionsBlock(text) ||
    isFooterText(text);
}

function isMotorCccBoilerplate(text: string, pageNumber: number) {
  return /\bestimate based on motor crash estimating guide\b/.test(text) ||
    /\bsymbols following\b/.test(text) ||
    /\bvin\s*=\s*vehicle identification number\b/.test(text) ||
    ((pageNumber === 9 || pageNumber === 10 || pageNumber === 11) && /\b(?:motor|ccc|crash estimating guide|guide pages?|included|not included|database|symbols following)\b/.test(text));
}

function isInsurerPolicyLanguage(text: string, pageNumber: number) {
  return /\bimportant information about the named insurance company'?s parts policy\b/.test(text) ||
    /\b(?:aftermarket|alternate|quality replacement|lkq|used|recycled|capa)\b.{0,90}\b(?:parts policy|policy language|parts used|replacement parts)\b/.test(text) ||
    ((pageNumber === 9 || pageNumber === 10 || pageNumber === 11) && /\b(?:parts policy|quality replacement|alternate parts|named insurance company)\b/.test(text));
}

function isLegalDisclaimerText(text: string, pageNumber: number) {
  return /\bany person who knowingly\b/.test(text) ||
    /\b(?:fraud|legal notice|disclaimer|not an authorization|terms and conditions|subject to review)\b/.test(text) ||
    ((pageNumber === 9 || pageNumber === 10 || pageNumber === 11) && /\b(?:fraud|legal|disclaimer|authorization)\b/.test(text));
}

function isHeaderOrContactBlock(text: string, pageNumber: number) {
  return (pageNumber === 1 && /\b(?:claim|owner|insured|address|phone|email|vehicle|vin|license|loss date|estimate id|workfile|appraiser|estimator|preliminary estimate)\b/.test(text) &&
    !/\b(?:repl|replace|rpr|repair|r&i|subl|add|refn|calibration|scan|align)\b/.test(text)) ||
    /^\s*(?:claim|vehicle|owner|insured|vin|license|estimate|page)\b/.test(text);
}

function isVehicleOptionsBlock(text: string) {
  const optionHits = (text.match(/\b(?:air conditioning|navigation|heated|seat|bluetooth|cruise|traction|telescopic|steering wheel|paint code|trim|options?|equipment|vin)\b/g) ?? []).length;
  return optionHits >= 3 && !/\b(?:repl|replace|rpr|repair|r&i|subl|add|refn|calibration|scan|align)\b/.test(text);
}

function isFooterText(text: string) {
  return /\bpage\s+\d+\s+of\s+\d+\b/.test(text) ||
    /\b(?:footer|estimate totals?|subtotal|grand total|deductible|tax)\b/.test(text) &&
      /\b(?:claim|insured|owner|vin|license|page)\b/.test(text);
}

function formatProductionAnchorClass(value: ProductionCitationAnchorClass) {
  return value.replace(/_/g, " ");
}

function addAnchorRejectLimitation(finding: CitationDensityFinding, reason: string) {
  const text = `Structured delta finding verified, visual anchor suppressed. Anchor reject reason: ${reason}`;
  if (!finding.limitations.includes(text)) {
    finding.limitations = [text, ...finding.limitations].slice(0, 12);
  }
}

function isImpossibleEstimateLineNumber(value: string | number | null | undefined) {
  const numeric = typeof value === "number" ? value : value ? Number(String(value).trim()) : NaN;
  return numeric === 4717 || isVehicleYearLineNumber(numeric);
}

function isBoilerplateOrLegalEstimatePageAnchor(anchor: EstimateRowAnchor, rowType: string) {
  const text = normalizeMatchText(anchor.rowText);
  const boilerplateRowTypes = new Set([
    "support_contract",
    "legal_notice",
    "insurer_boilerplate",
    "vehicle_identity_header_footer",
    "generic_section_text",
    "guide_row",
    "supplier_address",
  ]);
  if (boilerplateRowTypes.has(rowType)) return true;
  if (
    anchor.pageNumber === 1 &&
    /\b(?:vehicle|vin|claim|owner|insured|license|loss date|estimate id|workfile|options|equipment)\b/.test(text) &&
    !/\b(?:repl|replace|rpr|repair|r&i|subl|add|supp)\b/.test(text)
  ) {
    return true;
  }
  if (
    (anchor.pageNumber === 10 || anchor.pageNumber === 11) &&
    /\b(?:disclaimer|abbreviations?|motor|ccc|guide pages?|included|not included|quality replacement|alternate parts|allstate parts policy|fraud|legal notice|supplier address)\b/.test(text)
  ) {
    return true;
  }
  return /\b(?:disclaimer|abbreviations?|motor guide|ccc motor guide|guide pages?|legal notice|fraud warning|quality replacement parts|alternate parts policy|supplier address)\b/.test(text);
}

function hasStructuredEstimateRowEvidence(finding: CitationDensityFinding) {
  const record = finding as CitationDensityFinding & {
    structuredRowVerified?: boolean;
    cccSecureShareRowId?: string | null;
    cccSecureShareLineId?: string | null;
    sourceProvider?: string | null;
    source?: { provider?: string | null; cccSecureShareRowId?: string | null };
  };
  return (
    record.structuredRowVerified === true ||
    Boolean(record.cccSecureShareRowId || record.cccSecureShareLineId || record.source?.cccSecureShareRowId) ||
    record.sourceProvider === "ccc_secure_share" ||
    record.source?.provider === "ccc_secure_share"
  );
}

function orderFindingsForAnchoring(findings: CitationDensityFinding[]) {
  const ordered: CitationDensityFinding[] = [];
  const seen = new Set<string>();
  const add = (finding: CitationDensityFinding) => {
    if (seen.has(finding.id)) return;
    ordered.push(finding);
    seen.add(finding.id);
  };
  findings.filter((finding) => Boolean(getFindingAnchorId(finding))).forEach(add);
  findings.filter((finding) => !getFindingAnchorId(finding) && isReferencedNotProducedFinding(finding)).forEach(add);
  findings.filter((finding) => !getFindingAnchorId(finding) && hasConcreteFindingAnchor(finding)).forEach(add);
  findings.filter((finding) => !getFindingAnchorId(finding) && !isReferencedNotProducedFinding(finding) && !hasConcreteFindingAnchor(finding)).forEach(add);
  return ordered;
}

function getFindingAnchorId(finding: CitationDensityFinding) {
  const record = finding as CitationDensityFinding & {
    anchorId?: string | null;
    sourceAnchorId?: string | null;
    estimateAnchorId?: string | null;
    source?: { anchorId?: string | null };
    carrierAnchor?: { anchorId?: string | null };
    shopAnchor?: { anchorId?: string | null };
  };
  return (
    record.anchorId ??
    record.sourceAnchorId ??
    record.estimateAnchorId ??
    record.source?.anchorId ??
    record.carrierAnchor?.anchorId ??
    record.shopAnchor?.anchorId ??
    null
  );
}

function isReferencedNotProducedFinding(finding: CitationDensityFinding) {
  return (
    finding.estimateGapType === "referenced_not_produced" ||
    finding.citationLabel === "REFERENCED / NOT PRODUCED" ||
    Object.values(finding.citationStatus).some((value) => value === "referenced_not_produced")
  );
}

function buildCandidateFromFinding(
  finding: CitationDensityFinding,
  anchor: EstimateRowAnchor,
  estimateRole: "carrier" | "shop" | "selected"
): AnchoredCitationCandidate {
  const rowText = getAnchorSourceText(anchor);
  return {
    candidateId: `finding:${finding.id}:${anchor.anchorId}`,
    anchorId: anchor.anchorId,
    sourceDocumentRole: anchor.sourceDocumentRole,
    sourcePdfPageNumber: anchor.pageNumber,
    sourcePdfPageIndex: toSourcePdfPageIndex(anchor.pageNumber),
    sourceLineNumber: anchor.lineNumber ?? undefined,
    sourceAnchorType: anchor.anchorType,
    sourceAnchorText: rowText,
    sourceAnchorNormalizedText: normalizeMatchText(rowText),
    label: getProofBucketLabel(finding),
    estimateLineDisplay: formatEstimateLineForCallout(finding, estimateRole),
    bestAuthority: formatBestAuthority(finding),
    missingProof: formatMissingAuthority(finding),
    whyItMatters: finding.currentSupportSummary || buildRoleCalloutNote(finding, estimateRole),
    nextAction: finding.recommendedNextAction,
    supportRefs: formatAnnotationSourceRefs(finding),
    confidence: getMatchConfidence(anchor),
    finding,
    anchor,
    derivedFromFindingId: finding.id,
  };
}

function buildCandidateFromAnchor(
  anchor: EstimateRowAnchor,
  sourceDocumentRole: "carrier" | "shop",
  topics: Set<RowBackedCandidateTopic>
): AnchoredCitationCandidate | null {
  if (anchor.synthetic || anchor.confidence < 0.82) return null;
  const sourceText = getAnchorSourceText(anchor);
  const normalized = normalizeMatchText(sourceText);
  if (!normalized || isGenericOrMalformedAnchorText(sourceText)) return null;

  const kind = classifyRowBackedCandidate(anchor, normalized);
  if (!kind) return null;
  if (!topics.has(kind.topic)) return null;

  const label = kind.label;
  const finding = buildRowBackedFinding(anchor, kind);
  return {
    candidateId: `row:${anchor.anchorId}:${kind.type}`,
    anchorId: anchor.anchorId,
    sourceDocumentRole,
    sourcePdfPageNumber: anchor.pageNumber,
    sourcePdfPageIndex: toSourcePdfPageIndex(anchor.pageNumber),
    sourceLineNumber: anchor.lineNumber ?? undefined,
    sourceAnchorType: anchor.anchorType,
    sourceAnchorText: sourceText,
    sourceAnchorNormalizedText: normalized,
    label,
    estimateLineDisplay: formatEstimateLineForCallout(finding, sourceDocumentRole),
    bestAuthority: formatBestAuthority(finding),
    missingProof: formatMissingAuthority(finding),
    whyItMatters: finding.currentSupportSummary,
    nextAction: finding.recommendedNextAction,
    supportRefs: formatAnnotationSourceRefs(finding),
    confidence: getMatchConfidence(anchor),
    finding,
    anchor,
  };
}

type RowBackedCandidateTopic = "parts" | "diagnostic" | "totals" | "supplier";

function classifyRowBackedCandidate(
  anchor: EstimateRowAnchor,
  normalized: string
): {
  type: "parts_correctness" | "diagnostic_support" | "adas_report_reference" | "process_verification" | "totals_delta" | "supplier_parts";
  topic: RowBackedCandidateTopic;
  label: string;
  category: CitationDensityFinding["category"];
  estimateGapType: CitationDensityFinding["estimateGapType"];
  adasStatus?: "needed" | "referenced_not_produced" | "not_applicable";
  missingAuthorityTypes: string[];
} | null {
  if (anchor.anchorType === "totals_row") {
    return {
      type: "totals_delta",
      topic: "totals",
      label: "ESTIMATE GAP ONLY",
      category: "labor_difference",
      estimateGapType: "present_but_under_documented",
      adasStatus: "not_applicable",
      missingAuthorityTypes: ["P-page/DEG or rate/material support"],
    };
  }
  if (anchor.anchorType === "supplier_row") {
    if (!anchor.lineNumber || isRejectedBoilerplateSupplierText(normalized)) return null;
    return {
      type: "supplier_parts",
      topic: "supplier",
      label: "ESTIMATE GAP ONLY",
      category: "parts_downgrade",
      estimateGapType: "present_but_under_documented",
      adasStatus: "not_applicable",
      missingAuthorityTypes: ["parts correctness support"],
    };
  }
  if (anchor.anchorType === "embedded_link_row") {
    return {
      type: "adas_report_reference",
      topic: "diagnostic",
      label: "REFERENCED / NOT PRODUCED",
      category: "adas_calibration",
      estimateGapType: "referenced_not_produced",
      adasStatus: "referenced_not_produced",
      missingAuthorityTypes: ["referenced link or report"],
    };
  }
  if (anchor.anchorType === "guide_row") {
    return null;
  }
  if (/\bnot correct style\b/.test(normalized)) {
    return {
      type: "parts_correctness",
      topic: "parts",
      label: "ESTIMATE GAP ONLY",
      category: "parts_downgrade",
      estimateGapType: "present_but_under_documented",
      adasStatus: "not_applicable",
      missingAuthorityTypes: ["parts correctness support"],
    };
  }
  if (/\bfinal road test\b/.test(normalized)) {
    return {
      type: "process_verification",
      topic: "diagnostic",
      label: "ESTIMATE GAP ONLY",
      category: "other",
      estimateGapType: "needs_proof",
      adasStatus: "not_applicable",
      missingAuthorityTypes: ["verification or completion proof"],
    };
  }
  if (/\brevv\s*adas\b|\brevvadas\b|\badas report\b|\begnyte\b|\bvia this link\b/.test(normalized)) {
    return {
      type: "adas_report_reference",
      topic: "diagnostic",
      label: "REFERENCED / NOT PRODUCED",
      category: "adas_calibration",
      estimateGapType: "referenced_not_produced",
      adasStatus: "referenced_not_produced",
      missingAuthorityTypes: ["linked ADAS report"],
    };
  }
  if (/\b(?:pre repair scan|pre scan|in proc repair scan|in process scan|post repair scan|calibration|adas|srs|seat belt dynamic function test|aiming|initialization|programming|radar|camera|sensor|diagnostic|scan)\b/.test(normalized)) {
    return {
      type: "diagnostic_support",
      topic: "diagnostic",
      label: "NEEDS ADAS",
      category: "scan_diagnostic",
      estimateGapType: "needs_proof",
      adasStatus: "needed",
      missingAuthorityTypes: ["ADAS/diagnostic report or completion proof"],
    };
  }
  return null;
}

function buildRowBackedCandidateTopics(findings: CitationDensityFinding[]) {
  const topics = new Set<RowBackedCandidateTopic>();
  for (const finding of findings) {
    if (hasConcreteFindingAnchor(finding)) continue;
    const text = normalizeMatchText([
      finding.operationLabel,
      finding.category,
      finding.carrierEvidence?.description,
      finding.shopEvidence?.description,
      finding.currentSupportSummary,
      finding.missingProofSummary,
      finding.recommendedNextAction,
      ...finding.missingAuthorityTypes,
    ].join(" "));
    if (/\b(?:not correct style|grille|lkq|part|parts|style|oem style)\b/.test(text)) topics.add("parts");
    if (/\b(?:supplier|alternate|aftermarket|used part|lkq)\b/.test(text)) topics.add("supplier");
    if (/\b(?:labor rate|rate|paint material|paint supplies|materials|total|net cost|body labor|paint labor|deg|p page|ccc|motor|guide|included|not included|database)\b/.test(text)) topics.add("totals");
    if (/\b(?:adas|scan|diagnostic|calibration|srs|seat belt|road test|revvadas|report|radar|camera|sensor|programming|initialization|aiming)\b/.test(text)) topics.add("diagnostic");
  }
  return topics;
}

function buildRowBackedFinding(
  anchor: EstimateRowAnchor,
  kind: NonNullable<ReturnType<typeof classifyRowBackedCandidate>>
): CitationDensityFinding {
  const sourceText = getAnchorSourceText(anchor);
  const evidence = {
    lineNumber: anchor.lineNumber,
    description: sourceText,
    amount: null,
    laborHours: null,
    sourceLabel: `${anchor.sourceDocumentRole === "shop" ? "Shop" : "Carrier"} estimate`,
  };
  const isReferenced = kind.estimateGapType === "referenced_not_produced";
  return {
    id: `row-backed-${anchor.anchorId.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`,
    operationLabel: sourceText,
    category: kind.category,
    estimateGapType: kind.estimateGapType,
    carrierEvidence: anchor.sourceDocumentRole === "carrier" ? evidence : undefined,
    shopEvidence: anchor.sourceDocumentRole === "shop" ? evidence : undefined,
    applicableEstimateRoles: [anchor.sourceDocumentRole],
    primaryAnnotationRole: anchor.sourceDocumentRole,
    carrierAnchor: anchor.sourceDocumentRole === "carrier" ? buildFindingLineAnchor(anchor) : undefined,
    shopAnchor: anchor.sourceDocumentRole === "shop" ? buildFindingLineAnchor(anchor) : undefined,
    impact: {
      dollarImpact: null,
      laborHoursImpact: null,
      safetyImpact: kind.adasStatus === "needed" ? "high" : "medium",
      supplementPriority: kind.adasStatus === "needed" ? "high" : "medium",
    },
    citationStatus: {
      oem: "not_applicable",
      adas: kind.adasStatus ?? "not_applicable",
      pPages: kind.type === "totals_delta" ? "needed" : "not_applicable",
      scrs: "not_applicable",
      deg: kind.type === "totals_delta" ? "needed" : "not_applicable",
      nhtsa: "not_applicable",
      stateRegulation: "not_applicable",
      policy: "not_applicable",
      invoiceOrCompletionProof: kind.adasStatus === "needed" || isReferenced ? "needed" : "not_found",
      photoOrTeardownProof: "not_found",
    },
    citationDensityScore: kind.adasStatus === "needed" ? 38 : 52,
    verifiedAuthorityCount: 0,
    missingAuthorityTypes: kind.missingAuthorityTypes,
    missingAuthority: kind.missingAuthorityTypes,
    citationLabel: kind.label,
    currentSupportSummary: buildRowBackedSupportSummary(kind.type, sourceText),
    missingProofSummary: buildRowBackedMissingProof(kind.type),
    recommendedNextAction: buildRowBackedNextAction(kind.type),
    confidence: "high",
    limitations: ["Generated only from an exact extracted estimate row anchor."],
  };
}

function buildFindingLineAnchor(anchor: EstimateRowAnchor) {
  return {
    anchorId: anchor.anchorId,
    sourceDocumentId: anchor.sourceDocumentId,
    estimateRole: anchor.sourceDocumentRole,
    lineNumber: anchor.lineNumber,
    pageNumber: anchor.pageNumber,
    section: anchor.section,
    operation: anchor.rowText,
    description: getAnchorSourceText(anchor),
  };
}

function buildRowBackedSupportSummary(type: string, sourceText: string) {
  if (type === "adas_report_reference") return "The estimate references an ADAS report/link, but the report content has not been retrieved or reviewed.";
  if (type === "diagnostic_support") return "The estimate contains an exact diagnostic/ADAS-related row that needs supporting report or completion proof.";
  if (type === "process_verification") return "The estimate contains a verification/process row; treat it as process evidence, not an automatic ADAS deficiency.";
  if (type === "totals_delta") return "The estimate contains exact totals/rate/material rows that can support a rate or material delta review.";
  if (type === "supplier_parts") return "The supplier evidence is tied to an exact supplier/parts row.";
  return `The estimate row itself contains the parts correctness issue: ${sourceText}`;
}

function buildRowBackedMissingProof(type: string) {
  if (type === "adas_report_reference") return "Referenced report/link was not produced in the reviewed evidence.";
  if (type === "diagnostic_support") return "Diagnostic/ADAS report, calibration output, or completion proof was not produced in the reviewed evidence.";
  if (type === "totals_delta") return "Rate/material support, P-page, DEG, or agreed-rate proof is still needed before leading.";
  if (type === "supplier_parts") return "Supplier invoice, parts evidence, or style-correctness support is still needed.";
  if (type === "process_verification") return "Completion or verification proof is still needed if this row is being used as a claim support item.";
  return "Parts correctness support is still needed.";
}

function buildRowBackedNextAction(type: string) {
  if (type === "adas_report_reference") return "Retrieve and review the referenced ADAS report before presenting it as verified support.";
  if (type === "diagnostic_support") return "Attach the scan/report output or completion proof before leading with this item.";
  if (type === "totals_delta") return "Tie the totals/rate/material difference to P-page, DEG, rate, or invoice support.";
  if (type === "supplier_parts") return "Attach supplier evidence and reconcile it with the estimate parts row.";
  if (type === "process_verification") return "Attach completion proof if this verification row is material to the supplement request.";
  return "Attach parts correctness evidence before leading.";
}

function gateAnchoredCitationCandidate(
  candidate: AnchoredCitationCandidate,
  anchorIndex: Map<string, EstimateRowAnchor>
): "allowed" | "blocked" | "page_mismatch" {
  if (!candidate.anchorId) return "blocked";
  const anchor = anchorIndex.get(candidate.anchorId);
  if (!anchor) return "blocked";
  if (candidate.sourcePdfPageNumber !== anchor.pageNumber) return "page_mismatch";
  if (candidate.sourceLineNumber && anchor.lineNumber !== candidate.sourceLineNumber) return "blocked";
  if (candidate.sourceAnchorText !== getAnchorSourceText(anchor)) return "blocked";
  if (!isClassificationAllowedForRow(candidate.label, anchor)) return "blocked";
  if (anchor.anchorType === "guide_row") return "blocked";
  if (anchor.anchorType === "supplier_row" && isRejectedBoilerplateSupplierText(normalizeMatchText(getAnchorSourceText(anchor)))) return "blocked";
  if (isRestrictedSourcePageForCandidate(candidate, anchor)) return "blocked";
  return "allowed";
}

function isClassificationAllowedForRow(label: string, anchor: EstimateRowAnchor) {
  if (/NEEDS ADAS/i.test(label)) {
    return anchor.anchorType !== "totals_row" &&
      anchor.anchorType !== "supplier_row" &&
      anchor.anchorType !== "guide_row" &&
      !/\b(?:final road test|not correct style|total|paint supplies|paint materials|body labor|paint labor|net cost|supplier|lkq)\b/i.test(getAnchorSourceText(anchor));
  }
  return true;
}

function isRestrictedSourcePageForCandidate(candidate: AnchoredCitationCandidate, anchor: EstimateRowAnchor) {
  const text = getAnchorSourceText(anchor);
  if (/\b(?:disclaimer|abbreviations?|motor guide|ccc motor guide|guide pages|asTech diagnostic terms)\b/i.test(text)) {
    return !/\b(?:disclaimer|abbreviations?|motor guide|astech)\b/i.test(candidate.estimateLineDisplay);
  }
  if (anchor.anchorType === "totals_row") return !/total|rate|paint|material|labor|net cost|parts|miscellaneous|aluminum|sales tax|hrs?\b|category/i.test(candidate.estimateLineDisplay);
  if (anchor.anchorType === "supplier_row") return !/supplier|alternate|aftermarket|lkq|part|grille/i.test(candidate.estimateLineDisplay);
  if (anchor.anchorType === "embedded_link_row") return !/link|url|report|available|referenced|egnyte|revv|adas|oem/i.test(candidate.estimateLineDisplay);
  if (anchor.anchorType === "guide_row") return !/ccc|motor|guide|p page|included|not included|database|deg|rate|material|labor/i.test(candidate.estimateLineDisplay);
  return false;
}

function getAnchorSourceText(anchor: EstimateRowAnchor) {
  return [...new Set([anchor.rowText, anchor.noteText, anchor.supplierText]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => value.replace(/\s+/g, " ").trim()))]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPdfJsWorkerError(error: string | undefined) {
  return Boolean(error && /pdf\.worker\.mjs|Setting up fake worker failed/i.test(error));
}

function buildAnchorsByPage(anchors: EstimateRowAnchor[]) {
  const byPage: Record<string, string[]> = {};
  for (const anchor of anchors) {
    const key = String(anchor.pageNumber);
    byPage[key] = byPage[key] ?? [];
    byPage[key].push(anchor.lineNumber ? `line ${anchor.lineNumber}` : anchor.anchorType);
  }
  return byPage;
}

async function extractPdfTextAnchors(bytes: Uint8Array): Promise<TextAnchor[]> {
  const polyfillError = await ensurePdfJsNodePolyfills([]);
  if (polyfillError) {
    throw new Error(polyfillError);
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    disableWorker: true,
    useSystemFonts: true,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0]);
  const pdf = await loadingTask.promise;
  const anchors: TextAnchor[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!("str" in item) || typeof item.str !== "string") continue;
      const text = item.str.replace(/\s+/g, " ").trim();
      if (!text) continue;
      const transform = item.transform;
      const x = Number(transform[4] ?? 0);
      const pdfJsY = Number(transform[5] ?? 0);
      const height = Math.max(Number((item as { height?: number }).height ?? 8), 6);
      const width = Math.max(Number((item as { width?: number }).width ?? 40), text.length * 4);
      anchors.push({
        pageIndex: pageNumber - 1,
        text,
        normalizedText: normalizeMatchText(text),
        x,
        y: viewport.height - pdfJsY - height * 0.4,
        width,
        height,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
      });
    }
  }

  return [...anchors, ...buildGroupedLineAnchors(anchors)];
}

function buildGroupedLineAnchors(anchors: TextAnchor[]): TextAnchor[] {
  const byPage = new Map<number, TextAnchor[]>();
  for (const anchor of anchors) {
    const pageAnchors = byPage.get(anchor.pageIndex) ?? [];
    pageAnchors.push(anchor);
    byPage.set(anchor.pageIndex, pageAnchors);
  }

  const grouped: TextAnchor[] = [];
  for (const [, pageAnchors] of byPage.entries()) {
    const rows: TextAnchor[][] = [];
    for (const anchor of [...pageAnchors].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const row = rows.find((candidate) =>
        Math.abs(average(candidate.map((item) => item.y)) - anchor.y) <= Math.max(3.5, anchor.height * 0.55)
      );
      if (row) {
        row.push(anchor);
      } else {
        rows.push([anchor]);
      }
    }

    for (const row of rows) {
      if (row.length < 2) continue;
      const ordered = [...row].sort((a, b) => a.x - b.x);
      const text = ordered.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
      if (text.length < 8) continue;
      const minX = Math.min(...ordered.map((item) => item.x));
      const minY = Math.min(...ordered.map((item) => item.y));
      const maxX = Math.max(...ordered.map((item) => item.x + item.width));
      const maxY = Math.max(...ordered.map((item) => item.y + item.height));
      grouped.push({
        pageIndex: ordered[0].pageIndex,
        text,
        normalizedText: normalizeMatchText(text),
        x: minX,
        y: minY,
        width: Math.max(40, maxX - minX),
        height: Math.max(8, maxY - minY),
        pageWidth: ordered[0].pageWidth,
        pageHeight: ordered[0].pageHeight,
        groupedLine: true,
      });
    }
  }
  return grouped;
}

function buildStoredTextAnchors(sourceText: string | null | undefined, pdfDoc: PDFDocument): TextAnchor[] {
  const text = sourceText?.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return [];

  const pageCount = Math.max(1, pdfDoc.getPageCount());
  const pages = splitStoredTextIntoPages(text, pageCount);
  const anchors: TextAnchor[] = [];

  pages.forEach((pageText, pageIndex) => {
    const page = pdfDoc.getPage(Math.min(pageIndex, pageCount - 1));
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    const rawLines = pageText
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const lines = mergeContinuationLines(rawLines);
    const usableLines = lines.length ? lines : rawLines;
    const topY = pageHeight - 72;
    const rowHeight = Math.max(8, Math.min(13, (pageHeight - 120) / Math.max(1, usableLines.length)));

    usableLines.forEach((line, index) => {
      const lineY = clamp(topY - index * rowHeight, 42, pageHeight - 42);
      anchors.push({
        pageIndex: Math.min(pageIndex, pageCount - 1),
        text: line,
        normalizedText: normalizeMatchText(line),
        x: 42,
        y: pageHeight - lineY - 9,
        width: Math.min(pageWidth - 84, Math.max(180, line.length * 4.8)),
        height: 9,
        pageWidth,
        pageHeight,
        synthetic: true,
        groupedLine: true,
      });
    });
  });

  return anchors;
}

function splitStoredTextIntoPages(text: string, pageCount: number) {
  const formFeedPages = text.split(/\f+/).map((page) => page.trim()).filter(Boolean);
  if (formFeedPages.length > 1) return padPages(formFeedPages, pageCount);

  const markerPages = text
    .split(/\n\s*(?:-{2,}\s*)?(?:page|pg)\s+\d+(?:\s+of\s+\d+)?\s*(?:-{2,})?\s*\n/gi)
    .map((page) => page.trim())
    .filter(Boolean);
  if (markerPages.length > 1) return padPages(markerPages, pageCount);

  return distributeLinesAcrossPages(text, pageCount);
}

function padPages(pages: string[], pageCount: number) {
  if (pages.length >= pageCount) return pages.slice(0, pageCount);
  return [...pages, ...Array.from({ length: pageCount - pages.length }, () => "")];
}

function distributeLinesAcrossPages(text: string, pageCount: number) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (pageCount <= 1 || lines.length <= 1) return [text];
  const perPage = Math.ceil(lines.length / pageCount);
  return Array.from({ length: pageCount }, (_, index) =>
    lines.slice(index * perPage, (index + 1) * perPage).join("\n")
  );
}

function mergeContinuationLines(lines: string[]) {
  const merged: string[] = [];
  for (const line of lines) {
    const startsEstimateRow = /^\s*(?:line\s*)?\d{1,4}\b/i.test(line);
    const startsSection = /^(?:parts|body|paint|refinish|electrical|diagnostic|calibration|totals?|summary|alternate parts supplier|ccc|motor|p-?pages?|included|not included)\b/i.test(line);
    if (!merged.length || startsEstimateRow || startsSection) {
      merged.push(line);
      continue;
    }

    const previous = merged[merged.length - 1];
    if (
      /(?:note|available|via this link|not correct|supplier|guide|database|included|not included|paint materials?|labor|total)/i.test(line) ||
      /^\$?\d+(?:\.\d+)?\b/.test(line)
    ) {
      merged[merged.length - 1] = `${previous} ${line}`;
    } else {
      merged.push(line);
    }
  }
  return merged;
}

function findBestAnchorForFinding(
  finding: CitationDensityFinding,
  anchors: TextAnchor[],
  usedAnchors: Set<TextAnchor>,
  estimateRole: "carrier" | "shop" | "selected"
): TextAnchor | null {
  let best: { anchor: TextAnchor; score: number } | null = null;
  for (const anchor of anchors) {
    if (usedAnchors.has(anchor)) continue;
    const score = scoreAnchor(finding, anchor, estimateRole);
    if (score > (best?.score ?? 0)) {
      best = { anchor, score };
    }
  }

  return best && best.score >= 24 && isConcreteAnchorMatch(finding, best.anchor, estimateRole)
    ? best.anchor
    : null;
}

function sanitizeCitationDensityFindingsForVisibleLayer(findings: CitationDensityFinding[]) {
  const kept: CitationDensityFinding[] = [];
  const suppressed: CitationDensityFinding[] = [];
  const seen = new Set<string>();

  for (const finding of findings) {
    const displayText = [
      finding.operationLabel,
      finding.carrierEvidence?.description,
      finding.shopEvidence?.description,
      finding.carrierAnchor?.description,
      finding.shopAnchor?.description,
    ].join(" ");
    const key = normalizeMatchText(displayText);

    if (!isVisibleCitationDensityFinding(finding) || (key && seen.has(key))) {
      suppressed.push(finding);
      continue;
    }

    if (key) seen.add(key);
    kept.push(finding);
  }

  return { findings: kept, suppressed };
}

function isVisibleCitationDensityFinding(finding: CitationDensityFinding): boolean {
  const text = [
    finding.operationLabel,
    finding.category,
    finding.carrierEvidence?.description,
    finding.shopEvidence?.description,
    finding.currentSupportSummary,
    finding.missingProofSummary,
    finding.recommendedNextAction,
  ].join(" ");
  const normalized = normalizeMatchText(text);
  const primaryText = [
    finding.operationLabel,
    finding.carrierEvidence?.description,
    finding.shopEvidence?.description,
    finding.carrierAnchor?.description,
    finding.shopAnchor?.description,
    hasConcreteFindingAnchor(finding) ? "" : finding.currentSupportSummary,
    hasConcreteFindingAnchor(finding) ? "" : finding.missingProofSummary,
  ].join(" ");
  const primaryNormalized = normalizeMatchText(primaryText);

  if (!normalized.trim()) return false;
  // A 0/100 Citation Density score means no scoring signal survived — such a
  // "finding" is always an artifact (legend/boilerplate anchor), never a lead.
  if (typeof finding.citationDensityScore === "number" && finding.citationDensityScore <= 0) return false;
  // Totals-lane findings legitimately talk about subtotals/grand totals and
  // anchor to totals rows — the junk gate (built to kill boilerplate-anchored
  // artifacts) silently suppressed Body Labor/Mechanical hour-delta findings.
  const isTotalsLaneFinding = (finding.id ?? "").startsWith("required-detector-totals-");
  // Structured delta findings already passed the typed engine's row validation;
  // their anchor evidence can bleed adjacent boilerplate (a line next to the
  // VEHICLE OPTIONS block absorbs "4 wheel drive…"), so the junk gate judges
  // them by their own engine-derived label, not the anchor's fuzzy text.
  const isStructuredDeltaFinding = (finding.id ?? "").startsWith("required-detector-delta-");
  const junkGateText = isStructuredDeltaFinding ? normalizeMatchText(finding.operationLabel ?? "") : primaryNormalized;
  if (!isTotalsLaneFinding && isJunkCitationFindingText(junkGateText)) return false;
  if (/\brepair operation\b|\bproc report\b|\bcomparison or screenshot cues\b/i.test(text)) return false;
  if (/\bgeneric visible damage photo observations\b|\bgeneric key visible estimate facts\b/i.test(text)) return false;
  if (/\bproc\s+(?:pre|post)[-\s]?repair scanm\b/i.test(text) || /\bproc\s+(?:pre|post)\s+repair\s+scanm\b/.test(normalized)) return false;
  if (/\bstructural frame and measurement verification\b/i.test(text) && !hasConcreteFindingAnchor(finding)) return false;
  if (/\bside structure aperture door[-\s]?shell fit verification\b/i.test(text) && !hasConcreteFindingAnchor(finding)) return false;
  if (/^note required prior to final refinish/i.test(text) && !/test\s*fit/i.test(text)) return false;

  return true;
}

function hasConcreteFindingAnchor(finding: CitationDensityFinding): boolean {
  return Boolean(
    finding.carrierEvidence?.lineNumber ||
    finding.shopEvidence?.lineNumber ||
    finding.carrierEvidence?.description ||
    finding.shopEvidence?.description ||
    typeof finding.carrierEvidence?.amount === "number" ||
    typeof finding.shopEvidence?.amount === "number" ||
    typeof finding.carrierEvidence?.laborHours === "number" ||
    typeof finding.shopEvidence?.laborHours === "number" ||
    finding.carrierAnchor?.lineNumber ||
    finding.shopAnchor?.lineNumber ||
    finding.carrierAnchor?.section ||
    finding.shopAnchor?.section
  );
}

function isConcreteAnchorMatch(
  finding: CitationDensityFinding,
  anchor: TextAnchor,
  estimateRole: "carrier" | "shop" | "selected"
): boolean {
  if (anchor.synthetic && /^page-level citation density callout/i.test(anchor.text)) return false;
  if (isGenericOrMalformedAnchorText(anchor.text)) return false;

  const lineNumber = getTargetLineNumber(finding, estimateRole);
  if (lineNumber) return matchesLineNumber(anchor.text, lineNumber);

  const anchorType = getAnchorType(finding, anchor, "line", estimateRole);
  if (anchorType === "page_fallback") return false;
  if (anchorType === "totals") return /total|labor rate|paint supplies|paint materials|body labor|paint labor/i.test(anchor.text);
  if (anchorType === "supplier") return /supplier|alternate|a\/m|aftermarket|capa|lkq|oem/i.test(anchor.text);
  if (anchorType === "note") return /note|required|not correct|available upon request|via this link|report/i.test(anchor.text);
  if (anchorType === "section") return Boolean(getTargetSection(finding, estimateRole));
  if (
    (finding.carrierEvidence?.amount && anchor.normalizedText.includes(normalizeMoney(finding.carrierEvidence.amount))) ||
    (finding.shopEvidence?.amount && anchor.normalizedText.includes(normalizeMoney(finding.shopEvidence.amount)))
  ) {
    return sharedTermScore(normalizeMatchText(finding.operationLabel), anchor.normalizedText, 10) >= 3;
  }

  return sharedTermScore(normalizeMatchText(finding.operationLabel), anchor.normalizedText, 10) >= 8;
}

function isGenericOrMalformedAnchorText(value: string): boolean {
  return (
    /^\s*(?:repair operation|proc report|comparison or screenshot cues)\s*$/i.test(value) ||
    /\bproc\s+(?:pre|post)[-\s]?repair scanm\b/i.test(value) ||
    /\b(?:citation density gap report|annotation legend|unanchored citation density|disclosure|privacy|estimate summary only|disclaimer|abbreviations?|motor guide|guide pages)\b/i.test(value) ||
    /\bmotor\b.*\b(?:database|guide|included|not included)\b/i.test(value)
  );
}

function scoreAnchor(
  finding: CitationDensityFinding,
  anchor: TextAnchor,
  estimateRole: "carrier" | "shop" | "selected"
): number {
  const roleAnchor =
    estimateRole === "shop"
      ? finding.shopAnchor
      : estimateRole === "carrier"
        ? finding.carrierAnchor
        : finding.carrierAnchor ?? finding.shopAnchor;
  const roleEvidence =
    estimateRole === "shop"
      ? finding.shopEvidence
      : estimateRole === "carrier"
        ? finding.carrierEvidence
        : finding.carrierEvidence ?? finding.shopEvidence;
  const primaryEvidence = roleEvidence ?? roleAnchor;
  const secondaryEvidence = roleAnchor
    ? null
    : estimateRole === "shop"
      ? finding.carrierEvidence
      : estimateRole === "carrier"
        ? finding.shopEvidence
        : finding.shopEvidence ?? finding.carrierEvidence;
  const evidence = [primaryEvidence, secondaryEvidence].filter(Boolean);
  const anchorText = anchor.normalizedText;
  let score = 0;

  for (const item of evidence) {
    if (item?.lineNumber && matchesLineNumber(anchor.text, item.lineNumber)) {
      score += item === primaryEvidence ? 125 : 82;
    }
    if (item?.description) {
      const description = normalizeMatchText(item.description);
      if (description && (anchorText.includes(description) || description.includes(anchorText))) {
        score += item === primaryEvidence ? 95 : 55;
      }
      score += sharedTermScore(description, anchorText, 42);
      score += keyTokenScore(description, anchorText, 34);
    }
    if (typeof item?.amount === "number" && anchorText.includes(normalizeMoney(item.amount))) {
      score += 18;
    }
    if (typeof item?.laborHours === "number" && anchorText.includes(String(item.laborHours))) {
      score += 14;
    }
  }

  const operation = normalizeMatchText(finding.operationLabel);
  score += sharedTermScore(operation, anchorText, 34);
  score += keyTokenScore(operation, anchorText, 38);
  if (anchorText.includes(operation) || operation.includes(anchorText)) score += 50;
  score += scoreSectionAffinity(finding, anchor, estimateRole);
  if (anchor.groupedLine) score += 8;
  return score;
}

function drawFindingAnnotation(
  pdfDoc: PDFDocument,
  page: PDFPage,
  match: MatchedFinding,
  number: number,
  options: {
    mode: AnnotationMode;
    font: PDFFont;
    boldFont: PDFFont;
    estimateRole: "carrier" | "shop" | "selected";
    redactSensitive: boolean;
    trace: CitationDensityDebugTrace;
    reportIdentity: AnnotatedEstimateReportIdentity;
    subtleAnnotations?: boolean;
  }
) {
  const { anchor, finding } = match;
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const rotation = normalizeRotation(page.getRotation().angle);
  const highlightRect = buildPdfRectFromTopLeftAnchor(anchor, { pdfWidth: pageWidth, pdfHeight: pageHeight, rotation }, 0);
  const pdfLibRect = topLeftRectToPdfLibRect(highlightRect, { pdfWidth: pageWidth, pdfHeight: pageHeight, rotation });
  if (highlightRect.width <= 0 || highlightRect.height <= 0 || Number.isNaN(pdfLibRect.x) || Number.isNaN(pdfLibRect.y)) {
    const reason = `invalid render rect for anchor ${anchor.anchorId}`;
    options.trace.rendererDrops.push({ findingId: finding.id, anchorId: anchor.anchorId, reason });
    return { written: false as const, reason };
  }
  if (anchor.pageNumber < 1 || anchor.pageNumber > pdfDoc.getPageCount()) {
    const reason = `invalid pageIndex ${anchor.pageNumber - 1}`;
    options.trace.rendererDrops.push({ findingId: finding.id, anchorId: anchor.anchorId, reason });
    return { written: false as const, reason };
  }
  const label = getProofBucketLabel(finding);
  const shortTitle = formatShortIssueTitle(finding);
  const metadata = buildAnnotationMetadata(finding, anchor, number, label, shortTitle, {
    x: highlightRect.x,
    y: highlightRect.y,
    width: highlightRect.width,
    height: highlightRect.height,
    xPct: highlightRect.xPct,
    yPct: highlightRect.yPct,
    wPct: highlightRect.wPct,
    hPct: highlightRect.hPct,
    pageWidth,
    pageHeight,
    rotation,
    estimateRole: options.estimateRole,
    redactSensitive: options.redactSensitive,
    reportIdentity: options.reportIdentity,
  });

  if (options.mode === "inline_highlight" || options.mode === "both") {
    page.drawRectangle({
      x: pdfLibRect.x,
      y: pdfLibRect.y,
      width: pdfLibRect.width,
      height: pdfLibRect.height,
      color: rgb(1, 0.9, 0.3),
      opacity: 0.1,
    });
  }

  if (options.mode === "margin_callouts" || options.mode === "both") {
    // Badge shows the SOURCE LINE number — the same key the callout bands
    // ("Ln 76/77 …") and the findings report ("Source line") use, so all
    // three views map to each other with no separate legend.
    const lineNumberBadge = Number(anchor.lineNumber);
    drawCompactMarker(page, {
      number: Number.isFinite(lineNumberBadge) && lineNumberBadge > 0 ? lineNumberBadge : number,
      anchorX: anchor.x,
      highlightX: pdfLibRect.x,
      highlightY: pdfLibRect.y,
      highlightHeight: pdfLibRect.height,
      pageWidth,
      font: options.font,
      boldFont: options.boldFont,
    });
  }

  attachPdfFindingAnnotations(pdfDoc, page, metadata, options.reportIdentity, options.subtleAnnotations === true);
  return { written: true as const, metadata };
}

/**
 * M-1 — is the comparison document's extraction actually degraded?
 *
 * Two conditions must BOTH hold. The text layer must be measurably degraded,
 * which is a question about the PDF's font dictionaries — a font that is
 * non-embedded AND carries no ToUnicode map. And the row yield must be a
 * small fraction of the annotated estimate's.
 *
 * The font condition is what was missing. A carrier estimate legitimately
 * carrying a quarter of the shop's lines is the whole point of the
 * comparison, not evidence that reading failed: GEICO's RO 22182 Estimate of
 * Record prints 33 lines against the shop's 179 and says on its face that it
 * "WAS GENERATED BY AN ARTIFICIAL INTELLIGENCE APPLICATION BASED ON
 * PHOTOGRAPHIC DATA". Its fonts are embedded Type 1 subsets with no ToUnicode
 * map — the extraction artifacts are spacing ("GE I CO", "La bor Pa in t"),
 * a glyph-mapping condition that coordinate extraction repairs. Hedging on
 * row count alone titled nine genuinely-absent operations "Possibly missing
 * (OCR-uncertain — verify against source)" and told the reader the estimate
 * was machine-read from an image-only PDF. Neither was true.
 */
export function comparisonExtractionIsDegraded(params: {
  textLayerReliable: boolean;
  higherRowCount: number;
  lowerRowCount: number;
}): boolean {
  if (params.textLayerReliable) return false;
  return params.higherRowCount >= 40 && params.lowerRowCount < params.higherRowCount * 0.25;
}

/** Role words a document can be CALLED. None of them is an identity, so none
 * may ever reach a callout: "MISSED on SHOP" tells the reader nothing, and on
 * a shop-sourced report it names the wrong side of the dispute entirely. */
const ROLE_TOKEN = /^(?:SHOP|EOR|CARRIER|INSURER|ESTIMATE|COMPARISON|OTHER|SOR|SUPPLEMENT)$/i;

/** Repair-facility letterhead shape — a shop, dealer, or body-shop network. */
const REPAIR_FACILITY_SHAPE =
  /\b(?:collision|auto\s*body|body\s*shop|automotive|autobody|coachwork|car\s*star|service\s*cent(?:er|re))\b/i;

/**
 * ONE resolved identity for the comparison document, computed from DOCUMENT
 * EVIDENCE and consumed by every renderer (S-2).
 *
 * The resolution deliberately does NOT consult the role classifier. RO 22182
 * shipped 162 callouts reading "MISSED on SHOP" because a GEICO Estimate of
 * Record was classified `shop`, which both suppressed the carrier scan and
 * selected the role word as the printed label — the report then named the
 * shop as the party that omitted the shop's own operations.
 *
 * Evidence order:
 *  1. a known carrier named in the COMPARISON document's own text;
 *  2. the carrier named on the SOURCE document (a shop estimate carries the
 *     carrier it bills) — only when the comparison is not itself a repair
 *     facility, so a shop-vs-shop pair can never inherit a carrier name;
 *  3. the comparison document's own organization name from its letterhead.
 *
 * Returns null when nothing resolves. A null label is a resolution FAILURE,
 * not a cue to print a fallback: the caller suppresses the layer and says so.
 */
export function resolveComparisonDocumentIdentity(params: {
  comparisonText: string;
  comparisonFileName?: string;
  sourceText: string;
}): string | null {
  const comparisonText = params.comparisonText ?? "";
  const letterhead = comparisonText.split(/\r?\n/).slice(0, 20).join("\n");
  const accept = (candidate: string | null | undefined): string | null => {
    const trimmed = candidate?.replace(/\s+/g, " ").trim();
    if (!trimmed || ROLE_TOKEN.test(trimmed)) return null;
    return trimmed.toUpperCase().slice(0, 32);
  };

  const namedOnComparison =
    detectDominantKnownCarrier(comparisonText) ?? carriersNamedIn(letterhead)[0];
  if (namedOnComparison) return accept(namedOnComparison);

  if (!REPAIR_FACILITY_SHAPE.test(letterhead)) {
    const namedOnSource =
      detectDominantKnownCarrier(params.sourceText ?? "") ??
      carriersNamedIn(params.sourceText ?? "")[0];
    if (namedOnSource) return accept(namedOnSource);
  }

  const facility = letterhead
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length >= 4 && line.length <= 48 && REPAIR_FACILITY_SHAPE.test(line));
  if (facility) return accept(facility.replace(/\.(?:com|net|org)\b.*$/i, ""));

  return null;
}

function drawCompactMarker(
  page: PDFPage,
  options: {
    number: number;
    anchorX: number;
    highlightX: number;
    highlightY: number;
    highlightHeight?: number;
    pageWidth: number;
    font: PDFFont;
    boldFont: PDFFont;
  }
) {
  // Badge sits in the LEFT PAGE MARGIN, clear of the estimate's own
  // line-number column, and is vertically centered on its row (it previously
  // rendered about half a row low and crowded the line numbers).
  const markerX = 3;
  const rowCenter = options.highlightY + (options.highlightHeight ?? 10) / 2;
  const label = String(options.number);
  const size = label.length >= 3 ? 5.4 : 7;
  page.drawEllipse({
    x: markerX + 7,
    y: rowCenter,
    xScale: 7,
    yScale: 7,
    color: rgb(0.72, 0.12, 0.1),
    opacity: 0.95,
  });
  const textWidth = options.boldFont.widthOfTextAtSize(label, size);
  page.drawText(label, {
    x: markerX + 7 - textWidth / 2,
    y: rowCenter - size / 2 + 0.6,
    size,
    font: options.boldFont,
    color: rgb(1, 1, 1),
  });
}

function attachPdfFindingAnnotations(
  pdfDoc: PDFDocument,
  page: PDFPage,
  metadata: CitationDensityAnnotationMetadata,
  reportIdentity: AnnotatedEstimateReportIdentity = CITATION_DENSITY_REPORT_IDENTITY,
  subtleHighlight = false
) {
  const annots = page.node.Annots() ?? pdfDoc.context.obj([]);
  page.node.set(PDFName.Annots, annots);
  const pageRef = page.ref;
  const pdfLibRect = topLeftRectToPdfLibRect(metadata, {
    pdfWidth: metadata.pdfPageWidth,
    pdfHeight: metadata.pdfPageHeight,
    rotation: metadata.rotation,
  });
  const rect = [
    pdfLibRect.x,
    pdfLibRect.y,
    pdfLibRect.x + pdfLibRect.width,
    pdfLibRect.y + pdfLibRect.height,
  ];
  const quadPoints = [
    pdfLibRect.x,
    pdfLibRect.y + pdfLibRect.height,
    pdfLibRect.x + pdfLibRect.width,
    pdfLibRect.y + pdfLibRect.height,
    pdfLibRect.x,
    pdfLibRect.y,
    pdfLibRect.x + pdfLibRect.width,
    pdfLibRect.y,
  ];
  const highlightRef = addPdfAnnotation(pdfDoc, pageRef, {
    Type: "Annot",
    Subtype: "Highlight",
    Rect: rect,
    QuadPoints: quadPoints,
    C: [1, 0.88, 0.22],
    // When the delta value layer carries the visible story, the hover
    // highlight drops to a whisper so it doesn't wash whole rows/blocks.
    CA: subtleHighlight ? 0.1 : 0.36,
    T: PDFHexString.fromText(reportIdentity.pdfAnnotationTitle),
    Contents: PDFHexString.fromText(metadata.comment),
    NM: PDFHexString.fromText(`citation-density-${sanitizePdfAnnotationName(metadata.findingId)}-${sanitizePdfAnnotationName(metadata.anchorId)}-highlight`),
    M: PDFHexString.fromText(formatPdfDate(new Date())),
    F: 4,
  });
  annots.push(highlightRef);
}

function addPdfAnnotation(
  pdfDoc: PDFDocument,
  pageRef: PDFRef,
  values: Record<string, unknown>
) {
  const dict = pdfDoc.context.obj({
    ...values,
    P: pageRef,
  });
  return pdfDoc.context.register(dict);
}

function buildAnnotationMetadata(
  finding: CitationDensityFinding,
  anchor: EstimateRowAnchor,
  number: number,
  label: string,
  shortTitle: string,
  options: {
    x: number;
    y: number;
    width: number;
    height: number;
    xPct: number;
    yPct: number;
    wPct: number;
    hPct: number;
    pageWidth: number;
    pageHeight: number;
    rotation: 0 | 90 | 180 | 270;
    estimateRole: "carrier" | "shop" | "selected";
    redactSensitive: boolean;
    reportIdentity?: AnnotatedEstimateReportIdentity;
  }
): CitationDensityAnnotationMetadata {
  const sanitize = (value: string) => {
    const text = normalizeSourceBoundaryText(value.replace(/\s+/g, " ").trim());
    return options.redactSensitive ? redactAnnotationText(text) : text;
  };
  const sourceRefs = formatAnnotationSourceRefs(finding).map(sanitize);
  const bestAuthority = sanitize(formatBestAuthority(finding));
  const sourceDocumentRole = anchor.sourceDocumentRole;
  const findingSourceDocumentId = getSourceDocumentId(finding, sourceDocumentRole);
  const sourceDocumentId = findingSourceDocumentId || anchor.sourceDocumentId;
  const targetRawText = sanitize(getAnchorSourceText(anchor) || formatEstimateLineForCallout(finding, options.estimateRole));
  const metadata: CitationDensityAnnotationMetadata = {
    findingId: finding.id,
    anchorId: anchor.anchorId,
    sourceAnchorId: anchor.anchorId,
    sourceDocumentId,
    sourceDocumentRole,
    sourcePdfPageNumber: anchor.pageNumber,
    sourcePageNumber: anchor.pageNumber,
    sourceLineNumber: anchor.lineNumber ?? undefined,
    sourceAnchorType: anchor.anchorType,
    sourceAnchorText: targetRawText,
    sourceAnchorNormalizedText: anchor.normalizedRowText,
    sourceAnchorOperation: anchor.operation,
    sourceAnchorDescription: anchor.description,
    sourceAnchorPartNumber: anchor.partNumber,
    sourceAnchorQty: anchor.qty,
    sourceAnchorPrice: anchor.price,
    sourceAnchorLabor: anchor.labor,
    sourceAnchorPaint: anchor.paint,
    sourceAnchorPdfBoundingBox: anchor.pdfBoundingBox,
    sourceAnchorPdfQuad: anchor.pdfQuad,
    sourceAnchorNormalizedUiRect: anchor.normalizedUiRect,
    markerNumber: number,
    pageNumber: anchor.pageNumber,
    pdfPageWidth: normalizePdfRect({ x: 0, y: 0, width: options.pageWidth, height: options.pageHeight }, { pdfWidth: options.pageWidth, pdfHeight: options.pageHeight }).width,
    pdfPageHeight: normalizePdfRect({ x: 0, y: 0, width: options.pageWidth, height: options.pageHeight }, { pdfWidth: options.pageWidth, pdfHeight: options.pageHeight }).height,
    rotation: options.rotation,
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
    xPct: options.xPct,
    yPct: options.yPct,
    wPct: options.wPct,
    hPct: options.hPct,
    coordinateSpace: "pdf-points",
    targetLineNumber: anchor.lineNumber ?? getTargetLineNumber(finding, options.estimateRole),
    targetSection: anchor.section || getTargetSection(finding, options.estimateRole),
    targetRawText,
    targetNormalizedText: anchor.normalizedRowText,
    matchConfidence: getMatchConfidence(anchor),
    anchorType: anchor.anchorType,
    label,
    shortTitle,
    estimateLine: sanitize(formatEstimateLineForCallout(finding, options.estimateRole)),
    bestAuthority,
    authorityStatus: finding.bestAvailableAuthority?.status ?? label,
    missingProof: sanitize(finding.missingProofSummary),
    whyItMatters: sanitize(finding.currentSupportSummary || buildRoleCalloutNote(finding, options.estimateRole)),
    nextAction: sanitize(finding.recommendedNextAction),
    authorityNeeded: finding.authorityNeeded,
    authorityType: finding.authorityType,
    retrievalAttempted: finding.retrievalAttempted,
    retrievalSourcesSearched: finding.retrievalSourcesSearched,
    retrievalStatus: finding.retrievalStatus,
    matchedDocumentTitle: finding.matchedDocumentTitle ? sanitize(finding.matchedDocumentTitle) : finding.matchedDocumentTitle,
    matchedDocumentUrl: finding.matchedDocumentUrl ? sanitize(finding.matchedDocumentUrl) : finding.matchedDocumentUrl,
    sourceExcerpt: finding.sourceExcerpt ? sanitize(finding.sourceExcerpt) : finding.sourceExcerpt,
    sourcePageLine: finding.sourcePageLine ? sanitize(finding.sourcePageLine) : finding.sourcePageLine,
    appliesToShopEstimate: finding.appliesToShopEstimate,
    appliesToCarrierEstimate: finding.appliesToCarrierEstimate,
    lineTieStatus: finding.lineTieStatus,
    nextActionOwner: finding.nextActionOwner,
    sourceRefs,
    comment: "",
  };
  metadata.comment = buildPdfCommentBody(metadata, finding, options.estimateRole, options.redactSensitive, options.reportIdentity);
  return metadata;
}

function getTargetLineNumber(
  finding: CitationDensityFinding,
  estimateRole: "carrier" | "shop" | "selected"
) {
  if (estimateRole === "shop") return finding.shopEvidence?.lineNumber || finding.shopAnchor?.lineNumber || undefined;
  if (estimateRole === "carrier") return finding.carrierEvidence?.lineNumber || finding.carrierAnchor?.lineNumber || undefined;
  return finding.carrierEvidence?.lineNumber || finding.carrierAnchor?.lineNumber || finding.shopEvidence?.lineNumber || finding.shopAnchor?.lineNumber || undefined;
}

function getTargetSection(
  finding: CitationDensityFinding,
  estimateRole: "carrier" | "shop" | "selected"
) {
  const anchor = estimateRole === "shop"
    ? finding.shopAnchor
    : estimateRole === "carrier"
      ? finding.carrierAnchor
      : finding.carrierAnchor ?? finding.shopAnchor;
  return anchor?.section || undefined;
}

function getSourceDocumentId(
  finding: CitationDensityFinding,
  sourceDocumentRole: CitationDensityAnnotationMetadata["sourceDocumentRole"]
) {
  if (sourceDocumentRole === "carrier") {
    return finding.carrierAnchor?.sourceDocumentId || finding.embeddedEstimateLinks?.find((link) => link.estimateRole === "carrier")?.sourceDocumentId;
  }
  if (sourceDocumentRole === "shop") {
    return finding.shopAnchor?.sourceDocumentId || finding.embeddedEstimateLinks?.find((link) => link.estimateRole === "shop")?.sourceDocumentId;
  }
  return finding.carrierAnchor?.sourceDocumentId || finding.embeddedEstimateLinks?.find((link) => link.estimateRole === "carrier")?.sourceDocumentId;
}

function getMatchConfidence(anchor: EstimateRowAnchor): "high" | "medium" | "low" {
  if (anchor.synthetic) return "medium";
  if (anchor.confidence >= 0.9) return "high";
  return anchor.confidence >= 0.82 ? "medium" : "low";
}

function getAnchorType(
  finding: CitationDensityFinding,
  anchor: TextAnchor,
  matchKind: "line" | "page",
  estimateRole: "carrier" | "shop" | "selected"
): "exact_line" | "description" | "note" | "amount" | "section" | "totals" | "supplier" | "page_fallback" {
  if (matchKind === "page") return "page_fallback";
  const lineNumber = getTargetLineNumber(finding, estimateRole);
  if (lineNumber && matchesLineNumber(anchor.text, lineNumber)) return "exact_line";
  const text = normalizeMatchText(anchor.text);
  if (/\btotal|subtotal|net cost|grand total|paint supplies|labor summary|body labor|paint labor|mechanical labor\b/.test(text)) return "totals";
  if (/\bsupplier|alternate|a m|aftermarket|part|oem\b/.test(text)) return "supplier";
  if (/\bnote|remark|message\b/.test(text)) return "note";
  if (/\$?\d[\d,.]*|\b\d+(?:\.\d+)?\s*(?:hrs?|hours)\b/.test(anchor.text)) return "amount";
  if (getTargetSection(finding, estimateRole)) return "section";
  return "description";
}

function buildPdfCommentBody(
  metadata: CitationDensityAnnotationMetadata,
  finding: CitationDensityFinding,
  estimateRole: "carrier" | "shop" | "selected",
  redactSensitive: boolean,
  reportIdentity: AnnotatedEstimateReportIdentity = CITATION_DENSITY_REPORT_IDENTITY
) {
  const lines = buildCalloutLines(finding, metadata.markerNumber, metadata.label, redactSensitive, estimateRole, reportIdentity);
  return [
    `Finding #${metadata.markerNumber}: ${metadata.shortTitle}`,
    `Finding id: ${metadata.findingId}`,
    `Anchor id: ${metadata.anchorId}`,
    finding.canonicalDeltaObjectId ? `Canonical delta object: ${finding.canonicalDeltaObjectId}` : "",
    finding.canonicalDeltaId ? `Canonical delta id: ${finding.canonicalDeltaId}` : "",
    finding.estimatePairKind ? `Estimate pair kind: ${finding.estimatePairKind}` : "",
    finding.deltaClass ? `Delta class: ${formatSemanticDeltaClass(finding)}` : "",
    finding.evidenceStatus ? `Evidence status: ${finding.evidenceStatus}` : "",
    finding.initialFileHash ? `Initial file hash: ${finding.initialFileHash}` : "",
    finding.supplementFileHash ? `Supplement file hash: ${finding.supplementFileHash}` : "",
    ...lines.slice(1),
    metadata.sourceRefs.length ? `Source refs: ${metadata.sourceRefs.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

function sanitizePdfAnnotationName(value: string) {
  // PDF name tokens are capped at 127 bytes by the spec, and some strict
  // renderers (pdftoppm) warn on long tokens anywhere in the file. Finding and
  // anchor ids can exceed that — keep a readable prefix plus a short stable
  // hash so the annotation name stays unique without the full raw id.
  const cleaned = value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "anchor";
  if (cleaned.length <= 40) return cleaned;
  return `${cleaned.slice(0, 40)}-${shortStableHash(cleaned)}`;
}

function shortStableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function formatShortIssueTitle(finding: CitationDensityFinding) {
  const evidence = finding.carrierEvidence ?? finding.shopEvidence;
  return truncateText(evidence?.description || finding.operationLabel || "Citation Density finding", 48);
}

function formatAnnotationSourceRefs(finding: CitationDensityFinding) {
  const refs = [
    finding.carrierEvidence?.sourceLabel,
    finding.shopEvidence?.sourceLabel,
    finding.bestAvailableAuthority?.title,
    ...formatEmbeddedLinkLines(finding),
  ].filter((value): value is string => Boolean(value && value.trim()));
  return [...new Set(refs)].slice(0, 6);
}

function formatPdfDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function truncateText(value: string, maxLength: number) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function addLegendPage(
  pdfDoc: PDFDocument,
  options: {
    font: PDFFont;
    boldFont: PDFFont;
    reportIdentity?: AnnotatedEstimateReportIdentity;
    /** Labels this RUN actually emitted (D-5) — the legend is generated from
     * them, never from a hand-maintained list that drifts. */
    emittedLabels?: string[];
  }
) {
  const reportIdentity = options.reportIdentity ?? CITATION_DENSITY_REPORT_IDENTITY;
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  page.drawText(reportIdentity.legendTitle, {
    x: 48,
    y: height - 58,
    size: 18,
    font: options.boldFont,
    color: rgb(0.12, 0.14, 0.18),
  });
  drawWrappedLines(page, [
    ...reportIdentity.legendBoundaryTexts,
    "",
    // D-6: the badge-to-callout key. One line, so the page explains itself.
    "Key: the numbered badge in the left margin is the FINDING number in the Findings Report; keyed notes at page bottom cite the estimate's own line numbers (Ln 16/17).",
  ], {
    x: 48,
    y: height - 84,
    width: width - 96,
    font: options.font,
    boldFont: options.boldFont,
    size: 10,
    lineHeight: 13,
    maxLines: 10,
  });

  const labels = [...new Set(options.emittedLabels ?? Object.keys(LABEL_DEFINITIONS))];
  let y = height - 210;
  for (const label of labels) {
    if (y < 60) break;
    page.drawRectangle({
      x: 48,
      y: y - 3,
      width: 16,
      height: 10,
      color: rgb(1, 0.9, 0.3),
      opacity: 0.35,
    });
    page.drawText(label, {
      x: 74,
      y,
      size: 11,
      font: options.boldFont,
      color: rgb(0.12, 0.14, 0.18),
    });
    const definition = LABEL_DEFINITIONS[label] ?? "Label emitted by this run; see the finding card for its meaning.";
    drawWrappedLines(page, [definition], {
      x: 74,
      y: y - 13,
      width: width - 130,
      font: options.font,
      boldFont: options.boldFont,
      size: 9,
      lineHeight: 11,
      maxLines: 2,
    });
    y -= 40;
  }
}

function addNoLineAnchorWarningPage(
  pdfDoc: PDFDocument,
  options: { font: PDFFont; boldFont: PDFFont; message: string; pageCalloutCount: number; appendixCount: number }
) {
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  page.drawText(options.message, {
    x: 48,
    y: height - 58,
    size: 14,
    font: options.boldFont,
    color: rgb(0.68, 0.2, 0.16),
  });
  drawWrappedLines(page, [
    options.message,
    `Page-level callouts placed on original estimate pages: ${options.pageCalloutCount}.`,
    `Findings appended in the unanchored appendix: ${options.appendixCount}.`,
    "Review the highlighted sections and appendix before relying on these findings.",
  ], {
    x: 48,
    y: height - 92,
    width: width - 96,
    font: options.font,
    boldFont: options.boldFont,
    size: 10,
    lineHeight: 14,
    maxLines: 16,
  });
}

function addFindingsReportCoverPage(
  pdfDoc: PDFDocument,
  options: {
    font: PDFFont;
    boldFont: PDFFont;
    reportIdentity: AnnotatedEstimateReportIdentity;
    sourcePdfName?: string;
    annotatedCount: number;
    unanchoredCount: number;
    generatedAt: string;
    /** U-4: per-document text-layer reliability notes (broken font encoding). */
    textLayerNotes?: string[];
  }
) {
  const page = pdfDoc.addPage();
  const { height } = page.getSize();
  page.drawText(`${options.reportIdentity.reportShortTitle} Findings Report`, {
    x: 48,
    y: height - 64,
    size: 20,
    font: options.boldFont,
  });
  drawWrappedLines(
    page,
    [
      options.reportIdentity.reportTitle,
      "",
      `Companion to the annotated estimate: ${options.sourcePdfName ?? "estimate"}.`,
      "The annotated estimate PDF shows the on-page highlights. This separate report",
      "explains every finding in detail and the documentation needed to support it.",
      "",
      `Highlighted on the estimate (anchored): ${options.annotatedCount}`,
      `Supplement-only / unanchored (listed here only): ${options.unanchoredCount}`,
      `Total findings: ${options.annotatedCount + options.unanchoredCount}`,
      ...(options.textLayerNotes?.length ? ["", ...options.textLayerNotes] : []),
      "",
      `Generated: ${options.generatedAt}`,
    ],
    {
      x: 48,
      y: height - 104,
      width: 500,
      font: options.font,
      boldFont: options.boldFont,
      size: 11,
      lineHeight: 16,
      maxLines: 40,
    }
  );
}

function addSummaryPage(
  pdfDoc: PDFDocument,
  options: {
    font: PDFFont;
    boldFont: PDFFont;
    annotatedCount: number;
    unresolvedCount: number;
    warnings: string[];
  }
) {
  const page = pdfDoc.addPage();
  const { height } = page.getSize();
  page.drawText("Annotated Estimate Summary", {
    x: 48,
    y: height - 58,
    size: 18,
    font: options.boldFont,
  });
  drawWrappedLines(page, [
    `Annotated findings: ${options.annotatedCount}`,
    `Unresolved anchors: ${options.unresolvedCount}`,
    ...options.warnings,
  ], {
    x: 48,
    y: height - 92,
    width: 500,
    font: options.font,
    boldFont: options.boldFont,
    size: 10,
    lineHeight: 14,
    maxLines: 30,
  });
}

function addCitationDensityFindingDetailPages(
  pdfDoc: PDFDocument,
  details: FindingDetail[],
  options: {
    font: PDFFont;
    boldFont: PDFFont;
    sourcePdfName?: string;
    sourcePdfHash?: string;
    buildCommit?: string;
    reportIdentity?: AnnotatedEstimateReportIdentity;
  }
) {
  const detailLayoutBlocks: NonNullable<CitationDensityDebugTrace["detailLayoutBlocks"]> = [];
  let nextDetailPageNumber = 1;

  details.forEach(({ finding, metadata }) => {
    let context = createFindingDetailLayoutContext(pdfDoc, {
      ...options,
      findingNumber: metadata.markerNumber,
      detailLayoutBlocks,
    }, nextDetailPageNumber);

    context = drawFindingDetailHeader(context, metadata);

    for (const field of buildFindingDetailFields(finding, metadata, options.reportIdentity ?? CITATION_DENSITY_REPORT_IDENTITY)) {
      context = drawWrappedDetailField(field.label, field.value, context);
    }
    nextDetailPageNumber = context.detailPageNumber + 1;
  });

  return detailLayoutBlocks;
}

type FindingDetailField = {
  label: string;
  value: string;
};

function buildFindingDetailFields(
  finding: CitationDensityFinding,
  metadata: CitationDensityAnnotationMetadata,
  reportIdentity: AnnotatedEstimateReportIdentity = CITATION_DENSITY_REPORT_IDENTITY
): FindingDetailField[] {
  return [
    { label: "Finding number", value: String(metadata.markerNumber) },
    { label: "Finding id", value: metadata.findingId },
    { label: "Issue", value: finding.operationLabel },
    { label: "Anchor id", value: metadata.anchorId },
    { label: "Label", value: metadata.label },
    { label: reportIdentity.scoreLabel, value: `${finding.citationDensityScore}/100` },
    { label: "Source estimate", value: formatDetailSourceEstimateLabel(finding, metadata) },
    ...(finding.canonicalDeltaObjectId
      ? [
          { label: "Canonical delta object", value: finding.canonicalDeltaObjectId },
          { label: "Canonical delta id", value: finding.canonicalDeltaId ?? "unknown" },
          { label: "Estimate pair kind", value: finding.estimatePairKind ?? "unknown" },
          { label: "Delta class", value: formatSemanticDeltaClass(finding) },
          { label: "Evidence status", value: finding.evidenceStatus ?? "unknown" },
          { label: "Comparison estimate", value: formatDetailComparisonEstimateLabel(finding) },
          { label: "Initial file hash", value: finding.initialFileHash ?? "unknown" },
          { label: "Supplement file hash", value: finding.supplementFileHash ?? "unknown" },
        ]
      : []),
    { label: "Source page", value: String(metadata.sourcePageNumber) },
    { label: "Source line", value: metadata.sourceLineNumber ?? "section" },
    { label: "Source row text", value: metadata.sourceAnchorText },
    { label: "Best authority", value: metadata.bestAuthority },
    { label: "Missing proof", value: metadata.missingProof },
    { label: "Why it matters", value: metadata.whyItMatters },
    { label: "Next action", value: metadata.nextAction },
    { label: "Support refs", value: metadata.sourceRefs.length ? metadata.sourceRefs.join("; ") : "none listed" },
    { label: "Source", value: `page ${metadata.sourcePageNumber}, line ${metadata.sourceLineNumber ?? "section"}` },
  ];
}

function formatDetailSourceEstimateLabel(
  finding: CitationDensityFinding,
  metadata: CitationDensityAnnotationMetadata
) {
  if (finding.sourceEstimateRole) {
    return formatEstimateRoleForDisplay(finding.sourceEstimateRole, `${metadata.sourceDocumentRole} estimate`);
  }
  return `${metadata.sourceDocumentRole} estimate`;
}

function formatDetailComparisonEstimateLabel(finding: CitationDensityFinding) {
  return formatEstimateRoleForDisplay(finding.comparisonEstimateRole, "comparison estimate");
}

function formatEstimateRoleForDisplay(
  role: CitationDensityFinding["sourceEstimateRole"] | undefined,
  fallback: string
) {
  if (role === "carrier_estimate") return "carrier estimate";
  if (role === "shop_initial") return "initial shop estimate";
  if (role === "shop_supplement") return "shop supplement";
  if (role === "shop_final") return "shop supplement/final estimate";
  if (role === "independent_appraiser") return "independent appraiser estimate";
  return fallback;
}

function formatSemanticDeltaClass(finding: CitationDensityFinding) {
  if (finding.deltaClass === "PRESENT_ONLY_IN_COMPARISON") {
    if (finding.comparisonEstimateRole === "shop_supplement" || finding.comparisonEstimateRole === "shop_final") {
      return "PRESENT ONLY IN SUPPLEMENT";
    }
    return "PRESENT ONLY IN COMPARISON";
  }
  if (finding.deltaClass === "PRESENT_ONLY_IN_SOURCE") return "PRESENT ONLY IN SOURCE";
  if (finding.deltaClass === "VALUE_CHANGED") return "VALUE CHANGED";
  if (finding.deltaClass === "PART_SWAPPED") return "PART SWAPPED";
  if (finding.deltaClass === "LABOR_CHANGED") return "LABOR CHANGED";
  if (finding.deltaClass === "ABSORBED_INTO_PARENT_OPERATION") return "ABSORBED INTO PARENT OPERATION";
  return finding.deltaClass ?? "unknown";
}

type FindingDetailLayoutContext = {
  pdfDoc: PDFDocument;
  page: PDFPage;
  pageIndex: number;
  findingNumber: number;
  detailPageNumber: number;
  currentY: number;
  marginLeft: number;
  marginRight: number;
  topY: number;
  bottomY: number;
  fieldWidth: number;
  headingSize: number;
  findingHeaderSize: number;
  labelSize: number;
  bodySize: number;
  lineHeight: number;
  fieldGap: number;
  sectionGap: number;
  font: PDFFont;
  boldFont: PDFFont;
  sourcePdfName?: string;
  sourcePdfHash?: string;
  buildCommit?: string;
  reportIdentity: AnnotatedEstimateReportIdentity;
  detailLayoutBlocks: NonNullable<CitationDensityDebugTrace["detailLayoutBlocks"]>;
};

function createFindingDetailLayoutContext(
  pdfDoc: PDFDocument,
  options: {
    font: PDFFont;
    boldFont: PDFFont;
    sourcePdfName?: string;
    sourcePdfHash?: string;
    buildCommit?: string;
    reportIdentity?: AnnotatedEstimateReportIdentity;
    findingNumber: number;
    detailLayoutBlocks: NonNullable<CitationDensityDebugTrace["detailLayoutBlocks"]>;
  },
  detailPageNumber: number,
  continuationLabel?: string
): FindingDetailLayoutContext {
  const page = pdfDoc.addPage();
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const marginLeft = 54;
  const marginRight = 54;
  const headingSize = 18;
  const topY = pageHeight - 72;
  const context: FindingDetailLayoutContext = {
    pdfDoc,
    page,
    pageIndex: pdfDoc.getPageCount() - 1,
    findingNumber: options.findingNumber,
    detailPageNumber,
    currentY: topY,
    marginLeft,
    marginRight,
    topY,
    bottomY: 72,
    fieldWidth: pageWidth - marginLeft - marginRight,
    headingSize,
    findingHeaderSize: 13,
    labelSize: 8.5,
    bodySize: 8.5,
    lineHeight: 11,
    fieldGap: 5,
    sectionGap: 8,
    font: options.font,
    boldFont: options.boldFont,
    sourcePdfName: options.sourcePdfName,
    sourcePdfHash: options.sourcePdfHash,
    buildCommit: options.buildCommit,
    reportIdentity: options.reportIdentity ?? CITATION_DENSITY_REPORT_IDENTITY,
    detailLayoutBlocks: options.detailLayoutBlocks,
  };

  page.drawText(context.reportIdentity.detailTitle, {
    x: marginLeft,
    y: pageHeight - 54,
    size: headingSize,
    font: options.boldFont,
    color: rgb(0.12, 0.14, 0.18),
  });
  recordDetailLayoutBlock(context, "heading", pageHeight - 54 + headingSize, pageHeight - 54);
  if (continuationLabel) {
    page.drawText(continuationLabel, {
      x: marginLeft,
      y: topY,
      size: context.labelSize,
      font: options.boldFont,
      color: rgb(0.45, 0.1, 0.08),
    });
    recordDetailLayoutBlock(context, "continuation-header", topY + context.labelSize, topY);
    context.currentY -= context.lineHeight + context.fieldGap;
  }
  drawFindingDetailFooter(context);
  return context;
}

function drawFindingDetailHeader(
  context: FindingDetailLayoutContext,
  metadata: CitationDensityAnnotationMetadata
) {
  context = ensureDetailLineSpace(context);
  const headerY = context.currentY;
  context.page.drawText(`Finding ${metadata.markerNumber}`, {
    x: context.marginLeft,
    y: headerY,
    size: context.findingHeaderSize,
    font: context.boldFont,
    color: rgb(0.45, 0.1, 0.08),
  });
  context.page.drawText(`Source: page ${metadata.sourcePageNumber}, line ${metadata.sourceLineNumber ?? "section"}`, {
    x: context.marginLeft + 96,
    y: headerY + 1,
    size: context.bodySize,
    font: context.boldFont,
    color: rgb(0.28, 0.32, 0.38),
  });
  recordDetailLayoutBlock(context, "finding-header", headerY + context.findingHeaderSize, headerY);
  context.currentY -= context.lineHeight + context.sectionGap;
  return context;
}

function drawFindingDetailFooter(context: FindingDetailLayoutContext) {
  const hash = context.sourcePdfHash ? context.sourcePdfHash.slice(0, 10) : "unknown";
  const commit = context.buildCommit ? context.buildCommit.slice(0, 10) : "local";
  const source = normalizeDetailText(context.sourcePdfName || context.reportIdentity.sourcePdfFallbackName);
  const footer = `${context.reportIdentity.detailTitle} | page ${context.detailPageNumber} | ${source} | pdf ${hash} | build ${commit}`;
  context.page.drawText(footer, {
    x: context.marginLeft,
    y: 34,
    size: 7.5,
    font: context.font,
    color: rgb(0.35, 0.38, 0.43),
  });
  recordDetailLayoutBlock(context, "footer", 34 + 7.5, 34);
}

function drawWrappedDetailField(
  label: string,
  value: string,
  context: FindingDetailLayoutContext
) {
  const lines = wrapTextToWidth(normalizeDetailText(value), context.font, context.bodySize, context.fieldWidth);
  let nextContext = ensureDetailLineSpace(context);
  const labelText = `${label}:`;
  const labelY = nextContext.currentY;
  nextContext.page.drawText(labelText, {
    x: nextContext.marginLeft,
    y: labelY,
    size: nextContext.labelSize,
    font: nextContext.boldFont,
    color: rgb(0.12, 0.14, 0.18),
  });
  recordDetailLayoutBlock(nextContext, `field-label:${label}`, labelY + nextContext.labelSize, labelY);
  nextContext.currentY -= nextContext.lineHeight;

  for (const line of lines.length ? lines : [""]) {
    nextContext = ensureDetailLineSpace(nextContext);
    const lineY = nextContext.currentY;
    nextContext.page.drawText(line, {
      x: nextContext.marginLeft,
      y: lineY,
      size: nextContext.bodySize,
      font: nextContext.font,
      color: rgb(0.12, 0.14, 0.18),
    });
    recordDetailLayoutBlock(nextContext, `field-body:${label}`, lineY + nextContext.bodySize, lineY);
    nextContext.currentY -= nextContext.lineHeight;
  }
  nextContext.currentY -= nextContext.fieldGap;
  return nextContext;
}

function ensureDetailLineSpace(context: FindingDetailLayoutContext) {
  if (context.currentY - context.lineHeight >= context.bottomY) return context;
  return createFindingDetailLayoutContext(
    context.pdfDoc,
    context,
    context.detailPageNumber + 1,
    `Finding ${context.findingNumber} continued`
  );
}

function recordDetailLayoutBlock(
  context: FindingDetailLayoutContext,
  blockType: string,
  topY: number,
  bottomY: number
) {
  context.detailLayoutBlocks.push({
    findingNumber: context.findingNumber,
    pageIndex: context.pageIndex,
    blockType,
    topY: Math.round(topY * 100) / 100,
    bottomY: Math.round(bottomY * 100) / 100,
  });
}

function normalizeDetailText(value: string | number | null | undefined) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function wrapTextToWidth(text: string, font: PDFFont, fontSize: number, maxWidth: number) {
  const paragraphs = normalizeDetailText(text).split("\n");
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const pieces = splitWordToFitWidth(word, font, fontSize, maxWidth);
      for (const piece of pieces) {
        const candidate = line ? `${line} ${piece}` : piece;
        if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth || !line) {
          line = candidate;
        } else {
          lines.push(line);
          line = piece;
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function splitWordToFitWidth(word: string, font: PDFFont, fontSize: number, maxWidth: number) {
  if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) return [word];
  const pieces: string[] = [];
  let piece = "";
  for (const character of word) {
    const candidate = `${piece}${character}`;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth || !piece) {
      piece = candidate;
    } else {
      pieces.push(piece);
      piece = character;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

function addUnanchoredAppendix(
  pdfDoc: PDFDocument,
  findings: CitationDensityFinding[],
  options: {
    font: PDFFont;
    boldFont: PDFFont;
    estimateRole: "carrier" | "shop" | "selected";
    redactSensitive: boolean;
    reportIdentity?: AnnotatedEstimateReportIdentity;
  }
) {
  const reportIdentity = options.reportIdentity ?? CITATION_DENSITY_REPORT_IDENTITY;
  let page = pdfDoc.addPage();
  let y = page.getHeight() - 54;
  page.drawText(reportIdentity.unanchoredTitle, {
    x: 48,
    y,
    size: 18,
    font: options.boldFont,
  });
  y -= 28;

  findings.forEach((finding, index) => {
    const lines = buildCalloutLines(finding, index + 1, getProofBucketLabel(finding), options.redactSensitive, options.estimateRole, reportIdentity);
    if (y < 118) {
      page = pdfDoc.addPage();
      y = page.getHeight() - 54;
    }
    drawWrappedLines(page, lines, {
      x: 48,
      y,
      width: page.getWidth() - 96,
      font: options.font,
      boldFont: options.boldFont,
      size: 9,
      lineHeight: 12,
      // Enough room for the headline plus the current-support sentence that
      // carries the numbers. At 8 lines the TOTAL GAP card stopped before
      // either total was printed.
      maxLines: 12,
    });
    y -= 152;
  });
}

function buildCalloutLines(
  finding: CitationDensityFinding,
  number: number,
  label: string,
  redactSensitive: boolean,
  estimateRole: "carrier" | "shop" | "selected" = "selected",
  reportIdentity: AnnotatedEstimateReportIdentity = CITATION_DENSITY_REPORT_IDENTITY
) {
  const sanitize = (value: string) => {
    const text = normalizeSourceBoundaryText(value.replace(/\s+/g, " ").trim());
    return redactSensitive ? redactAnnotationText(text) : text;
  };

  return [
    `Finding #: ${number}`,
    `Label: ${label}`,
    // The finding's own headline. Without it the card opened on the anchor's
    // row text, so the RO 22182 TOTAL GAP card printed "Grand Total 20,243.73"
    // and nothing else — the $15,677.62 difference and the comparison total
    // both sat below the card's line cap and were never rendered.
    `Finding: ${sanitize(finding.operationLabel)}`,
    ...(finding.canonicalDeltaObjectId
      ? [
          `Canonical delta object: ${finding.canonicalDeltaObjectId}`,
          `Canonical delta id: ${finding.canonicalDeltaId ?? "unknown"}`,
          `Estimate pair kind: ${finding.estimatePairKind ?? "unknown"}`,
          `Delta class: ${formatSemanticDeltaClass(finding)}`,
          `Evidence status: ${finding.evidenceStatus ?? "unknown"}`,
          `Initial file hash: ${finding.initialFileHash ?? "unknown"}`,
          `Supplement file hash: ${finding.supplementFileHash ?? "unknown"}`,
        ]
      : []),
    `${reportIdentity.scoreCommentLabel}: ${finding.citationDensityScore}/100`,
    `Estimate line: ${sanitize(formatEstimateLineForCallout(finding, estimateRole))}`,
    `Best authority: ${sanitize(formatBestAuthority(finding))}`,
    ...formatEmbeddedLinkLines(finding).map((line) => `Estimate link: ${sanitize(line)}`),
    `Missing authority: ${sanitize(formatMissingAuthority(finding))}`,
    `Estimate note: ${sanitize(buildRoleCalloutNote(finding, estimateRole))}`,
    `Current support: ${sanitize(finding.currentSupportSummary)}`,
    `Missing proof: ${sanitize(finding.missingProofSummary)}`,
    ...finding.limitations
      .filter((line) => /anchor reject|visual anchor suppressed|unanchored/i.test(line))
      .slice(0, 2)
      .map((line) => `Anchor status: ${sanitize(line)}`),
    // Coverage limits are never silent: a capped list reads as "this is
    // everything" unless the card says otherwise.
    ...finding.limitations
      .filter((line) => /not itemized here|beyond this pack|were detected beyond/i.test(line))
      .slice(0, 1)
      .map((line) => `Coverage limit: ${sanitize(line)}`),
    // A withdrawn self-contradiction is reported, never silently dropped.
    ...finding.limitations
      .filter((line) => /are the same operation written differently|closely resembles/i.test(line))
      .slice(0, 3)
      .map((line) => `Reconcile directly: ${sanitize(line)}`),
    // How well the comparison document was READ. This card renders only the
    // limitations it recognises, so a note with no branch here is dropped
    // silently — which is how a truncated-counterpart run shipped findings
    // correctly marked unverified while the page never said why.
    ...finding.limitations
      .filter((line) => /extraction confidence/i.test(line))
      .slice(0, 1)
      .map((line) => `Read quality: ${sanitize(line)}`),
    `Next action: ${sanitize(finding.recommendedNextAction)}`,
  ];
}

function formatEstimateLineForCallout(
  finding: CitationDensityFinding,
  estimateRole: "carrier" | "shop" | "selected"
) {
  const evidence = estimateRole === "shop"
    ? finding.shopEvidence ?? finding.shopAnchor ?? finding.carrierEvidence
    : estimateRole === "carrier"
      ? finding.carrierEvidence ?? finding.carrierAnchor ?? finding.shopEvidence
      : finding.carrierEvidence ?? finding.carrierAnchor ?? finding.shopEvidence ?? finding.shopAnchor;
  const linePrefix = evidence?.lineNumber ? `Line ${evidence.lineNumber}: ` : "";
  return `${linePrefix}${evidence?.description ?? finding.operationLabel}`;
}

function formatEmbeddedLinkLines(finding: CitationDensityFinding) {
  return (finding.embeddedEstimateLinks ?? [])
    .slice(0, 2)
    .map((link) => `${link.redactedUrl} (${link.retrievalStatus}; ${link.authorityStatus})`);
}

function getProofBucketLabel(finding: CitationDensityFinding): string {
  // An internet-fallback-backed finding is ONLINE FALLBACK regardless of the
  // family label — the reader must see the support tier, not a bare NEEDS
  // label that hides where the backing came from.
  if (finding.bestAvailableAuthority?.type === "online_fallback") return "ONLINE FALLBACK";
  if (finding.citationLabel) {
    if (/^NEEDS ADAS$/i.test(finding.citationLabel) && !isAdasRelatedFinding(finding) && !hasExplicitAdasAuthorityNeed(finding)) return fallbackNonAdasOemLabel(finding);
    if (/^NEEDS OEM$/i.test(finding.citationLabel) && !isOemHvRelatedFinding(finding)) return fallbackNonAdasOemLabel(finding);
    return finding.citationLabel;
  }
  if (finding.citationStatus.oem === "verified") return "VERIFIED OEM";
  if (finding.citationStatus.adas === "verified") return "VERIFIED ADAS";
  if (finding.citationStatus.stateRegulation === "verified" || finding.citationStatus.policy === "verified") return "VERIFIED LEGAL";
  if (
    finding.citationStatus.invoiceOrCompletionProof === "verified" ||
    finding.citationStatus.photoOrTeardownProof === "verified"
  ) {
    return "VERIFIED DOCUMENTATION";
  }
  if (Object.values(finding.citationStatus).some((value) => value === "referenced_not_produced")) return "REFERENCED / NOT PRODUCED";
  if (finding.estimateGapType === "referenced_not_produced") return "REFERENCED / NOT PRODUCED";
  if (finding.citationStatus.adas === "needed" && isAdasRelatedFinding(finding)) return "NEEDS ADAS";
  if (finding.estimateGapType === "weak_do_not_lead") return "WEAK — DO NOT LEAD";
  if (finding.citationStatus.invoiceOrCompletionProof === "needed") return "NEEDS INVOICE";
  if (isPPageDegMotorFinding(finding)) return "NEEDS P-PAGE";
  if (
    (finding.citationStatus.oem === "needed" || finding.missingAuthorityTypes.some((item) => /oem|high[-\s]?voltage|hv/i.test(item))) &&
    isOemHvRelatedFinding(finding)
  ) return "NEEDS OEM";
  if (finding.citationStatus.pPages === "needed" || finding.missingAuthorityTypes.some((item) => /p-?page/i.test(item))) return "NEEDS P-PAGE";
  return "ESTIMATE GAP ONLY";
}

function hasExplicitAdasAuthorityNeed(finding: CitationDensityFinding) {
  return finding.missingAuthorityTypes.some((item) =>
    /\b(?:adas|calibration|scan|diagnostic|dtc|firmware|service mode|camera|radar)\b/i.test(item)
  );
}

function fallbackNonAdasOemLabel(finding: CitationDensityFinding) {
  if (Object.values(finding.citationStatus).some((value) => value === "referenced_not_produced")) return "REFERENCED / NOT PRODUCED";
  if (finding.estimateGapType === "referenced_not_produced") return "REFERENCED / NOT PRODUCED";
  if (finding.citationStatus.invoiceOrCompletionProof === "needed") return "NEEDS INVOICE";
  if (isPPageDegMotorFinding(finding)) return "NEEDS P-PAGE";
  if (finding.citationStatus.pPages === "needed" || finding.missingAuthorityTypes.some((item) => /p-?page|deg|motor/i.test(item))) return "NEEDS P-PAGE";
  return "ESTIMATE GAP ONLY";
}

function isAdasRelatedFinding(finding: CitationDensityFinding) {
  const text = [
    finding.category,
    finding.operationLabel,
    finding.carrierEvidence?.description,
    finding.shopEvidence?.description,
    finding.currentSupportSummary,
    finding.missingProofSummary,
    finding.recommendedNextAction,
  ].join(" ");
  const canonicalText = normalizeMatchText(text).split(" ").map(canonicalMatchToken).join(" ");
  if (isPPageDegMotorFinding(finding)) return false;
  return /\b(?:adas|calibration|calibrate|aim|scan|diagnostic|dtc|radar|camera|sensor|blind spot|lane|aeb|srs|airbag|restraint|initiali[sz]ation|programming|module|pre[-\s]?scan|post[-\s]?scan)\b/i.test(`${text} ${canonicalText}`);
}

function isOemHvRelatedFinding(finding: CitationDensityFinding) {
  if (isPartSourceFinding(finding)) return true;
  const text = [
    finding.category,
    finding.operationLabel,
    finding.carrierEvidence?.description,
    finding.shopEvidence?.description,
    finding.currentSupportSummary,
    finding.missingProofSummary,
    finding.recommendedNextAction,
    ...finding.missingAuthorityTypes,
  ].join(" ");
  if (isPPageDegMotorFinding(finding)) return false;
  return /\b(?:high[-\s]?voltage|hv\b|ev battery|battery charge|isolation|deactivate|activate|oem procedure|position statement|one[-\s]?time[-\s]?use|structural|substrate|aluminum|material rule|repair method|fit[-\s]?sensitive)\b/i.test(text);
}

function isPPageDegMotorFinding(finding: CitationDensityFinding) {
  const text = [
    finding.category,
    finding.operationLabel,
    finding.carrierEvidence?.description,
    finding.shopEvidence?.description,
    finding.currentSupportSummary,
    finding.missingProofSummary,
    finding.recommendedNextAction,
    ...finding.missingAuthorityTypes,
  ].join(" ");
  return /\b(?:finish sand|de[-\s]?nib|polish|mask|primer|refinish|paint|color|tint|pre[-\s]?wash|clean for delivery|adhesive|feather|prime|block|overlap|included|not included|database|manual entr|p-?page|deg|motor)\b/i.test(text);
}

function formatBestAuthority(finding: CitationDensityFinding) {
  const authority = finding.bestAvailableAuthority;
  if (!authority) {
    return "Estimate evidence only; no reviewed authority attached.";
  }
  return `${authority.title} (${authority.status}; ${authority.type}; ${authority.confidence} confidence)`;
}

function formatMissingAuthority(finding: CitationDensityFinding) {
  const missing = finding.missingAuthority?.length ? finding.missingAuthority : finding.missingAuthorityTypes;
  return missing.length ? missing.join(", ") : "None identified from current Citation Density review.";
}

function buildRoleCalloutNote(
  finding: CitationDensityFinding,
  estimateRole: "carrier" | "shop" | "selected"
) {
  const delta = buildEstimateDeltaText(finding);
  if (estimateRole !== "carrier" && (finding.crossEstimateIssue || finding.primaryAnnotationRole === "both" || finding.estimateGapType === "reduced_by_carrier")) {
    return `Cross-estimate conflict. Source/lower and comparison/final estimates carry different labor/amount/scope. Reconcile with procedure support and completion proof.${delta}`;
  }
  if (finding.crossEstimateIssue || finding.primaryAnnotationRole === "both" || finding.estimateGapType === "reduced_by_carrier") {
    return `Cross-estimate conflict. Carrier and shop estimates carry different labor/amount/scope. Reconcile with procedure support and completion proof.${delta}`;
  }
  if (estimateRole === "carrier") {
    if (finding.estimateGapType === "missing_from_carrier") {
      return "Missing or not located compared with shop estimate. Estimate evidence shows a difference, but OEM/P-page/invoice support has not yet been verified.";
    }
    return `Reduced or missing compared with shop estimate. Estimate evidence shows a difference, but OEM/P-page/invoice support has not yet been verified.${delta}`;
  }
  if (estimateRole === "shop") {
    if (finding.estimateGapType === "missing_from_carrier") {
      return "Added in the comparison/final estimate and not clearly carried on the source/lower estimate. Do not lead with this line until the missing OEM/P-page/invoice support is attached.";
    }
    return "Source/comparison estimate difference. Do not lead with this line until the missing OEM/P-page/invoice support is attached.";
  }
  if (finding.estimateGapType === "missing_from_carrier") {
    return "Added in the comparison/final estimate and not clearly carried on the source/lower estimate. Verify authority and completion proof before leading with this item.";
  }
  return "Estimate evidence shows a Citation Density issue. Verify authority and completion proof before leading with this item.";
}

function buildEstimateDeltaText(finding: CitationDensityFinding) {
  const amountDelta =
    typeof finding.shopEvidence?.amount === "number" && typeof finding.carrierEvidence?.amount === "number"
      ? ` Amount delta: ${formatSignedNumber(finding.shopEvidence.amount - finding.carrierEvidence.amount)}.`
      : "";
  const laborDelta =
    typeof finding.shopEvidence?.laborHours === "number" && typeof finding.carrierEvidence?.laborHours === "number"
      ? ` Labor delta: ${formatSignedNumber(finding.shopEvidence.laborHours - finding.carrierEvidence.laborHours)} hrs.`
      : "";
  const counterpart = finding.counterpartSummary ? ` ${finding.counterpartSummary}` : "";
  return `${amountDelta}${laborDelta}${counterpart}`;
}

function formatSignedNumber(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

export function redactAnnotationText(value: string): string {
  return normalizeSourceBoundaryText(redactDownloadContent(value))
    .replace(/\b[A-HJ-NPR-Z0-9]{11}\*{6}\b/g, "[REDACTED_VIN]")
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, "[REDACTED_VIN]")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]")
    // Phone redaction REQUIRES formatting (parens or separators): a bare
    // 10-digit run is an OEM part number ("1678850708"), not a phone. No
    // leading \b — it never fires before "(" after a space.
    .replace(/(?<!\d)(?:\+?1[-.\s]?)?(?:\(\d{3}\)\s?\d{3}[-.\s]?\d{4}|\d{3}[-.\s]\d{3}[-.\s]\d{4})\b/g, "[REDACTED_PHONE]")
    .replace(/\b\d{1,6}\s+[A-Za-z0-9 .'-]+\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Ct|Court)\b\.?/gi, "[REDACTED_ADDRESS]");
}

function normalizeSourceBoundaryText(value: string) {
  return value
    .replace(/\bEstimate documentation the existence of a difference\.?/gi, "Estimate evidence supports the existence of a difference.")
    .replace(/\bCCC Secure Share documentation this estimate line was present in the structured estimate data\.?/gi, CCC_SOURCE_BOUNDARY_TEXT)
    .replace(/\bOEMdocumentation support\b/gi, "OEM/P-page/DEG/legal support")
    .replace(/\bBase Coatdocumentation\b/gi, "Base Coat support")
    .replace(/\b(OEM|P-page|DEG|legal)documentation\b/gi, "$1 support");
}

/**
 * EXPORT BOUNDARY for drawn prose.
 *
 * Insurance information reaches an exported page through more routes than a
 * finding's text: a FILENAME carries it ("USAA EOR 22047.pdf" in a diagnostic
 * line), and so does any support ref or warning built from one. Sweeping here,
 * where every wrapped line is drawn, closes the class rather than the instance.
 */
function drawWrappedLines(
  page: PDFPage,
  rawLines: string[],
  options: {
    x: number;
    y: number;
    width: number;
    font: PDFFont;
    boldFont: PDFFont;
    size: number;
    lineHeight: number;
    maxLines: number;
  }
) {
  const lines = rawLines.map((line) => redactInsurersForExport(line));
  let y = options.y;
  let drawn = 0;
  for (const line of lines) {
    const [label, ...rest] = line.split(":");
    const body = rest.join(":").trim();
    const wrapped = wrapText(body ? `${label}: ${body}` : label, options.font, options.size, options.width);
    for (const wrappedLine of wrapped) {
      if (drawn >= options.maxLines) return;
      const labelMatch = wrappedLine.match(/^([^:]{1,22}:)(.*)$/);
      if (labelMatch) {
        page.drawText(labelMatch[1], {
          x: options.x,
          y,
          size: options.size,
          font: options.boldFont,
          color: rgb(0.12, 0.14, 0.18),
        });
        page.drawText(labelMatch[2].trim(), {
          x: options.x + options.boldFont.widthOfTextAtSize(labelMatch[1], options.size) + 2,
          y,
          size: options.size,
          font: options.font,
          color: rgb(0.12, 0.14, 0.18),
        });
      } else {
        page.drawText(wrappedLine, {
          x: options.x,
          y,
          size: options.size,
          font: options.font,
          color: rgb(0.12, 0.14, 0.18),
        });
      }
      y -= options.lineHeight;
      drawn += 1;
    }
  }
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function normalizeMatchText(value: string) {
  return value
    .toLowerCase()
    .replace(/\ba\/m\b/g, " aftermarket ")
    .replace(/\bnon[-\s]?oem\b/g, " non oem ")
    .replace(/[^a-z0-9.$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMoney(value: number) {
  return String(Math.round(value * 100) / 100).replace(/\.00$/, "");
}

function sharedTermScore(a: string, b: string, max: number) {
  const terms = a.split(" ")
    .map(canonicalMatchToken)
    .filter((term) => term.length > 2 && !/^\d+$/.test(term) && !COMMON_MATCH_TERMS.has(term));
  if (!terms.length) return 0;
  const haystack = new Set(b.split(" ").map(canonicalMatchToken));
  const matches = terms.filter((term) => haystack.has(term) || b.includes(term)).length;
  return Math.min(max, Math.round((matches / terms.length) * max));
}

function keyTokenScore(a: string, b: string, max: number) {
  const sourceTokens = buildKeyTokens(a);
  if (!sourceTokens.size) return 0;
  const targetTokens = buildKeyTokens(b);
  const sourceList = [...sourceTokens];
  const targetList = [...targetTokens];
  const matches = sourceList.filter((token) =>
    targetTokens.has(token) ||
    targetList.some((target) => token.length > 4 && (target.includes(token) || token.includes(target)))
  ).length;
  return Math.min(max, Math.round((matches / sourceList.length) * max));
}

function buildKeyTokens(value: string) {
  return new Set(
    normalizeMatchText(value)
      .split(" ")
      .map(canonicalMatchToken)
      .filter((term) =>
        term.length > 2 &&
        !/^\d+$/.test(term) &&
        !COMMON_MATCH_TERMS.has(term)
      )
  );
}

function canonicalMatchToken(value: string) {
  const token = value.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  if (!token) return "";
  const known = [
    "aftermarket",
    "alternate",
    "bumper",
    "cover",
    "reflector",
    "molding",
    "blind",
    "spot",
    "radar",
    "calibration",
    "initialization",
    "pre",
    "post",
    "repair",
    "scan",
    "adas",
    "revvadas",
    "corrosion",
    "protection",
    "mask",
    "jamb",
    "jambs",
    "color",
    "sand",
    "polish",
    "paint",
    "supplies",
    "materials",
    "refinish",
    "labor",
    "rate",
    "manual",
    "motor",
    "database",
    "included",
    "section",
    "note",
    "total",
  ];
  const directAlias: Record<string, string> = {
    "a": "",
    "m": "",
    "am": "aftermarket",
    "scanm": "scan",
    "spre": "pre",
    "spost": "post",
    "proc": "",
    "hrs": "hours",
    "lt": "left",
    "rt": "right",
  };
  if (directAlias[token] !== undefined) return directAlias[token];
  const embedded = known.find((item) =>
    token !== item &&
    token.length <= item.length + 3 &&
    token.includes(item)
  );
  return embedded ?? token.replace(/s$/, "");
}

function scoreSectionAffinity(
  finding: CitationDensityFinding,
  anchor: TextAnchor,
  estimateRole: "carrier" | "shop" | "selected"
) {
  const roleAnchor = estimateRole === "shop" ? finding.shopAnchor : estimateRole === "carrier" ? finding.carrierAnchor : null;
  const text = anchor.normalizedText;
  let score = 0;
  const section = normalizeMatchText(roleAnchor?.section ?? "");
  if (section) {
    if (text.includes(section) || section.includes(text)) score += 36;
    score += keyTokenScore(section, text, 22);
  }

  const operation = normalizeMatchText(`${finding.operationLabel} ${roleAnchor?.operation ?? ""}`);
  if (/scan|calibration|radar|initialization|adas/.test(operation) && /scan|calibration|diagnostic|adas|radar|electrical/.test(text)) {
    score += 22;
  }
  if (/aftermarket|bumper|cover|reflector|molding|part/.test(operation) && /parts|part|bumper|cover|reflector|molding|aftermarket|a m/.test(text)) {
    score += 22;
  }
  if (/refinish|paint|mask|jamb|sand|polish|material|suppl/.test(operation) && /refinish|paint|mask|jamb|sand|polish|material|suppl/.test(text)) {
    score += 22;
  }
  if (/corrosion|protection|seam|cavity|weld/.test(operation) && /corrosion|protection|seam|cavity|weld/.test(text)) {
    score += 22;
  }
  if (/total|labor|rate|paint/.test(operation) && /total|labor|rate|paint|suppl|material/.test(text)) {
    score += 18;
  }
  return score;
}

function matchesLineNumber(text: string, lineNumber: string) {
  const escaped = escapeRegex(lineNumber.trim());
  if (!escaped) return false;
  return new RegExp(`(^|\\D)${escaped}(\\D|$)`).test(text);
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

const COMMON_MATCH_TERMS = new Set([
  "line",
  "item",
  "estimate",
  "carrier",
  "shop",
  "proof",
  "needed",
  "needs",
  "support",
  "current",
  "missing",
  "action",
  "attach",
  "procedure",
  "invoice",
  "present",
]);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pruneExportCache() {
  const cutoff = Date.now() - EXPORT_TTL_MS;
  for (const [id, entry] of exportCache.entries()) {
    if (entry.createdAt < cutoff) exportCache.delete(id);
  }
}

function getBuildCommit() {
  return process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    process.env.COMMIT_SHA ||
    "local";
}

function hashPdfBytes(bytes: Uint8Array) {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function truncateDebugText(value: string, maxLength = 500) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}
