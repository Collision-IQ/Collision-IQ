export type CitationDensityTargetEstimate = "carrier" | "shop" | "selected";

export function shouldGenerateAnnotatedCitationDensityEstimate(message: string) {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (/\bsummary report\b|\bgap report\b|\bstandalone report\b/.test(normalized)) {
    return false;
  }

  return (
    /\bannotated estimate\b/.test(normalized) ||
    /\bannotate the estimate\b/.test(normalized) ||
    /\bannotated citation density estimate(?: pdf)?\b/.test(normalized) ||
    /\bcitation density estimate pdf\b/.test(normalized) ||
    /\bmark\s*up (?:the )?(?:carrier |shop |insurer |insurance )?estimate\b/.test(normalized) ||
    /\bshow this on the estimate\b/.test(normalized) ||
    /\bshow citation gaps on (?:the )?estimate\b/.test(normalized) ||
    /\bcitation density markup\b/.test(normalized) ||
    /\bexport annotated carrier estimate\b/.test(normalized) ||
    /\bmake the annotated pdf\b/.test(normalized) ||
    /\bregenerate the estimate pdf with annotations\b/.test(normalized)
  );
}

export function resolveAnnotatedCitationDensityTarget(message: string): CitationDensityTargetEstimate {
  const normalized = message.toLowerCase();
  if (/\bshop\b|repair facility|body shop/.test(normalized)) return "shop";
  if (/\bcarrier\b|insurer|insurance|lower-cost|lower cost/.test(normalized)) return "carrier";
  return "selected";
}
