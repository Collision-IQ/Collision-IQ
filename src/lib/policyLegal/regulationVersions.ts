import { createHash } from "node:crypto";

export type RegulationVerificationStatus =
  | "verified"
  | "placeholder"
  | "superseded"
  | "unverified";

export type RegulationVersionInput = {
  regulationId: string;
  jurisdiction: string;
  effectiveDate?: Date | string | null;
  supersededDate?: Date | string | null;
  sourcePublicationDate?: Date | string | null;
  verificationStatus: RegulationVerificationStatus;
  citationSource: string;
  retrievalTimestamp: Date | string;
  ruleText?: string | null;
  citationText?: string | null;
  sourceUrl?: string | null;
  sourceName?: string | null;
  notes?: string | null;
};

export type RegulationVersionSnapshot = {
  regulation_id: string;
  jurisdiction: string;
  effective_date: string | null;
  superseded_date: string | null;
  source_publication_date: string | null;
  version_hash: string;
  verification_status: RegulationVerificationStatus;
  citation_source: string;
  retrieval_timestamp: string;
  snapshot: {
    ruleText: string | null;
    citationText: string | null;
    sourceUrl: string | null;
    sourceName: string | null;
    notes: string | null;
  };
};

export type RegulationVersionComparison = {
  regulation_id: string;
  status: "unchanged" | "changed" | "new" | "superseded";
  previous_hash: string | null;
  current_hash: string;
  changed_fields: string[];
  replay_safe: boolean;
};

type ExistingRegulationVersion = {
  regulationId?: string | null;
  regulation_id?: string | null;
  versionHash?: string | null;
  version_hash?: string | null;
  supersededDate?: Date | string | null;
  superseded_date?: Date | string | null;
  snapshot?: unknown;
};

export function buildRegulationVersionSnapshot(
  input: RegulationVersionInput
): RegulationVersionSnapshot {
  const effectiveDate = normalizeDate(input.effectiveDate ?? null);
  const supersededDate = normalizeDate(input.supersededDate ?? null);
  const sourcePublicationDate = normalizeDate(input.sourcePublicationDate ?? null);
  const retrievalTimestamp = normalizeRequiredDate(input.retrievalTimestamp);
  const snapshot = {
    ruleText: normalizeNullableString(input.ruleText),
    citationText: normalizeNullableString(input.citationText),
    sourceUrl: normalizeNullableString(input.sourceUrl),
    sourceName: normalizeNullableString(input.sourceName),
    notes: normalizeNullableString(input.notes),
  };
  const versionHash = hashRegulationVersion({
    regulation_id: input.regulationId,
    jurisdiction: input.jurisdiction.trim().toUpperCase(),
    effective_date: effectiveDate,
    superseded_date: supersededDate,
    source_publication_date: sourcePublicationDate,
    verification_status: input.verificationStatus,
    citation_source: input.citationSource.trim(),
    snapshot,
  });

  return {
    regulation_id: input.regulationId,
    jurisdiction: input.jurisdiction.trim().toUpperCase(),
    effective_date: effectiveDate,
    superseded_date: supersededDate,
    source_publication_date: sourcePublicationDate,
    version_hash: versionHash,
    verification_status: input.verificationStatus,
    citation_source: input.citationSource.trim(),
    retrieval_timestamp: retrievalTimestamp,
    snapshot,
  };
}

export function buildRegulationVersionCreateData(input: RegulationVersionInput) {
  const version = buildRegulationVersionSnapshot(input);

  return {
    regulationId: version.regulation_id,
    jurisdiction: version.jurisdiction,
    effectiveDate: version.effective_date ? new Date(version.effective_date) : null,
    supersededDate: version.superseded_date ? new Date(version.superseded_date) : null,
    sourcePublicationDate: version.source_publication_date
      ? new Date(version.source_publication_date)
      : null,
    versionHash: version.version_hash,
    verificationStatus: version.verification_status,
    citationSource: version.citation_source,
    retrievalTimestamp: new Date(version.retrieval_timestamp),
    snapshot: version.snapshot,
  };
}

export function compareRegulationVersion(
  currentInput: RegulationVersionInput,
  previousVersion?: ExistingRegulationVersion | null
): RegulationVersionComparison {
  const current = buildRegulationVersionSnapshot(currentInput);
  if (!previousVersion) {
    return {
      regulation_id: current.regulation_id,
      status: "new",
      previous_hash: null,
      current_hash: current.version_hash,
      changed_fields: [],
      replay_safe: true,
    };
  }

  const previousHash = previousVersion.versionHash ?? previousVersion.version_hash ?? null;
  const supersededDate =
    previousVersion.supersededDate ?? previousVersion.superseded_date ?? null;

  if (supersededDate) {
    return {
      regulation_id: current.regulation_id,
      status: "superseded",
      previous_hash: previousHash,
      current_hash: current.version_hash,
      changed_fields: ["superseded_date"],
      replay_safe: true,
    };
  }

  return {
    regulation_id: current.regulation_id,
    status: previousHash === current.version_hash ? "unchanged" : "changed",
    previous_hash: previousHash,
    current_hash: current.version_hash,
    changed_fields:
      previousHash === current.version_hash
        ? []
        : compareSnapshotFields(previousVersion.snapshot, current.snapshot),
    replay_safe: true,
  };
}

export function selectRegulationVersionForClaimReplay<T extends {
  effectiveDate?: Date | string | null;
  effective_date?: Date | string | null;
  supersededDate?: Date | string | null;
  superseded_date?: Date | string | null;
}>(versions: T[], claimDate: Date | string): T | null {
  const pointInTime = new Date(claimDate).getTime();
  if (Number.isNaN(pointInTime)) return null;

  return versions
    .filter((version) => {
      const effective = version.effectiveDate ?? version.effective_date ?? null;
      const superseded = version.supersededDate ?? version.superseded_date ?? null;
      const effectiveTime = effective ? new Date(effective).getTime() : Number.NEGATIVE_INFINITY;
      const supersededTime = superseded ? new Date(superseded).getTime() : Number.POSITIVE_INFINITY;
      return effectiveTime <= pointInTime && pointInTime < supersededTime;
    })
    .sort((left, right) => {
      const leftDate = left.effectiveDate ?? left.effective_date ?? null;
      const rightDate = right.effectiveDate ?? right.effective_date ?? null;
      return dateTime(rightDate) - dateTime(leftDate);
    })[0] ?? null;
}

function compareSnapshotFields(previous: unknown, current: RegulationVersionSnapshot["snapshot"]) {
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) {
    return ["snapshot"];
  }

  const previousRecord = previous as Partial<RegulationVersionSnapshot["snapshot"]>;
  return (Object.keys(current) as Array<keyof RegulationVersionSnapshot["snapshot"]>)
    .filter((key) => previousRecord[key] !== current[key]);
}

function hashRegulationVersion(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function normalizeRequiredDate(value: Date | string) {
  const normalized = normalizeDate(value);
  if (!normalized) {
    throw new Error("retrieval_timestamp must be a valid date.");
  }
  return normalized;
}

function normalizeDate(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeNullableString(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function dateTime(value: Date | string | null) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    return `{${Object.keys(objectValue)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
