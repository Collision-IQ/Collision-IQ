export type EstimateLinkClassification =
  | "oem_procedure"
  | "generic_reference"
  | "internal_repository"
  | "unsupported";

export type EstimateLinkCandidate = {
  url: string;
  domain: string;
  classification: EstimateLinkClassification;
  sourceFilename?: string;
  context?: string;
};

const URL_PATTERN = /https?:\/\/[^\s)\]>"]+/gi;
const OEM_DOMAIN_HINTS = [
  "subaru",
  "bmw",
  "mini",
  "nissan",
  "infiniti",
  "volvo",
  "chevrolet",
  "chevy",
  "gmc",
  "gm",
  "ford",
  "lincoln",
  "toyota",
  "lexus",
  "honda",
  "acura",
  "mazda",
  "hyundai",
  "kia",
  "mopar",
  "stellantis",
  "chrysler",
  "dodge",
  "jeep",
  "ram",
  "audi",
  "volkswagen",
  "vw",
  "porsche",
  "mercedes",
  "benz",
  "tesla",
  "jaguar",
  "landrover",
];
const PROCEDURE_HINTS = [
  "adas",
  "calibration",
  "procedure",
  "repair",
  "service",
  "manual",
  "tech",
  "techinfo",
  "position",
  "bulletin",
  "oem",
  "pdf",
];
const UNSUPPORTED_DOMAIN_HINTS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
];

export function extractEstimateLinksFromDocuments(
  documents: Array<{ filename: string; text?: string | null }>
): EstimateLinkCandidate[] {
  const deduped = new Map<string, EstimateLinkCandidate>();

  for (const document of documents) {
    const text = document.text?.trim();
    if (!text) continue;

    const matches = text.match(URL_PATTERN) ?? [];
    for (const rawMatch of matches) {
      const cleanedUrl = sanitizeUrl(rawMatch);
      if (!cleanedUrl || deduped.has(cleanedUrl)) continue;

      const domain = safeDomain(cleanedUrl);
      const candidate: EstimateLinkCandidate = {
        url: cleanedUrl,
        domain,
        classification: classifyEstimateLink(cleanedUrl),
        sourceFilename: document.filename,
        context: extractLinkContext(text, rawMatch),
      };
      deduped.set(cleanedUrl, candidate);
    }
  }

  return [...deduped.values()];
}

export function isFetchableEstimateLink(link: EstimateLinkCandidate): boolean {
  return link.classification !== "unsupported";
}

const HIGH_VALUE_LINK_HINTS =
  /oem|procedure|position statement|repair manual|bulletin|calibration|adas|revv|pre-?scan|post-?scan|scan/i;

/**
 * Retrieval-priority score for a link. Higher = fetch first. OEM procedure and
 * internal-repository (Egnyte DMS) links outrank generic references, and links
 * whose surrounding text/URL signals OEM/ADAS/procedure content are boosted so
 * the shop's OEM procedure link and the REVV/ADAS report link are attempted
 * ahead of lower-value links within the fetch budget.
 */
export function estimateLinkPriority(link: EstimateLinkCandidate): number {
  if (link.classification === "unsupported") return 0;
  const base =
    link.classification === "oem_procedure"
      ? 100
      : link.classification === "internal_repository"
        ? 80
        : 40; // generic_reference
  const signal = `${link.context ?? ""} ${link.url}`;
  return base + (HIGH_VALUE_LINK_HINTS.test(signal) ? 15 : 0);
}

/** Order links by retrieval value (highest first); stable for equal scores. */
export function prioritizeEstimateLinks(
  links: EstimateLinkCandidate[]
): EstimateLinkCandidate[] {
  return links
    .map((link, index) => ({ link, index, score: estimateLinkPriority(link) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.link);
}

// Hosts that belong to Collision IQ's own document management system. Egnyte is the org DMS;
// any *.egnyte.com host is treated as an internal repository source.
export function isInternalRepositoryHost(host: string): boolean {
  const lower = host.toLowerCase();
  return lower === "egnyte.com" || lower.endsWith(".egnyte.com");
}

function classifyEstimateLink(urlValue: string): EstimateLinkClassification {
  try {
    const url = new URL(urlValue);
    const lowerHost = url.hostname.toLowerCase();
    const lowerPath = `${url.pathname} ${url.search}`.toLowerCase();
    const lowerJoined = `${lowerHost} ${lowerPath}`;

    if (UNSUPPORTED_DOMAIN_HINTS.some((hint) => lowerHost.includes(hint))) {
      return "unsupported";
    }

    // Collision IQ's own document repository (Egnyte DMS). Shop estimates frequently embed
    // Egnyte share links (e.g. https://<org>.egnyte.com/fl/<id>) pointing at OEM procedures,
    // scans, and supporting docs. These are our own source — recognize them and attempt
    // retrieval via the Egnyte integration instead of discarding them as "unsupported".
    if (isInternalRepositoryHost(lowerHost)) {
      return "internal_repository";
    }

    const directPdf = /\.pdf(?:$|[?#])/i.test(urlValue);
    const hasOemHint = OEM_DOMAIN_HINTS.some((hint) => lowerJoined.includes(hint));
    const hasProcedureHint = PROCEDURE_HINTS.some((hint) => lowerJoined.includes(hint));
    const trustedDocHost =
      lowerHost.includes("docs.google.com") ||
      lowerHost.includes("drive.google.com") ||
      lowerHost.includes("dropbox.com");

    if ((hasOemHint && (hasProcedureHint || directPdf)) || (directPdf && hasProcedureHint)) {
      return "oem_procedure";
    }

    if (directPdf || (trustedDocHost && hasProcedureHint)) {
      return "generic_reference";
    }

    if (hasOemHint && hasProcedureHint) {
      return "oem_procedure";
    }

    return "unsupported";
  } catch {
    return "unsupported";
  }
}

function sanitizeUrl(value: string): string | null {
  const trimmed = value.trim().replace(/[),.;]+$/, "");
  try {
    const parsed = new URL(trimmed);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function safeDomain(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function extractLinkContext(text: string, rawMatch: string): string | undefined {
  const index = text.indexOf(rawMatch);
  if (index < 0) return undefined;

  const start = Math.max(0, index - 140);
  const end = Math.min(text.length, index + rawMatch.length + 140);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}
