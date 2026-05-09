import type { ExportModel } from "./buildExportModel";
import type { ExportBuilderInput } from "./exportTemplates";

export type ClaimHandlingDisputeContext = {
  hasContext: boolean;
  summary: string[];
  userReports: string[];
  documentSupport: string[];
  unverified: string[];
  timingConcerns: string[];
  documentsNeeded: string[];
  repairAttachments: string[];
  nextDocumentation: string[];
  explicitSections: Array<{ title: string; bullets: string[] }>;
};

export function buildClaimHandlingDisputeContext(
  params: ExportBuilderInput,
  exportModel: ExportModel
): ClaimHandlingDisputeContext {
  const text = normalizeText([
    params.assistantAnalysis,
    params.analysis?.narrative,
    params.report?.analysis?.narrative,
    params.report?.summary,
    ...(params.report?.recommendedActions ?? []),
    ...(params.report?.evidence ?? []).map((item) => `${item.title} ${item.snippet ?? ""} ${item.source}`),
    ...(params.report?.evidenceRegistry ?? []).map((item) =>
      `${item.label} ${item.extractedText ?? ""} ${item.extractedSummary ?? ""} ${Object.values(item.structuredFacts ?? {}).join(" ")}`
    ),
    exportModel.repairPosition,
    exportModel.positionStatement,
    exportModel.request,
    params.panel?.appraisal?.reasoning,
    ...(params.panel?.stateLeverage ?? []),
  ].filter(Boolean).join("\n"));

  const signals = {
    appraisal: /\bappraisal|independent appraiser|\bia\b|award letter|amount of loss|loss amount/i.test(text),
    prematureAward: /award letter|signed after supplement 1|before (?:the )?shop can continue|before repairs? (?:can )?(?:continue|complete)|premature/i.test(text),
    repairRestriction: /before (?:the )?shop can continue|cannot continue|stop repairs|restrict(?:ed|ion)? on continuing repairs|continue repairs/i.test(text),
    postRepairDenial: /post[- ]?repair|repairs? complete|den(?:y|ied|ial).{0,80}appraisal|appraisal.{0,80}den(?:y|ied|ial)/i.test(text),
    supplement: /supplement|reinspect|reinspection|supplement 1|supplemental/i.test(text),
    maturity: /amount[- ]of[- ]loss|amount of loss|matur(?:e|ity)|final award|interim award|final documents|all documents/i.test(text),
    hiddenDamage: /hidden damage|teardown|tear[- ]?down|scope may still|evolving|developing|not fully documented|incomplete/i.test(text),
    writtenPosition: /written|policy basis|carrier position|claim position|legal team|correspondence|demand/i.test(text),
  };
  const hasContext = Object.values(signals).some(Boolean);

  const repairAttachments = buildRepairAttachmentBullets(exportModel);

  return {
    hasContext,
    summary: [
      "The primary dispute context is claim handling and appraisal timing, not an estimate QA issue.",
      signals.appraisal
        ? "The file reflects an appraisal-process dispute involving when the amount-of-loss process should be finalized."
        : "No appraisal-process narrative was isolated; collect the appraisal clause and communication history before escalation.",
      "Appraisal generally addresses the amount of loss. If teardown-dependent damage, supplements, or final repair documentation remain open, the maturity of that amount-of-loss record matters.",
      "The report should avoid legal-violation conclusions unless written conduct and verified authority support that conclusion.",
    ],
    userReports: [
      signals.prematureAward
        ? "The user reports a premature demand to sign or finalize an appraisal award after Supplement 1, before repairs and final documentation are complete."
        : null,
      signals.repairRestriction
        ? "The user reports that continued repairs may be restricted or conditioned on the appraisal award posture."
        : null,
      signals.postRepairDenial
        ? "The user reports concern that appraisal may later be resisted or denied once repairs are complete."
        : null,
      signals.supplement
        ? "The user reports a supplement and reinspection timing dispute."
        : null,
      signals.maturity
        ? "The user reports concern that the amount-of-loss record may not be mature enough for a final award."
        : null,
      signals.hiddenDamage
        ? "The user reports or the file suggests teardown-dependent damage and repair scope may still be developing."
        : null,
    ].filter(Boolean) as string[],
    documentSupport: [
      signals.appraisal ? "Runtime context and claim discussion material identify appraisal as the dispute path to review." : null,
      signals.supplement ? "The file references supplement timing, reinspection, or continuing repair documentation as part of the dispute." : null,
      signals.hiddenDamage ? "Repair attachments support the possibility that hidden damage, teardown findings, or final repair scope may still evolve." : null,
      signals.writtenPosition ? "The context points to a need for written carrier or IA communications rather than oral process assumptions." : null,
    ].filter(Boolean) as string[],
    unverified: [
      "User chat alone is not treated as verified insurer conduct.",
      "The actual carrier demand, IA instruction, denial posture, and policy basis need date-stamped written support.",
      "Any DOI position needs jurisdiction-specific support before it is framed as a regulatory complaint.",
    ],
    timingConcerns: [
      "The timing concern is reasonable because appraisal is meant to resolve the amount of loss, and the amount may change while teardown, hidden damage review, supplements, and final repair documentation remain open.",
      "An interim award posture can create confusion if later damage or supplements are still being developed.",
      "A carrier process demand should be tied to policy language or a written claim position so each party understands the basis for the requested timing.",
    ],
    documentsNeeded: [
      "Policy jacket, declarations, endorsements, and the appraisal/disagreement-resolution clause.",
      "Written carrier or IA demand about award timing, repair continuation, supplement review, or post-repair appraisal position.",
      "Date-stamped emails, portal messages, call notes, claim notes, or letters showing what was requested and when.",
      "Supplement 1, reinspection notes, teardown findings, final estimate updates, invoices, scans, calibration records, and photos showing whether the amount of loss is still developing.",
      "Jurisdiction-specific DOI, regulation, or policy support before filing or asserting a complaint theory.",
    ],
    repairAttachments,
    nextDocumentation: [
      "Ask the carrier or IA to state the policy basis for any demand to finalize an award before repairs and final supplements are complete.",
      "Ask whether repair continuation is being restricted, and if so, request the restriction in writing with the policy or claim-handling basis.",
      "Preserve all supplement, reinspection, teardown, photo, invoice, scan, and calibration records as amount-of-loss maturity support.",
      "Build a date-stamped communication timeline before presenting the issue to DOI or counsel.",
    ],
    explicitSections: [
      {
        title: "Reported Premature Appraisal Award Demand",
        bullets: [
          signals.prematureAward
            ? "The reported concern is that an award was demanded or expected before repair completion and before all amount-of-loss documentation was available."
            : "No specific premature award demand was verified in the current structured record; obtain the written demand or IA communication.",
          "This should be framed as a reported process concern unless written correspondence verifies the demand.",
        ],
      },
      {
        title: "Reported Restriction On Continuing Repairs",
        bullets: [
          signals.repairRestriction
            ? "The reported concern is that continuing repairs may be conditioned on the appraisal award posture."
            : "No written restriction on continuing repairs was isolated; request a written carrier position if that is being asserted.",
          "A repair-continuation restriction matters because hidden damage and supplements can affect the matured amount of loss.",
        ],
      },
      {
        title: "Reported Post-Repair Appraisal Denial Concerns",
        bullets: [
          signals.postRepairDenial
            ? "The reported concern is that appraisal may later be denied or resisted after repairs are complete."
            : "No written post-repair appraisal denial posture was isolated; preserve any prior communications or claim positions on that issue.",
          "This concern should be tied to policy language, claim communications, and timing history before it is escalated.",
        ],
      },
    ],
  };
}

function buildRepairAttachmentBullets(exportModel: ExportModel): string[] {
  const items = exportModel.supplementItems.slice(0, 8).map((item) => {
    const text = `${item.title} ${item.rationale} ${item.category}`.toLowerCase();
    if (/scan|calibration|adas/.test(text)) {
      return "The file still reflects open scan and calibration verification items, which may support the owner's position that the repair scope remains developing and not fully matured for final amount-of-loss resolution.";
    }
    if (/hidden|teardown|structural|measure|frame|alignment/.test(text)) {
      return "The repair attachments indicate teardown, structural, alignment, or hidden-damage issues may still affect the final amount-of-loss record.";
    }
    if (/supplement|invoice|documentation|proof|photo/.test(text)) {
      return "The repair attachments show documentation or supplement support still matters to the final claim record.";
    }
    return `Repair attachment context: ${humanizeRepairTitle(item.title)} may support the amount-of-loss maturity discussion if tied to supplements, final repair records, or written claim communications.`;
  });

  return dedupe(items).length
    ? dedupe(items)
    : ["No specific repair attachment issue was isolated, but final repair, supplement, and teardown records should still be preserved if appraisal timing is disputed."];
}

function humanizeRepairTitle(value: string): string {
  return value
    .replace(/\bCalibration Verification Open\b/gi, "scan and calibration verification")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
