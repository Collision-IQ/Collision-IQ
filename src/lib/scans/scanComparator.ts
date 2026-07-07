// Pre/post scan comparison — deterministic, keyed by normalized DTC + module.

import type {
  DtcComparison,
  DtcRecord,
  ParsedScanReport,
  ScanComparisonSummary,
  ScanIqComparison,
} from "@/lib/scans/scanTypes";

function comparisonKey(dtc: DtcRecord): string {
  return `${dtc.normalizedCode}|${(dtc.module ?? "").toLowerCase()}`;
}

function repairRelevanceFor(changeType: DtcComparison["changeType"]): string {
  switch (changeType) {
    case "cleared":
      return "Resolved during repair — supports scan/repair documentation for this system.";
    case "remaining":
      return "Still present after repair — additional diagnosis, calibration, or repair verification may be needed before the file is complete.";
    case "new":
      return "Appeared after repair — verify whether repair operations, disconnections, or calibrations introduced this code.";
    default:
      return "Status could not be established on both scans — verify against the original scan reports.";
  }
}

/** Best description across sides (post wins when both exist). */
function pickDescription(pre?: DtcRecord, post?: DtcRecord): string | null {
  return post?.originalDescription ?? pre?.originalDescription ?? null;
}

export function compareScans(pre: ParsedScanReport, post: ParsedScanReport): ScanIqComparison {
  const preByKey = new Map(pre.dtcs.map((dtc) => [comparisonKey(dtc), dtc]));
  const postByKey = new Map(post.dtcs.map((dtc) => [comparisonKey(dtc), dtc]));
  const rows: DtcComparison[] = [];

  const allKeys = [...new Set([...preByKey.keys(), ...postByKey.keys()])];
  for (const key of allKeys) {
    const preDtc = preByKey.get(key);
    const postDtc = postByKey.get(key);

    let changeType: DtcComparison["changeType"];
    if (preDtc && postDtc) {
      changeType = postDtc.status === "cleared" ? "cleared" : "remaining";
    } else if (preDtc && !postDtc) {
      changeType = "cleared";
    } else if (!preDtc && postDtc) {
      changeType = "new";
    } else {
      changeType = "unknown";
    }
    // A side that was unreadable can't prove a code cleared/new.
    if ((pre.unreadable && !preDtc) || (post.unreadable && !postDtc)) {
      changeType = "unknown";
    }

    rows.push({
      code: (postDtc ?? preDtc)!.code,
      module: (postDtc ?? preDtc)!.module,
      preStatus: preDtc?.status ?? null,
      postStatus: postDtc?.status ?? null,
      changeType,
      originalDescription: pickDescription(preDtc, postDtc),
      normalizedDescription: null,
      motorLookupStatus: "skipped",
      motorSource: null,
      repairRelevance: repairRelevanceFor(changeType),
      evidence: {
        preSourceFile: preDtc?.sourceFile ?? null,
        postSourceFile: postDtc?.sourceFile ?? null,
        preLineReference: preDtc?.lineReference ?? null,
        postLineReference: postDtc?.lineReference ?? null,
      },
    });
  }

  // Stable order: new → remaining → cleared → unknown, then by code.
  const rank: Record<DtcComparison["changeType"], number> = { new: 0, remaining: 1, cleared: 2, unknown: 3 };
  rows.sort((a, b) => rank[a.changeType] - rank[b.changeType] || a.code.localeCompare(b.code));

  const preModules = new Set(pre.modules.map((m) => m.toLowerCase()));
  const postModules = new Set(post.modules.map((m) => m.toLowerCase()));

  const summary: ScanComparisonSummary = {
    clearedCount: rows.filter((row) => row.changeType === "cleared").length,
    remainingCount: rows.filter((row) => row.changeType === "remaining").length,
    newCount: rows.filter((row) => row.changeType === "new").length,
    unknownCount: rows.filter((row) => row.changeType === "unknown").length,
    modulesOnlyInPre: pre.modules.filter((m) => !postModules.has(m.toLowerCase())),
    modulesOnlyInPost: post.modules.filter((m) => !preModules.has(m.toLowerCase())),
  };

  return { pre, post, rows, summary };
}
