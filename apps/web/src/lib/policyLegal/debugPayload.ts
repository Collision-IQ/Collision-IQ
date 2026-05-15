import type { RegulationRecord } from "@/lib/ai/types/analysis";
import {
  getApplicableRegulations,
  type PrismaRegulationRecord,
} from "./regulations";

export type PolicyLegalRegulationsDebugPayload = {
  state: string | null;
  total: number;
  counts: {
    verified: number;
    placeholder: number;
  };
  records: Array<
    RegulationRecord & {
      source_metadata: {
        sourceName: string | null;
        sourceUrl: string | null;
        retrievedAt: string | null;
        verifiedBy: string | null;
        notes: string | null;
      };
    }
  >;
};

export function buildPolicyLegalRegulationsDebugPayload(params: {
  state?: string | null;
  dbRecords?: PrismaRegulationRecord[];
}): PolicyLegalRegulationsDebugPayload {
  const state = params.state?.trim().toUpperCase() || null;
  const dbRegulations = getApplicableRegulations(state, params.dbRecords ?? []);
  const placeholders = getApplicableRegulations(state);
  const dbIds = new Set(dbRegulations.map((record) => record.id));
  const records = [
    ...dbRegulations,
    ...placeholders.filter((record) => !dbIds.has(record.id)),
  ].sort((left, right) => {
    if (left.verification_state === right.verification_state) {
      return left.category.localeCompare(right.category);
    }

    return left.verification_state === "verified" ? -1 : 1;
  });

  const withMetadata = records.map((record) => ({
    ...record,
    source_metadata: {
      sourceName: record.source_name,
      sourceUrl: record.source_url,
      retrievedAt: record.retrieved_at,
      verifiedBy: record.verified_by,
      notes: record.notes,
    },
  }));

  return {
    state,
    total: withMetadata.length,
    counts: {
      verified: withMetadata.filter((record) => record.verification_state === "verified").length,
      placeholder: withMetadata.filter((record) => record.verification_state === "placeholder").length,
    },
    records: withMetadata,
  };
}
