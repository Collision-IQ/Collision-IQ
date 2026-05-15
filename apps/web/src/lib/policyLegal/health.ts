import { PLACEHOLDER_REGULATIONS } from "./regulations";
import { isPolicyLegalIntelligenceEnabled } from "./gate";

export type PolicyLegalHealthPayload = {
  enabled: boolean;
  regulation_table_reachable: boolean;
  placeholder_dataset_available: boolean;
  verified_regulation_count: number;
  last_snapshot_timestamp: string | null;
};

export async function buildPolicyLegalHealthPayload(params: {
  env?: {
    POLICY_LEGAL_INTELLIGENCE_ENABLED?: string;
  };
  countVerifiedRegulations: () => Promise<number>;
  findLastSnapshot: () => Promise<{ generatedAt: Date | string } | null>;
}): Promise<PolicyLegalHealthPayload> {
  let regulationTableReachable = true;
  let verifiedRegulationCount = 0;
  let lastSnapshotTimestamp: string | null = null;

  try {
    verifiedRegulationCount = await params.countVerifiedRegulations();
    const lastSnapshot = await params.findLastSnapshot();
    lastSnapshotTimestamp = lastSnapshot
      ? toIsoString(lastSnapshot.generatedAt)
      : null;
  } catch {
    regulationTableReachable = false;
  }

  return {
    enabled: isPolicyLegalIntelligenceEnabled(params.env),
    regulation_table_reachable: regulationTableReachable,
    placeholder_dataset_available: PLACEHOLDER_REGULATIONS.length > 0,
    verified_regulation_count: verifiedRegulationCount,
    last_snapshot_timestamp: lastSnapshotTimestamp,
  };
}

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
