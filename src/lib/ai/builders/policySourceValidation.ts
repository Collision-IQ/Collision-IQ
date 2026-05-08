import type { ImmutablePolicyCitation, PolicyRightsReviewModel } from "@/lib/ai/types/policyRightsReview";

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

const WEAK_LEGAL_SOURCE_PATTERN =
  /(youtube|youtu\.be|facebook|instagram|tiktok|x\.com|twitter|law\s*firm|attorneys?|lawyers?|legal\s+blog|blog|substack|medium|linkedin|justia|avvo|nolo|findlaw|news\s+article|general\s+article|article\s+by|overview|explainer|commentary)/i;

export function getClaimStateCodeFromJurisdiction(jurisdiction: PolicyRightsReviewModel["jurisdiction"]): string | null {
  if (jurisdiction.confidence !== "high") {
    return null;
  }

  return extractStateCode(jurisdiction.state);
}

export function isVerifiedLegalCitation(
  citation: ImmutablePolicyCitation,
  claimStateCode: string | null
): boolean {
  if (!claimStateCode) {
    return false;
  }
  if (!citation.retrievedAt && !citation.effectiveDate) {
    return false;
  }
  if (citation.source !== "VerifiedRegulationsDatabase" && citation.source !== "DriveLawFolder") {
    return false;
  }

  const citationStateCode = extractStateCode(citation.jurisdiction ?? citation.title);
  if (citationStateCode !== claimStateCode) {
    return false;
  }

  const haystack = `${citation.title} ${citation.url ?? ""} ${citation.locator ?? ""}`;
  return isOfficialLegalSource(haystack) && !isWeakLegalSource(haystack);
}

export function isVerifiedPolicyCitation(citation: ImmutablePolicyCitation): boolean {
  return (
    ["DrivePolicyFolder", "UploadedPolicyDocument"].includes(citation.source) &&
    Boolean(citation.retrievedAt || citation.effectiveDate)
  );
}

export function isWeakLegalSource(value: string): boolean {
  return WEAK_LEGAL_SOURCE_PATTERN.test(value);
}

export function isOfficialLegalSource(value: string): boolean {
  if (!value) {
    return false;
  }

  const lower = value.toLowerCase();
  if (/\.gov\b/.test(lower) || /courts?\./.test(lower) || /legislature\./.test(lower) || /insurance\.[a-z]{2}\.gov/.test(lower)) {
    return true;
  }

  return /department of insurance|insurance department|commissioner|statute|regulation|administrative code|court of appeals|supreme court/i.test(value);
}

export function buildJurisdictionUnavailableMessage(): string {
  return "Jurisdiction not confirmed; legal support unavailable.";
}

function extractStateCode(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const parenMatch = trimmed.match(/\(([A-Z]{2})\)/);
  if (parenMatch) {
    return parenMatch[1];
  }

  const upper = trimmed.toUpperCase();
  if (STATE_NAMES[upper]) {
    return upper;
  }

  for (const [code, name] of Object.entries(STATE_NAMES)) {
    if (new RegExp(`\\b${name}\\b`, "i").test(trimmed)) {
      return code;
    }
  }

  return null;
}
