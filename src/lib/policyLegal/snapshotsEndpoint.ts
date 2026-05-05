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
};

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
    PolicyLegalConfidenceScore: number;
    regulation_ids_used: string[];
    regulation_sources_used: Array<{
      id: string;
      citation: string;
      sourceName: string | null;
      sourceUrl: string | null;
      retrievedAt: string | null;
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
  }>;
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
  return {
    snapshot_id: record.id,
    caseId: record.caseId ?? null,
    claimId: record.claimId ?? null,
    claim_state: record.claimState ?? null,
    generatedAt: toIsoString(record.generatedAt),
    PolicyLegalConfidenceScore: record.policyLegalConfidenceScore,
    regulation_ids_used: toStringArray(record.regulationIdsUsed),
    regulation_sources_used: toRegulationSources(record.regulationSourcesUsed),
    citations_used: toStringArray(record.citationsUsed),
    oem_sources_used: toStringArray(record.oemSourcesUsed),
    carrier_sources_used: toStringArray(record.carrierSourcesUsed),
    placeholder_citations: toPlaceholderCitations(record.placeholderCitations),
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
