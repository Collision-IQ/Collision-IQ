/**
 * The export boundary check.
 *
 * Inside the system the full record is intact — that is what makes the analysis
 * possible. Everything that LEAVES the system must be redacted, and this is the
 * assertion that says whether it actually was.
 *
 * It exists because redaction that is applied by construction cannot be
 * trusted by construction: the annotated estimate is built by copying the
 * source PDF's own pages, so no amount of care in the text builders touches it.
 * A scanner that reads the FINISHED artifact is the only thing that can tell
 * the difference between "we redact on export" and "we redact the parts we
 * remembered".
 *
 * Note the VIN rule. A word boundary finds nothing in an estimate: CCC prints
 * "VIN:5YJ3E1EA6PF691987Interior Color:WHITE", so the VIN is welded to the next
 * label. Detection slides a 17-character window and accepts on the ISO 3779
 * check digit.
 */
import { COMMON_INSURERS } from "../ai/extractors/extractEstimateFacts";

export type PiiKind = "vin" | "claim_number" | "policy_number" | "insurer" | "person" | "address";

export interface PiiFinding {
  kind: PiiKind;
  /** The offending text, itself truncated so this record is safe to log. */
  sample: string;
  count: number;
}

const VIN_ALPHABET = /^[A-HJ-NPR-Z0-9]{17}$/;
const VIN_TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** A run of digits is a claim or policy number, not a VIN. Roughly one in
 *  eleven random 17-character windows satisfies the check digit, so scanning a
 *  21-digit claim number reported phantom VINs. Every real VIN carries letters
 *  in the WMI and VDS. */
const VIN_MIN_LETTERS = 3;

function isVin(candidate: string): boolean {
  const vin = candidate.toUpperCase();
  if (!VIN_ALPHABET.test(vin)) return false;
  if ((vin.match(/[A-Z]/g) ?? []).length < VIN_MIN_LETTERS) return false;
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    const char = vin[i];
    const value = /\d/.test(char) ? Number(char) : VIN_TRANSLITERATION[char];
    if (value === undefined) return false;
    sum += value * VIN_WEIGHTS[i];
  }
  const remainder = sum % 11;
  return vin[8] === (remainder === 10 ? "X" : String(remainder));
}

/** Every unmasked VIN in the text. A VIN whose last 8 are already asterisks
 *  fails the check digit, so a redacted document reports nothing. */
export function findUnmaskedVins(text: string): string[] {
  const found: string[] = [];
  for (let i = 0; i + 17 <= text.length; i += 1) {
    const window = text.slice(i, i + 17);
    if (isVin(window)) {
      found.push(window.toUpperCase());
      i += 16;
    }
  }
  return found;
}

/** Show enough to locate the leak, never enough to be the leak. */
function safeSample(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= 6 ? trimmed : `${trimmed.slice(0, 4)}…${trimmed.slice(-2)}`;
}

function tally(kind: PiiKind, matches: string[]): PiiFinding[] {
  if (matches.length === 0) return [];
  return [{ kind, sample: safeSample(matches[0]), count: matches.length }];
}

/**
 * Scan finished export text. Returns everything that should not have left.
 *
 * `expectedInsurers` lets a caller pass carrier names resolved for the case;
 * omit it and the shared carrier vocabulary is used. One vocabulary, not two.
 */
export function scanExportForPii(
  text: string,
  options: { expectedInsurers?: string[] } = {}
): PiiFinding[] {
  const source = text ?? "";
  const findings: PiiFinding[] = [];

  findings.push(...tally("vin", findUnmaskedVins(source)));

  // A labelled identifier that still carries its digits.
  const labelled = (labels: string, kind: PiiKind) => {
    const pattern = new RegExp(`\\b(?:${labels})\\s*(?:#|no\\.?|number|id)?\\s*[:#.-]{1,3}\\s*([A-Za-z0-9][A-Za-z0-9-]{5,})`, "gi");
    const hits: string[] = [];
    for (const match of source.matchAll(pattern)) {
      const value = match[1];
      if (/^\[REDACTED/i.test(value)) continue;
      if (!/\d/.test(value)) continue;
      hits.push(value);
    }
    findings.push(...tally(kind, hits));
  };
  labelled("claim", "claim_number");
  labelled("policy", "policy_number");

  const carriers = options.expectedInsurers?.length ? options.expectedInsurers : COMMON_INSURERS;
  const carrierHits: string[] = [];
  for (const carrier of carriers) {
    const pattern = new RegExp(`\\b${carrier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    const matches = source.match(pattern);
    if (matches) carrierHits.push(...matches);
  }
  findings.push(...tally("insurer", carrierHits));

  return findings;
}

/** True when the artifact may leave the system. */
export function isExportClean(findings: PiiFinding[]): boolean {
  return findings.length === 0;
}

/** Operator-facing description of what is still exposed. */
export function describePiiExposure(artifactName: string, findings: PiiFinding[]): string {
  if (findings.length === 0) return `${artifactName}: no unredacted identifiers found.`;
  const detail = findings
    .map((finding) => `${finding.kind} x${finding.count} (e.g. ${finding.sample})`)
    .join(", ");
  return `${artifactName} still carries unredacted identifiers — ${detail}`;
}
