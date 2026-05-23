import { redactExternalDocumentUrls } from "@/lib/externalDocuments";
import type { ExportModel } from "@/lib/ai/builders/buildExportModel";
import type {
  ArtifactRefreshPolicy,
  CaseEvidenceRegistryItem,
  ReassessmentDelta,
  SharedFactualCore,
} from "@/lib/ai/types/analysis";
import type { LinkedEvidence } from "@/lib/ingest/fetchLinkedEvidence";

export const LARGE_CASE_FILE_THRESHOLD = 25;
export const LARGE_CASE_CONTEXT_CHAR_THRESHOLD = 120000;

export type LargeCaseChatFile = {
  id: string;
  name: string;
  type: string;
  text: string;
  summary: string | null;
};

export type LargeCaseChatContextInput = {
  id: string;
  estimateText: string;
  files: LargeCaseChatFile[];
  linkedEvidence: LinkedEvidence[];
  transcriptSummary: string | null;
  determination: string | null;
  supportGaps: string[];
  extractedFacts: Record<string, string | number | null>;
  vehicle: {
    year: number | null;
    make: string | null;
    model: string | null;
    trim: string | null;
    vin: string | null;
  };
  factualCore: SharedFactualCore | null;
  evidenceRegistry: CaseEvidenceRegistryItem[];
  reassessmentDelta: ReassessmentDelta | null;
  artifactRefreshPolicy: ArtifactRefreshPolicy | null;
  exportModel: ExportModel;
};

export type LargeCaseChatFallbackDecision = {
  useFallback: boolean;
  fileCount: number;
  estimatedContextChars: number;
  reasons: string[];
};

export function resolveLargeCaseChatFallback(
  activeCase: LargeCaseChatContextInput | null | undefined,
  turnDocuments: Array<{ text?: string | null }> = []
): LargeCaseChatFallbackDecision {
  if (!activeCase) {
    return {
      useFallback: false,
      fileCount: 0,
      estimatedContextChars: estimateTurnDocumentChars(turnDocuments),
      reasons: [],
    };
  }

  const fileCount = activeCase.files.length;
  const estimatedContextChars =
    activeCase.estimateText.length +
    activeCase.files.reduce((sum, file) => sum + (file.text?.length ?? 0), 0) +
    estimateTurnDocumentChars(turnDocuments);
  const reasons = [
    fileCount > LARGE_CASE_FILE_THRESHOLD
      ? `reviewed_file_count_${fileCount}_exceeds_${LARGE_CASE_FILE_THRESHOLD}`
      : "",
    estimatedContextChars > LARGE_CASE_CONTEXT_CHAR_THRESHOLD
      ? `estimated_context_chars_${estimatedContextChars}_exceeds_${LARGE_CASE_CONTEXT_CHAR_THRESHOLD}`
      : "",
  ].filter(Boolean);

  return {
    useFallback: reasons.length > 0,
    fileCount,
    estimatedContextChars,
    reasons,
  };
}

export function buildLargeCaseChatContext(params: {
  activeCase: LargeCaseChatContextInput;
  conversationContext: string;
  newUploadSummary: string;
}): string {
  const { activeCase } = params;
  const exportModel = activeCase.exportModel;
  const factualCore = activeCase.factualCore;
  const snapshot = exportModel.collisionSnapshot;
  const delta = activeCase.reassessmentDelta;
  const refreshPolicy = activeCase.artifactRefreshPolicy;
  const researchSnapshot = exportModel.retrievalSummary;

  const sections = [
    "ACTIVE CASE CONTINUATION - LARGE CASE SUMMARY FALLBACK",
    `Case ID: ${activeCase.id}`,
    "The reviewed-file set is large. Answer from generated report summaries, structured findings, extracted facts, evidence registry summaries, and retrieval summaries. Do not request raw re-upload merely because raw attachment excerpts are omitted here.",
    "",
    "Repair Intelligence Report summary:",
    bulletLines([
      `Vehicle: ${factualCore?.vehicleSummary || exportModel.vehicle.label || buildVehicleLabel(activeCase.vehicle) || "Vehicle not fully established"}`,
      `Current determination: ${factualCore?.currentDetermination || activeCase.determination || "Provisional / not established"}`,
      `Case summary: ${factualCore?.currentCaseSummary || activeCase.transcriptSummary || exportModel.disputeIntelligenceReport.summary}`,
      `Risk/confidence/evidence quality: ${exportModel.confidenceIntegrity.adjustedConfidence} confidence, ${exportModel.confidenceIntegrity.completenessStatus} completeness, ${activeCase.exportModel.disputeIntelligenceReport.summary}`,
    ]),
    "",
    "Customer Report summary:",
    bulletLines([
      snapshot?.verdictLine,
      snapshot?.repairPlanVerdict.reason,
      ...(snapshot?.damageSummary ?? []).slice(0, 4),
      snapshot?.disclosure,
    ]),
    "",
    "Estimate Delta summary:",
    formatDeltaSummary(delta),
    "",
    "DOI Readiness state:",
    formatDoiReadinessSummary(activeCase),
    "",
    "Policy & Rights summary:",
    formatPolicyRightsSummary(activeCase),
    "",
    "Snapshot summary:",
    bulletLines([
      `Repair plan verdict: ${snapshot?.repairPlanVerdict.moreCompletePlan ?? "INCONCLUSIVE"}; carrier plan ${snapshot?.repairPlanVerdict.carrierPlanStatus ?? "INCONCLUSIVE"}.`,
      `Estimate comparison: ${snapshot?.estimateComparison.available ? "available" : snapshot?.estimateComparison.unavailableReason || "not available"}.`,
      ...(snapshot?.estimateComparison.keyDeltas ?? []).slice(0, 6),
      `Evidence completeness: ${snapshot?.evidenceCompleteness.completenessStatus ?? exportModel.confidenceIntegrity.completenessStatus}; reviewed ${snapshot?.evidenceCompleteness.reviewedFileCount ?? activeCase.files.length} files.`,
    ]),
    "",
    "Chat export context:",
    bulletLines([
      activeCase.transcriptSummary,
      `Recent relevant turns: ${params.conversationContext || "No recent turns provided."}`,
    ]),
    "",
    "Key extracted findings:",
    formatKeyFindings(activeCase),
    "",
    "Support gaps and next actions:",
    bulletLines([
      ...activeCase.supportGaps.slice(0, 10),
      ...exportModel.disputeIntelligenceReport.nextMoves.slice(0, 8),
      ...exportModel.negotiationPlaybook.documentationNeeded.slice(0, 8),
    ]),
    "",
    "Linked/internal retrieval summary:",
    bulletLines([
      researchSnapshot
        ? `Drive docs used: ${researchSnapshot.driveDocsUsed}; web sources used: ${researchSnapshot.webSourcesUsed}; OEM evidence found: ${researchSnapshot.oemEvidenceFound ? "yes" : "no"}.`
        : "No retrieval summary stored.",
      ...activeCase.linkedEvidence.slice(0, 8).map((doc) =>
        `${doc.title || "Linked supporting document"} | ${doc.status} | ${doc.sourceType}`
      ),
    ]),
    "",
    "Artifact refresh / generated-report state:",
    formatArtifactRefreshPolicy(refreshPolicy),
    "",
    "Structured vehicle identity:",
    JSON.stringify(activeCase.vehicle, null, 2),
    "",
    "Extracted facts:",
    JSON.stringify(activeCase.extractedFacts, null, 2),
    "",
    "New evidence uploaded in this turn:",
    params.newUploadSummary,
    "",
    "Continuation rules:",
    "- Answer from the compressed active-case state above before considering external sources.",
    "- Treat generated summaries and structured findings as the primary context for this large case.",
    "- Do not infer that omitted raw attachment text means the evidence is absent.",
    "- Never reveal raw external document URLs, and never tell the user to open or visit a linked external document.",
    "- Keep the answer grounded in stored findings; say what is supported, what remains open, and what document would close any gap.",
  ];

  return redactExternalDocumentUrls(sections.join("\n")).trim();
}

export function countLargeCaseSummaryArtifacts(context: string): number {
  return [
    "Repair Intelligence Report summary:",
    "Customer Report summary:",
    "Estimate Delta summary:",
    "DOI Readiness state:",
    "Policy & Rights summary:",
    "Snapshot summary:",
    "Chat export context:",
    "Key extracted findings:",
  ].filter((label) => context.includes(label)).length;
}

function estimateTurnDocumentChars(turnDocuments: Array<{ text?: string | null }>) {
  return turnDocuments.reduce((sum, document) => sum + (document.text?.length ?? 0), 0);
}

function bulletLines(lines: Array<string | null | undefined>) {
  const filtered = lines
    .map((line) => (typeof line === "string" ? line.trim() : ""))
    .filter(Boolean);
  return filtered.length ? filtered.map((line) => `- ${line}`).join("\n") : "- Not available.";
}

function formatDeltaSummary(delta: ReassessmentDelta | null) {
  if (!delta) return "- No estimate delta or reassessment delta stored.";
  return bulletLines([
    delta.summary,
    `Added evidence: ${delta.addedEvidenceIds.join(", ") || "None"}`,
    `Affected issues: ${delta.affectedIssueKeys.join(", ") || "None"}`,
    `Newly documented: ${delta.newlyDocumented.join(", ") || "None"}`,
    `Still open: ${delta.stillOpen.slice(0, 8).join(", ") || "None"}`,
    `Determination changed: ${delta.determinationChanged ? "yes" : "no"}`,
  ]);
}

function formatDoiReadinessSummary(activeCase: LargeCaseChatContextInput) {
  const research = activeCase.exportModel.retrievalSummary;
  const policyEvidenceCount = activeCase.evidenceRegistry.filter(
    (item) => item.sourceType === "policy_document"
  ).length;
  const documentedConduct = activeCase.factualCore?.issueAssessments.filter((issue) =>
    /claim|policy|appraisal|delay|denial|rights|carrier|insurer/i.test(
      `${issue.title} ${issue.summary}`
    )
  ) ?? [];
  const hasLegalSupport = Boolean(research && research.sourcesInfluencingFindings.some(
    (source) => source.sourceType === "drive" || source.sourceType === "web"
  ));
  const state = policyEvidenceCount > 0 && hasLegalSupport && documentedConduct.length > 0
    ? "POTENTIALLY_READY_REVIEW_REQUIRED"
    : "NEEDS_MORE_DOCUMENTATION";

  return bulletLines([
    `State: ${state}.`,
    `Policy documents in evidence registry: ${policyEvidenceCount}.`,
    `Potential claim-handling/appraisal conduct findings: ${documentedConduct.length}.`,
    `Verified source support available in retrieval summary: ${hasLegalSupport ? "yes" : "no"}.`,
    "Treat this as a chat summary only; do not alter DOI gate conclusions.",
  ]);
}

function formatPolicyRightsSummary(activeCase: LargeCaseChatContextInput) {
  const research = activeCase.exportModel.retrievalSummary;
  const sourceCount = research?.sourcesInfluencingFindings.length ?? 0;
  const policyItems = activeCase.evidenceRegistry
    .filter((item) => item.sourceType === "policy_document" || /policy|rights|appraisal/i.test(item.label))
    .slice(0, 8)
    .map((item) => `${item.label}: ${item.extractedSummary || item.evidenceStatus}`);

  return bulletLines([
    `Policy/right source count in retrieval summary: ${sourceCount}.`,
    ...policyItems,
    ...(activeCase.exportModel.disputeStrategy?.priorityFindings ?? []).slice(0, 5),
  ]);
}

function formatKeyFindings(activeCase: LargeCaseChatContextInput) {
  const factualCore = activeCase.factualCore;
  const exportModel = activeCase.exportModel;
  const issueLines = factualCore?.issueAssessments.length
    ? factualCore.issueAssessments.slice(0, 12).map((issue) =>
        `${issue.key}: ${issue.title} | ${issue.status} | ${issue.severity} | ${issue.summary}`
      )
    : [];
  const registryLines = activeCase.evidenceRegistry.slice(0, 12).map((item) =>
    `${item.id}: ${item.label} | ${item.sourceType} | ${item.evidenceStatus} | ${item.extractedSummary || "No summary"}`
  );
  const driverLines = exportModel.disputeIntelligenceReport.topDrivers.slice(0, 8).map((driver) =>
    `${driver.title}: ${driver.supportStatus}; ${driver.whyItMatters}; next: ${driver.nextAction}`
  );

  return bulletLines([
    ...issueLines,
    ...registryLines,
    ...driverLines,
    ...exportModel.findingReasoning.slice(0, 8).map((finding) =>
      `${finding.issue}: ${finding.rationaleSummary || finding.finding || finding.why_it_matters}; evidence ${finding.evidenceLevel}; next ${finding.next_action}`
    ),
  ]);
}

function formatArtifactRefreshPolicy(policy: ArtifactRefreshPolicy | null) {
  if (!policy) return "- No artifact refresh policy stored.";
  return bulletLines([
    `Repair Intelligence Report: ${policy.mainReport.shouldRefresh ? "refresh" : "stable"} - ${policy.mainReport.reason}`,
    `Customer Report: ${policy.customerReport.shouldRefresh ? "refresh" : "stable"} - ${policy.customerReport.reason}`,
    `Dispute Report: ${policy.disputeReport.shouldRefresh ? "refresh" : "stable"} - ${policy.disputeReport.reason}`,
    `Rebuttal Output: ${policy.rebuttalOutput.shouldRefresh ? "refresh" : "stable"} - ${policy.rebuttalOutput.reason}`,
    `Chat summary only: ${policy.chatSummaryOnly.shouldRefresh ? "yes" : "no"} - ${policy.chatSummaryOnly.reason}`,
  ]);
}

function buildVehicleLabel(vehicle: LargeCaseChatContextInput["vehicle"]) {
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ").trim();
}
