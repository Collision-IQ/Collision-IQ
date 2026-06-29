// Generic, content-driven triage classification for uploaded estimates.
//
// This is deliberately NOT keyed to any specific carrier, shop, or fixture
// file. Roles are inferred from authorship signals present in the document
// text, and the comparison basis is the *repair total* (gross cost of
// repairs), never a net-after-deductible figure.

export type EstimateRoleScore = { carrier: number; shop: number };

/**
 * Extract the most plausible estimate total from raw text. Repair/gross totals
 * are preferred; net-after-deductible and customer-pay figures are demoted so
 * they are only used when nothing better is present.
 */
export function extractEstimateTotalCandidate(text: string): number | null {
  if (!text.trim()) return null;

  const candidates: Array<{ value: number; score: number }> = [];
  const totalPatterns: Array<{ re: RegExp; score: number }> = [
    // Repair total (gross cost of repairs) — the preferred comparison basis.
    { re: /(?:total cost of repairs|repair total|gross total)[^$\d]{0,32}\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/gi, score: 5 },
    { re: /(?:estimate|gross|repair|claim|grand)\s+total[^$\d]{0,32}\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/gi, score: 4 },
    { re: /\btotal[^$\d]{0,20}\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/gi, score: 3 },
    // Net / customer-pay figures are AFTER deductible — never the comparison
    // basis; only used as a last resort when no repair total is found.
    { re: /(?:net cost of repairs|net total|customer pay|amount due|less deductible)[^$\d]{0,32}\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/gi, score: 1 },
    { re: /\$\s*([0-9][0-9,]*(?:\.\d{2}))/g, score: 1 },
  ];

  for (const { re, score } of totalPatterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const value = Number(String(match[1] ?? "").replace(/,/g, ""));
      if (!Number.isFinite(value) || value < 100 || value > 250000) continue;
      candidates.push({ value, score });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score || b.value - a.value);
  return candidates[0]?.value ?? null;
}

/**
 * Score carrier-authorship vs shop-authorship signals for one document. A mere
 * mention of an insurer (e.g. a labeled "Insurance Company:" field that shop
 * estimates also carry) is intentionally weak, so it does not flip a shop
 * estimate to a carrier role.
 */
export function scoreEstimateRoleSignals(filename: string, text: string): EstimateRoleScore {
  const haystack = `${filename}\n${(text ?? "").slice(0, 6000)}`.toLowerCase();
  const has = (re: RegExp): number => (re.test(haystack) ? 1 : 0);

  let carrier = 0;
  // Strong: the document is authored by a carrier / appraiser.
  carrier += 3 * has(/\bsupplement of record\b|\bs\.?o\.?r\.?\b/);
  carrier += 3 * has(/\bcasualty insurance company\b/);
  carrier += 2 * has(/\bappraiser\b|\bclaim(?:s)?\s*(?:rep|representative|adjuster|handler)\b|\bdesk review\b/);
  carrier += 2 * has(/\bquality replacement parts?\b|\bqrp\b/);
  carrier += 2 * has(/\bnet cost of repairs\b|\bless deductible\b|\bdeductible applied\b/);
  carrier += 1 * has(/\bclaim\s*(?:number|no\.?|#)\b/);
  // Weak: a generic insurer lexicon (signal only, not special-casing any one).
  carrier += 1 * has(/\b(?:allstate|state farm|geico|progressive|usaa|nationwide|liberty mutual|farmers|travelers|esurance)\b/);

  let shop = 0;
  // Strong: the document is authored by a repair facility.
  shop += 3 * has(/\bcollision center\b|\bbody shop\b|\brepair facility\b|\bauto body\b/);
  shop += 2 * has(/\brepair order\b|\bro\s*#|\bwork\s?file\b|\bworkfile\b|\bwork authorization\b/);
  shop += 2 * has(/\bwritten by\b|\bestimator\b|\bshop\s*(?:writer|manager|foreman)\b/);
  // A facility website in the header is a strong shop-authorship hint.
  shop += 2 * (/(?:collision|body|auto|repair)[a-z0-9-]*\.(?:com|net)\b/.test(haystack) ? 1 : 0);
  // Weak: shops also author supplements.
  shop += 1 * has(/\bsupplement\b/);

  return { carrier, shop };
}

/**
 * Assign distinct carrier and shop documents from a scored set. When two or
 * more estimates exist, the carrier and shop are guaranteed to be *different*
 * documents (the most carrier-leaning vs the most shop-leaning), so the same
 * file can never be reported as both roles.
 */
export function resolveTriageRoles<T extends { scores: EstimateRoleScore }>(
  items: T[]
): { carrier?: T; shop?: T } {
  if (items.length === 0) return {};
  if (items.length === 1) {
    const only = items[0];
    return only.scores.carrier > only.scores.shop
      ? { carrier: only }
      : { shop: only };
  }

  const carrierLean = (i: T) => i.scores.carrier - i.scores.shop;
  // Most carrier-leaning becomes carrier; most shop-leaning of the rest is shop.
  const carrier = [...items].sort((a, b) => carrierLean(b) - carrierLean(a))[0];
  const shop = [...items]
    .filter((i) => i !== carrier)
    .sort((a, b) => carrierLean(a) - carrierLean(b))[0];
  return { carrier, shop };
}
