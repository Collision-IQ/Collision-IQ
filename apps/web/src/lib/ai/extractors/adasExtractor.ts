export interface AdasFinding {
  finding: string;
  category: "calibration" | "scan" | "sensor" | "safety";
  evidence: string;
}

const ADAS_PATTERNS: Array<{
  regex: RegExp;
  finding: string;
  category: AdasFinding["category"];
  evidence: string;
}> = [
  {
    regex: /\bacc\b|adaptive cruise|radar calibration/i,
    finding: "ACC radar calibration reference detected",
    category: "calibration",
    evidence: "Document Text / ADAS Report",
  },
  {
    regex: /\bkafas\b|forward camera|camera calibration/i,
    finding: "Forward camera calibration reference detected",
    category: "calibration",
    evidence: "Document Text / ADAS Report",
  },
  {
    regex: /pre[- ]repair scan|pre scan|diagnostic scan/i,
    finding: "Pre-repair scan reference detected",
    category: "scan",
    evidence: "Document Text / ADAS Report",
  },
  {
    regex: /post[- ]repair scan|post scan|final scan/i,
    finding: "Post-repair scan reference detected",
    category: "scan",
    evidence: "Document Text / ADAS Report",
  },
  {
    regex: /sensor|module|radar|camera/i,
    finding: "ADAS sensor or module reference detected",
    category: "sensor",
    evidence: "Document Text / ADAS Report",
  },
];

export function extractAdasFindings(text: string): AdasFinding[] {
  return ADAS_PATTERNS.filter((pattern) => pattern.regex.test(text)).map(
    (pattern) => ({
      finding: pattern.finding,
      category: pattern.category,
      evidence: pattern.evidence,
    })
  );
}
