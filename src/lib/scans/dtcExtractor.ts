// DTC extraction tolerant of multiple scan vendors (asTech, AirPro, Autel,
// Launch, Snap-on, OEM tools...). Deterministic text parsing — no AI.

import type { DtcRecord, DtcStatus, ScanSide } from "@/lib/scans/scanTypes";

// SAE/generic + manufacturer-enhanced DTCs: P/B/C/U + 4 hex digits, with an
// optional 2-digit failure-type suffix ("U0121-00", "B1342:08", "P0301.02").
const DTC_RE = /\b([PBCU][0-9][0-9A-F]{3})(?:\s?[-:.]\s?([0-9A-F]{2}))?\b/gi;

// BMW/ISTA + asTech-on-BMW fault codes are 6 hex characters, printed either
// with an explicit 0x prefix ("0xB7F8CB - CID: Image data invalid…", RO 22009
// asTech pre-scan) or bare on ISTA printouts ("B7F8A5 Supply voltage…"). The
// SAE pattern above can never match them, which read whole BMW fault lists as
// "no diagnostic trouble codes". The 0x form is unambiguous. The bare form is
// only accepted when it contains at least one hex LETTER (a 6-digit pure
// number is a price/line-number risk) and sits at the start of a line or is
// followed by a separator+description — the shape of a fault-list row.
const BMW_HEX_DTC_RE = /\b0x([0-9A-F]{6})\b/gi;
const BMW_BARE_HEX_DTC_RE = /(^|[\s>])((?=[0-9A-F]*[A-F])[0-9A-F]{6})(?=\s*[-–—:]\s+\S|\s+[A-Za-z]{3,})/gim;

const STATUS_PATTERNS: Array<[RegExp, DtcStatus]> = [
  // BMW/asTech "Not present" (fault stored in memory, not currently active)
  // must outrank the bare "present" → active rule below.
  [/\bnot\s+(?:currently\s+)?present\b/i, "stored"],
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

function containsAnyDtc(line: string): boolean {
  for (const re of [DTC_RE, BMW_HEX_DTC_RE, BMW_BARE_HEX_DTC_RE]) {
    re.lastIndex = 0;
    if (re.test(line)) return true;
  }
  return false;
}

function looksLikeModuleHeading(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80) return null;
  // Never treat a line that contains a DTC as a module heading.
  if (containsAnyDtc(trimmed)) return null;
  // The acronym must stand alone or lead a separator ("SAS", "EPS - Electric
  // Power Steering"). A glued header key/value ("SRS DeploymentNo",
  // "SAS Deployment: No") is report chrome, not a module heading — those
  // leaked into the modules list as garbage (RO 22009 asTech header block).
  if (KNOWN_MODULE_ACRONYMS.test(trimmed) && /^[A-Z0-9]{2,6}(?:\s*[-–—:(].*)?$/.test(trimmed)) {
    return trimmed.replace(/\s*[:\-–—]\s*$/, "");
  }
  // asTech-on-BMW section headings are plain title-case lines ending with a
  // colon ("Front Radar Sensor Long Range:", "Optional Extra Equipment:").
  const colonHeading = /^([A-Z][A-Za-z0-9 /&()\-]{2,60}):$/.exec(trimmed);
  if (colonHeading) return colonHeading[1].trim();
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

  // ISTA "Fault code memory list" printouts start every row with a bare
  // 6-hex code that is often PURE DIGITS ("022345 SAS: Voltage supply -
  // global external undervoltage") — only safe to accept when the document
  // itself identifies as a BMW fault list (banner text, or several explicit
  // 0x-prefixed codes elsewhere in the same document).
  BMW_HEX_DTC_RE.lastIndex = 0;
  const bmwFaultListDocument =
    /fault\s+code\s+memory\s+list|\bista\b/i.test(params.text) ||
    (params.text.match(BMW_HEX_DTC_RE) ?? []).length >= 2;

  lines.forEach((line, index) => {
    const moduleHeading = looksLikeModuleHeading(line);
    if (moduleHeading) {
      currentModule = moduleHeading;
      if (!modules.includes(moduleHeading)) modules.push(moduleHeading);
      return;
    }

    // Collect matches from every code family, deduped per line by code.
    const lineCodes = new Map<string, { exact: string; endIndex: number }>();
    DTC_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = DTC_RE.exec(line)) !== null) {
      const exact = match[2] ? `${match[1].toUpperCase()}-${match[2].toUpperCase()}` : match[1].toUpperCase();
      const normalized = normalizeDtcCode(match[1]);
      if (!lineCodes.has(normalized)) {
        lineCodes.set(normalized, { exact, endIndex: match.index + match[0].length });
      }
    }
    BMW_HEX_DTC_RE.lastIndex = 0;
    while ((match = BMW_HEX_DTC_RE.exec(line)) !== null) {
      const normalized = normalizeDtcCode(match[1]);
      if (!lineCodes.has(normalized)) {
        lineCodes.set(normalized, { exact: `0x${match[1].toUpperCase()}`, endIndex: match.index + match[0].length });
      }
    }
    BMW_BARE_HEX_DTC_RE.lastIndex = 0;
    while ((match = BMW_BARE_HEX_DTC_RE.exec(line)) !== null) {
      const normalized = normalizeDtcCode(match[2]);
      if (!lineCodes.has(normalized)) {
        lineCodes.set(normalized, {
          exact: match[2].toUpperCase(),
          endIndex: match.index + match[0].length,
        });
      }
    }
    if (bmwFaultListDocument) {
      const lineStart = /^\s*([0-9A-F]{6})\b/i.exec(line);
      if (lineStart) {
        const normalized = normalizeDtcCode(lineStart[1]);
        if (!lineCodes.has(normalized)) {
          lineCodes.set(normalized, {
            exact: lineStart[1].toUpperCase(),
            endIndex: (lineStart.index ?? 0) + lineStart[0].length,
          });
        }
      }
    }

    for (const [normalized, found] of lineCodes) {
      // Description: text on the line after the code (strip status words later).
      const after = line.slice(found.endIndex).replace(/^[\s\-–—:.]+/, "").trim();
      const description = after.length > 2 ? after.slice(0, 220) : null;
      let status = detectDtcStatus(line);
      // ISTA fault-list rows carry a currently-present column ("… 83219 No
      // Information" / "… 83218 yes Battery"). The LAST standalone yes/no on
      // the row is that column (a "no" inside the description comes earlier),
      // and it is the only current-vs-memory signal these printouts provide.
      if (status === "unknown" && bmwFaultListDocument) {
        const presence = [...line.matchAll(/\b(yes|no)\b/gi)].pop()?.[1]?.toLowerCase();
        if (presence === "yes") status = "active";
        else if (presence === "no") status = "stored";
      }
      dtcs.push({
        code: found.exact,
        normalizedCode: normalized,
        module: currentModule,
        originalDescription: description,
        status,
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
