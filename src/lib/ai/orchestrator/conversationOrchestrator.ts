import { type ActiveContext } from "@/lib/context/activeContext";
import { getUploadedAttachments } from "@/lib/uploadedAttachmentStore";
import { runRepairAnalysis } from "./analysisOrchestrator";
import { runRepairPipeline } from "../pipeline/repairPipeline";
import { orchestrateRetrieval } from "../retrievalOrchestrator";
import { parseEstimate } from "../extractors/estimateExtractor";
import { extractComparisonFacts } from "../extractors/comparisonExtractor";
import { extractOemRequirements } from "../extractors/oemProcedureExtractor";
import { runEstimateAgent, type EstimateAgentFinding } from "../agents/estimateAgent";
import { runADASAgent, type ADASAgentFinding } from "../agents/adasAgent";
import {
  runProcedureAgent,
  type ProcedureAgentFinding,
} from "../agents/procedureAgent";
import {
  runSupplementAgent,
  type SupplementAgentFinding,
} from "../agents/supplementAgent";
import { composeAuditResponse } from "../reasoning/composeAuditResponse";
import { buildAuditPrompt } from "../reasoning/analysisPrompt";
import type { Evidence, Finding, RepairIntelligenceReport } from "../types/analysis";
import type { RetrieveResult } from "@/lib/rag/retrieve";

export type ConversationIntent =
  | "estimate_comparison"
  | "adas_question"
  | "general_repair_analysis";

type ConversationOrchestratorParams = {
  artifactIds: string[];
  userMessage: string;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  activeContext: ActiveContext | null;
};

export type SpecialistAgentOutputs = {
  estimateFindings: EstimateAgentFinding | null;
  adasFindings: ADASAgentFinding[];
  procedureFindings: ProcedureAgentFinding[];
  supplementFindings: SupplementAgentFinding[];
};

export type ConversationOrchestratorResult = {
  intent: ConversationIntent;
  report: RepairIntelligenceReport | null;
  evidence: RetrieveResult[];
  specialistFindings: SpecialistAgentOutputs;
  prompt: string;
};

export async function orchestrateConversation({
  artifactIds,
  userMessage,
  conversationHistory,
  activeContext,
}: ConversationOrchestratorParams): Promise<ConversationOrchestratorResult> {
  const intent = detectConversationIntent(userMessage);
  const attachments = getUploadedAttachments(artifactIds);
  const documents = attachments.map((attachment) => ({
    filename: attachment.filename,
    mime: attachment.type,
    text: attachment.text,
  }));

  const shopText = findDocumentText(documents, ["shop", "body shop", "repair facility"]);
  const insurerText = findDocumentText(documents, ["insurer", "insurance", "carrier", "sor"]);
  const oemText = findDocumentText(documents, ["oem", "adas", "procedure", "bmw"]);

  let report: RepairIntelligenceReport | null = null;
  let evidence: RetrieveResult[] = [];

  if (intent === "estimate_comparison" || intent === "general_repair_analysis") {
    report = await runRepairAnalysis({
      artifactIds,
      sessionContext: {
        vehicleMake: activeContext?.vehicle?.make ?? null,
        system: activeContext?.repair?.system ?? null,
        component: activeContext?.repair?.component ?? null,
        procedure: activeContext?.repair?.procedure ?? null,
      },
      userIntent: userMessage,
    });
  }

  if (intent === "adas_question" || intent === "general_repair_analysis") {
    const pipeline = runRepairPipeline(documents);
    evidence = await orchestrateRetrieval({
      userQuery: userMessage,
      activeContext,
      intelligence: pipeline,
      limit: 5,
    });
  }

  const specialistFindings = await runSpecialistAgents({
    shopText,
    insurerText,
    oemText,
  });

  const prompt = buildConversationPrompt({
    intent,
    userMessage,
    report,
    evidence,
    specialistFindings,
    conversationHistory,
  });

  return {
    intent,
    report,
    evidence,
    specialistFindings,
    prompt,
  };
}

export function detectConversationIntent(message: string): ConversationIntent {
  const lower = message.toLowerCase();

  if (
    lower.includes("compare") ||
    lower.includes("insurance estimate") ||
    lower.includes("carrier") ||
    lower.includes("shop estimate") ||
    lower.includes("missing")
  ) {
    return "estimate_comparison";
  }

  if (
    lower.includes("adas") ||
    lower.includes("calibration") ||
    lower.includes("scan") ||
    lower.includes("kafas") ||
    lower.includes("radar")
  ) {
    return "adas_question";
  }

  return "general_repair_analysis";
}

async function runSpecialistAgents(params: {
  shopText?: string;
  insurerText?: string;
  oemText?: string;
}): Promise<SpecialistAgentOutputs> {
  const estimateFindings =
    params.shopText && params.insurerText
      ? await runEstimateAgent(params.shopText, params.insurerText)
      : null;

  const operations = params.shopText ? runRepairPipeline([{ filename: "shop.txt", text: params.shopText }]).operations : [];
  const adasFindings = await runADASAgent(operations);

  const comparisonFacts =
    params.shopText && params.insurerText
      ? extractComparisonFacts(parseEstimate(params.shopText), parseEstimate(params.insurerText))
      : {
          shop: {},
          insurer: {},
        };

  const oemRequirements = params.oemText
    ? extractOemRequirements(params.oemText)
    : {
        collisionDamageRequiresScan: false,
        frontBumperRequiresAccCalibration: false,
        frontBumperRequiresKafasCalibration: false,
      };

  const procedureFindings = await runProcedureAgent(
    comparisonFacts,
    oemRequirements
  );
  const supplementFindings = await runSupplementAgent(comparisonFacts);

  return {
    estimateFindings,
    adasFindings,
    procedureFindings,
    supplementFindings,
  };
}

function buildConversationPrompt(params: {
  intent: ConversationIntent;
  userMessage: string;
  report: RepairIntelligenceReport | null;
  evidence: RetrieveResult[];
  specialistFindings: SpecialistAgentOutputs;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
}): string {
  const sections: string[] = [];

  sections.push(`Intent: ${params.intent}`);

  if (params.report) {
    sections.push("Structured Analysis Report:");
    sections.push(JSON.stringify(params.report, null, 2));
    sections.push(buildAuditPrompt(composeAuditResponseFromReport(params.report)));
  }

  sections.push("Primary Estimate Story:");
  sections.push(JSON.stringify(params.specialistFindings.estimateFindings, null, 2));
  sections.push("Supporting ADAS Signals:");
  sections.push(JSON.stringify(params.specialistFindings.adasFindings, null, 2));
  sections.push("Supporting Procedure Signals:");
  sections.push(JSON.stringify(params.specialistFindings.procedureFindings, null, 2));
  sections.push("Supporting Supplement Signals:");
  sections.push(JSON.stringify(params.specialistFindings.supplementFindings, null, 2));

  sections.push(`
[DECISION PRIORITY]

- Use the estimate story as the primary frame for the response
- Treat ADAS, procedure, and supplement agents as supporting signals only
- Do not treat agent outputs as final truth
- Decide what matters based on the repair as a whole
`.trim());

  if (params.evidence.length > 0) {
    const retrievedEvidence = buildStructuredEvidence(params.evidence);

    sections.push("Retrieved OEM Evidence:");
    sections.push(JSON.stringify(retrievedEvidence, null, 2));
    sections.push(buildStructuredFindingContract(params.userMessage, retrievedEvidence));
  }

  if (params.conversationHistory.length > 0) {
    sections.push("Conversation History:");
    sections.push(
      params.conversationHistory
        .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
        .join("\n")
    );
  }

  return sections.join("\n\n");
}

function buildStructuredEvidence(evidence: RetrieveResult[]): Evidence[] {
  return evidence.map((item) => ({
    source: item.file_id ?? "Unknown",
    excerpt: item.content.slice(0, 500),
  }));
}

function buildStructuredFindingContract(
  userMessage: string,
  evidence: Evidence[]
): string {
  const exampleFinding: Finding = {
    category: "compliance_risk",
    title: "Improper Wet Sanding Timing",
    severity: "high",
    explanation:
      "OEM specifies wet sanding and buffing only after full cure. Performing earlier may reduce clear coat thickness and cause failure.",
    evidence: [
      {
        source: "1xoFF0VuqR_mCXgH9QkcI5xifWlTCmY7N",
        excerpt: "Use wet sand and buff only after full cure...",
      },
    ],
    recommendation: "Ensure full cure before any wet sanding or buffing operations.",
  };

  return `
You are a collision repair OEM compliance engine.

Given:
1. User input
2. Retrieved OEM procedures

Use the retrieved OEM procedures as supporting reference material.

Your role:
- Compare the OEM information against the estimate or question
- Decide whether it actually applies to the situation
- Use it to confirm or challenge your reasoning
- Provide structured findings grounded in relevance

Important:
- Not all retrieved procedures apply directly
- Do not assume a requirement without confirming relevance
- Consider repair context, system involvement, and equivalent operations

User input:
${userMessage}

Retrieved OEM procedures:
${JSON.stringify(evidence, null, 2)}

Output JSON only.

Return an array of objects with this exact structure:
${JSON.stringify(exampleFinding, null, 2)}
`.trim();
}

function composeAuditResponseFromReport(report: RepairIntelligenceReport): string {
  const criticalIssues = report.issues.filter(
    (issue) => issue.severity === "high"
  ).length;
  const missingProcedureSet = new Set(
    report.missingProcedures.map((procedure) => procedure.toLowerCase())
  );

  return composeAuditResponse({
    executiveSummary: report.recommendedActions,
    findings: report.issues.map((issue) => ({
      id: issue.id,
      category:
        issue.category === "documentation"
          ? "qc"
          : issue.category === "parts"
            ? "parts"
            : issue.category === "scan"
              ? "scan"
              : "calibration",
      title: issue.title,
      status:
        issue.missingOperation && missingProcedureSet.has(issue.missingOperation.toLowerCase())
          ? "missing"
          : issue.category === "documentation" || issue.category === "parts" || issue.category === "scan"
              ? "missing"
              : "included",
      severity: issue.severity,
      conclusion: issue.finding,
      rationale: issue.impact,
      evidence: report.evidence
        .filter((evidence) => issue.evidenceIds.includes(evidence.id))
        .map((evidence) => ({
          source: evidence.source,
          quote: evidence.snippet,
        })),
    })),
    criticalIssues,
    riskScore: report.summary.riskScore,
    confidence: report.summary.confidence,
    evidenceQuality: report.summary.evidenceQuality,
  });
}

function findDocumentText(
  documents: Array<{ filename: string; text?: string }>,
  keywords: string[]
): string | undefined {
  return documents.find((document) =>
    keywords.some((keyword) =>
      document.filename.toLowerCase().includes(keyword)
    )
  )?.text;
}
