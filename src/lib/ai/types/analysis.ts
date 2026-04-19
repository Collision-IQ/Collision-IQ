import type { EvidenceRecord } from "./evidence";
import type { EstimateOperation } from "../extractors/estimateExtractor";
import type { WorkspaceEstimateComparisons } from "@/types/workspaceTypes";
import type { LinkedEvidence } from "@/lib/ingest/fetchLinkedEvidence";

export type FindingStatus = "included" | "missing" | "not_shown";
export type Severity = "low" | "medium" | "high";
export type FindingBucket =
  | "critical"
  | "compliance"
  | "supplement"
  | "quality"
  | "parts"
  | "adas";

export interface EvidenceRef {
  source: string;
  page?: number;
  quote?: string;
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
  severity: Severity;
  evidenceIds: string[];
};

export type CaseEvidenceSourceType =
  | "shop_estimate"
  | "carrier_estimate"
  | "supplement"
  | "photo"
  | "procedure_link"
  | "scan_report"
  | "calibration_report"
  | "adas_report"
  | "oem_documentation"
  | "manual_note"
  | "other_supporting_document";

export type CaseEvidenceIngestionState =
  | "uploaded"
  | "ingested"
  | "referenced_not_produced"
  | "failed";

export type CaseEvidenceRegistryItem = {
  id: string;
  sourceType: CaseEvidenceSourceType;
  label: string;
  extractedText?: string;
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
  ingestionMeta?: {
    linkedEvidenceCount?: number;
    linkedEvidenceFetchedAt?: string;
    activeCaseId?: string;
    reassessedAt?: string;
    reassessmentMode?: "new_case" | "active_case_update";
    closedAt?: string;
    active?: boolean;
  };
};
