import type { ImmutablePolicyCitation, PolicyRightsReviewModel, SourceAuthorityTier } from "@/lib/ai/types/policyRightsReview";

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
  /(youtube|youtu\.be|facebook|instagram|tiktok|x\.com|twitter|law\s*firm|attorneys?|lawyers?|legal\s+blog|blog|substack|medium|linkedin|justia|avvo|nolo|findlaw|news\s+article|general\s+article|article\s+by|overview|explainer|commentary|repairer|body\s+shop|collision\s+repair|wreck\s+check)/i;

const INDUSTRY_CONTEXT_PATTERN =
  /\b(SCRS|DEG|I-?CAR|OEM|manufacturer|position statement|trade association|trade article)\b/i;

const LEGAL_TOPIC_PATTERN =
  /\b(DOI|department of insurance|insurance department|insurance commissioner|statute|statutes|code|administrative code|regulation|regulations|bulletin|notice|consumer rights|case law|court opinion|opinion)\b/i;

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
  if (citation.sourceAuthorityTier !== "LEGAL_AUTHORITY") {
    return false;
  }

  const citationStateCode = extractStateCode(citation.jurisdiction ?? citation.title);
  if (citationStateCode !== claimStateCode) {
    return false;
  }

  return isOfficialLegalSource(citation) && !isWeakLegalSource(formatCitationAuthorityText(citation));
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

export function classifySourceAuthorityTier(params: {
  title: string;
  sourceType?: ImmutablePolicyCitation["sourceType"];
  url?: string;
  locator?: string;
}): SourceAuthorityTier {
  const value = formatAuthorityText(params.title, params.url, params.locator);

  if (/policy|declarations|endorsement|coverage/i.test(params.title)) {
    return "POLICY_CONTRACT";
  }

  if (params.sourceType === "oem" || /\b(oem|manufacturer|position statement)\b/i.test(value)) {
    return "OEM_PROCEDURE";
  }

  if (isWeakLegalSource(value)) {
    return "REJECTED_FOR_LEGAL_USE";
  }

  if (isAcceptedOfficialLegalAuthority(params)) {
    return "LEGAL_AUTHORITY";
  }

  if (INDUSTRY_CONTEXT_PATTERN.test(value)) {
    return "INDUSTRY_CONTEXT";
  }

  if (LEGAL_TOPIC_PATTERN.test(value)) {
    return "REJECTED_FOR_LEGAL_USE";
  }

  return "INDUSTRY_CONTEXT";
}

export function isOfficialLegalSource(value: string | ImmutablePolicyCitation): boolean {
  if (!value) {
    return false;
  }

  if (typeof value !== "string") {
    return isAcceptedOfficialLegalAuthority({
      title: value.title,
      sourceType: value.sourceType,
      url: value.url,
      locator: value.locator,
    });
  }

  return isAcceptedOfficialLegalAuthority({ title: value });
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

function isAcceptedOfficialLegalAuthority(params: {
  title: string;
  sourceType?: ImmutablePolicyCitation["sourceType"];
  url?: string;
  locator?: string;
}): boolean {
  const value = formatAuthorityText(params.title, params.url, params.locator);
  if (isWeakLegalSource(value) || INDUSTRY_CONTEXT_PATTERN.test(value)) {
    return false;
  }

  const lower = value.toLowerCase();
  const hasOfficialHost =
    /\.gov(?:\/|$|\b)/.test(lower) ||
    /\b(?:legislature|legis|courts?|judiciary)\.[a-z]{2}\.gov\b/.test(lower) ||
    /\b(?:flsenate|malegislature|nyassembly|capitol\.texas)\.gov\b/.test(lower);
  const hasOfficialLegalMarker =
    /\bdepartment of insurance\b|\binsurance department\b|\binsurance commissioner\b|\bdoi\b/i.test(value) ||
    /\bstatutes?\b|\badministrative code\b|\badmin(?:istrative)?\.?\s*code\b|\bregulations?\b/i.test(value) ||
    /\bbulletins?\b|\bnotices?\b/i.test(value);
  const hasExplicitCaseLaw =
    /\b(case law|court opinion|judicial opinion|appellate opinion)\b/i.test(value);

  return hasOfficialHost && (hasOfficialLegalMarker || hasExplicitCaseLaw);
}

function formatCitationAuthorityText(citation: ImmutablePolicyCitation): string {
  return formatAuthorityText(citation.title, citation.url, citation.locator);
}

function formatAuthorityText(title: string, url?: string, locator?: string): string {
  return `${title} ${url ?? ""} ${locator ?? ""}`;
}
