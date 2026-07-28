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
    case "stored_on_post":
      return "Stored/history code in the post-scan fault memory with no matching pre-scan entry — likely pre-existing memory content, not a repair-induced fault. Clear and re-scan to confirm before treating it as a new problem.";
    default:
      return "Status could not be established on both scans — verify against the original scan reports.";
  }
}

/** Stored/history/memory statuses are fault-memory content, not current faults. */
function isMemoryStatus(status: DtcRecord["status"]): boolean {
  return status === "stored" || status === "history";
}

/** Best description across sides (post wins when both exist). */
function pickDescription(pre?: DtcRecord, post?: DtcRecord): string | null {
  return post?.originalDescription ?? pre?.originalDescription ?? null;
}

export function compareScans(pre: ParsedScanReport, post: ParsedScanReport): ScanIqComparison {
  const preByKey = new Map(pre.dtcs.map((dtc) => [comparisonKey(dtc), dtc]));
  const postByKey = new Map(post.dtcs.map((dtc) => [comparisonKey(dtc), dtc]));
  const rows: DtcComparison[] = [];

  // Cross-vendor pairing: asTech reports carry module headings, ISTA memory
  // lists do not — the SAME code then lives under different code|module keys
  // and reads as "cleared" on one side plus "new" on the other. When an
  // exact code+module key has no counterpart, fall back to pairing by bare
  // code against the other side's still-unmatched records.
  const preKeyByCode = new Map<string, string[]>();
  for (const [key, dtc] of preByKey) {
    const list = preKeyByCode.get(dtc.normalizedCode) ?? [];
    list.push(key);
    preKeyByCode.set(dtc.normalizedCode, list);
  }
  const postKeyByCode = new Map<string, string[]>();
  for (const [key, dtc] of postByKey) {
    const list = postKeyByCode.get(dtc.normalizedCode) ?? [];
    list.push(key);
    postKeyByCode.set(dtc.normalizedCode, list);
  }
  const pairedPreKeys = new Set<string>();
  const pairedPostKeys = new Set<string>();
  // A post report that carries stored/history codes is a fault-memory list
  // (ISTA-style); ordinary scan tools list only present codes and never
  // produce stored statuses.
  const postIsMemoryList = post.dtcs.some((dtc) => isMemoryStatus(dtc.status));
  const resolveCounterpart = (
    key: string,
    dtc: DtcRecord,
    ownSide: Map<string, DtcRecord>,
    otherSide: Map<string, DtcRecord>,
    otherKeysByCode: Map<string, string[]>,
    otherPaired: Set<string>
  ): DtcRecord | undefined => {
    const exact = otherSide.get(key);
    if (exact) return exact;
    // Bare-code fallback: only claim a counterpart that is not itself
    // exact-matched (its own key absent on this side) and not already paired.
    const candidates = otherKeysByCode.get(dtc.normalizedCode) ?? [];
    for (const candidateKey of candidates) {
      if (otherPaired.has(candidateKey)) continue;
      if (ownSide.has(candidateKey)) continue;
      otherPaired.add(candidateKey);
      return otherSide.get(candidateKey);
    }
    return undefined;
  };

  const allKeys = [...new Set([...preByKey.keys(), ...postByKey.keys()])];
  for (const key of allKeys) {
    if (pairedPreKeys.has(key) || pairedPostKeys.has(key)) continue;
    const exactPre = preByKey.get(key);
    const exactPost = postByKey.get(key);
    const preDtc =
      exactPre ??
      (exactPost
        ? resolveCounterpart(key, exactPost, postByKey, preByKey, preKeyByCode, pairedPreKeys)
        : undefined);
    const postDtc =
      exactPost ??
      (exactPre
        ? resolveCounterpart(key, exactPre, preByKey, postByKey, postKeyByCode, pairedPostKeys)
        : undefined);

    let changeType: DtcComparison["changeType"];
    if (preDtc && postDtc) {
      changeType = postDtc.status === "cleared" ? "cleared" : "remaining";
    } else if (preDtc && !postDtc) {
      changeType = "cleared";
    } else if (!preDtc && postDtc) {
      // A post-only code that is STORED/HISTORY is fault-memory content, not
      // proof the repair introduced a fault — a full ISTA memory list would
      // otherwise flood the report with ~100 false "new after repair" codes
      // and force a high risk score (RO 22009). In a memory-list document an
      // UNREADABLE presence column (OCR noise) cannot support "appeared after
      // repair" either — that is a verify item, not an asserted new fault.
      changeType = isMemoryStatus(postDtc.status)
        ? "stored_on_post"
        : postDtc.status === "unknown" && postIsMemoryList
          ? "unknown"
          : "new";
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

  // Stable order: new → remaining → stored-memory → cleared → unknown, then by code.
  const rank: Record<DtcComparison["changeType"], number> = {
    new: 0,
    remaining: 1,
    stored_on_post: 2,
    cleared: 3,
    unknown: 4,
  };
  rows.sort((a, b) => rank[a.changeType] - rank[b.changeType] || a.code.localeCompare(b.code));

  const preModules = new Set(pre.modules.map((m) => m.toLowerCase()));
  const postModules = new Set(post.modules.map((m) => m.toLowerCase()));

  const summary: ScanComparisonSummary = {
    clearedCount: rows.filter((row) => row.changeType === "cleared").length,
    remainingCount: rows.filter((row) => row.changeType === "remaining").length,
    newCount: rows.filter((row) => row.changeType === "new").length,
    storedOnPostCount: rows.filter((row) => row.changeType === "stored_on_post").length,
    unknownCount: rows.filter((row) => row.changeType === "unknown").length,
    modulesOnlyInPre: pre.modules.filter((m) => !postModules.has(m.toLowerCase())),
    modulesOnlyInPost: post.modules.filter((m) => !preModules.has(m.toLowerCase())),
  };

  return { pre, post, rows, summary };
}
