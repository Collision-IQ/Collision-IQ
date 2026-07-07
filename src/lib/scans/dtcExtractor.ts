// DTC extraction tolerant of multiple scan vendors (asTech, AirPro, Autel,
// Launch, Snap-on, OEM tools...). Deterministic text parsing — no AI.

import type { DtcRecord, DtcStatus, ScanSide } from "@/lib/scans/scanTypes";

// SAE/generic + manufacturer-enhanced DTCs: P/B/C/U + 4 hex digits, with an
// optional 2-digit failure-type suffix ("U0121-00", "B1342:08", "P0301.02").
const DTC_RE = /\b([PBCU][0-9][0-9A-F]{3})(?:\s?[-:.]\s?([0-9A-F]{2}))?\b/gi;

const STATUS_PATTERNS: Array<[RegExp, DtcStatus]> = [
  [/\b(?:active|current|present|confirmed|set)\b/i, "active"],
  [/\bpermanent\b/i, "permanent"],
  [/\bpending\b/i, "pending"],
  [/\b(?:stored|memory)\b/i, "stored"],
  [/\b(?:history|historic|past)\b/i, "history"],
  [/\bintermittent\b/i, "intermittent"],
  [/\b(?:cleared|erased|no dtc)\b/i, "cleared"],
];

// Module heading heuristics: "ECM - Engine Control Module", "BCM (Body
// Control)", "Module: ABS", "Airbag Control Module", "PCM", section banners.
const MODULE_LINE_RE =
  /^\s*(?:module\s*[:\-]\s*)?([A-Z][A-Za-z0-9 /&()\-]{1,60}?(?:control\s+)?module(?:\s*\([^)]*\))?|[A-Z]{2,6}\s*[-–—:(]\s*[A-Za-z][A-Za-z0-9 /&\-]{2,60})\s*[:\-–—]?\s*$/;

const KNOWN_MODULE_ACRONYMS =
  /^(?:ECM|PCM|TCM|BCM|ABS|SRS|RCM|EPS|IPC|HVAC|TPMS|SAS|ACC|BSM|PAM|VCM|GWM|APIM|SCCM|DDM|PDM|OCS|ORC|SDM|EBCM|FCM|HCM|LCM|TCCM|4WD|AWD)\b/;

export function detectDtcStatus(text: string): DtcStatus {
  for (const [re, status] of STATUS_PATTERNS) {
    if (re.test(text)) return status;
  }
  return "unknown";
}

/** Canonical code for pre/post matching: uppercase, suffix retained separately. */
export function normalizeDtcCode(code: string): string {
  return code.toUpperCase().replace(/\s+/g, "");
}

function looksLikeModuleHeading(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80) return null;
  // Never treat a line that contains a DTC as a module heading.
  DTC_RE.lastIndex = 0;
  if (DTC_RE.test(trimmed)) return null;
  if (KNOWN_MODULE_ACRONYMS.test(trimmed)) return trimmed.replace(/\s*[:\-–—]\s*$/, "");
  const match = MODULE_LINE_RE.exec(trimmed);
  if (match) return match[1].trim();
  if (/\bmodule\b/i.test(trimmed) && !/\bno (dtc|codes?)\b/i.test(trimmed)) {
    return trimmed.replace(/\s*[:\-–—]\s*$/, "");
  }
  return null;
}

/**
 * Extract DTC records from scan text, tracking the current module context
 * line by line. Preserves the exact code, description text, status, and the
 * 1-based line reference.
 */
export function extractDtcs(params: {
  text: string;
  sourceFile: string;
  side: ScanSide;
}): { dtcs: DtcRecord[]; modules: string[] } {
  const lines = params.text.split(/\r?\n/);
  const dtcs: DtcRecord[] = [];
  const modules: string[] = [];
  let currentModule: string | null = null;

  lines.forEach((line, index) => {
    const moduleHeading = looksLikeModuleHeading(line);
    if (moduleHeading) {
      currentModule = moduleHeading;
      if (!modules.includes(moduleHeading)) modules.push(moduleHeading);
      return;
    }

    DTC_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = DTC_RE.exec(line)) !== null) {
      const exact = match[2] ? `${match[1].toUpperCase()}-${match[2].toUpperCase()}` : match[1].toUpperCase();
      // Description: text on the line after the code (strip status words later).
      const after = line.slice(match.index + match[0].length).replace(/^[\s\-–—:.]+/, "").trim();
      const description = after.length > 2 ? after.slice(0, 220) : null;
      dtcs.push({
        code: exact,
        normalizedCode: normalizeDtcCode(match[1]),
        module: currentModule,
        originalDescription: description,
        status: detectDtcStatus(line),
        sourceFile: params.sourceFile,
        side: params.side,
        lineReference: index + 1,
      });
    }
  });

  // De-dupe identical (code+module+status) rows from repeated table rows.
  const seen = new Set<string>();
  const deduped = dtcs.filter((dtc) => {
    const key = `${dtc.normalizedCode}|${dtc.module ?? ""}|${dtc.status}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { dtcs: deduped, modules };
}
