/**
 * AUTHORITY TIERS — what may be cited as support, and at what weight.
 *
 * A Repair Intelligence Report on RO 22059 listed, under the heading "VERIFIED
 * OEM / POSITION STATEMENT SUPPORT" and adjacent OEM headings, all of:
 *
 *   - "Model S (2021+) Collision Repair Procedures (2021+) Tesla"   (real)
 *   - "Tesla I-CAR"                                                 (real)
 *   - "OEM procedures aren't just about repair quality Instagram"   (a post)
 *   - "Help us make sense of this? Insurer beats collision repair"  (a forum thread)
 *
 * all at 68% confidence. The retrieval layer had stamped every one of them
 * `sourceType: "oem"`, and every consumer downstream trusted that label. An
 * Instagram post is not an OEM position statement, and a document that cites
 * one as if it were is worse than a document that cites nothing.
 *
 * THE LABEL IS NOT EVIDENCE. Tier is therefore derived from the URL host and
 * the document's own identifiers — things the publisher controls and a
 * summarizer cannot invent — and never from the upstream sourceType, which is
 * exactly what failed. A source that cannot be placed on the ladder is
 * REJECTED rather than admitted at the bottom of it: an unplaceable source is
 * one we cannot describe honestly to a reader.
 *
 * Ladder, following the project evidence hierarchy:
 *   1  Uploaded case evidence; OEM repair procedures and position statements
 *   2  Licensed estimating data (MOTOR, CCC) within authorized coverage
 *   3  Statute, regulation, DOI guidance, NHTSA
 *   4  Industry technical bodies (I-CAR, SCRS, DEG)
 *   5  Other high-quality published technical sources
 */

export type AuthorityTier = 1 | 2 | 3 | 4 | 5;

export type TieredAuthority = {
  title: string;
  url?: string;
  locator?: string;
  tier: AuthorityTier;
  /** Human-readable basis for the tier, shown in the report. */
  tierBasis: string;
};

export type RejectedAuthority = {
  title: string;
  url?: string;
  /** Why it may not be cited. Recorded, never silently dropped. */
  reason: string;
};

/**
 * Hosts that publish user-generated or social content. Nothing from these is
 * citable authority, whatever its title claims and whatever tier the upstream
 * retrieval assigned it. Matched on registrable host so a path or subdomain
 * cannot smuggle one past.
 */
const USER_GENERATED_HOSTS = [
  "instagram.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "reddit.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "pinterest.com",
  "linkedin.com",
  "quora.com",
  "medium.com",
  "wordpress.com",
  "blogspot.com",
  "substack.com",
];

/** Discussion software, wherever it is hosted. */
const FORUM_PATH_SHAPE = /\/(?:forum|forums|thread|threads|topic|topics|showthread|viewtopic|comments)\b/i;

/** OEM technical-information portals and manufacturer domains. */
const OEM_HOST_SHAPE =
  /(?:^|\.)(?:tesla|toyota|lexus|honda|acura|nissan|infiniti|ford|lincoln|gm|chevrolet|cadillac|buick|gmc|stellantis|mopar|fcagroup|chrysler|dodge|jeep|ram|bmw|mini|mercedes-benz|mbusa|audi|vw|volkswagen|porsche|volvocars|subaru|mazda|hyundai|kia|genesis|rivian|lucidmotors|polestar)\.(?:com|net|org|us)$/i;

const OEM_PORTAL_HOSTS = [
  "oem1stop.com",
  "techinfo.toyota.com",
  "techinfo.honda.com",
  "service.tesla.com",
  "erwin.volkswagen.de",
  "moparrepairconnection.com",
  "gmtechinfo.com",
];

const LICENSED_ESTIMATING_HOSTS = ["motor.com", "cccis.com", "mitchell.com", "audatex.com", "solera.com"];

const REGULATOR_HOST_SHAPE = /(?:^|\.)(?:[a-z-]+\.)?(?:gov|mil)$/i;
const REGULATOR_NAMED_HOSTS = ["nhtsa.gov", "pacodeandbulletin.gov", "legis.state.pa.us", "ecfr.gov"];

const INDUSTRY_BODY_HOSTS = [
  "i-car.com",
  "rts.i-car.com",
  "scrs.com",
  "degweb.org",
  "sae.org",
  "ase.com",
];

/** Statute/regulation citation shapes, e.g. "31 Pa. Code § 62.3", "49 CFR 571". */
const STATUTE_CITATION_SHAPE =
  /\b\d+\s*(?:Pa\.?|[A-Z]{2}\.?)?\s*(?:Code|C\.?F\.?R\.?|U\.?S\.?C\.?|Admin\.?\s*Code|Rev\.?\s*Stat\.?)\s*(?:§+\s*)?[\d.\-]+/i;

function hostOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function hostMatches(host: string, candidates: string[]): boolean {
  return candidates.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

/**
 * Place one retrieved source on the ladder, or reject it.
 *
 * `uploadedEvidence` marks a source that came from the case file itself rather
 * than from retrieval — it is tier 1 by provenance and needs no host check.
 */
export function classifyAuthority(source: {
  title: string;
  url?: string;
  locator?: string;
  uploadedEvidence?: boolean;
}): { tier: TieredAuthority } | { rejected: RejectedAuthority } {
  const title = source.title?.trim() ?? "";
  if (title.length < 3) {
    return { rejected: { title, url: source.url, reason: "No citable title." } };
  }

  if (source.uploadedEvidence) {
    return {
      tier: {
        title,
        url: source.url,
        locator: source.locator,
        tier: 1,
        tierBasis: "Uploaded case evidence",
      },
    };
  }

  const host = hostOf(source.url);

  // Rejections first, so nothing below can rescue a social or forum result.
  if (host && hostMatches(host, USER_GENERATED_HOSTS)) {
    return {
      rejected: {
        title,
        url: source.url,
        reason: `User-generated content (${host}) is not a citable repair authority.`,
      },
    };
  }
  if (source.url && FORUM_PATH_SHAPE.test(source.url)) {
    return {
      rejected: {
        title,
        url: source.url,
        reason: "Discussion thread, not a published technical or regulatory source.",
      },
    };
  }
  if (!host) {
    // A statute can be cited by its identifier alone; anything else without a
    // resolvable source cannot be verified by a reader and is not admitted.
    if (STATUTE_CITATION_SHAPE.test(title)) {
      return {
        tier: {
          title,
          locator: source.locator,
          tier: 3,
          tierBasis: "Statute or regulation, cited by identifier",
        },
      };
    }
    return {
      rejected: {
        title,
        url: source.url,
        reason: "No resolvable source location, so the citation cannot be verified.",
      },
    };
  }

  if (hostMatches(host, OEM_PORTAL_HOSTS) || OEM_HOST_SHAPE.test(host)) {
    return {
      tier: {
        title,
        url: source.url,
        locator: source.locator,
        tier: 1,
        tierBasis: `OEM published source (${host})`,
      },
    };
  }
  if (hostMatches(host, LICENSED_ESTIMATING_HOSTS)) {
    return {
      tier: {
        title,
        url: source.url,
        locator: source.locator,
        tier: 2,
        tierBasis: `Licensed estimating data (${host})`,
      },
    };
  }
  if (hostMatches(host, REGULATOR_NAMED_HOSTS) || REGULATOR_HOST_SHAPE.test(host)) {
    return {
      tier: {
        title,
        url: source.url,
        locator: source.locator,
        tier: 3,
        tierBasis: `Government or regulatory publication (${host})`,
      },
    };
  }
  if (hostMatches(host, INDUSTRY_BODY_HOSTS)) {
    return {
      tier: {
        title,
        url: source.url,
        locator: source.locator,
        tier: 4,
        tierBasis: `Industry technical body (${host})`,
      },
    };
  }

  return {
    tier: {
      title,
      url: source.url,
      locator: source.locator,
      tier: 5,
      tierBasis: `Published technical source (${host}) — confirm against a primary source before relying on it`,
    },
  };
}

/**
 * Classify a whole retrieval set, keeping the tiered sources in ladder order
 * and returning the rejections so the report can state what it declined to
 * cite rather than quietly shortening its own evidence list.
 *
 * Deduplicates on URL (falling back to title), because the same procedure page
 * commonly arrives from more than one retrieval lane.
 */
export function classifyAuthorities(
  sources: Array<{ title: string; url?: string; locator?: string; uploadedEvidence?: boolean }>
): { accepted: TieredAuthority[]; rejected: RejectedAuthority[] } {
  const accepted: TieredAuthority[] = [];
  const rejected: RejectedAuthority[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    const key = (source.url ?? source.title ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const result = classifyAuthority(source);
    if ("tier" in result) accepted.push(result.tier);
    else rejected.push(result.rejected);
  }

  accepted.sort((a, b) => a.tier - b.tier);
  return { accepted, rejected };
}
