import type { AnalysisResult } from "../types/analysis";
import { buildSupplementLines } from "./supplementBuilder";
import { buildStateLeverage } from "./stateLeverageEngine";

export type NegotiationStage =
  | "initial_request"
  | "pushback_response"
  | "escalation"
  | "appraisal_notice";

export function generateNegotiationWorkflow(params: {
  result: AnalysisResult;
  stage: NegotiationStage;
  state?: string;
}) {
  const { result, stage, state } = params;
  const supplements = buildSupplementLines(result).slice(0, 5);
  const leverage = buildStateLeverage(state);

  if (supplements.length === 0) {
    return `
The current estimate review does not show a clear unresolved support gap that warrants a negotiation ask at this stage.
`.trim();
  }

  if (stage === "initial_request") {
    return `
Please review the attached estimate support and clarify how the following operations are being addressed:

${supplements.map((item) => `- ${item.title}`).join("\n")}

These items relate directly to repair support, system verification, and a defensible completed repair. As written, the current estimate does not clearly support full repair process depth in these areas.
`.trim();
  }

  if (stage === "pushback_response") {
    return `
The issue here is not preference or wording. The issue is whether the estimate clearly supports a complete and verifiable repair process.

The following operations remain insufficiently supported:

${supplements.map((item) => `- ${item.title}: ${item.rationale}`).join("\n")}

${leverage.points.join(" ")}
`.trim();
  }

  if (stage === "escalation") {
    return `
We still do not have clear support for several operations tied to repair defensibility and verification.

${supplements.map((item) => `- ${item.title}`).join("\n")}

At this point, the remaining differences are no longer just estimate formatting issues. They affect whether the repair can be documented and defended as complete.
`.trim();
  }

  return `
The remaining estimate differences materially affect repair support, verification, and documented completeness.

If these items cannot be resolved through normal supplement handling, this file is approaching appraisal territory.

Items still in dispute:
${supplements.map((item) => `- ${item.title}`).join("\n")}
`.trim();
}
