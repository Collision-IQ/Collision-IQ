import type { EvidenceRecord } from "./evidence";

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
  status: "included" | "missing" | "reduced" | "exposure";
  evidence: EvidenceRef[];
}

export interface AnalysisSummary {
  riskScore: "low" | "moderate" | "high" | "unknown";
  confidence: "low" | "moderate" | "high";
  criticalIssues: number;
  evidenceQuality: "weak" | "moderate" | "strong";
}

export interface AnalysisResult {
  mode?: "comparison" | "single-document-review" | "parser-incomplete";
  parserStatus?: "ok" | "failed_or_incomplete";
  summary: AnalysisSummary;
  findings: AnalysisFinding[];
  supplements: AnalysisFinding[];
  evidence: EvidenceRef[];
  narrative: string;
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
  severity: Severity;
  evidenceIds: string[];
};

export type RepairIntelligenceReport = {
  summary: {
    riskScore: "low" | "moderate" | "high";
    confidence: "low" | "moderate" | "high";
    criticalIssues: number;
    evidenceQuality: "weak" | "moderate" | "strong";
  };
  vehicle?: {
    year?: number;
    make?: string;
    model?: string;
    vin?: string;
  };
  issues: AnalysisIssue[];
  requiredProcedures: RequiredProcedureRecord[];
  presentProcedures: string[];
  missingProcedures: string[];
  supplementOpportunities: string[];
  evidence: EvidenceRecord[];
  recommendedActions: string[];
};
