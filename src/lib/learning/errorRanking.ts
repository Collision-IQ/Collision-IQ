/**
 * Collision Learning Engine — pure error-ranking rules (no server imports).
 * errorLedger.ts applies these against the database.
 */

const SEVERITY_BY_CODE: Record<string, "critical" | "high" | "medium"> = {
  SAFETY_CRITICAL_MISS: "critical",
  UNSUPPORTED_VEHICLE_NOT_DECLARED: "critical",
  UNSUPPORTED_ASSERTION: "high",
  SCOPE_OVERCLAIM: "high",
  WRONG_AUTHORITY_CLASS: "high",
  MISSED_REQUIRED_POINT: "medium",
  MISSING_UNCERTAINTY: "medium",
};

export function severityForErrorCode(errorCode: string): "critical" | "high" | "medium" {
  return SEVERITY_BY_CODE[errorCode] ?? "medium";
}

/**
 * Rank error targets for Saturday remediation: severity first, then
 * recurrence, then recency.
 */
export function rankErrorTargets<
  T extends { severity: string; occurrenceCount: number; lastSeenAt: Date }
>(errors: T[]): T[] {
  const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2 };
  return [...errors].sort((a, b) => {
    const bySeverity = (severityRank[a.severity] ?? 3) - (severityRank[b.severity] ?? 3);
    if (bySeverity !== 0) return bySeverity;
    if (b.occurrenceCount !== a.occurrenceCount) return b.occurrenceCount - a.occurrenceCount;
    return b.lastSeenAt.getTime() - a.lastSeenAt.getTime();
  });
}
