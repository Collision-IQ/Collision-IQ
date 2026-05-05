import type { Prisma } from "@prisma/client";
import type { PolicyLegalReview } from "@/lib/ai/types/analysis";
import {
  observePolicyLegalSnapshotCreated,
  observePolicyLegalSnapshotFailure,
} from "./observability";

export type PolicyLegalAccessLogInput = {
  userId?: string | null;
  state?: string | null;
  requestId?: string | null;
  cacheStatus?: string | null;
  status: number;
  totalCount?: number;
  verifiedCount?: number;
  placeholderCount?: number;
};

export type PolicyLegalCitationSnapshotInput = {
  caseId?: string | null;
  claimId?: string | null;
  review: PolicyLegalReview;
  generatedAt?: Date;
};

export function buildPolicyLegalAccessLogData(
  input: PolicyLegalAccessLogInput
): Prisma.PolicyLegalRegulationAccessLogCreateInput {
  return {
    userId: input.userId ?? null,
    state: input.state ?? null,
    requestId: input.requestId ?? null,
    cacheStatus: input.cacheStatus ?? null,
    status: input.status,
    totalCount: input.totalCount ?? 0,
    verifiedCount: input.verifiedCount ?? 0,
    placeholderCount: input.placeholderCount ?? 0,
  };
}

export function buildPolicyLegalCitationSnapshotData(
  input: PolicyLegalCitationSnapshotInput
): Prisma.PolicyLegalReviewSnapshotCreateInput {
  const regulationIdsUsed = new Set<string>();
  const regulationSourcesUsed = new Map<
    string,
    {
      id: string;
      citation: string;
      sourceName: string | null;
      sourceUrl: string | null;
      retrievedAt: string | null;
      verifiedBy: string | null;
      notes: string | null;
    }
  >();
  const citationsUsed = new Set<string>();
  const oemSourcesUsed = new Set<string>();
  const carrierSourcesUsed = new Set<string>();

  for (const entry of input.review.citation_log) {
    if (entry.citation) {
      citationsUsed.add(entry.citation);
    }

    if (entry.source_type === "OEM") {
      oemSourcesUsed.add(entry.citation);
    }

    if (entry.source_type === "Insurer") {
      carrierSourcesUsed.add(entry.citation);
    }

    if (entry.source_type === "Regulation") {
      const regulation = input.review.claim_context.applicable_regulations.find(
        (candidate) =>
          candidate.verification_state === "verified" &&
          candidate.citation === entry.citation
      );
      if (regulation) {
        regulationIdsUsed.add(regulation.id);
        regulationSourcesUsed.set(regulation.id, {
          id: regulation.id,
          citation: regulation.citation,
          sourceName: regulation.source_name,
          sourceUrl: regulation.source_url,
          retrievedAt: regulation.retrieved_at,
          verifiedBy: regulation.verified_by,
          notes: regulation.notes,
        });
      }
    }
  }

  const placeholderCitations = input.review.regulatory_support_log
    .filter((entry) => entry.support === "placeholder")
    .map((entry) => ({
      category: entry.category,
      citation: entry.citation,
      note: entry.note,
    }));

  return {
    caseId: input.caseId ?? null,
    claimId: input.claimId ?? null,
    claimState: input.review.claim_context.claim_state ?? null,
    regulationIdsUsed: [...regulationIdsUsed],
    regulationSourcesUsed: [...regulationSourcesUsed.values()],
    citationsUsed: [...citationsUsed],
    oemSourcesUsed: [...oemSourcesUsed],
    carrierSourcesUsed: [...carrierSourcesUsed],
    placeholderCitations,
    policyLegalConfidenceScore:
      input.review.final_score.PolicyLegalConfidenceScore,
    generatedAt: input.generatedAt ?? new Date(),
  };
}

export async function persistPolicyLegalCitationSnapshot(params: {
  data: Prisma.PolicyLegalReviewSnapshotCreateInput;
  createSnapshot: (
    data: Prisma.PolicyLegalReviewSnapshotCreateInput
  ) => Promise<unknown>;
}) {
  try {
    await params.createSnapshot(params.data);
    observePolicyLegalSnapshotCreated({
      claimState: params.data.claimState ?? null,
      PolicyLegalConfidenceScore: params.data.policyLegalConfidenceScore,
      regulationCount: Array.isArray(params.data.regulationIdsUsed)
        ? params.data.regulationIdsUsed.length
        : 0,
      citationCount: Array.isArray(params.data.citationsUsed)
        ? params.data.citationsUsed.length
        : 0,
      placeholderCitationCount: Array.isArray(params.data.placeholderCitations)
        ? params.data.placeholderCitations.length
        : 0,
    });
    return { created: true };
  } catch (error) {
    observePolicyLegalSnapshotFailure({
      claimState: params.data.claimState ?? null,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { created: false };
  }
}
