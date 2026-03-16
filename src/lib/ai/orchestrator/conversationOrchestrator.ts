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
import type { RepairIntelligenceReport } from "../types/analysis";
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
  estimateFindings: EstimateAgentFinding[];
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
      : [];

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

  sections.push("Estimate Findings:");
  sections.push(JSON.stringify(params.specialistFindings.estimateFindings, null, 2));
  sections.push("ADAS Findings:");
  sections.push(JSON.stringify(params.specialistFindings.adasFindings, null, 2));
  sections.push("Procedure Findings:");
  sections.push(JSON.stringify(params.specialistFindings.procedureFindings, null, 2));
  sections.push("Supplement Opportunities:");
  sections.push(JSON.stringify(params.specialistFindings.supplementFindings, null, 2));

  if (params.evidence.length > 0) {
    sections.push("Retrieved Evidence:");
    sections.push(
      params.evidence
        .map(
          (item, index) =>
            `${index + 1}. ${item.drive_path ?? "Unknown source"}\n${item.text}`
        )
        .join("\n\n")
    );
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

function composeAuditResponseFromReport(report: RepairIntelligenceReport): string {
  const criticalIssues = report.issues.filter(
    (issue) => issue.severity === "high"
  ).length;

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
      status: report.missingProcedures.includes(issue.title) ? "missing" : "included",
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
