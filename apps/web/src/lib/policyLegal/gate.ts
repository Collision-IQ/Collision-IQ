import type { PolicyLegalReview, RepairIntelligenceReport } from "@/lib/ai/types/analysis";
import type { EstimateOperation } from "@/lib/ai/extractors/estimateExtractor";
import type { PolicyLegalContext } from "@/lib/ai/types/analysis";
import { buildPolicyLegalReview } from "./review";

type PolicyLegalEnv = {
  POLICY_LEGAL_INTELLIGENCE_ENABLED?: string;
};

export function isPolicyLegalIntelligenceEnabled(
  env?: PolicyLegalEnv
) {
  const source = env ?? process.env;
  return source.POLICY_LEGAL_INTELLIGENCE_ENABLED !== "false";
}

export function buildPolicyLegalReviewIfEnabled(params: {
  context: PolicyLegalContext;
  report: RepairIntelligenceReport;
  operations: EstimateOperation[];
  env?: PolicyLegalEnv;
}): PolicyLegalReview | undefined {
  if (!isPolicyLegalIntelligenceEnabled(params.env)) {
    return undefined;
  }

  return buildPolicyLegalReview({
    context: params.context,
    report: params.report,
    operations: params.operations,
  });
}
