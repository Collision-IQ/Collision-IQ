import type { AgentFindingEnhanced } from "./types/analysis";

type RetrievedDocumentSource = "google-drive" | "web";

type RetrievedDocument = {
  source: RetrievedDocumentSource;
  title: string;
  url?: string;
  text?: string;
  metadata?: Record<string, unknown>;
};

export type ClaimFingerprintInput = {
  jurisdiction?: string;
  mode?: string;
  userQuery?: string;
  shopEstimateText?: string;
  insurerEstimateText?: string;
  oemProcedureText?: string;
  retrievedDocuments?: RetrievedDocument[];
};

export type ClaimFingerprint = {
  vehicleProfile: {
    make: string | null;
    model: string | null;
    trim: string | null;
    year: string | null;
    adasRelevant: boolean;
  };
  damageProfile: {
    primaryImpactArea: string | null;
    secondaryAreas: string[];
    structuralSignals: string[];
    mechanicalSignals: string[];
    refinishSignals: string[];
    electricalSignals: string[];
    coolingSignals: string[];
    adasSignals: string[];
  };
  estimateProfile: {
    hasDuelingEstimates: boolean;
    laborDeltaDrivers: string[];
    partsDeltaDrivers: string[];
    procedureDeltaDrivers: string[];
    uniqueShopOperations: string[];
    uniqueCarrierOperations: string[];
    unsupportedOperations: string[];
  };
  retrievalProfile: {
    googleDriveDocsUsed: number;
    webDocsUsed: number;
    serperWorked: boolean;
    oemSourcesFound: boolean;
    legalSourcesFound: boolean;
    categories: Record<string, number>;
  };
  claimSpecificPriorities: string[];
  overusedNarrativesToAvoid: string[];
};

export type EvidenceMap = {
  corpusSignals: Record<string, string[]>;
  issueSupport: Record<string, EvidenceIssueSupport>;
};

export type EvidenceIssueSupport = {
  supported: boolean;
  evidenceSignals: string[];
  missingEvidence: string[];
  sourceSupport: GatedFinding["sourceSupport"];
};

export type GatedFinding = {
  id?: string;
  issue: string;
  finding?: string;
  include: boolean;
  reasonIncluded: string;
  reasonExcluded?: string;
  why_it_matters: string;
  what_proves_it: string;
  next_action: string;
  evidenceSignals: string[];
  missingEvidence: string[];
  evidenceLevel: "documented" | "referenced" | "inferred" | "missing" | "unsupported";
  confidence: number;
  claimSpecificity: "high" | "medium" | "low";
  sourceSupport: Array<"estimate" | "dueling-estimate" | "google-drive" | "web" | "serper" | "manual">;
  secondLevelReasoning: string;
  thirdLevelAction: string;
};

const OVERUSED_NARRATIVES = [
  "credible preliminary repair plan",
  "support remains open",
  "repair path appears supportable",
  "procedure support should not be treated as no support",
  "file documents several parts",
  "current file set supports",
  "the narrative supports",
];

type IssueKey =
  | "adas"
  | "structural"
  | "cooling"
  | "corrosion"
  | "testFit"
  | "oemFit"
  | "legal"
  | "scan"
  | "refinish"
  | "scopeDelta"
  | "laborDelta"
  | "partsDelta";

export function buildClaimFingerprint(input: ClaimFingerprintInput): ClaimFingerprint {
  const shopText = input.shopEstimateText ?? "";
  const insurerText = input.insurerEstimateText ?? "";
  const estimateCorpus = `${shopText}\n${insurerText}`;
  const fullCorpus = buildFullCorpus(input);
  const lowerCorpus = fullCorpus.toLowerCase();
  const categories = categorizeRetrievedDocuments(input.retrievedDocuments ?? []);
  const damageProfile = buildDamageProfile(estimateCorpus);
  const estimateProfile = buildEstimateProfile(shopText, insurerText);
  const retrievalProfile = {
    googleDriveDocsUsed: (input.retrievedDocuments ?? []).filter((document) => document.source === "google-drive").length,
    webDocsUsed: (input.retrievedDocuments ?? []).filter((document) => document.source === "web").length,
    serperWorked: (input.retrievedDocuments ?? []).some((document) => document.metadata?.sourceType === "serper"),
    oemSourcesFound: /oem|position statement|repair procedure|service manual|i-car|automaker/.test(lowerCorpus),
    legalSourcesFound: /statute|regulation|insurance code|commissioner|appraisal clause|public adjuster|bad faith/.test(lowerCorpus),
    categories,
  };
  const vehicleProfile = {
    ...extractVehicleProfile(estimateCorpus),
    adasRelevant: hasAny(damageProfile.adasSignals) || hasCategory(categories, "adas") || hasAdasVehicleSignal(lowerCorpus),
  };

  const provisionalFingerprint: ClaimFingerprint = {
    vehicleProfile,
    damageProfile,
    estimateProfile,
    retrievalProfile,
    claimSpecificPriorities: [],
    overusedNarrativesToAvoid: OVERUSED_NARRATIVES,
  };

  return {
    ...provisionalFingerprint,
    claimSpecificPriorities: buildClaimSpecificPriorities(provisionalFingerprint, input),
  };
}

export function buildEvidenceMap(input: ClaimFingerprintInput): EvidenceMap {
  const shopText = input.shopEstimateText ?? "";
  const insurerText = input.insurerEstimateText ?? "";
  const estimateText = `${shopText}\n${insurerText}`;
  const retrievedDocuments = input.retrievedDocuments ?? [];
  const docText = retrievedDocuments.map((document) => `${document.title}\n${document.text ?? ""}`).join("\n");
  const categories = categorizeRetrievedDocuments(retrievedDocuments);
  const impactAreas = detectImpactAreas(estimateText);
  const vehicleAdasSignal = hasAdasVehicleSignal(estimateText.toLowerCase());
  const structuralAreaAdjacent = impactAreas.some((area) => /front|rear|side|quarter|rocker|pillar|roof/.test(area));

  const adasSignals = [
    ...matches(estimateText, /\b(radar|camera|blind spot|lane|park sensor|parking sensor|adaptive cruise|calibration|aim|initialize|program|scan)\b/gi),
    ...categorySignals(categories, ["adas", "scan"]),
    ...(vehicleAdasSignal
      ? zoneSignals(impactAreas, ["front", "rear", "bumper", "grille", "windshield", "mirror", "quarter"])
      : []),
  ];
  const structuralSignals = [
    ...matches(estimateText, /\b(frame|measure|structural|rail|apron|pillar|core support|uniside|quarter|aperture|alignment)\b/gi),
    ...matches(docText, /\b(structural exposure|frame measurement|datum|rail|apron|pillar|quarter panel|core support)\b/gi),
  ].filter((signal) => signal !== "alignment" || structuralAreaAdjacent);
  const coolingSignals = [
    ...matches(estimateText, /\b(coolant|radiator|condenser|cooling|bleed|refill|reservoir|hose|fan|air purge)\b/gi),
    ...zoneSignals(impactAreas, ["front", "radiator", "condenser"]),
  ];
  const corrosionSignals = [
    ...matches(estimateText, /\b(corrosion|cavity wax|seam sealer|anti-corrosion|weld|panel replacement|quarter|uniside|pillar|rocker)\b/gi),
    ...matches(docText, /\b(corrosion protection|cavity wax|seam sealer|anti-corrosion)\b/gi),
  ];
  const testFitSignals = [
    ...matches(estimateText, /\b(test fit|mock-up|mock up|trial fit|pre-fit|prefit)\b/gi),
    ...matches(estimateText, /\b(quarter|uniside|aperture|hood|fender|door|decklid|liftgate|bumper|fascia)\b/gi),
  ];
  const oemFitSignals = [
    ...matches(estimateText, /\b(a\/m|aftermarket|lkq|recycled|reconditioned|reman|remanufactured)\b/gi),
    ...matches(estimateText, /\b(headlamp|tail lamp|lamp|mirror|camera|sensor|bumper|fascia|grille|hood|fender|radar)\b/gi),
  ];
  const legalSignals = input.mode === "dispute" && input.jurisdiction && hasLegalSource(retrievedDocuments)
    ? [`${input.jurisdiction} public legal retrieval`]
    : [];
  const scanSignals = matches(estimateText, /\b(pre-?scan|post-?scan|diagnostic scan|dtc|diagnostic)\b/gi);
  const refinishSignals = matches(estimateText, /\b(refinish|blend|clear coat|color tint|finish sand|polish|paint)\b/gi);
  const scopeDeltaSignals = buildDeltaSignals(shopText, insurerText);

  return {
    corpusSignals: {
      impactAreas,
      adasSignals,
      structuralSignals,
      coolingSignals,
      corrosionSignals,
      testFitSignals,
      oemFitSignals,
      legalSignals,
      scanSignals,
      refinishSignals,
      scopeDeltaSignals,
    },
    issueSupport: {
      adas: supportFromSignals(adasSignals, "ADAS/scan/calibration evidence is not present in estimate text, retrieved sources, or sensor-zone impact signals.", sourceSupportForSignals(adasSignals, retrievedDocuments, "estimate")),
      structural: supportFromSignals(structuralSignals, "Structural measurement requires frame, measuring, structural component, exposure, or dueling-estimate geometry evidence.", sourceSupportForSignals(structuralSignals, retrievedDocuments, "estimate")),
      cooling: supportFromSignals(coolingSignals, "Cooling fill or bleed requires cooling-system text or a clear cooling-system repair path in the estimate.", sourceSupportForSignals(coolingSignals, retrievedDocuments, "estimate")),
      corrosion: supportFromSignals(corrosionSignals, "Corrosion protection requires corrosion/weld/panel-replacement text and repair-type procedure support.", sourceSupportForSignals(corrosionSignals, retrievedDocuments, "estimate")),
      testFit: supportFromSignals(testFitSignals, "Test fit requires test-fit language, adjacent fit-sensitive panel replacement, or a fit/access delta.", ["estimate"]),
      oemFit: supportFromSignals(oemFitSignals, "OEM fit posture requires alternate-part text on a fit-sensitive or ADAS-bearing component.", ["estimate"]),
      legal: supportFromSignals(legalSignals, "Legal/appraisal context requires dispute mode, jurisdiction, and public legal retrieval.", legalSignals.length > 0 ? ["web"] : []),
      scan: supportFromSignals(scanSignals, "Diagnostic scan requires scan, DTC, diagnostic, OEM procedure, or electrical/ADAS evidence.", sourceSupportForSignals(scanSignals, retrievedDocuments, "estimate")),
      refinish: supportFromSignals(refinishSignals, "Refinish issue requires refinish, blend, paint, finish sand, or polish evidence.", ["estimate"]),
      scopeDelta: supportFromSignals(scopeDeltaSignals, "Scope delta requires meaningful line, labor, cost, or operation differences between estimates.", ["dueling-estimate"]),
      laborDelta: supportFromSignals(scopeDeltaSignals.filter((signal) => /labor|hour/i.test(signal)), "Labor delta requires differing labor-hour or labor-operation evidence.", ["dueling-estimate"]),
      partsDelta: supportFromSignals(scopeDeltaSignals.filter((signal) => /part|alternate|aftermarket|lkq|recycled/i.test(signal)), "Parts delta requires differing parts, alternate-part, or parts-price evidence.", ["dueling-estimate"]),
    },
  };
}

export function buildReportAgenda(
  fingerprint: ClaimFingerprint,
  evidenceMap: EvidenceMap
): string[] {
  return fingerprint.claimSpecificPriorities.filter((priority) => {
    const key = classifyIssue(priority);
    return !key || evidenceMap.issueSupport[key]?.supported;
  });
}

export function shouldIncludeFinding(
  finding: AgentFindingEnhanced | GatedFinding,
  fingerprint: ClaimFingerprint,
  evidenceMap: EvidenceMap
): GatedFinding {
  const issue = finding.issue;
  const issueKey = classifyIssue(issue);
  const evidenceSupport = issueKey ? evidenceMap.issueSupport[issueKey] : evidenceMap.issueSupport.scopeDelta;
  const evidenceLevel = normalizeEvidenceLevel(finding.evidenceLevel, evidenceSupport?.supported);
  const sourceSupport = normalizeSourceSupport("sourceSupport" in finding ? finding.sourceSupport : finding.supportSources);
  const claimSpecificity = scoreClaimSpecificity(issue, fingerprint, evidenceMap);
  const confidence = clampConfidence(finding.confidence);
  const defaultTheme = isDefaultCollisionTheme(issue);
  const genericText = hasGenericNarrative([issue, "finding" in finding ? finding.finding : "", finding.secondLevelReasoning].join(" "));
  const supportMissing = issueKey ? !evidenceSupport?.supported : false;

  let include = true;
  const exclusionReasons: string[] = [];

  if ("include" in finding && finding.include === false) {
    include = false;
    exclusionReasons.push(finding.reasonExcluded ?? "Agent marked the finding for exclusion.");
  }
  if (supportMissing) {
    include = false;
    exclusionReasons.push(evidenceSupport?.missingEvidence[0] ?? "Claim-specific evidence support is missing.");
  }
  if (confidence < 0.55) {
    include = false;
    exclusionReasons.push("Confidence is below the 0.55 gate.");
  }
  if (claimSpecificity === "low" && evidenceLevel !== "documented") {
    include = false;
    exclusionReasons.push("Claim specificity is low and the issue is not documented.");
  }
  if (defaultTheme && !evidenceSupport?.supported) {
    include = false;
    exclusionReasons.push("Issue appears only as a default/common collision theme.");
  }
  if (genericText && claimSpecificity === "low") {
    include = false;
    exclusionReasons.push("Finding relies on repeated generic narrative language.");
  }

  return {
    issue,
    finding: "finding" in finding ? finding.finding : undefined,
    include,
    reasonIncluded: include
      ? buildReasonIncluded(issue, evidenceSupport, claimSpecificity)
      : "",
    reasonExcluded: include ? undefined : exclusionReasons.join(" "),
    why_it_matters: replaceGenericLanguage(finding.secondLevelReasoning, evidenceSupport?.evidenceSignals ?? []),
    what_proves_it: buildWhatProvesIt(issue, evidenceSupport, fingerprint),
    next_action: replaceGenericLanguage(finding.thirdLevelAction, evidenceSupport?.evidenceSignals ?? []),
    evidenceSignals: evidenceSupport?.evidenceSignals ?? [],
    missingEvidence: evidenceSupport?.missingEvidence ?? [],
    evidenceLevel,
    confidence,
    claimSpecificity,
    sourceSupport: dedupeSourceSupport([
      ...sourceSupport,
      ...(evidenceSupport?.sourceSupport ?? []),
    ]),
    secondLevelReasoning: replaceGenericLanguage(finding.secondLevelReasoning, evidenceSupport?.evidenceSignals ?? []),
    thirdLevelAction: replaceGenericLanguage(finding.thirdLevelAction, evidenceSupport?.evidenceSignals ?? []),
  };
}

export function suppressGenericNarratives<T extends AgentFindingEnhanced | GatedFinding>(
  findings: T[],
  fingerprint: ClaimFingerprint
): T[] {
  return findings.map((finding) => {
    const signals = fingerprint.claimSpecificPriorities;
    return {
      ...finding,
      secondLevelReasoning: replaceGenericLanguage(finding.secondLevelReasoning, signals),
      thirdLevelAction: replaceGenericLanguage(finding.thirdLevelAction, signals),
    };
  });
}

export function countGenericNarrativePhrases(values: string[]): number {
  return values.reduce((count, value) => {
    const lower = value.toLowerCase();
    return count + OVERUSED_NARRATIVES.reduce((phraseCount, phrase) => {
      const pattern = new RegExp(escapeRegExp(phrase), "gi");
      return phraseCount + (lower.match(pattern)?.length ?? 0);
    }, 0);
  }, 0);
}

function buildFullCorpus(input: ClaimFingerprintInput): string {
  return [
    input.userQuery,
    input.shopEstimateText,
    input.insurerEstimateText,
    input.oemProcedureText,
    ...(input.retrievedDocuments ?? []).map((document) => `${document.title}\n${document.text ?? ""}`),
  ]
    .filter(Boolean)
    .join("\n");
}

function extractVehicleProfile(text: string) {
  const year = text.match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
  const knownMakes = [
    "Acura", "Audi", "BMW", "Buick", "Cadillac", "Chevrolet", "Chrysler", "Dodge",
    "Ford", "Genesis", "GMC", "Honda", "Hyundai", "Infiniti", "Jaguar", "Jeep",
    "Kia", "Lexus", "Lincoln", "Mazda", "Mercedes", "Mini", "Nissan", "Porsche",
    "Ram", "Subaru", "Tesla", "Toyota", "Volkswagen", "Volvo",
  ];
  const make = knownMakes.find((candidate) => new RegExp(`\\b${escapeRegExp(candidate)}\\b`, "i").test(text)) ?? null;
  const model = make
    ? text.match(new RegExp(`\\b${escapeRegExp(make)}\\s+([A-Z0-9][A-Za-z0-9-]{1,18})`, "i"))?.[1] ?? null
    : null;
  const trim = text.match(/\b(?:trim|submodel|series)\s*[:#-]?\s*([A-Za-z0-9 -]{2,30})/i)?.[1]?.trim() ?? null;
  return { make, model, trim, year };
}

function buildDamageProfile(text: string): ClaimFingerprint["damageProfile"] {
  const primaryImpactArea = detectImpactAreas(text)[0] ?? null;
  return {
    primaryImpactArea,
    secondaryAreas: detectImpactAreas(text).slice(1),
    structuralSignals: matches(text, /\b(frame|structural|measure|rail|apron|pillar|core support|uniside|quarter|aperture|alignment)\b/gi),
    mechanicalSignals: matches(text, /\b(suspension|steering|alignment|knuckle|control arm|strut|wheel|hub|axle)\b/gi),
    refinishSignals: matches(text, /\b(refinish|blend|paint|clear coat|finish sand|polish)\b/gi),
    electricalSignals: matches(text, /\b(wire|wiring|harness|connector|sensor|module|program|initialize|scan|dtc)\b/gi),
    coolingSignals: matches(text, /\b(coolant|radiator|condenser|cooling|bleed|refill|reservoir|hose|fan|air purge)\b/gi),
    adasSignals: matches(text, /\b(radar|camera|blind spot|lane|park sensor|parking sensor|adaptive cruise|calibration|aim|initialize|program|scan)\b/gi),
  };
}

function buildEstimateProfile(shopText: string, insurerText: string): ClaimFingerprint["estimateProfile"] {
  const hasDuelingEstimates = shopText.trim().length > 0 && insurerText.trim().length > 0;
  const shopLines = lineSet(shopText);
  const carrierLines = lineSet(insurerText);
  const uniqueShopOperations = [...shopLines].filter((line) => !carrierLines.has(line)).slice(0, 25);
  const uniqueCarrierOperations = [...carrierLines].filter((line) => !shopLines.has(line)).slice(0, 25);
  return {
    hasDuelingEstimates,
    laborDeltaDrivers: matches(`${shopText}\n${insurerText}`, /\b(body labor|refinish labor|mech(?:anical)? labor|frame labor|labor hours?|hrs?)\b/gi),
    partsDeltaDrivers: matches(`${shopText}\n${insurerText}`, /\b(part|oem|a\/m|aftermarket|lkq|recycled|reconditioned|reman)\b/gi),
    procedureDeltaDrivers: matches(`${shopText}\n${insurerText}`, /\b(scan|calibration|aim|measure|blend|corrosion|cavity wax|test fit|finish sand|polish)\b/gi),
    uniqueShopOperations,
    uniqueCarrierOperations,
    unsupportedOperations: uniqueShopOperations.filter((line) => /scan|calibration|measure|corrosion|test fit|blend|coolant|sublet/i.test(line)),
  };
}

function categorizeRetrievedDocuments(documents: RetrievedDocument[]): Record<string, number> {
  const categories: Record<string, number> = {};
  for (const document of documents) {
    const text = `${document.title}\n${document.text ?? ""}`.toLowerCase();
    for (const category of [
      ["adas", /\b(adas|calibration|radar|camera|blind spot|lane|park sensor|scan)\b/],
      ["structural", /\b(frame|structural|rail|apron|pillar|quarter|core support|measurement)\b/],
      ["cooling", /\b(coolant|radiator|condenser|cooling|bleed|air purge)\b/],
      ["corrosion", /\b(corrosion|cavity wax|seam sealer|anti-corrosion)\b/],
      ["legal", /\b(statute|regulation|insurance code|commissioner|appraisal clause)\b/],
      ["refinish", /\b(refinish|blend|paint|clear coat|finish sand|polish)\b/],
    ] as const) {
      if (category[1].test(text)) {
        categories[category[0]] = (categories[category[0]] ?? 0) + 1;
      }
    }
  }
  return categories;
}

function buildClaimSpecificPriorities(
  fingerprint: ClaimFingerprint,
  input: ClaimFingerprintInput
): string[] {
  const priorities: string[] = [];
  const damage = fingerprint.damageProfile;
  const estimate = fingerprint.estimateProfile;
  const retrieval = fingerprint.retrievalProfile;

  if (estimate.hasDuelingEstimates && estimate.uniqueShopOperations.length > 0) {
    priorities.push("Line-item scope differences between shop and carrier estimates");
  }
  if (estimate.laborDeltaDrivers.length > 0) {
    priorities.push("Labor-hour or access differences documented in the estimates");
  }
  if (estimate.partsDeltaDrivers.length > 0) {
    priorities.push("Parts type, sourcing, or price differences documented in the estimates");
  }
  if (damage.adasSignals.length > 0 || retrieval.categories.adas > 0) {
    priorities.push("ADAS, scan, calibration, or aiming items tied to estimate text or retrieved procedure support");
  }
  if (damage.structuralSignals.length > 0 || retrieval.categories.structural > 0) {
    priorities.push("Structural, measuring, alignment, or geometry items tied to the damaged area");
  }
  if (damage.coolingSignals.length > 0 || retrieval.categories.cooling > 0) {
    priorities.push("Cooling-system access, fill, bleed, or replacement items");
  }
  if (damage.refinishSignals.length > 0 || retrieval.categories.refinish > 0) {
    priorities.push("Refinish, blend, finish-sand, or polish items supported by the estimate");
  }
  if (retrieval.categories.corrosion > 0 || /\b(corrosion|cavity wax|seam sealer|weld|quarter|pillar|rocker|uniside)\b/i.test(input.shopEstimateText ?? "")) {
    priorities.push("Corrosion protection tied to welded or enclosed-panel repair evidence");
  }
  if (input.mode === "dispute" && input.jurisdiction && retrieval.legalSourcesFound) {
    priorities.push(`${input.jurisdiction} public legal/appraisal context for dispute mode`);
  }

  return dedupe(priorities).slice(0, 8);
}

function classifyIssue(issue: string): IssueKey | null {
  const lower = issue.toLowerCase();
  if (/adas|calibration|radar|camera|blind spot|lane|park sensor|aim|initialize|program|transport/.test(lower)) return "adas";
  if (/scan|diagnostic|dtc/.test(lower)) return "scan";
  if (/structural|frame|measure|rail|apron|pillar|core support|uniside|quarter|aperture|geometry/.test(lower)) return "structural";
  if (/coolant|radiator|condenser|cooling|bleed|reservoir|hose|fan|air purge/.test(lower)) return "cooling";
  if (/corrosion|cavity wax|seam sealer|anti-corrosion|weld/.test(lower)) return "corrosion";
  if (/test fit|mock-up|mock up|trial fit|pre-fit|prefit|fit\/finish/.test(lower)) return "testFit";
  if (/oem fit|aftermarket|a\/m|lkq|recycled|reconditioned|reman|alternate/.test(lower)) return "oemFit";
  if (/legal|appraisal|statute|regulation|insurance code/.test(lower)) return "legal";
  if (/refinish|blend|finish sand|polish|paint/.test(lower)) return "refinish";
  if (/body labor|labor hour|hours gap/.test(lower)) return "laborDelta";
  if (/part|parts|sourcing/.test(lower)) return "partsDelta";
  if (/scope|cost gap|estimate/.test(lower)) return "scopeDelta";
  return null;
}

function normalizeEvidenceLevel(level: unknown, supported?: boolean): GatedFinding["evidenceLevel"] {
  if (level === "documented" || level === "referenced" || level === "inferred" || level === "missing" || level === "unsupported") {
    return level;
  }
  return supported ? "referenced" : "unsupported";
}

function normalizeSourceSupport(sources: unknown): GatedFinding["sourceSupport"] {
  if (!Array.isArray(sources)) {
    return [];
  }
  return sources
    .map((source) => source === "upload" ? "estimate" : source)
    .filter((source): source is GatedFinding["sourceSupport"][number] =>
      source === "estimate" ||
      source === "dueling-estimate" ||
      source === "google-drive" ||
      source === "web" ||
      source === "serper" ||
      source === "manual"
    );
}

function scoreClaimSpecificity(
  issue: string,
  fingerprint: ClaimFingerprint,
  evidenceMap: EvidenceMap
): GatedFinding["claimSpecificity"] {
  const key = classifyIssue(issue);
  if (key && evidenceMap.issueSupport[key]?.evidenceSignals.length >= 2) return "high";
  if (fingerprint.claimSpecificPriorities.some((priority) => classifyIssue(priority) === key || priority.toLowerCase().includes(issue.toLowerCase()))) return "medium";
  if (key && evidenceMap.issueSupport[key]?.supported) return "medium";
  return "low";
}

function buildReasonIncluded(
  issue: string,
  support: EvidenceIssueSupport | undefined,
  specificity: GatedFinding["claimSpecificity"]
): string {
  const signals = support?.evidenceSignals.slice(0, 3).join(", ");
  return `${issue} passed the claim-specific gate with ${specificity} specificity${signals ? ` based on: ${signals}` : ""}.`;
}

function buildWhatProvesIt(
  issue: string,
  support: EvidenceIssueSupport | undefined,
  fingerprint: ClaimFingerprint
): string {
  const signals = support?.evidenceSignals ?? [];
  if (signals.length > 0) {
    return `${signals.slice(0, 4).join(", ")}.`;
  }

  const relatedPriority = fingerprint.claimSpecificPriorities.find((priority) =>
    priority.toLowerCase().includes(issue.toLowerCase())
  );
  if (relatedPriority) {
    return `${relatedPriority}.`;
  }

  return "No claim-specific proof signal was found for this finding.";
}

function supportFromSignals(
  evidenceSignals: string[],
  missingEvidence: string,
  sourceSupport: GatedFinding["sourceSupport"]
): EvidenceIssueSupport {
  const uniqueSignals = dedupe(evidenceSignals.map((signal) => signal.trim()).filter(Boolean));
  return {
    supported: uniqueSignals.length > 0,
    evidenceSignals: uniqueSignals.slice(0, 20),
    missingEvidence: uniqueSignals.length > 0 ? [] : [missingEvidence],
    sourceSupport,
  };
}

function sourceSupportForSignals(
  signals: string[],
  documents: RetrievedDocument[],
  fallback: GatedFinding["sourceSupport"][number]
): GatedFinding["sourceSupport"] {
  const sources: GatedFinding["sourceSupport"] = signals.length > 0 ? [fallback] : [];
  const retrievalCategorySignal = signals.some((signal) =>
    /retrieval category/i.test(signal)
  );
  const docsWithSignal = documents.filter((document) => {
    const text = `${document.title}\n${document.text ?? ""}`.toLowerCase();
    return retrievalCategorySignal ||
      signals.some((signal) => signal.length > 3 && text.includes(signal.toLowerCase()));
  });
  if (docsWithSignal.some((document) => document.source === "google-drive")) sources.push("google-drive");
  if (docsWithSignal.some((document) => document.source === "web")) sources.push("web");
  if (docsWithSignal.some((document) => document.metadata?.sourceType === "serper")) sources.push("serper");
  return dedupeSourceSupport(sources);
}

function replaceGenericLanguage(text: string, signals: string[]): string {
  let output = text;
  const replacement = signals.length > 0
    ? `Claim-specific support comes from ${signals.slice(0, 3).join(", ")}.`
    : "No claim-specific evidence signal has been documented for this issue.";
  for (const phrase of OVERUSED_NARRATIVES) {
    output = output.replace(new RegExp(escapeRegExp(phrase), "gi"), replacement);
  }
  return output;
}

function hasGenericNarrative(text: string): boolean {
  return OVERUSED_NARRATIVES.some((phrase) => text.toLowerCase().includes(phrase));
}

function isDefaultCollisionTheme(issue: string): boolean {
  return /adas|structural|coolant|cooling|corrosion|cavity wax|test fit|oem fit|aftermarket|legal|appraisal/.test(issue.toLowerCase());
}

function detectImpactAreas(text: string): string[] {
  return matches(text, /\b(front|rear|left|right|lh|rh|driver|passenger|bumper|fascia|grille|hood|fender|door|quarter|rocker|pillar|roof|windshield|radiator|condenser)\b/gi);
}

function buildDeltaSignals(shopText: string, insurerText: string): string[] {
  if (!shopText.trim() || !insurerText.trim()) {
    return [];
  }
  const shopLines = lineSet(shopText);
  const carrierLines = lineSet(insurerText);
  const uniqueShopCount = [...shopLines].filter((line) => !carrierLines.has(line)).length;
  const uniqueCarrierCount = [...carrierLines].filter((line) => !shopLines.has(line)).length;
  const signals: string[] = [];
  if (uniqueShopCount > 0) signals.push(`${uniqueShopCount} shop-only operation lines`);
  if (uniqueCarrierCount > 0) signals.push(`${uniqueCarrierCount} carrier-only operation lines`);
  signals.push(...matches(`${shopText}\n${insurerText}`, /\b(labor hours?|body labor|refinish labor|parts total|subtotal|estimate total|a\/m|aftermarket|lkq|recycled)\b/gi));
  return signals;
}

function lineSet(text: string): Set<string> {
  return new Set(
    text
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\s+/g, " ").toLowerCase())
      .filter((line) => line.length > 4)
  );
}

function matches(text: string, pattern: RegExp): string[] {
  return dedupe(Array.from(text.matchAll(pattern)).map((match) => match[0].trim().toLowerCase()));
}

function categorySignals(categories: Record<string, number>, names: string[]): string[] {
  return names.flatMap((name) => categories[name] ? [`${name} retrieval category (${categories[name]})`] : []);
}

function zoneSignals(areas: string[], zones: string[]): string[] {
  return areas.filter((area) => zones.includes(area.toLowerCase())).map((area) => `${area} impact/sensor-zone signal`);
}

function hasCategory(categories: Record<string, number>, name: string): boolean {
  return (categories[name] ?? 0) > 0;
}

function hasAny(values: unknown[]): boolean {
  return values.length > 0;
}

function hasAdasVehicleSignal(text: string): boolean {
  return /\b(limited|platinum|touring|elite|premium|technology|safety sense|eyesight|copilot|pro pilot|driver assist)\b/.test(text);
}

function hasLegalSource(documents: RetrievedDocument[]): boolean {
  return documents.some((document) => {
    const text = `${document.title}\n${document.text ?? ""}`.toLowerCase();
    return document.source === "web" && /\b(statute|regulation|insurance code|commissioner|appraisal clause|department of insurance)\b/.test(text);
  });
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function dedupeSourceSupport(values: GatedFinding["sourceSupport"]): GatedFinding["sourceSupport"] {
  return [...new Set(values)];
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
