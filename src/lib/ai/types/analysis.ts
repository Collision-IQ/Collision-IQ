import type { EvidenceRecord } from "./evidence";
import type { EstimateOperation } from "../extractors/estimateExtractor";
import type { WorkspaceEstimateComparisons } from "@/types/workspaceTypes";
import type { LinkedEvidence } from "@/lib/ingest/fetchLinkedEvidence";
import type {
  ExcludedFromReviewFileDiagnostic,
  ExcludedFromReviewReason,
} from "@/lib/reviewCompleteness";
import type {
  EvidenceCategoryResolution,
  FileReviewDiagnosticsSummary,
  FileReviewLedgerEntry,
} from "@/lib/fileReviewLedger";

export type FindingStatus = "included" | "missing" | "not_shown";
export type Severity = "low" | "medium" | "high";

// ─── Enhanced agent output contract ─────────────────────────────────────────
export type AgentEvidenceLevel =
  | "documented"
  | "referenced"
  | "inferred"
  | "missing";

export type AgentSupportSource =
  | "upload"
  | "google-drive"
  | "web"
  | "serper"
  | "manual";

export type AgentFindingEnhanced = {
  issue: string;
  finding: string;
  evidenceLevel: AgentEvidenceLevel;
  supportSources: AgentSupportSource[];
  risk: "low" | "medium" | "high";
  confidence: number;
  secondLevelReasoning: string;
  thirdLevelAction: string;
};

export type RetrievalImpact = {
  driveDocumentsUsed: number;
  webDocumentsUsed: number;
  serperWorked: boolean;
  oemSourcesFound: boolean;
  legalSourcesFound: boolean;
  changedFindings: string[];
};
// ─────────────────────────────────────────────────────────────────────────────

export type FindingBucket =
  | "critical"
  | "compliance"
  | "supplement"
  | "quality"
  | "parts"
  | "adas";

export type EvidenceLane =
  | "estimate_evidence"
  | "procedure_authority"
  | "estimating_guide_authority"
  | "industry_authority"
  | "regulatory_authority"
  | "policy_authority"
  | "claim_conduct_evidence";

export type SourceSystem =
  | "ccc_secure_share_bms"
  | "uploaded_pdf"
  | "uploaded_image"
  | "oem_procedure"
  | "p_page"
  | "scrs_guide"
  | "deg"
  | "nhtsa"
  | "state_regulation"
  | "insurance_policy"
  | "carrier_correspondence";

export interface EvidenceRef {
  // Legacy display source retained for existing renderers.
  source: string;
  page?: number;
  quote?: string;
  sourceSystem?: SourceSystem;
  evidenceLane?: EvidenceLane;
  confidence?: "low" | "medium" | "high";
  supports?: string;
  limitations?: string[];
}

export type Evidence = {
  source: string;
  excerpt: string;
};

export type FindingCategory =
  | "missing_operation"
  | "compliance_risk"
  | "best_practice";

export type Finding = {
  category: FindingCategory;
  title: string;
  severity: Severity;
  explanation: string;
  evidence: Evidence[];
  recommendation: string;
};

export interface AuditFinding {
  id: string;
  category:
    | "scan"
    | "calibration"
    | "blend"
    | "refinish"
    | "rni"
    | "parts"
    | "electrical"
    | "qc"
    | "corrosion";
  title: string;
  status: FindingStatus;
  severity: Severity;
  conclusion: string;
  rationale: string;
  evidence: EvidenceRef[];
}

export interface RepairAuditReport {
  executiveSummary: string[];
  findings: AuditFinding[];
  criticalIssues: number;
  riskScore: "low" | "moderate" | "high";
  confidence: "low" | "moderate" | "high";
  evidenceQuality: "weak" | "moderate" | "strong";
}

export type AuditRuleContext = {
  facts: Record<string, boolean>;
};

export type AuditRule = {
  id: string;
  category: AuditFinding["category"];
  trigger: (context: AuditRuleContext) => boolean;
  evaluate: (context: AuditRuleContext) => FindingStatus;
  severity: Severity;
};

export interface AnalysisFinding {
  id: string;
  bucket: FindingBucket;
  category: string;
  title: string;
  detail: string;
  severity: Severity;
  status: "present" | "unclear" | "not_detected" | "exposure";
  evidence: EvidenceRef[];
}

export type IssueEvidenceStatus =
  | "DOCUMENTED"
  | "REFERENCED_NOT_PRODUCED"
  | "VISIBLE_IN_IMAGES"
  | "SUPPORTABLE_BUT_UNCONFIRMED"
  | "OPEN_PENDING_FURTHER_DOCUMENTATION"
  | "NOT_ESTABLISHED";

export interface AnalysisSummary {
  riskScore: "low" | "moderate" | "high" | "unknown";
  confidence: "low" | "moderate" | "high";
  criticalIssues: number;
  evidenceQuality: "weak" | "moderate" | "strong";
}

export type VehicleIdentity = {
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  trim?: string;
  manufacturer?: string;
  bodyStyle?: string;
  series?: string;
  sourceQuality?:
    | "explicit_header"
    | "labeled_block"
    | "vin_backed"
    | "note_context"
    | "unknown";
  confidence?: number;
  source?:
    | "vin_decoded"
    | "attachment"
    | "user"
    | "inferred"
    | "session"
    | "unknown";
  fieldSources?: Partial<Record<
    "year" | "make" | "model" | "vin" | "trim" | "manufacturer" | "bodyStyle" | "series",
    "vin_decoded" | "attachment" | "user" | "inferred" | "session" | "unknown"
  >>;
  mismatches?: string[];
};

export type EstimateFacts = {
  vehicle?: VehicleIdentity;
  mileage?: number;
  insurer?: string;
  estimateTotal?: number;
  documentedProcedures: string[];
  documentedHighlights: string[];
};

export interface AnalysisResult {
  mode?: "comparison" | "single-document-review" | "parser-incomplete";
  parserStatus?: "ok" | "failed_or_incomplete";
  summary: AnalysisSummary;
  findings: AnalysisFinding[];
  supplements: AnalysisFinding[];
  evidence: EvidenceRef[];
  operations?: EstimateOperation[];
  // Preserve comparison rows at the analysis layer so Workspace and exports can
  // render the same structured source without re-parsing assistant prose.
  estimateComparisons?: WorkspaceEstimateComparisons;
  rawEstimateText?: string;
  narrative: string;
  vehicle?: VehicleIdentity;
  estimateFacts?: EstimateFacts;
}

// Legacy v2 contract still used by the current orchestrator/UI.
// Keep it exported while the app migrates to RepairAuditReport.
export type RequiredProcedureRecord = {
  procedure: string;
  reason: string;
  source: "rule" | "oem_doc" | "knowledge_graph";
  severity: Severity;
};

export type AnalysisIssue = {
  id: string;
  category: "calibration" | "scan" | "safety" | "parts" | "documentation";
  title: string;
  finding: string;
  impact: string;
  missingOperation?: string;
  evidenceStatus?: IssueEvidenceStatus;
  basisTier?: IssueEvidenceStatus;
  severity: Severity;
  evidenceIds: string[];
};

export type CaseEvidenceSourceType =
  | "shop_estimate"
  | "carrier_estimate"
  | "supplement"
  | "ccc_workfile"
  | "ccc_awf"
  | "ccc_companion_file"
  | "photo"
  | "invoice"
  | "sublet_document"
  | "procedure_link"
  | "scan_report"
  | "calibration_report"
  | "adas_report"
  | "oem_documentation"
  | "policy_document"
  | "manual_note"
  | "other_supporting_document";

export type CaseEvidenceIngestionState =
  | "uploaded"
  | "ingested"
  | "referenced_not_produced"
  | "access_limited"
  | "skipped"
  | "failed";

export type CaseEvidenceRegistryItem = {
  id: string;
  sourceType: CaseEvidenceSourceType;
  label: string;
  extractedText?: string;
  extractedSummary?: string;
  structuredFacts?: Record<string, string | string[] | null>;
  linkedUrl?: string;
  ingestionState: CaseEvidenceIngestionState;
  evidenceStatus: IssueEvidenceStatus;
  relatedIssueKeys: string[];
  createdAt: string;
  updatedAt: string;
};

export type SharedFactualCore = {
  vehicleSummary: string;
  currentCaseSummary: string;
  visibleDamageObservations: string[];
  documentedRepairOperations: string[];
  evidenceRegistrySummary: string[];
  linkedEvidenceState: string[];
  issueAssessments: Array<{
    key: string;
    title: string;
    status: IssueEvidenceStatus;
    severity: Severity;
    summary: string;
    evidenceIds: string[];
  }>;
  documentedPositives: string[];
  openIssues: string[];
  unresolvedVerificationNeeds: string[];
  currentDetermination: string;
  caseContinuity: {
    activeCaseId?: string;
    mode: "new_case" | "active_case_update";
    reassessedAt: string;
    evidenceCount: number;
  };
};

export type ReassessmentDelta = {
  addedEvidenceIds: string[];
  affectedIssueKeys: string[];
  statusChanges: Array<{
    key: string;
    from?: IssueEvidenceStatus;
    to: IssueEvidenceStatus;
  }>;
  newlyDocumented: string[];
  stillOpen: string[];
  determinationChanged: boolean;
  summary: string;
};

export type ArtifactRefreshDecision = {
  shouldRefresh: boolean;
  reason: string;
  signals: string[];
};

export type ArtifactRefreshPolicy = {
  mainReport: ArtifactRefreshDecision;
  customerReport: ArtifactRefreshDecision;
  disputeReport: ArtifactRefreshDecision;
  rebuttalOutput: ArtifactRefreshDecision;
  chatSummaryOnly: ArtifactRefreshDecision;
};

export type ReportFindingReasoning = {
  id?: string;
  issue: string;
  finding?: string;
  why_it_matters: string;
  what_proves_it: string;
  next_action: string;
  rationaleSummary?: string;
  evidenceChainSummary?: string;
  riskIfOmitted?: string;
  /**
   * "verified" is reserved for retrieved authority or uploaded documentation.
   * "documented" means the item is documented ON THE ESTIMATE (or visible in
   * images) — estimate presence is never verified authority support.
   */
  supportConfidenceIndicator?: "verified" | "documented" | "referenced" | "inferred" | "missing" | "unsupported";
  evidenceLevel: "documented" | "referenced" | "inferred" | "missing" | "unsupported";
  confidence: number;
  claimSpecificity: "high" | "medium" | "low";
  leverageScore?: number;
  priorityRank?: number;
};

export type ReportRetrievalSummary = {
  driveDocsUsed: number;
  webSourcesUsed: number;
  serperStatus: "SUCCESS" | "FAILED" | "NOT_RUN";
  oemEvidenceFound: boolean;
  sourcesInfluencingFindings: Array<{
    title: string;
    sourceType: "drive" | "web" | "oem" | "estimate";
    url?: string;
    relatedFindingIds: string[];
  }>;
};

export type ExportResearchAgentName =
  | "Legal / Regulation Agent"
  | "Policy Rights Agent"
  | "OEM Procedure Agent"
  | "Estimate Scrubber Agent"
  | "Citation Verification Agent"
  | "Source Conflict Agent";

export type ExportResearchSupportCategory =
  | "Verified Law"
  | "Research Leads - Not Jurisdiction Verified"
  | "Verified Policy Language"
  | "Verified OEM / Position Statement Support"
  | "General Research Leads - Not Make-Specific"
  | "Internet-Sourced Industry Support"
  | "Inferred Repair Intelligence"
  | "Unsupported / Needs Review";

export type ExportResearchSource = {
  id: string;
  sourceType: "drive" | "web" | "oem" | "policy" | "law" | "industry" | "inference";
  sourceTitle: string;
  locator: string;
  url?: string;
  /** Short search-result excerpt (metadata only — never large copied sections). */
  snippet?: string;
  driveFileId?: string;
  retrievalTimestamp: string;
  jurisdiction?: string;
  effectiveDate?: string;
  confidenceScore: number;
  agent: ExportResearchAgentName;
  supportCategory: ExportResearchSupportCategory;
  accepted: boolean;
  rejectionReason?: string;
};

export type ExportResearchSnapshot = {
  id: string;
  reportType:
    | "policy_rights_review"
    | "estimate_scrubber"
    | "doi_complaint_packet"
    | "oem_contradiction_detection"
    | "repair_intelligence";
  generatedAt: string;
  retrievalTimestamp: string;
  agentsRun: ExportResearchAgentName[];
  searchQueriesUsed: Array<{
    agent: ExportResearchAgentName;
    query: string;
    sourceTarget: "drive" | "internet";
  }>;
  sourcesReviewed: ExportResearchSource[];
  sourcesAccepted: ExportResearchSource[];
  sourcesRejected: ExportResearchSource[];
  citationMap: Array<{
    assertionType: ExportResearchSupportCategory;
    sourceIds: string[];
    confidenceScore: number;
    status: "verified" | "inferred" | "unverified_needs_source";
  }>;
  verificationSummary: {
    uncitedLegalClaimsRejected: number;
    fabricatedStatutesRejected: number;
    staleOrSupersededRegulationsRejected: number;
    unsupportedOemRequirementsRejected: number;
    inferredPolicyRightsDowngraded: number;
  };
  unsupportedFindings: string[];
  immutableSnapshotHash: string;
};

export type ReportDisputeStrategy = {
  leverageScore: number;
  priorityFindings: string[];
  easyWins: string[];
  hardFights: string[];
  recommendedSequence: string[];
};

export type OEMContradictionSeverity = "informational" | "moderate" | "high" | "critical";

export type OEMContradiction = {
  conflictSummary: string;
  affectedOperation: string;
  oemSupportCitation: string | null;
  contradictionSeverity: OEMContradictionSeverity;
  recommendedFollowUp: string;
  supportStatus: "verified" | "referenced" | "inferred";
  sourceType:
    | "OEMProcedure"
    | "OEMPositionStatement"
    | "CalibrationRequirement"
    | "StructuralVerification"
    | "InferredProcedureConflict";
};

export type ConfidenceIntegrity = {
  baseConfidence: "Low" | "Moderate" | "High";
  adjustedConfidence: "Low" | "Moderate" | "High";
  completenessStatus: "COMPLETE" | "PARTIAL" | "INSUFFICIENT";
  uploadedFileCount: number;
  indexedFileCount?: number;
  visionProcessedFileCount?: number;
  reviewedFileCount?: number;
  reviewableFileCount?: number;
  excludedFromReviewCount?: number;
  excludedFromReviewReasons?: ExcludedFromReviewReason[];
  excludedFromReviewFiles?: ExcludedFromReviewFileDiagnostic[];
  fileReviewLedger?: FileReviewLedgerEntry[];
  fileReviewDiagnostics?: FileReviewDiagnosticsSummary;
  evidenceCompletenessLedger?: EvidenceCategoryResolution[];
  totalKnownFileCount?: number;
  uploadLimitReached: boolean;
  userIndicatedMoreFiles: boolean;
  missingCriticalEvidence: string[];
  confidencePenalties: Array<{
    reason: string;
    impact: number;
    explanation: string;
  }>;
  userFacingDisclosure: string;
};

export type RepairIntelligenceReport = {
  summary: {
    riskScore: "low" | "moderate" | "high";
    confidence: "low" | "moderate" | "high";
    criticalIssues: number;
    evidenceQuality: "weak" | "moderate" | "strong";
  };
  vehicle?: VehicleIdentity;
  issues: AnalysisIssue[];
  requiredProcedures: RequiredProcedureRecord[];
  presentProcedures: string[];
  missingProcedures: string[];
  supplementOpportunities: string[];
  evidence: EvidenceRecord[];
  recommendedActions: string[];
  analysis?: AnalysisResult;
  sourceEstimateText?: string;
  estimateFacts?: EstimateFacts;
  linkedEvidence?: LinkedEvidence[];
  evidenceRegistry?: CaseEvidenceRegistryItem[];
  factualCore?: SharedFactualCore;
  reassessmentDelta?: ReassessmentDelta;
  artifactRefreshPolicy?: ArtifactRefreshPolicy;
  findingReasoning?: ReportFindingReasoning[];
  retrievalSummary?: ReportRetrievalSummary;
  exportResearchSnapshot?: ExportResearchSnapshot;
  disputeStrategy?: ReportDisputeStrategy;
  confidenceIntegrity?: ConfidenceIntegrity;
  cccWorkfileContext?: {
    disclaimer: string;
    artifacts: Array<{
      id: string;
      filename: string;
      classification: "ccc_workfile" | "ccc_awf" | "ccc_companion_file";
      parserStatus?: string;
      sha256?: string;
      sizeBytes?: number;
    }>;
  };
  ingestionMeta?: {
    linkedEvidenceCount?: number;
    linkedEvidenceFetchedAt?: string;
    activeCaseId?: string;
    reassessedAt?: string;
    reassessmentMode?: "new_case" | "active_case_update";
    uploadedFileCount?: number;
    indexedFileCount?: number;
    visionProcessedFileCount?: number;
    reviewedFileCount?: number;
    reviewableFileCount?: number;
    excludedFromReviewCount?: number;
    excludedFromReviewReasons?: ExcludedFromReviewReason[];
    excludedFromReviewFiles?: ExcludedFromReviewFileDiagnostic[];
    fileReviewLedger?: FileReviewLedgerEntry[];
    fileReviewDiagnostics?: FileReviewDiagnosticsSummary;
    evidenceCompletenessLedger?: EvidenceCategoryResolution[];
    totalKnownFileCount?: number;
    uploadLimitReached?: boolean;
    userIndicatedMoreFiles?: boolean;
    closedAt?: string;
    active?: boolean;
  };
};

export type RegulatoryCategory =
  | "unfair_claims_practices"
  | "parts_usage"
  | "repair_standards"
  | "steering"
  | "disclosure"
  | "labor_procedures"
  | "total_loss"
  | "diminished_value";

export type RegulationRecord = {
  id: string;
  state: string;
  category: RegulatoryCategory;
  rule: string;
  citation: string;
  source_url: string | null;
  source_name: string | null;
  applicability: string;
  severity: Severity;
  effective_date: string | null;
  retrieved_at: string | null;
  verified_by: string | null;
  notes: string | null;
  verification_state: "verified" | "placeholder";
};

export type PolicyLegalContext = {
  claim_state: string | null;
  applicable_regulations: RegulationRecord[];
  oem_procedures: string[];
  carrier_guidelines: string[];
  policy_context: Record<string, string | number | boolean | null>;
  citation_required: boolean;
};

export type PolicyLegalLineItemReview = {
  line_item: string;
  recommendation: string;
  oem_compliant: boolean | null;
  regulatory_compliant: boolean | null;
  insurer_aligned: boolean | null;
  regulatory_support: "Yes" | "No";
  citation: string;
  source_type: "OEM" | "Regulation" | "Insurer" | "None";
  dispute_strength: "Low" | "Medium" | "High";
  recommended_rebuttal: string;
  incomplete: boolean;
};

export type PolicyLegalReview = {
  claim_context: PolicyLegalContext;
  compliance_summary: {
    total_line_items: number;
    complete_citations: number;
    incomplete_items: number;
    oem_supported_items: number;
    regulation_supported_items: number;
    insurer_aligned_items: number;
    unsupported_legal_claims_blocked: number;
    disclaimer: string;
  };
  line_item_reviews: PolicyLegalLineItemReview[];
  disputable_items: PolicyLegalLineItemReview[];
  regulatory_support_log: Array<{
    state: string | null;
    category: RegulatoryCategory;
    support: "verified" | "placeholder" | "none";
    citation: string;
    note: string;
  }>;
  citation_log: Array<{
    line_item: string;
    citation: string;
    source_type: PolicyLegalLineItemReview["source_type"];
    complete: boolean;
  }>;
  missing_support: string[];
  final_score: {
    PolicyLegalConfidenceScore: number;
    components: {
      citation_completeness: number;
      oem_compliance: number;
      regulatory_compliance: number;
      insurer_alignment: number;
      dispute_strength: number;
    };
  };
};
