import { createHash } from "node:crypto";

type AuthorizedUser = {
  isPlatformAdmin?: boolean;
  isInternalUser?: boolean;
} | null;

type PolicyLegalSnapshotRecord = {
  id: string;
  caseId?: string | null;
  claimId?: string | null;
  claimState?: string | null;
  regulationIdsUsed: unknown;
  regulationSourcesUsed?: unknown;
  citationsUsed: unknown;
  oemSourcesUsed: unknown;
  carrierSourcesUsed: unknown;
  placeholderCitations: unknown;
  policyLegalConfidenceScore: number;
  generatedAt: Date | string;
  createdAt?: Date | string | null;
};

type SnapshotValidationStatus = "pass" | "warn" | "fail";

export type PolicyLegalSnapshotViewerPayload = {
  total: number;
  filters: {
    caseId: string | null;
    claimId: string | null;
  };
  snapshots: Array<{
    snapshot_id: string;
    caseId: string | null;
    claimId: string | null;
    claim_state: string | null;
    generatedAt: string;
    createdAt: string | null;
    snapshot_timestamp: string;
    snapshot_version: string;
    immutable_snapshot_hash: string;
    replay_safe_rendering: {
      supported: true;
      schema: "policy_legal_snapshot_viewer.v2";
      render_key: string;
    };
    jurisdiction_context: {
      claim_state: string | null;
      confidence: "high" | "medium" | "low";
      basis: string;
    };
    confidence_metadata: {
      policyLegalConfidenceScore: number;
      band: "high" | "medium" | "low";
    };
    evidence_completeness_metadata: {
      regulationCitationCount: number;
      regulationSourceCount: number;
      citationCount: number;
      oemSourceCount: number;
      carrierSourceCount: number;
      placeholderCitationCount: number;
      missing: string[];
    };
    source_metadata: {
      regulationSources: Array<{
        id: string;
        citation: string;
        sourceName: string | null;
        sourceUrl: string | null;
        retrievedAt: string | null;
        effectiveDate: string | null;
        verifiedBy: string | null;
        notes: string | null;
      }>;
      oemSources: string[];
      carrierSources: string[];
    };
    citation_counts: {
      regulationCitations: number;
      renderedCitations: number;
      placeholderCitations: number;
      oemSources: number;
      carrierSources: number;
    };
    PolicyLegalConfidenceScore: number;
    regulation_ids_used: string[];
    regulation_sources_used: Array<{
      id: string;
      citation: string;
      sourceName: string | null;
      sourceUrl: string | null;
      retrievedAt: string | null;
      effectiveDate: string | null;
      verifiedBy: string | null;
      notes: string | null;
    }>;
    citations_used: string[];
    oem_sources_used: string[];
    carrier_sources_used: string[];
    placeholder_citations: Array<{
      category?: string | null;
      citation?: string | null;
      note?: string | null;
      verification_state: "placeholder";
      regulatory_support: "No";
    }>;
    validation: {
      snapshot_immutability: SnapshotValidationResult;
      source_preservation: SnapshotValidationResult;
      citation_rendering_integrity: SnapshotValidationResult;
      regulation_source_mapping: SnapshotValidationResult;
    };
  }>;
};

type SnapshotValidationResult = {
  status: SnapshotValidationStatus;
  details: string;
  metadata?: Record<string, unknown>;
};

export type PolicyLegalSnapshotsEndpointResult = {
  status: number;
  body: PolicyLegalSnapshotViewerPayload | { error: string };
};

export async function buildPolicyLegalSnapshotsEndpointResult(params: {
  caseId: string | null | undefined;
  claimId: string | null | undefined;
  currentUser: AuthorizedUser;
  findSnapshots: (filters: {
    caseId: string | null;
    claimId: string | null;
  }) => Promise<PolicyLegalSnapshotRecord[]>;
}): Promise<PolicyLegalSnapshotsEndpointResult> {
  if (!params.currentUser) {
    return {
      status: 401,
      body: { error: "Authentication is required." },
    };
  }

  if (!params.currentUser.isPlatformAdmin && !params.currentUser.isInternalUser) {
    return {
      status: 403,
      body: { error: "Admin or internal access is required." },
    };
  }

  const caseId = normalizeFilter(params.caseId);
  const claimId = normalizeFilter(params.claimId);
  if (!caseId && !claimId) {
    return {
      status: 400,
      body: { error: "caseId or claimId is required." },
    };
  }

  const records = await params.findSnapshots({ caseId, claimId });
  const snapshots = records
    .map(serializeSnapshot)
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));

  return {
    status: 200,
    body: {
      total: snapshots.length,
      filters: { caseId, claimId },
      snapshots,
    },
  };
}

function normalizeFilter(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function serializeSnapshot(record: PolicyLegalSnapshotRecord) {
  const generatedAt = toIsoString(record.generatedAt);
  const createdAt = record.createdAt ? toIsoString(record.createdAt) : null;
  const regulationIds = toStringArray(record.regulationIdsUsed);
  const regulationSources = toRegulationSources(record.regulationSourcesUsed);
  const citations = toStringArray(record.citationsUsed);
  const oemSources = toStringArray(record.oemSourcesUsed);
  const carrierSources = toStringArray(record.carrierSourcesUsed);
  const placeholderCitations = toPlaceholderCitations(record.placeholderCitations);
  const canonicalSnapshot = {
    snapshot_id: record.id,
    caseId: record.caseId ?? null,
    claimId: record.claimId ?? null,
    claim_state: record.claimState ?? null,
    generatedAt,
    createdAt,
    PolicyLegalConfidenceScore: record.policyLegalConfidenceScore,
    regulation_ids_used: regulationIds,
    regulation_sources_used: regulationSources,
    citations_used: citations,
    oem_sources_used: oemSources,
    carrier_sources_used: carrierSources,
    placeholder_citations: placeholderCitations,
  };
  const immutableHash = hashSnapshot(canonicalSnapshot);
  const validation = buildSnapshotValidation({
    hash: immutableHash,
    regulationIds,
    regulationSources,
    citations,
    oemSources,
    carrierSources,
    placeholderCitations,
  });
  const citationCounts = {
    regulationCitations: regulationIds.length,
    renderedCitations: citations.length,
    placeholderCitations: placeholderCitations.length,
    oemSources: oemSources.length,
    carrierSources: carrierSources.length,
  };
  const evidenceCompleteness = buildEvidenceCompletenessMetadata({
    regulationIds,
    regulationSources,
    citations,
    oemSources,
    carrierSources,
    placeholderCitations,
  });

  return {
    snapshot_id: record.id,
    caseId: record.caseId ?? null,
    claimId: record.claimId ?? null,
    claim_state: record.claimState ?? null,
    generatedAt,
    createdAt,
    snapshot_timestamp: generatedAt,
    snapshot_version: "policy_legal_snapshot_viewer.v2",
    immutable_snapshot_hash: immutableHash,
    replay_safe_rendering: {
      supported: true as const,
      schema: "policy_legal_snapshot_viewer.v2" as const,
      render_key: `${record.id}:${immutableHash.slice(0, 12)}`,
    },
    jurisdiction_context: buildJurisdictionContext(record.claimState),
    confidence_metadata: {
      policyLegalConfidenceScore: record.policyLegalConfidenceScore,
      band: confidenceBand(record.policyLegalConfidenceScore),
    },
    evidence_completeness_metadata: evidenceCompleteness,
    source_metadata: {
      regulationSources,
      oemSources,
      carrierSources,
    },
    citation_counts: citationCounts,
    PolicyLegalConfidenceScore: record.policyLegalConfidenceScore,
    regulation_ids_used: regulationIds,
    regulation_sources_used: regulationSources,
    citations_used: citations,
    oem_sources_used: oemSources,
    carrier_sources_used: carrierSources,
    placeholder_citations: placeholderCitations,
    validation,
  };
}

function toRegulationSources(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
    .filter((item) => typeof item.id === "string" && typeof item.citation === "string")
    .map((item) => ({
      id: item.id as string,
      citation: item.citation as string,
      sourceName: typeof item.sourceName === "string" ? item.sourceName : null,
      sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : null,
      retrievedAt: typeof item.retrievedAt === "string" ? item.retrievedAt : null,
      effectiveDate:
        typeof item.effectiveDate === "string"
          ? item.effectiveDate
          : typeof item.effective_date === "string"
            ? item.effective_date
            : null,
      verifiedBy: typeof item.verifiedBy === "string" ? item.verifiedBy : null,
      notes: typeof item.notes === "string" ? item.notes : null,
    }));
}

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function toPlaceholderCitations(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
    .map((item) => ({
      category: typeof item.category === "string" ? item.category : null,
      citation: typeof item.citation === "string" ? item.citation : null,
      note: typeof item.note === "string" ? item.note : null,
      verification_state: "placeholder" as const,
      regulatory_support: "No" as const,
    }));
}

function buildSnapshotValidation(params: {
  hash: string;
  regulationIds: string[];
  regulationSources: ReturnType<typeof toRegulationSources>;
  citations: string[];
  oemSources: string[];
  carrierSources: string[];
  placeholderCitations: ReturnType<typeof toPlaceholderCitations>;
}) {
  const mappedRegulationIds = new Set(params.regulationSources.map((source) => source.id));
  const unmappedRegulationIds = params.regulationIds.filter((id) => !mappedRegulationIds.has(id));
  const citationsMissingRender = params.citations.filter((citation) => !citation.trim());
  const sourceCount = params.regulationSources.length + params.oemSources.length + params.carrierSources.length;

  return {
    snapshot_immutability: {
      status: "pass" as const,
      details: "Immutable snapshot hash was computed from the canonical replay payload.",
      metadata: {
        algorithm: "sha256",
        hash: params.hash,
        version: "policy_legal_snapshot_viewer.v2",
      },
    },
    source_preservation: {
      status: sourceCount > 0 ? "pass" as const : "warn" as const,
      details: sourceCount > 0
        ? "Source metadata is preserved for replay rendering."
        : "No source metadata was preserved on this snapshot.",
      metadata: { sourceCount },
    },
    citation_rendering_integrity: {
      status: citationsMissingRender.length === 0 ? "pass" as const : "fail" as const,
      details: citationsMissingRender.length === 0
        ? "All stored citations are renderable strings."
        : "One or more stored citations cannot be rendered.",
      metadata: {
        citationCount: params.citations.length,
        invalidCitationCount: citationsMissingRender.length,
      },
    },
    regulation_source_mapping: {
      status: unmappedRegulationIds.length === 0 ? "pass" as const : "warn" as const,
      details: unmappedRegulationIds.length === 0
        ? "Every regulation id has preserved regulation-source metadata."
        : "Some regulation ids are missing preserved source metadata.",
      metadata: {
        regulationIdCount: params.regulationIds.length,
        regulationSourceCount: params.regulationSources.length,
        unmappedRegulationIds,
      },
    },
  };
}

function buildEvidenceCompletenessMetadata(params: {
  regulationIds: string[];
  regulationSources: ReturnType<typeof toRegulationSources>;
  citations: string[];
  oemSources: string[];
  carrierSources: string[];
  placeholderCitations: ReturnType<typeof toPlaceholderCitations>;
}) {
  const missing = [
    params.regulationSources.length === 0 ? "regulation source metadata" : null,
    params.citations.length === 0 ? "rendered citations" : null,
    params.oemSources.length === 0 ? "OEM source metadata" : null,
    params.carrierSources.length === 0 ? "carrier/policy source metadata" : null,
  ].filter((item): item is string => Boolean(item));

  return {
    regulationCitationCount: params.regulationIds.length,
    regulationSourceCount: params.regulationSources.length,
    citationCount: params.citations.length,
    oemSourceCount: params.oemSources.length,
    carrierSourceCount: params.carrierSources.length,
    placeholderCitationCount: params.placeholderCitations.length,
    missing,
  };
}

function buildJurisdictionContext(claimState: string | null | undefined) {
  const normalized = claimState?.trim().toUpperCase() || null;
  return {
    claim_state: normalized,
    confidence: normalized && /^[A-Z]{2}$/.test(normalized) ? "high" as const : "low" as const,
    basis: normalized && /^[A-Z]{2}$/.test(normalized)
      ? "Snapshot includes a two-letter claim-state value."
      : "Snapshot does not include a confirmed two-letter claim-state value.",
  };
}

function confidenceBand(score: number): "high" | "medium" | "low" {
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  return "low";
}

function hashSnapshot(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
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
