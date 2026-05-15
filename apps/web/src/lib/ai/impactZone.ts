export type ImpactZonePrimary =
  | "front"
  | "rear"
  | "left-side"
  | "right-side"
  | "roof"
  | "unspecified";

export type ImpactZoneConfidence = "high" | "moderate" | "low";

export type ImpactZone = {
  primary: ImpactZonePrimary;
  confidence: ImpactZoneConfidence;
  basis: string[];
};

type ImpactZoneInput = {
  text?: string | null;
  extractedFacts?: unknown;
  photoText?: string | null;
};

export function deriveImpactZone(input: ImpactZoneInput): ImpactZone {
  const text = normalizeText(
    [
      input.text ?? "",
      stringifyFacts(input.extractedFacts),
      input.photoText ?? "",
    ].join("\n")
  );

  const pointOfImpact = deriveFromPointOfImpact(text);
  if (pointOfImpact) {
    return pointOfImpact;
  }

  const factSignals = deriveFromAreaSignals(text);
  if (factSignals.confidence !== "low" || factSignals.primary !== "unspecified") {
    return factSignals;
  }

  return {
    primary: "unspecified",
    confidence: "low",
    basis: ["No reliable impact-zone signal found."],
  };
}

export function formatImpactZone(zone: ImpactZone): string {
  switch (zone.primary) {
    case "left-side":
      return zone.basis.some((item) => /t[-\s]?bone/i.test(item))
        ? "left-side / left T-bone"
        : "left-side";
    case "right-side":
      return zone.basis.some((item) => /t[-\s]?bone/i.test(item))
        ? "right-side / right T-bone"
        : "right-side";
    case "front":
      return "front";
    case "rear":
      return "rear";
    case "roof":
      return "roof";
    default:
      return "unspecified area";
  }
}

export function isSideImpactZone(zone: ImpactZone): boolean {
  return zone.primary === "left-side" || zone.primary === "right-side";
}

export function hasFrontSupportZoneEvidence(value: string): boolean {
  const lower = normalizeText(value);
  return /\b(?:front bumper|radiator support|core support|lock support|tie bar|bumper reinforcement|impact bar|absorber|front reinforcement|upper rail|lower rail|sidemember|front rail|front body rail|front frame)\b/.test(
    lower
  );
}

function deriveFromPointOfImpact(text: string): ImpactZone | null {
  const pointOfImpactMatch = text.match(
    /\bpoint\s+of\s+impact\b\s*:?\s*(?:0?[0-9]\s*)?([^\n\r.;]+)/i
  );
  const pointText = pointOfImpactMatch?.[1]?.trim() ?? "";

  if (pointText) {
    const normalizedPoint = normalizeText(pointText);
    if (/\bleft\s+t[-\s]?bone\b|\bleft\s+side\b|\bdriver\s+side\b/.test(normalizedPoint)) {
      return {
        primary: "left-side",
        confidence: "high",
        basis: [`Point of Impact: ${pointText}`],
      };
    }
    if (/\bright\s+t[-\s]?bone\b|\bright\s+side\b|\bpassenger\s+side\b/.test(normalizedPoint)) {
      return {
        primary: "right-side",
        confidence: "high",
        basis: [`Point of Impact: ${pointText}`],
      };
    }
    if (/\bfront\b/.test(normalizedPoint)) {
      return {
        primary: "front",
        confidence: "high",
        basis: [`Point of Impact: ${pointText}`],
      };
    }
    if (/\brear\b/.test(normalizedPoint)) {
      return {
        primary: "rear",
        confidence: "high",
        basis: [`Point of Impact: ${pointText}`],
      };
    }
    if (/\broof\b/.test(normalizedPoint)) {
      return {
        primary: "roof",
        confidence: "high",
        basis: [`Point of Impact: ${pointText}`],
      };
    }
  }

  if (/\bleft\s+t[-\s]?bone\b|\bleft\s+side\s+impact\b/.test(text)) {
    return {
      primary: "left-side",
      confidence: "high",
      basis: ["Text states left T-bone / left-side impact."],
    };
  }

  if (/\bright\s+t[-\s]?bone\b|\bright\s+side\s+impact\b/.test(text)) {
    return {
      primary: "right-side",
      confidence: "high",
      basis: ["Text states right T-bone / right-side impact."],
    };
  }

  return null;
}

function deriveFromAreaSignals(text: string): ImpactZone {
  const leftSideSignals = countMatches(text, [
    /\blt\.?\s+aperture\b/g,
    /\bleft\s+aperture\b/g,
    /\blt\.?\s+front\s+door\b/g,
    /\bleft\s+front\s+door\b/g,
    /\blt\.?\s+rear\s+door\b/g,
    /\bleft\s+rear\s+door\b/g,
    /\blt\.?\s+quarter\b/g,
    /\bleft\s+quarter\b/g,
    /\blt\.?\s+roof\s+rail\b/g,
    /\bleft\s+roof\s+rail\b/g,
    /\bquarter\s+glass\b/g,
    /\bside\s+molding\b/g,
    /\bside[-\s]?impact\s+sensor\b/g,
    /\bleft\s+rocker\b/g,
    /\blt\.?\s+fender\b/g,
  ]);
  const rightSideSignals = countMatches(text, [
    /\brt\.?\s+aperture\b/g,
    /\bright\s+aperture\b/g,
    /\brt\.?\s+front\s+door\b/g,
    /\bright\s+front\s+door\b/g,
    /\brt\.?\s+rear\s+door\b/g,
    /\bright\s+rear\s+door\b/g,
    /\brt\.?\s+quarter\b/g,
    /\bright\s+quarter\b/g,
    /\brt\.?\s+roof\s+rail\b/g,
    /\bright\s+roof\s+rail\b/g,
    /\bright\s+rocker\b/g,
    /\brt\.?\s+fender\b/g,
  ]);
  const frontSignals = countMatches(text, [
    /\bfront\s+bumper\b/g,
    /\bradiator\s+support\b/g,
    /\bcore\s+support\b/g,
    /\block\s+support\b/g,
    /\btie\s+bar\b/g,
    /\bfront\s+reinforcement\b/g,
    /\babsorber\b/g,
  ]);
  const rearSignals = countMatches(text, [
    /\brear\s+bumper\b/g,
    /\bdecklid\b/g,
    /\btrunk\b/g,
    /\brear\s+body\b/g,
    /\brear\s+rail\b/g,
  ]);

  const scores = [
    { primary: "left-side" as const, score: leftSideSignals },
    { primary: "right-side" as const, score: rightSideSignals },
    { primary: "front" as const, score: frontSignals },
    { primary: "rear" as const, score: rearSignals },
  ].sort((left, right) => right.score - left.score);

  const winner = scores[0];
  if (!winner || winner.score === 0) {
    return {
      primary: "unspecified",
      confidence: "low",
      basis: [],
    };
  }

  const confidence: ImpactZoneConfidence =
    winner.score >= 4 || winner.score >= (scores[1]?.score ?? 0) + 2
      ? "moderate"
      : "low";

  return {
    primary: winner.primary,
    confidence,
    basis: [`Operation distribution favors ${winner.primary} (${winner.score} signals).`],
  };
}

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, pattern) => sum + [...text.matchAll(pattern)].length, 0);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function stringifyFacts(value: unknown): string {
  if (!value) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}
