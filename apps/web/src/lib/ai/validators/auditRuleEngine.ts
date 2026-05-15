import type {
  AuditFinding,
  AuditRule,
  AuditRuleContext,
  EvidenceRef,
  FindingStatus,
  Severity,
} from "../types/analysis";

export type AuditRuleDefinition = AuditRule & {
  title: string;
  rationale: string;
  evidence: EvidenceRef[];
  severityByStatus?: Partial<Record<FindingStatus, Severity>>;
  conclusion: {
    included: string;
    missing: string;
    not_shown: string;
  };
};

export function evaluateAuditRules(
  definitions: AuditRuleDefinition[],
  context: AuditRuleContext
): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const definition of definitions) {
    if (!definition.trigger(context)) continue;

    const status = definition.evaluate(context);

    findings.push({
      id: definition.id,
      category: definition.category,
      title: definition.title,
      status,
      severity: definition.severityByStatus?.[status] ?? definition.severity,
      conclusion: definition.conclusion[status],
      rationale: definition.rationale,
      evidence: definition.evidence,
    });
  }

  return findings;
}
