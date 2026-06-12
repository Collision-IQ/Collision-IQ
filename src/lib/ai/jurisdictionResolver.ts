import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";

export type ResolvedJurisdiction = {
  state: string | null;
  stateCode: string | null;
  confidence: "high" | "medium" | "low" | "unknown";
  source:
    | "explicit_user"
    | "policy_governing_law"
    | "owner_zip"
    | "owner_address"
    | "insured_zip"
    | "insured_address"
    | "shop_zip_fallback"
    | "shop_address_fallback"
    | "inspection_site_zip_fallback"
    | "inspection_site_address_fallback"
    | "unknown";
  basis: string;
  evidenceLabel: string;
  limitations: string[];
};

type JurisdictionResolverInput = {
  explicitJurisdiction?: string | null;
  report?: RepairIntelligenceReport | null;
  analysis?: unknown;
  panel?: unknown;
  assistantAnalysis?: string | null;
  renderModel?: unknown;
};

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  IA: "Iowa",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  MA: "Massachusetts",
  MD: "Maryland",
  ME: "Maine",
  MI: "Michigan",
  MN: "Minnesota",
  MO: "Missouri",
  MS: "Mississippi",
  MT: "Montana",
  NC: "North Carolina",
  ND: "North Dakota",
  NE: "Nebraska",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NV: "Nevada",
  NY: "New York",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VA: "Virginia",
  VT: "Vermont",
  WA: "Washington",
  WI: "Wisconsin",
  WV: "West Virginia",
  WY: "Wyoming",
};

const ZIP_RANGES: Array<[number, number, string]> = [
  [35000, 36999, "AL"],
  [99500, 99999, "AK"],
  [85000, 86599, "AZ"],
  [71600, 72999, "AR"],
  [90000, 96699, "CA"],
  [80000, 81699, "CO"],
  [6000, 6999, "CT"],
  [19700, 19999, "DE"],
  [32000, 34999, "FL"],
  [30000, 31999, "GA"],
  [96700, 96899, "HI"],
  [83200, 83899, "ID"],
  [60000, 62999, "IL"],
  [46000, 47999, "IN"],
  [50000, 52899, "IA"],
  [66000, 67999, "KS"],
  [40000, 42799, "KY"],
  [70000, 71599, "LA"],
  [3900, 4999, "ME"],
  [20600, 21999, "MD"],
  [1000, 2799, "MA"],
  [48000, 49999, "MI"],
  [55000, 56799, "MN"],
  [38600, 39799, "MS"],
  [63000, 65999, "MO"],
  [59000, 59999, "MT"],
  [27000, 28999, "NC"],
  [58000, 58899, "ND"],
  [68000, 69399, "NE"],
  [3000, 3899, "NH"],
  [7000, 8999, "NJ"],
  [87000, 88499, "NM"],
  [88900, 89899, "NV"],
  [10000, 14999, "NY"],
  [43000, 45999, "OH"],
  [73000, 74999, "OK"],
  [97000, 97999, "OR"],
  [15000, 19699, "PA"],
  [2800, 2999, "RI"],
  [29000, 29999, "SC"],
  [57000, 57799, "SD"],
  [37000, 38599, "TN"],
  [75000, 79999, "TX"],
  [88500, 88599, "TX"],
  [84000, 84999, "UT"],
  [20100, 20599, "VA"],
  [22000, 24699, "VA"],
  [5000, 5999, "VT"],
  [98000, 99499, "WA"],
  [53000, 54999, "WI"],
  [24700, 26899, "WV"],
  [82000, 83199, "WY"],
];

const ZIP_PATTERN = /(?<![\d.])(\d{5})(?:-\d{4})?(?![\d.])/g;

export function resolveJurisdiction(input: JurisdictionResolverInput): ResolvedJurisdiction {
  const explicit =
    normalizeStateCode(input.explicitJurisdiction) ??
    normalizeStateCode(getNestedString(input.report, "claimState")) ??
    normalizeStateCode(getNestedString(input.report, "claim_state")) ??
    normalizeStateCode(getNestedString(input.report, "jurisdiction")) ??
    normalizeStateCode(getNestedString(input.panel, "claimState")) ??
    normalizeStateCode(getNestedString(input.panel, "jurisdiction"));
  if (explicit) {
    return buildResult(explicit, "high", "explicit_user", "Explicit user-provided jurisdiction.");
  }

  const policyText = buildPolicyText(input);
  const policy = resolvePolicyGoverningLaw(policyText);
  if (policy) return policy;

  const allText = buildEvidenceText(input);
  const ownerLabels = [
    /owner/i,
    /vehicle\s+owner/i,
    /claimant/i,
  ];
  const insuredLabels = [/insured/i, /named\s+insured/i, /policyholder/i];
  const inspectionLabels = [
    /inspection\s+site/i,
    /inspection\s+location/i,
    /appraiser\s+location/i,
    /estimator\s+location/i,
  ];
  const shopLabels = [
    /repair\s+facility/i,
    /repair\s+shop/i,
    /body\s+shop/i,
    /\bshop\b/i,
    /facility/i,
  ];
  const nonOwnerAddressLabels = [...inspectionLabels, ...shopLabels];
  const ownerStopLabels = [...insuredLabels, ...nonOwnerAddressLabels];
  const insuredStopLabels = [...ownerLabels, ...nonOwnerAddressLabels];

  const ownerZip = findVerifiedPartyAddressBlockZip(allText, ownerLabels, ownerStopLabels);
  if (ownerZip) return buildZipResult(ownerZip, "owner_zip", "Owner ZIP from uploaded claim documents.");

  const ownerAddress = findVerifiedPartyAddressBlockState(allText, ownerLabels, ownerStopLabels);
  if (ownerAddress) {
    return buildResult(ownerAddress, "high", "owner_address", "Owner address state from uploaded claim documents.");
  }

  const insuredZip = findVerifiedPartyAddressBlockZip(allText, insuredLabels, insuredStopLabels);
  if (insuredZip) return buildZipResult(insuredZip, "insured_zip", "Insured ZIP from uploaded claim documents.");

  const insuredAddress = findVerifiedPartyAddressBlockState(allText, insuredLabels, insuredStopLabels);
  if (insuredAddress) {
    return buildResult(insuredAddress, "high", "insured_address", "Insured address state from uploaded claim documents.");
  }

  const inspectionStopLabels = [...ownerLabels, ...insuredLabels, ...shopLabels];
  const shopStopLabels = [...ownerLabels, ...insuredLabels, ...inspectionLabels];
  const inspectionZip = findAddressBlockZip(allText, inspectionLabels, inspectionStopLabels) ?? findLabeledZip(allText, inspectionLabels);
  if (inspectionZip) {
    const state = stateFromZip(inspectionZip);
    if (state) return buildResult(state, "medium", "inspection_site_zip_fallback", "Inspection Site ZIP from uploaded estimate.");
  }

  const inspectionAddress = findAddressBlockState(allText, inspectionLabels, inspectionStopLabels) ?? findLabeledState(allText, inspectionLabels);
  if (inspectionAddress) {
    return buildResult(inspectionAddress, "medium", "inspection_site_address_fallback", "Inspection Site address from uploaded estimate.");
  }

  const shopZip = findAddressBlockZip(allText, shopLabels, shopStopLabels) ?? findLabeledZip(allText, shopLabels);
  if (shopZip) {
    const state = stateFromZip(shopZip);
    if (state) return buildResult(state, "medium", "shop_zip_fallback", "Repair shop ZIP from uploaded estimate.");
  }

  const shopAddress = findAddressBlockState(allText, shopLabels, shopStopLabels) ?? findLabeledState(allText, shopLabels);
  if (shopAddress) {
    return buildResult(shopAddress, "medium", "shop_address_fallback", "Repair shop address from uploaded estimate.");
  }

  return {
    state: null,
    stateCode: null,
    confidence: "unknown",
    source: "unknown",
    basis: "No user, policy, owner/insured, or repair-shop jurisdiction evidence was isolated.",
    evidenceLabel: "No user, policy, owner/insured, or repair-shop jurisdiction evidence was isolated.",
    limitations: ["State-specific legal and policy conclusions should remain pending until jurisdiction evidence is supplied."],
  };
}

export function stateFromZip(value: string | null | undefined): string | null {
  const zip = normalizeZip(value);
  if (!zip) return null;
  const numeric = Number.parseInt(zip, 10);
  const match = ZIP_RANGES.find(([start, end]) => numeric >= start && numeric <= end);
  return match?.[2] ?? null;
}

export function normalizeStateCode(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  const codeMatch = upper.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/);
  if (codeMatch) return codeMatch[1];

  const normalizedName = upper.replace(/[^A-Z]+/g, " ").trim();
  for (const [code, name] of Object.entries(STATE_NAMES)) {
    if (normalizedName.includes(name.toUpperCase())) return code;
  }
  return null;
}

export function formatResolvedJurisdictionForReport(resolution: ResolvedJurisdiction): string {
  return resolution.state ? `${STATE_NAMES[resolution.state]} (${resolution.state})` : "Not confirmed";
}

function buildPolicyText(input: JurisdictionResolverInput): string {
  return collectText(input, { policyOnly: true });
}

function buildEvidenceText(input: JurisdictionResolverInput): string {
  return collectText(input, { policyOnly: false });
}

function collectText(input: JurisdictionResolverInput, options: { policyOnly: boolean }): string {
  const report = input.report;
  const registry = (report?.evidenceRegistry ?? [])
    .filter((item) => {
      if (!options.policyOnly) return true;
      return /policy|declaration|declarations|insurance|identification card|id card|financial responsibility|governing law/i.test(
        `${item.label} ${item.sourceType} ${item.extractedText ?? ""} ${item.extractedSummary ?? ""}`
      );
    })
    .map((item) =>
      [
        item.label,
        item.sourceType,
        item.extractedText,
        item.extractedSummary,
        ...Object.entries(item.structuredFacts ?? {}).map(([key, value]) =>
          `${key}: ${Array.isArray(value) ? value.join(" ") : value ?? ""}`
        ),
      ]
        .filter(Boolean)
        .join("\n")
    );

  const evidence = (report?.evidence ?? []).map((item) =>
    [item.title, item.source, item.snippet].filter(Boolean).join("\n")
  );
  const rawEstimateText = getNestedString(input.analysis, "rawEstimateText");
  const reportRawEstimateText = getNestedString(report?.analysis, "rawEstimateText");

  return [
    ...registry,
    ...(options.policyOnly ? [] : evidence),
    options.policyOnly ? null : rawEstimateText,
    options.policyOnly ? null : reportRawEstimateText,
  ]
    .filter(Boolean)
    .join("\n");
}

function resolvePolicyGoverningLaw(text: string): ResolvedJurisdiction | null {
  if (!text.trim()) return null;
  for (const [code, name] of Object.entries(STATE_NAMES)) {
    const state = escapeRegExp(name);
    const patterns = [
      new RegExp(`\\b(?:governed by|subject to|construed under|in accordance with)\\s+(?:the\\s+)?(?:laws?\\s+of\\s+)?(?:the\\s+Commonwealth\\s+of\\s+)?${state}\\b`, "i"),
      new RegExp(`\\blaws?\\s+of\\s+(?:the\\s+Commonwealth\\s+of\\s+)?${state}\\b`, "i"),
      new RegExp(`\\b(?:${state}|${code})\\s+law\\s+(?:applies|governs)\\b`, "i"),
      new RegExp(`\\b(?:declarations?|policy\\s+form|form\\s+state|policy\\s+state|rated\\s+state|risk\\s+state)\\b(?:(?!\\n).){0,140}\\b(?:${state}|${code})\\b`, "i"),
      new RegExp(`\\b(?:${state}|${code})\\b(?:(?!\\n).){0,120}\\b(?:financial\\s+responsibility|identification\\s+card|insurance\\s+id\\s+card|id\\s+card|policy\\s+declarations?)\\b`, "i"),
      new RegExp(`\\b(?:financial\\s+responsibility|identification\\s+card|insurance\\s+id\\s+card|id\\s+card)\\b(?:(?!\\n).){0,120}\\b(?:${state}|${code})\\b`, "i"),
    ];
    if (patterns.some((pattern) => pattern.test(text))) {
      return buildResult(code, "high", "policy_governing_law", "Policy/declarations/governing-law state from uploaded policy evidence.");
    }
  }
  return null;
}

function findLabeledZip(text: string, labels: RegExp[]): string | null {
  for (const line of getRelevantLines(text, labels)) {
    if (isZipFalsePositiveLine(line)) continue;
    const zip = extractZip(line);
    if (zip) return zip;
  }
  return null;
}

function findAddressBlockZip(text: string, labels: RegExp[], stopLabels: RegExp[]): string | null {
  for (const block of getLabeledBlocks(text, labels, stopLabels)) {
    if (!hasAddressEvidence(block)) continue;
    const zip = extractZip(block.join(" "));
    if (zip) return zip;
  }
  return null;
}

function findAddressBlockState(text: string, labels: RegExp[], stopLabels: RegExp[]): string | null {
  for (const block of getLabeledBlocks(text, labels, stopLabels)) {
    if (!hasAddressEvidence(block)) continue;
    const state = normalizeStateCode(block.join(" "));
    if (state) return state;
  }
  return null;
}

function findVerifiedPartyAddressBlockZip(text: string, labels: RegExp[], stopLabels: RegExp[]): string | null {
  for (const block of getLabeledBlocks(text, labels, stopLabels)) {
    if (!hasRealPartyAddressEvidence(block)) continue;
    const zip = extractZip(block.join(" "));
    if (zip) return zip;
  }
  return null;
}

function findVerifiedPartyAddressBlockState(text: string, labels: RegExp[], stopLabels: RegExp[]): string | null {
  for (const block of getLabeledBlocks(text, labels, stopLabels)) {
    if (!hasRealPartyAddressEvidence(block)) continue;
    const state = normalizeStateCode(block.join(" "));
    if (state) return state;
  }
  return null;
}

function findLabeledState(text: string, labels: RegExp[]): string | null {
  for (const line of getRelevantLines(text, labels)) {
    const state = normalizeStateCode(line);
    if (state) return state;
  }
  return null;
}

function getLabeledBlocks(text: string, labels: RegExp[], stopLabels: RegExp[]): string[][] {
  const lines = normalizeEvidenceLines(text);
  const blocks: string[][] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!labels.some((label) => label.test(lines[index]))) continue;
    const block = [lines[index]];
    for (let next = index + 1; next < lines.length && block.length < 6; next += 1) {
      if (stopLabels.some((label) => label.test(lines[next]))) break;
      block.push(lines[next]);
    }
    blocks.push(block);
  }
  return blocks;
}

function getRelevantLines(text: string, labels: RegExp[]): string[] {
  const lines = normalizeEvidenceLines(text);
  const relevant: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!labels.some((label) => label.test(lines[index]))) continue;
    relevant.push(lines[index]);
    if (lines[index + 1]) relevant.push(`${lines[index]} ${lines[index + 1]}`);
    if (lines[index + 2]) relevant.push(`${lines[index]} ${lines[index + 1] ?? ""} ${lines[index + 2]}`);
  }
  return relevant;
}

function normalizeEvidenceLines(text: string): string[] {
  return text
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function hasAddressEvidence(lines: string[]): boolean {
  const block = lines.join(" ");
  return /\b(address|mailing|garag(?:e|ing)|postal|zip)\b/i.test(block) ||
    /\b(street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|boulevard|blvd\.?|highway|hwy\.?|court|ct\.?|circle|cir\.?|place|pl\.?)\b/i.test(block) ||
    /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\s+\d{5}(?:-\d{4})?\b/.test(block);
}

function hasRealPartyAddressEvidence(lines: string[]): boolean {
  const block = lines.join(" ");
  const hasStreet = /\b(?:\d{1,6}\s+)?[A-Z0-9][A-Za-z0-9.'-]*(?:\s+[A-Z0-9][A-Za-z0-9.'-]*)*\s+(?:street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|boulevard|blvd\.?|highway|hwy\.?|court|ct\.?|circle|cir\.?|place|pl\.?|way|terrace|ter\.?|pike)\b/i.test(block);
  const hasCityStateZip = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\s+\d{5}(?:-\d{4})?\b/.test(block);
  const hasAddressLabel = /\b(address|mailing|garag(?:e|ing)|postal)\b/i.test(block);
  const hasStateAndZip = /\b(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b\s+\d{5}(?:-\d{4})?\b/.test(block);
  return hasStreet || hasCityStateZip || (hasAddressLabel && hasStateAndZip);
}


function extractZip(value: string): string | null {
  ZIP_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(ZIP_PATTERN)) {
    const zip = normalizeZip(match[1]);
    if (zip && stateFromZip(zip)) return zip;
  }
  return null;
}

function isZipFalsePositiveLine(value: string) {
  return /\b(phone|fax|tel|telephone|claim\s*(?:number|#)|ro\s*(?:number|#)|repair\s*order\s*(?:number|#)|estimate\s*(?:number|#|total)|invoice\s*(?:number|#|total)|total|subtotal|deductible)\b/i.test(value) &&
    !/\b(address|mailing|street|city|state|zip|postal|location|facility)\b/i.test(value);
}

function normalizeZip(value: string | null | undefined): string | null {
  const match = value?.trim().match(/^(\d{5})(?:-\d{4})?$/);
  return match ? match[1] : null;
}

function buildZipResult(
  zip: string,
  source: Extract<ResolvedJurisdiction["source"], "owner_zip" | "insured_zip">,
  evidenceLabel: string
): ResolvedJurisdiction {
  const state = stateFromZip(zip);
  return state
    ? buildResult(state, "high", source, evidenceLabel)
    : {
        state: null,
        stateCode: null,
        confidence: "unknown",
        source: "unknown",
        basis: "ZIP evidence was malformed or outside supported state ranges.",
        evidenceLabel: "ZIP evidence was malformed or outside supported state ranges.",
        limitations: ["State-specific legal and policy conclusions should remain pending until jurisdiction evidence is supplied."],
      };
}

function buildResult(
  state: string,
  confidence: ResolvedJurisdiction["confidence"],
  source: ResolvedJurisdiction["source"],
  evidenceLabel: string
): ResolvedJurisdiction {
  return {
    state,
    stateCode: state,
    confidence,
    source,
    basis: evidenceLabel,
    evidenceLabel,
    limitations: buildJurisdictionLimitations(confidence, source),
  };
}

function buildJurisdictionLimitations(
  confidence: ResolvedJurisdiction["confidence"],
  source: ResolvedJurisdiction["source"]
): string[] {
  if (confidence === "high") return [];
  if (source === "inspection_site_zip_fallback" || source === "inspection_site_address_fallback") {
    return ["Jurisdiction is inferred from inspection-site estimate metadata, not from an owner mailing address or policy governing-law clause."];
  }
  if (source === "shop_zip_fallback" || source === "shop_address_fallback") {
    return ["Jurisdiction is inferred from repair-facility estimate metadata, not from an owner mailing address or policy governing-law clause."];
  }
  return ["State-specific legal and policy conclusions should remain pending until stronger jurisdiction evidence is supplied."];
}

function getNestedString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
