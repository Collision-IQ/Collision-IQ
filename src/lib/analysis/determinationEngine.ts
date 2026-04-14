export type UploadedFile = {
  name?: string;
  text?: string | null;
  summary?: string | null;
  type?: string | null;
};

export type LinkedEvidence = {
  url?: string;
  finalUrl?: string;
  title?: string | null;
  mimeType?: string | null;
  sourceType?: "google_doc" | "google_drive" | "pdf" | "html" | "unknown";
  text?: string | null;
  status?: "ok" | "blocked" | "failed";
  notes?: string;
};

export type VehicleInfo = {
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  mileage?: number;
};

export type DeterminationInput = {
  vehicle?: VehicleInfo;
  estimateText?: string;
  files?: UploadedFile[];
  linkedEvidence?: LinkedEvidence[];
  extractedFacts?: Record<string, unknown>;
};

export type SupportLevel = "supported" | "partial" | "provisional" | "unsupported";

export type DeterminationSection = {
  title: string;
  status: SupportLevel;
  summary: string;
  evidence: string[];
  confidence: number;
};

export type ValuationResult = {
  status: SupportLevel;
  summary: string;
  confidence: number;
  rangeLow?: number;
  rangeHigh?: number;
  source: "jd_power" | "fallback" | "none";
  evidence: string[];
};

export type AdasResult = {
  status: SupportLevel;
  summary: string;
  confidence: number;
  state:
    | "baseline_scan_required"
    | "teardown_dependent"
    | "calibration_supported";
  evidence: string[];
};

export type DeterminationResult = {
  headline: string;
  determination: string;
  confidence: number;
  supportGaps: string[];
  cautionFlags: string[];
  sections: {
    scans: DeterminationSection;
    adas: AdasResult;
    structural: DeterminationSection;
    corrosion: DeterminationSection;
    valuation: ValuationResult;
    linkedEvidence: DeterminationSection;
  };
  debug: {
    evidenceStats: {
      uploadedFileCount: number;
      linkedEvidenceCount: number;
      accessibleLinkedEvidenceCount: number;
      blockedLinkedEvidenceCount: number;
    };
    vehicleFingerprint: string;
    oemGuardrailBlocks: string[];
  };
};

export type DeterminationEngineInput = DeterminationInput;
export type DeterminationEngineResult = DeterminationResult;

const TEARDOWN_SIGNALS = [
  "teardown",
  "disassemble",
  "disassembly",
  "after teardown",
  "hidden damage",
  "damage analysis complete",
  "tear down",
  "tear-down",
];

const SCAN_SIGNALS = [
  "pre-repair scan",
  "post-repair scan",
  "pre scan",
  "post scan",
  "diagnostic scan",
  "scan for diagnostic trouble codes",
  "dtc scan",
];

const INTERRUPTION_SIGNALS = [
  "disconnect",
  "reconnect",
  "battery disconnect",
  "module replacement",
  "bumper removal",
  "bumper replace",
  "bumper cover replace",
  "fascia replace",
  "headlamp replace",
  "lamp replace",
  "mirror replace",
  "radar",
  "camera",
  "sensor",
  "blind spot",
  "lane departure",
  "lane keep",
  "park sensor",
  "parking sensor",
  "adas",
  "front radar",
  "side radar",
  "surround view",
];

const SPECIFIC_CALIBRATION_SIGNALS = [
  "calibration",
  "static calibration",
  "dynamic calibration",
  "aiming",
  "headlamp aim",
  "headlamp aiming",
  "initialization",
  "programming",
  "setup procedure",
  "zero point calibration",
  "target alignment",
];

const STRUCTURAL_SIGNALS = [
  "frame",
  "unibody",
  "rail",
  "apron",
  "core support",
  "radiator support",
  "structural",
  "measure",
  "measuring",
  "three-dimensional measuring",
  "pull",
  "sectioning",
  "weld",
];

const CORROSION_SIGNALS = [
  "corrosion protection",
  "cavity wax",
  "anti-corrosion",
  "seam sealer",
  "undercoat",
  "refinish material",
];

const JD_POWER_SIGNALS = [
  "jd power",
  "j.d. power",
  "average trade-in value",
  "low trade-in",
  "high trade-in",
  "average price paid",
];

const BMW_ONLY_TERMS = ["kafas"];

function normalizeText(input?: string | null) {
  return (input || "").replace(/\s+/g, " ").trim();
}

function lower(input?: string | null) {
  return normalizeText(input).toLowerCase();
}

function uniqueStrings(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function scoreConfidence(base: number, boosts: number[] = []) {
  const total = boosts.reduce((sum, value) => sum + value, base);
  return Math.max(0, Math.min(100, total));
}

function firstMatchSnippet(text: string, signals: string[], radius = 120): string[] {
  const haystack = lower(text);
  const snippets: string[] = [];

  for (const signal of signals) {
    const idx = haystack.indexOf(signal.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - radius);
      const end = Math.min(text.length, idx + signal.length + radius);
      snippets.push(normalizeText(text.slice(start, end)));
    }
  }

  return uniqueStrings(snippets).slice(0, 5);
}

function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function findMoneyNearLabel(text: string, label: string): number | null {
  const regex = new RegExp(`${label}\\s*[:\\-]?\\s*\\$?([0-9,]+(?:\\.\\d{2})?)`, "i");
  const match = text.match(regex);
  return match?.[1] ? parseMoney(match[1]) : null;
}

function formatCurrency(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function vehicleFingerprint(vehicle?: VehicleInfo) {
  return [vehicle?.year, vehicle?.make, vehicle?.model, vehicle?.trim]
    .filter(Boolean)
    .join(" ");
}

function buildEvidenceCorpus(input: DeterminationInput) {
  const parts: string[] = [];

  if (input.estimateText) {
    parts.push(`ESTIMATE\n${input.estimateText}`);
  }

  for (const file of input.files || []) {
    parts.push(
      `UPLOADED FILE: ${file.name || "Untitled"}\n${file.text || file.summary || ""}`
    );
  }

  for (const doc of input.linkedEvidence || []) {
    if (doc.status !== "ok") continue;

    parts.push(
      [
        `LINKED DOCUMENT: ${doc.title || "Untitled"}`,
        `URL: ${doc.url || "Unknown"}`,
        `TYPE: ${doc.sourceType || "unknown"}`,
        doc.text || "",
      ].join("\n")
    );
  }

  return parts.join("\n\n");
}

function hasAny(text: string, signals: string[]) {
  const haystack = lower(text);
  return signals.some((signal) => haystack.includes(signal.toLowerCase()));
}

function countAny(text: string, signals: string[]) {
  const haystack = lower(text);
  return signals.reduce(
    (count, signal) => count + (haystack.includes(signal.toLowerCase()) ? 1 : 0),
    0
  );
}

function getLinkedEvidenceSummary(linkedEvidence: LinkedEvidence[]) {
  const accessible = linkedEvidence.filter((doc) => doc.status === "ok");
  const blocked = linkedEvidence.filter((doc) => doc.status === "blocked");

  const evidence: string[] = [];

  for (const doc of accessible.slice(0, 5)) {
    evidence.push(doc.title || doc.url || "Linked document");
  }

  for (const doc of blocked.slice(0, 3)) {
    evidence.push(`Blocked link: ${doc.title || doc.url || "Unknown link"}`);
  }

  return {
    accessible,
    blocked,
    evidence,
  };
}

function applyOemGuardrails(vehicle: VehicleInfo | undefined, text: string) {
  const make = lower(vehicle?.make);
  const blocks: string[] = [];

  if (make !== "bmw") {
    for (const term of BMW_ONLY_TERMS) {
      if (lower(text).includes(term)) {
        blocks.push(`Removed non-matching OEM term: ${term}`);
      }
    }
  }

  return blocks;
}

function buildScansSection(corpus: string): DeterminationSection {
  const evidence = firstMatchSnippet(corpus, SCAN_SIGNALS);
  const hasScanSignal = hasAny(corpus, SCAN_SIGNALS);

  if (hasScanSignal) {
    return {
      title: "Pre/Post Scan Support",
      status: "supported",
      summary:
        "The current file set supports standard pre-repair and post-repair diagnostic scanning.",
      evidence,
      confidence: scoreConfidence(75, [evidence.length * 3]),
    };
  }

  return {
    title: "Pre/Post Scan Support",
    status: "provisional",
    summary:
      "Standard pre/post scanning may still be appropriate, but the current file set does not yet clearly document those procedures.",
    evidence,
    confidence: 48,
  };
}

function buildAdasSection(corpus: string, vehicle?: VehicleInfo): AdasResult {
  const hasTeardownSignal = hasAny(corpus, TEARDOWN_SIGNALS);
  const hasScanSignal = hasAny(corpus, SCAN_SIGNALS);
  const hasInterruptionSignal = hasAny(corpus, INTERRUPTION_SIGNALS);
  const hasSpecificCalibrationSignal = hasAny(corpus, SPECIFIC_CALIBRATION_SIGNALS);

  const evidence = uniqueStrings([
    ...firstMatchSnippet(corpus, SPECIFIC_CALIBRATION_SIGNALS),
    ...firstMatchSnippet(corpus, INTERRUPTION_SIGNALS),
    ...firstMatchSnippet(corpus, SCAN_SIGNALS),
    ...firstMatchSnippet(corpus, TEARDOWN_SIGNALS),
  ]).slice(0, 6);

  const make = lower(vehicle?.make);

  if (hasSpecificCalibrationSignal) {
    const filteredEvidence =
      make !== "bmw"
        ? evidence.filter(
            (item) => !BMW_ONLY_TERMS.some((term) => lower(item).includes(term))
          )
        : evidence;

    return {
      status: "supported",
      state: "calibration_supported",
      summary:
        "The current documentation supports calibration-related procedures through explicit calibration, aiming, initialization, or equivalent procedure language.",
      confidence: scoreConfidence(80, [
        filteredEvidence.length * 2,
        hasInterruptionSignal ? 4 : 0,
        hasTeardownSignal ? 4 : 0,
      ]),
      evidence: filteredEvidence,
    };
  }

  if (!hasTeardownSignal && (hasScanSignal || hasInterruptionSignal)) {
    return {
      status: "provisional",
      state: "teardown_dependent",
      summary:
        "Baseline scanning is supported, but final ADAS calibration scope remains teardown-dependent. Additional requirements may arise if teardown confirms component damage, mounting disturbance, or interruption from disconnect/reconnect or related repair operations.",
      confidence: scoreConfidence(70, [
        hasScanSignal ? 6 : 0,
        hasInterruptionSignal ? 8 : 0,
        evidence.length,
      ]),
      evidence,
    };
  }

  if (hasScanSignal) {
    return {
      status: "partial",
      state: "baseline_scan_required",
      summary:
        "The current file set supports standard pre/post scanning, but it does not yet independently confirm a procedure-specific ADAS calibration requirement.",
      confidence: scoreConfidence(65, [evidence.length * 2]),
      evidence,
    };
  }

  return {
    status: "provisional",
    state: "teardown_dependent",
    summary:
      "No explicit calibration support is present yet. ADAS scope should remain provisional until teardown clarifies full damage and any interruption-related requirements.",
    confidence: 50,
    evidence,
  };
}

function buildStructuralSection(corpus: string): DeterminationSection {
  const structuralCount = countAny(corpus, STRUCTURAL_SIGNALS);
  const evidence = firstMatchSnippet(corpus, STRUCTURAL_SIGNALS);

  if (structuralCount >= 2) {
    return {
      title: "Structural / Measuring Support",
      status: "partial",
      summary:
        "The file set includes structural repair signals, but dedicated measuring or verification documentation may still be needed to fully support final structural procedures.",
      evidence,
      confidence: scoreConfidence(68, [evidence.length * 3, structuralCount * 2]),
    };
  }

  if (structuralCount === 1) {
    return {
      title: "Structural / Measuring Support",
      status: "provisional",
      summary:
        "There is some structural repair indication, but stronger measuring or verification support is still advisable.",
      evidence,
      confidence: 56,
    };
  }

  return {
    title: "Structural / Measuring Support",
    status: "unsupported",
    summary:
      "No clear structural measuring or verification support appears in the current file set.",
    evidence,
    confidence: 40,
  };
}

function buildCorrosionSection(corpus: string): DeterminationSection {
  const evidence = firstMatchSnippet(corpus, CORROSION_SIGNALS);
  const hasCorrosionSignal = hasAny(corpus, CORROSION_SIGNALS);

  if (hasCorrosionSignal) {
    return {
      title: "Corrosion Protection Support",
      status: "partial",
      summary:
        "Corrosion-protection-related language is present, but final support may still depend on clearer procedure-level documentation or confirmation of applied materials and locations.",
      evidence,
      confidence: scoreConfidence(66, [evidence.length * 3]),
    };
  }

  return {
    title: "Corrosion Protection Support",
    status: "provisional",
    summary:
      "The current documentation does not clearly confirm corrosion protection or cavity wax procedures.",
    evidence,
    confidence: 45,
  };
}

function buildLinkedEvidenceSection(linkedEvidence: LinkedEvidence[]): DeterminationSection {
  const { accessible, blocked, evidence } = getLinkedEvidenceSummary(linkedEvidence);

  if (accessible.length > 0) {
    return {
      title: "Linked OEM / ADAS Evidence",
      status: "supported",
      summary:
        "Linked documents were successfully retrieved and can be used as substantive case evidence, including OEM procedures or ADAS-related reports where applicable.",
      evidence,
      confidence: scoreConfidence(78, [accessible.length * 3]),
    };
  }

  if (blocked.length > 0) {
    return {
      title: "Linked OEM / ADAS Evidence",
      status: "provisional",
      summary:
        "Case links were detected, but one or more linked documents were blocked or not accessible to the system. Those links should not be treated as reviewed evidence until retrievable.",
      evidence,
      confidence: 52,
    };
  }

  return {
    title: "Linked OEM / ADAS Evidence",
    status: "unsupported",
    summary:
      "No retrievable linked OEM or ADAS evidence was preserved in the current case data.",
    evidence,
    confidence: 35,
  };
}

function buildValuationSection(input: DeterminationInput, corpus: string): ValuationResult {
  const jdPowerFile = (input.files || []).find((file) =>
    hasAny(`${file.name || ""}\n${file.text || file.summary || ""}`, JD_POWER_SIGNALS)
  );

  const jdPowerLinked = (input.linkedEvidence || []).find(
    (doc) => doc.status === "ok" && hasAny(`${doc.title || ""}\n${doc.text || ""}`, JD_POWER_SIGNALS)
  );

  const sourceText = jdPowerFile
    ? `${jdPowerFile.name || ""}\n${jdPowerFile.text || jdPowerFile.summary || ""}`
    : jdPowerLinked
      ? `${jdPowerLinked.title || ""}\n${jdPowerLinked.text || ""}`
      : "";

  if (sourceText) {
    const avgTrade = findMoneyNearLabel(sourceText, "average trade-in value");
    const lowTrade = findMoneyNearLabel(sourceText, "low trade-in");
    const highTrade = findMoneyNearLabel(sourceText, "high trade-in");
    const avgPaid = findMoneyNearLabel(sourceText, "average price paid");

    const rangeLow = lowTrade ?? avgTrade ?? undefined;
    const rangeHigh = highTrade ?? avgTrade ?? undefined;

    const evidence = uniqueStrings([
      avgTrade ? `Average trade-in value: ${formatCurrency(avgTrade)}` : "",
      lowTrade ? `Low trade-in: ${formatCurrency(lowTrade)}` : "",
      highTrade ? `High trade-in: ${formatCurrency(highTrade)}` : "",
      avgPaid ? `Average price paid: ${formatCurrency(avgPaid)}` : "",
      jdPowerFile ? `Source file: ${jdPowerFile.name || "JD Power upload"}` : "",
      jdPowerLinked
        ? `Source link: ${jdPowerLinked.title || jdPowerLinked.url || "JD Power link"}`
        : "",
    ]);

    return {
      status: "partial",
      summary:
        rangeLow && rangeHigh
          ? `JD Power market data is present and can anchor a stronger provisional market-value range of approximately ${formatCurrency(rangeLow)} to ${formatCurrency(rangeHigh)}. This is useful market context, but it should not be framed as formal ACV by itself.`
          : "JD Power market data is present and materially improves valuation context, though the extracted range is still incomplete.",
      confidence: scoreConfidence(76, [
        rangeLow ? 6 : 0,
        rangeHigh ? 6 : 0,
        avgPaid ? 3 : 0,
      ]),
      rangeLow,
      rangeHigh,
      source: "jd_power",
      evidence,
    };
  }

  const estimateAmountMatch = corpus.match(/\$([0-9,]+\.\d{2})/);
  const estimateAmount = estimateAmountMatch?.[1]
    ? parseMoney(estimateAmountMatch[1])
    : null;

  if (estimateAmount) {
    const rangeLow = Math.round(estimateAmount * 0.8);
    const rangeHigh = Math.round(estimateAmount * 1.15);

    return {
      status: "provisional",
      summary: `No stronger market-value support was preserved, so valuation remains fallback-driven. A rough provisional band of ${formatCurrency(rangeLow)} to ${formatCurrency(rangeHigh)} can be used only as a low-confidence placeholder until better market evidence is available.`,
      confidence: 38,
      rangeLow,
      rangeHigh,
      source: "fallback",
      evidence: [
        `Fallback seed from estimate-related amount: ${formatCurrency(estimateAmount)}`,
      ],
    };
  }

  return {
    status: "unsupported",
    summary: "No meaningful market valuation support was preserved in the current case data.",
    confidence: 20,
    source: "none",
    evidence: [],
  };
}

function buildSupportGaps(result: DeterminationResult["sections"]) {
  const gaps: string[] = [];

  if (result.adas.status !== "supported") {
    gaps.push("ADAS / calibration procedure support remains incomplete or teardown-dependent.");
  }

  if (result.structural.status !== "supported") {
    gaps.push("Structural measuring / verification support remains limited.");
  }

  if (result.corrosion.status !== "supported") {
    gaps.push("Corrosion protection / cavity wax support remains limited.");
  }

  if (result.valuation.source !== "jd_power") {
    gaps.push(
      "Stronger market-value evidence is still needed for a more credible provisional valuation range."
    );
  }

  if (result.linkedEvidence.status !== "supported") {
    gaps.push("Linked OEM / ADAS documents are missing, blocked, or not yet preserved as readable evidence.");
  }

  return uniqueStrings(gaps);
}

function buildCautionFlags(
  input: DeterminationInput,
  adas: AdasResult,
  linkedEvidenceSection: DeterminationSection
) {
  const flags: string[] = [];

  if (adas.state === "teardown_dependent") {
    flags.push("Teardown appears incomplete or not fully documented, so final ADAS scope remains provisional.");
  }

  if (linkedEvidenceSection.status === "provisional") {
    flags.push("One or more estimate-linked or file-linked documents were blocked and should not be treated as reviewed evidence.");
  }

  if (!input.vehicle?.make || !input.vehicle?.model) {
    flags.push("Vehicle identification is incomplete, which increases the risk of overly generic procedure reasoning.");
  }

  return uniqueStrings(flags);
}

function buildHeadline(
  vehicle: VehicleInfo | undefined,
  adas: AdasResult,
  valuation: ValuationResult
) {
  const label = vehicleFingerprint(vehicle) || "This vehicle";

  if (adas.status === "supported" && valuation.source === "jd_power") {
    return `${label}: procedure support is materially grounded, with linked / uploaded evidence supporting calibration-related reasoning and stronger market context.`;
  }

  if (adas.state === "teardown_dependent") {
    return `${label}: baseline scan support is present, but final ADAS scope remains teardown-dependent and should not be overstated before full damage discovery.`;
  }

  return `${label}: the current case supports a provisional collision analysis, but several procedure and valuation areas still need stronger evidence.`;
}

function buildDeterminationText(
  scans: DeterminationSection,
  adas: AdasResult,
  structural: DeterminationSection,
  corrosion: DeterminationSection,
  valuation: ValuationResult,
  linkedEvidence: DeterminationSection
) {
  return [
    scans.summary,
    adas.summary,
    structural.summary,
    corrosion.summary,
    valuation.summary,
    linkedEvidence.summary,
  ].join(" ");
}

export function runDeterminationEngine(input: DeterminationInput): DeterminationResult {
  const corpus = buildEvidenceCorpus(input);
  const scans = buildScansSection(corpus);
  const adas = buildAdasSection(corpus, input.vehicle);
  const structural = buildStructuralSection(corpus);
  const corrosion = buildCorrosionSection(corpus);
  const valuation = buildValuationSection(input, corpus);
  const linkedEvidence = buildLinkedEvidenceSection(input.linkedEvidence || []);

  const oemGuardrailBlocks = applyOemGuardrails(
    input.vehicle,
    [adas.summary, ...adas.evidence].join("\n")
  );

  const sections: DeterminationResult["sections"] = {
    scans,
    adas,
    structural,
    corrosion,
    valuation,
    linkedEvidence,
  };

  const supportGaps = buildSupportGaps(sections);
  const cautionFlags = buildCautionFlags(input, adas, linkedEvidence);
  const confidence = Math.round(
    (scans.confidence +
      adas.confidence +
      structural.confidence +
      corrosion.confidence +
      valuation.confidence +
      linkedEvidence.confidence) /
      6
  );

  return {
    headline: buildHeadline(input.vehicle, adas, valuation),
    determination: buildDeterminationText(
      scans,
      adas,
      structural,
      corrosion,
      valuation,
      linkedEvidence
    ),
    confidence,
    supportGaps,
    cautionFlags,
    sections,
    debug: {
      evidenceStats: {
        uploadedFileCount: input.files?.length || 0,
        linkedEvidenceCount: input.linkedEvidence?.length || 0,
        accessibleLinkedEvidenceCount:
          input.linkedEvidence?.filter((doc) => doc.status === "ok").length || 0,
        blockedLinkedEvidenceCount:
          input.linkedEvidence?.filter((doc) => doc.status === "blocked").length || 0,
      },
      vehicleFingerprint: vehicleFingerprint(input.vehicle),
      oemGuardrailBlocks,
    },
  };
}

export default runDeterminationEngine;
