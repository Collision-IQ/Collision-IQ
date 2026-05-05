import type { PolicyLegalContext } from "@/lib/ai/types/analysis";
import { extractZipFromText, resolveStateFromZip } from "./stateFromZip";
import {
  getApplicableRegulations,
  type PrismaRegulationRecord,
} from "./regulations";
import {
  observePolicyLegalContextInjection,
  observePolicyLegalRegulationDbFallback,
  observePolicyLegalStateDetection,
} from "./observability";

type BuildPolicyLegalContextParams = {
  zip?: string | null;
  state?: string | null;
  estimateText?: string | null;
  oemProcedures?: string[];
  carrierGuidelines?: string[];
  policyContext?: Record<string, string | number | boolean | null>;
  regulationRecords?: PrismaRegulationRecord[];
};

export function buildPolicyLegalContext(
  params: BuildPolicyLegalContextParams
): PolicyLegalContext {
  const resolution = resolvePolicyLegalClaimState(params);
  observePolicyLegalStateDetection(resolution.observation);

  return buildPolicyLegalContextFromResolved({
    ...params,
    claimState: resolution.claimState,
    regulationRecords: params.regulationRecords,
  });
}

export async function buildPolicyLegalContextWithDbRegulations(
  params: BuildPolicyLegalContextParams & {
    findRegulations: (state: string) => Promise<PrismaRegulationRecord[]>;
  }
): Promise<PolicyLegalContext> {
  const resolution = resolvePolicyLegalClaimState(params);
  observePolicyLegalStateDetection(resolution.observation);

  let regulationRecords: PrismaRegulationRecord[] | undefined;
  if (resolution.claimState) {
    try {
      regulationRecords = await params.findRegulations(resolution.claimState);
    } catch (error) {
      observePolicyLegalRegulationDbFallback({
        state: resolution.claimState,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      regulationRecords = undefined;
    }
  }

  return buildPolicyLegalContextFromResolved({
    ...params,
    claimState: resolution.claimState,
    regulationRecords,
  });
}

function resolvePolicyLegalClaimState(params: BuildPolicyLegalContextParams) {
  const textZip = params.estimateText ? extractZipFromText(params.estimateText) : null;
  const claimState =
    params.state?.trim().toUpperCase() ||
    resolveStateFromZip(params.zip) ||
    resolveStateFromZip(textZip);

  return {
    claimState: claimState || null,
    observation: {
      inputStateProvided: Boolean(params.state?.trim()),
      zipProvided: Boolean(params.zip?.trim()),
      textZipDetected: Boolean(textZip),
      claimState: claimState || null,
    },
  };
}

function buildPolicyLegalContextFromResolved(
  params: BuildPolicyLegalContextParams & {
    claimState: string | null;
  }
): PolicyLegalContext {
  const context: PolicyLegalContext = {
    claim_state: params.claimState,
    applicable_regulations: getApplicableRegulations(
      params.claimState,
      params.regulationRecords
    ),
    oem_procedures: [...new Set(params.oemProcedures ?? [])],
    carrier_guidelines: [...new Set(params.carrierGuidelines ?? [])],
    policy_context: params.policyContext ?? {},
    citation_required: true,
  };

  observePolicyLegalContextInjection(context);

  return context;
}

export function formatPolicyLegalPromptContext(context: PolicyLegalContext) {
  return JSON.stringify(
    {
      claim_state: context.claim_state,
      applicable_regulations: context.applicable_regulations,
      oem_procedures: context.oem_procedures,
      carrier_guidelines: context.carrier_guidelines,
      policy_context: context.policy_context,
      citation_required: true,
      citation_enforcement:
        "Every recommendation must cite OEM support, a verified regulation, an insurer guideline, or say: No governing regulation found. Do not assert legal/regulatory conclusions from placeholder records.",
      legal_advice_disclaimer:
        "This is not legal advice. The system provides claim intelligence and citation-backed repair review support.",
    },
    null,
    2
  );
}
