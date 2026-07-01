export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// LLM review + retrieval can run well past the short Vercel default (chat-with-files was ~113s
// locally). Without this the function is killed in production and the chat "fails to respond"
// even though it works locally. 300s is the Pro plan cap.
export const maxDuration = 300;

import { NextResponse } from "next/server";
import type { ChatAnalysisOutput } from "@/lib/ai/contracts/chatAnalysisSchema";
import type { DriveRetrievalResponse } from "@/lib/ai/contracts/driveRetrievalContract";
import { NON_BIAS_ACCURACY_DIRECTIVE } from "@/lib/ai/nonBiasDirective";
import { DAMAGE_ZONE_AND_DETERMINATION_DIRECTIVE } from "@/lib/ai/narrativeGuard";
import {
  AUTHORITY_RETRIEVAL_POSTURE_DIRECTIVE,
  AUTHORITY_RETRIEVAL_STATUS_FIELDS,
} from "@/lib/ai/authorityRetrievalPosture";
import { JURISDICTIONAL_INSURANCE_APPRAISAL_PROMPT } from "@/lib/ai/jurisdictionalInsurancePrompt";
import { DOCUMENT_REVIEW_TWO_PASS_PROTOCOL } from "@/lib/ai/documentReviewProtocol";
import { buildAppraisalAwardEvaluatorInstruction } from "@/lib/ai/appraisalAwardEvaluator";
import { buildAssistanceProfileInstruction } from "@/lib/ai/assistanceProfile";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import { getOrCreateUser } from "@/lib/getOrCreateUser";
import { normalizeEmail } from "@/lib/auth/platform-admin";
import {
  getCurrentProductEntitlements,
  getCurrentSubscriptionTierForUser,
  resolveProductTrialActive,
} from "@/lib/billing/productEntitlements";
import { getCaseById } from "@/lib/cases/getCaseById";
import type { StoredCaseData } from "@/lib/cases/getCaseById";
import { redactExternalDocumentUrls } from "@/lib/externalDocuments";
import { buildProductAccessGuard } from "@/lib/featureAccess";
import { buildModeContext, type OutputMode } from "@/lib/ai/outputMode";
import { buildResponseModeInstruction, determineResponseMode } from "@/lib/ai/responseMode";
import { buildReviewResponseShapeInstruction } from "@/lib/ai/reviewResponseShape";
import { sanitizeUserFacingEvidenceText } from "@/lib/ui/presentationText";
import {
  classifyRetryableProviderError,
  RETRYABLE_PROVIDER_USER_MESSAGE,
} from "@/lib/ai/providerRetryableError";
import { generatePrimaryText } from "@/lib/ai/providerTextGeneration";
import type { ResponsesInput } from "@/lib/anthropic";

type ChatGenerationRequest = {
  model?: string;
  instructions?: string;
  input: ResponsesInput;
  temperature?: number;
};
import { getCollisionIqModelDiagnostic, collisionIqProvider } from "@/lib/modelConfig";
import {
  areInternalRetrievalPathsResolved,
  createAgentRetrievalTrace,
  logAgentTraceCompleted,
  logAgentTraceEvent,
  recordAgentRetrievalStep,
  type AgentRetrievalTrace,
} from "@/lib/ai/agentRetrievalTrace";
import {
  buildLargeCaseChatContext,
  countLargeCaseSummaryArtifacts,
  resolveLargeCaseChatFallback,
} from "@/lib/ai/chatLargeCaseContext";
import { budgetChatAttachments, buildChatAttachmentOmissionNotice } from "@/lib/ai/chatAttachmentBudget";
import { shouldGenerateAnnotatedCitationDensityEstimate } from "@/lib/reports/citationDensityIntent";
import {
  getUploadBatchLimitMessage,
  resolveUploadPlanLimits,
} from "@/lib/uploadSafety/uploadLimits";
import { isOpenAiVisionCompatibleImage } from "@/lib/ai/openAiVisionInput";

const OPENAI_RETRY_DELAY_MS = 400;
const LEGAL_INFO_DISCLAIMER =
  "Informational support only — not legal advice. I'm not a lawyer, and any legal position should be reviewed by qualified counsel.";

const PENNSYLVANIA_COUNSEL_REVIEW_FALLBACK =
  "Counsel should review applicable Pennsylvania claim-handling and bad-faith law.";

function shouldExposeSafeProviderDiagnostics(userMessage: string) {
  return /\b(?:provider|model|routing|diagnostics?|fallbackUsed|reasoningEffort|keyPresent|openai|gpt-?5\.5)\b/i.test(userMessage);
}

function appendSafeProviderDiagnostics(text: string, params: { stage: string; provider: string; model: string }) {
  const diagnostic = getCollisionIqModelDiagnostic({
    stage: params.stage,
    provider: params.provider as Parameters<typeof getCollisionIqModelDiagnostic>[0]["provider"],
    model: params.model,
  });
  return [
    text.trim(),
    "",
    "Provider diagnostics:",
    `- stage: ${diagnostic.stage}`,
    `- provider: ${diagnostic.provider}`,
    `- model: ${diagnostic.model}`,
    `- fallbackUsed: ${diagnostic.fallbackUsed}`,
    `- reasoningEffort: ${diagnostic.reasoningEffort ?? "null"}`,
    `- keyPresent: ${diagnostic.keyPresent}`,
  ].join("\n");
}

function limitText(text: string, max = 12000) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}\n...[truncated]` : text;
}

type UploadedDocument = {
  id?: string;
  filename: string;
  mime?: string;
  text?: string;
  imageDataUrl?: string;
  pageCount?: number;
};

type MessageContentPart = {
  type?: string;
  text?: string;
};

type IncomingMessage = {
  role: string;
  content: unknown;
};

type IncomingAttachment = {
  filename: string;
  type: string;
  text?: string;
  imageDataUrl?: string;
  pageCount?: number;
};

type IncomingJurisdiction = {
  stateCode?: string;
};

type ChatRequestBody = {
  messages?: IncomingMessage[];
  attachmentIds?: string[];
  attachments?: IncomingAttachment[];
  uploadState?: {
    pending?: boolean;
    phase?: string | null;
  } | null;
  activeCaseId?: string | null;
  jurisdiction?: IncomingJurisdiction;
  productAccess?: {
    plan?: string;
    chatReportRecommendations?: boolean;
    snapshotExport?: boolean;
  };
  assistanceProfile?: string | null;
};

class AttachmentAccessError extends Error {
  status = 404;

  constructor(message = "One or more attachments were not found for the current account.") {
    super(message);
    this.name = "AttachmentAccessError";
  }
}

type ChatRouteDeps = {
  getUploadedAttachments: typeof import("@/lib/uploadedAttachmentStore").getUploadedAttachments;
  saveUploadedAttachment: typeof import("@/lib/uploadedAttachmentStore").saveUploadedAttachment;
  buildDriveRefinementContext: typeof import("@/lib/ai/driveRetrievalService").buildDriveRefinementContext;
  detectChatTaskType: typeof import("@/lib/ai/driveRetrievalService").detectChatTaskType;
  retrieveDriveSupport: typeof import("@/lib/ai/driveRetrievalService").retrieveDriveSupport;
  retrieveWebSupport: typeof import("@/lib/ai/webRetrievalService").retrieveWebSupport;
  buildWebRefinementContext: typeof import("@/lib/ai/webRetrievalService").buildWebRefinementContext;
  inferDriveRetrievalTopics: typeof import("@/lib/ai/contracts/driveRetrievalContract").inferDriveRetrievalTopics;
  inferDriveVehicleContext: typeof import("@/lib/ai/contracts/driveRetrievalContract").inferDriveVehicleContext;
  cleanDisplayText: typeof import("@/lib/ai/displayText").cleanDisplayText;
  assessRetrievedDocumentApplicability: typeof import("@/lib/ai/vehicleApplicability").assessRetrievedDocumentApplicability;
  isVehicleContentApplicable: typeof import("@/lib/ai/vehicleApplicability").isVehicleContentApplicable;
  resolveVehicleApplicabilityContext: typeof import("@/lib/ai/vehicleApplicability").resolveVehicleApplicabilityContext;
  extractEstimateLinksFromDocuments: typeof import("@/lib/ai/estimateLinkExtractor").extractEstimateLinksFromDocuments;
  isFetchableEstimateLink: typeof import("@/lib/ai/estimateLinkExtractor").isFetchableEstimateLink;
  prioritizeEstimateLinks: typeof import("@/lib/ai/estimateLinkExtractor").prioritizeEstimateLinks;
  buildLinkedProcedureRefinementContext: typeof import("@/lib/ai/linkedProcedureRetriever").buildLinkedProcedureRefinementContext;
  retrieveEstimateLinkedProcedureDocs: typeof import("@/lib/ai/linkedProcedureRetriever").retrieveEstimateLinkedProcedureDocs;
  collisionIqModels: typeof import("@/lib/modelConfig").collisionIqModels;
  ADAS_POLICY: typeof import("@/lib/analysis/adasDecision").ADAS_POLICY;
  EVIDENCE_POLICY: typeof import("@/lib/analysis/buildEvidenceCorpus").EVIDENCE_POLICY;
};

let chatRouteDepsPromise: Promise<ChatRouteDeps> | null = null;

function loadChatRouteDeps(): Promise<ChatRouteDeps> {
  if (!chatRouteDepsPromise) {
    chatRouteDepsPromise = Promise.all([
      import("@/lib/uploadedAttachmentStore"),
      import("@/lib/ai/driveRetrievalService"),
      import("@/lib/ai/webRetrievalService"),
      import("@/lib/ai/contracts/driveRetrievalContract"),
      import("@/lib/ai/displayText"),
      import("@/lib/ai/vehicleApplicability"),
      import("@/lib/ai/estimateLinkExtractor"),
      import("@/lib/ai/linkedProcedureRetriever"),
      import("@/lib/modelConfig"),
      import("@/lib/analysis/adasDecision"),
      import("@/lib/analysis/buildEvidenceCorpus"),
    ]).then(
      ([
        uploadedAttachmentStore,
        driveRetrievalService,
        webRetrievalService,
        driveRetrievalContract,
        displayText,
        vehicleApplicability,
        estimateLinkExtractor,
        linkedProcedureRetriever,
        modelConfig,
        adasDecision,
        evidenceCorpus,
      ]) => ({
        getUploadedAttachments: uploadedAttachmentStore.getUploadedAttachments,
        saveUploadedAttachment: uploadedAttachmentStore.saveUploadedAttachment,
        buildDriveRefinementContext: driveRetrievalService.buildDriveRefinementContext,
        detectChatTaskType: driveRetrievalService.detectChatTaskType,
        retrieveDriveSupport: driveRetrievalService.retrieveDriveSupport,
        retrieveWebSupport: webRetrievalService.retrieveWebSupport,
        buildWebRefinementContext: webRetrievalService.buildWebRefinementContext,
        inferDriveRetrievalTopics: driveRetrievalContract.inferDriveRetrievalTopics,
        inferDriveVehicleContext: driveRetrievalContract.inferDriveVehicleContext,
        cleanDisplayText: displayText.cleanDisplayText,
        assessRetrievedDocumentApplicability:
          vehicleApplicability.assessRetrievedDocumentApplicability,
        isVehicleContentApplicable: vehicleApplicability.isVehicleContentApplicable,
        resolveVehicleApplicabilityContext:
          vehicleApplicability.resolveVehicleApplicabilityContext,
        extractEstimateLinksFromDocuments:
          estimateLinkExtractor.extractEstimateLinksFromDocuments,
        isFetchableEstimateLink: estimateLinkExtractor.isFetchableEstimateLink,
        prioritizeEstimateLinks: estimateLinkExtractor.prioritizeEstimateLinks,
        buildLinkedProcedureRefinementContext:
          linkedProcedureRetriever.buildLinkedProcedureRefinementContext,
        retrieveEstimateLinkedProcedureDocs:
          linkedProcedureRetriever.retrieveEstimateLinkedProcedureDocs,
        collisionIqModels: modelConfig.collisionIqModels,
        ADAS_POLICY: adasDecision.ADAS_POLICY,
        EVIDENCE_POLICY: evidenceCorpus.EVIDENCE_POLICY,
      })
    );
  }

  return chatRouteDepsPromise;
}

function buildSystemInstructions(adasPolicy: string, evidencePolicy: string) {
  return `
You are Collision-IQ, a senior collision estimator and repair strategist.

Think like a real estimator, not a narrator.

Tone:
- be concise, confident, direct, and human
- sound like a sharp working professional, not a generic assistant
- light dry humor is allowed occasionally when calling out weak estimate logic, obvious inconsistencies, or thin support
- never aim humor at the user
- never use humor in safety-critical, legal-adjacent, injury-related, diminished value, Market Preview, actual cash value, or other valuation-sensitive conclusions
- if humor risks reducing clarity, skip it

If the user asks a direct question, answer that question directly.

When estimates, repair documents, photos, scans, OEM material, or related files are attached:
- understand the repair strategy before answering
- focus on what materially matters, not line-by-line coverage
- pay closest attention to labor realism, access burden, repair vs replace posture, structural or safety implications, scan and calibration relevance, and estimate completeness
- identify what is actually driving the cost: visible damage, hidden damage potential, access, procedure, electronics, setup, teardown, or estimating style
- make soft professional judgments only when supported by the file, and label uncertainty when support is incomplete
- infer the likely repair path behind the listed operations when reasonable
- compare estimating posture and repair strategy when multiple estimates are present
- when comparing documents, stay neutral unless the file clearly supports a conclusion; describe whether differences affect safety, verification, fit, function, repair completeness, or value
- use OEM or procedure context only when it materially changes the conclusion
- do not paraphrase the estimate line by line
- do not try to mention everything
- be concise, natural, and direct

When no documents are attached:
- answer as a collision repair intelligence assistant for VIN decoding, OEM procedures, part questions, structural questions, diminished value, negotiation strategy, total loss logic, and general automotive knowledge

For Market Preview, actual cash value, or diminished value answers:
- you may provide a rough preview range when the current material supports it
- do not present any Market Preview, actual cash value, or diminished value result as a final appraisal, final actual cash value, or binding diminished value conclusion
- if you provide a number or range, label it as a preliminary preview
- mention confidence and missing inputs when they materially limit the preview
- if the value is not determinable, explain why and list the key missing inputs when possible
- every Market Preview, actual cash value, or diminished value answer must end with: For a full valuation, continue at https://www.collision.academy/

Write in short paragraphs.
Use bullets only when they genuinely improve comparison, negotiation, or rebuttal clarity.
Avoid rigid templates.

${DOCUMENT_REVIEW_TWO_PASS_PROTOCOL}

${NON_BIAS_ACCURACY_DIRECTIVE}

${DAMAGE_ZONE_AND_DETERMINATION_DIRECTIVE}

${AUTHORITY_RETRIEVAL_POSTURE_DIRECTIVE}

${AUTHORITY_RETRIEVAL_STATUS_FIELDS}

${JURISDICTIONAL_INSURANCE_APPRAISAL_PROMPT}

${adasPolicy}

${evidencePolicy}
`.trim();
}

function buildActiveCaseSystemGuard(params: {
  hasStoredEvidence: boolean;
  hasVehicleContext: boolean;
  hasEstimateText: boolean;
  hasFactualCore: boolean;
}) {
  if (!params.hasStoredEvidence) return "";

  return `
ACTIVE CASE CONTINUITY GUARD:
- This is an active case continuation. Stored case evidence is already loaded into the prompt when present.
- If stored case evidence exists, never fall back to generic onboarding just because this turn has no fresh attachment.
- If vehicle identity appears in VEHICLE, EXTRACTED FACTS, STABLE FACTUAL CORE, stored estimate text, report attachments, or uploaded files, never say you do not know the vehicle.
- If uploaded files, stored estimate text, stored report attachments, factual core, extracted facts, or vehicle identity exist, never ask for VIN or for the user to upload the estimate again.
- Only say vehicle identity is not established if it is genuinely absent from every stored case evidence source.
- Treat uploaded attachments and stored active-case evidence as primary. Treat linked external documents as supplemental only.
- Never reveal raw external document URLs.
- When supporting OEM/procedure/external documents are present, describe their relevance without linking.
- If asked for more detail, summarize the findings from those documents as reflected in the case evidence.
- Do not tell the user to open or visit an external document link.

Loaded evidence flags:
- hasVehicleContext: ${params.hasVehicleContext ? "yes" : "no"}
- hasEstimateText: ${params.hasEstimateText ? "yes" : "no"}
- hasFactualCore: ${params.hasFactualCore ? "yes" : "no"}
`.trim();
}

const REFINEMENT_INSTRUCTIONS = `
You are refining an existing collision-repair answer after targeted linked external-document retrieval.

Rules:
- keep the original estimator-style conclusion as the base
- use retrieved OEM support only to reinforce or adjust repair/procedure/compliance conclusions
- use retrieved PA law support only for rights, appraisal, aftermarket, valuation, settlement, or claim-handling questions
- if both OEM and PA law support are present, keep them logically separate in the final answer
- do not dump or paraphrase whole documents
- use the retrieved support as compact supporting context, not as replacement reasoning
- estimate-linked OEM or ADAS references for the resolved vehicle are higher priority than broad external-document retrieval
- stay concise, natural, and direct
- if the retrieved support is weak or only partially applicable, say that clearly
- do not let retrieved support for a different make, model, or manufacturer override the submitted vehicle context
- preserve the Market Preview and diminished value product rules, including the Collision Academy handoff
`.trim();

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object") {
          const candidate = part as MessageContentPart;
          return typeof candidate.text === "string" ? candidate.text : "";
        }

        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function extractLatestUserMessage(messages: IncomingMessage[] = []): string {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message?.role === "user");

  return lastUserMessage ? extractTextContent(lastUserMessage.content).trim() : "";
}

function isFollowupTurn(messages: IncomingMessage[] = []): boolean {
  const conversationalMessages = messages.filter(
    (message) => message?.role === "user" || message?.role === "assistant"
  );
  const userMessages = conversationalMessages.filter((message) => message.role === "user");

  return conversationalMessages.length > 2 && userMessages.length > 1;
}

type ChatIntent =
  | "pasted_text_policy_review"
  | "general_chat"
  | "estimate_file_review"
  | "citation_density_request"
  | "report_export_request"
  | "mixed_policy_and_estimate_file_review";

function hasSubstantivePastedText(message: string) {
  const normalized = message.trim();
  if (normalized.length >= 280) return true;
  if ((normalized.match(/\n/g) ?? []).length >= 2 && normalized.length >= 120) return true;
  return /(?:^|\s)["“][\s\S]{80,}["”](?:\s|$)/.test(normalized);
}

function isPastedTextPolicyReviewIntent(message: string) {
  const normalized = message.toLowerCase();
  const policyOrClaimPrompt =
    /\b(?:policy|clause|language|appraisal|rta|right to appraisal|amount of loss|loss|claim process|instructions?|explain|summary|summarize|rewrite|plain language)\b/i.test(
      message
    );
  const policyClauseSignal =
    /\b(?:if we and you do not agree|amount of loss|competent appraiser|select an umpire|written decision|binding|each party pays|does not waive|policy rights)\b/i.test(
      message
    );

  return (
    policyOrClaimPrompt &&
    (hasSubstantivePastedText(message) ||
      policyClauseSignal ||
      /\b(?:review|explain|summari[sz]e|rewrite|instructions?)\b/.test(normalized) &&
        /\b(?:policy|clause|language|appraisal|rta)\b/.test(normalized))
  );
}

function isCitationDensityRequest(message: string) {
  return /\b(?:citation density|annotated estimate|gap report|annotation legend)\b/i.test(
    message
  );
}

function isReportExportRequest(message: string) {
  return (
    /\b(?:download|email|export|generate|create|send)\b/i.test(message) &&
    /\b(?:report|pdf|packet|snapshot|repair intelligence|doi complaint|customer report)\b/i.test(
      message
    )
  );
}

function isEstimateFileReviewIntent(message: string) {
  // Fire only for an actionable request to act on files/an upload - never on a
  // bare topical mention. Requires an action verb co-occurring with either a
  // file/upload reference or a deictic pointer to an upload, so general
  // auto-claims questions ("explain this appraisal clause") reach the model.
  const actionVerb = /\b(?:review|analy[sz]e|triage|check|run|go\s+over|look\s+at)\b/i;
  const fileReference =
    /\b(?:files?|estimates?|zip|upload(?:s|ed)?|attachments?|documents?|pdf|photos?)\b/i;
  const uploadDeictic =
    /\b(?:these|this\s+file|attached|my\s+files|the\s+estimate)\b|what\s+i\s+(?:just\s+)?sent/i;
  return (
    actionVerb.test(message) &&
    (fileReference.test(message) || uploadDeictic.test(message))
  );
}

function classifyChatIntent(message: string): ChatIntent {
  const hasPolicyText = isPastedTextPolicyReviewIntent(message);
  const hasEstimateFileRequest = isEstimateFileReviewIntent(message);

  if (hasPolicyText && hasEstimateFileRequest) {
    return "mixed_policy_and_estimate_file_review";
  }

  if (hasPolicyText) {
    return "pasted_text_policy_review";
  }

  if (isCitationDensityRequest(message)) {
    return "citation_density_request";
  }

  if (isReportExportRequest(message)) {
    return "report_export_request";
  }

  if (hasEstimateFileRequest) {
    return "estimate_file_review";
  }

  return "general_chat";
}

function isReviewOrEstimateAnalysisIntent(message: string) {
  return classifyChatIntent(message) === "estimate_file_review";
}

function resolveJurisdictionFromBody(
  body: ChatRequestBody
): { stateCode: string; confidence: "high"; source: "client_input" } | undefined {
  const stateCode = body.jurisdiction?.stateCode?.trim().toUpperCase();

  if (!stateCode) {
    return undefined;
  }

  return {
    stateCode,
    confidence: "high",
    source: "client_input",
  };
}

function formatRecentConversation(messages: IncomingMessage[] = []): string {
  return messages
    .filter((message) => message?.role === "user" || message?.role === "assistant")
    .slice(-8)
    .map((message) => {
      const content = extractTextContent(message.content).trim();
      if (!content) return "";
      return `${message.role.toUpperCase()}:\n${content}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

async function extractDocuments(params: {
  body: ChatRequestBody;
  ownerUserId: string;
  shopId?: string | null;
  deps: Pick<ChatRouteDeps, "getUploadedAttachments" | "saveUploadedAttachment">;
}): Promise<UploadedDocument[]> {
  const attachmentIds = params.body.attachmentIds ?? [];
  const incomingAttachments = params.body.attachments ?? [];

  if (attachmentIds.length > 0) {
    const uploadedAttachments = await params.deps.getUploadedAttachments(attachmentIds, {
      ownerUserId: params.ownerUserId,
      shopId: params.shopId,
    });

    if (uploadedAttachments.length !== attachmentIds.length) {
      throw new AttachmentAccessError();
    }

    return uploadedAttachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mime: attachment.type,
      text: attachment.text,
      imageDataUrl: attachment.imageDataUrl,
      pageCount: attachment.pageCount,
    }));
  }

  if (incomingAttachments.length > 0) {
    const persisted = await Promise.all(
      incomingAttachments.map((attachment) =>
        params.deps.saveUploadedAttachment({
          ownerUserId: params.ownerUserId,
          shopId: params.shopId,
          filename: attachment.filename,
          type: attachment.type,
          text: attachment.text ?? "",
          imageDataUrl: attachment.imageDataUrl,
          pageCount: attachment.pageCount,
        })
      )
    );

    return persisted.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mime: attachment.type,
      text: attachment.text,
      imageDataUrl: attachment.imageDataUrl,
      pageCount: attachment.pageCount,
    }));
  }

  return [];
}

function formatDocuments(documents: UploadedDocument[]): string {
  return documents
    .map((document, index) => {
      const label = `Attachment ${index + 1}: ${document.filename}${
        document.mime ? ` (${document.mime})` : ""
      }`;

      const textBlock = document.text?.trim()
        ? document.text.trim()
        : document.imageDataUrl
          ? "[Image attached separately as vision input]"
          : "[No extracted text available]";

      return `### ${label}\n${textBlock}`;
    })
    .join("\n\n---\n\n");
}

function buildTextContext(params: {
  userMessage: string;
  conversationContext: string;
  documents: UploadedDocument[];
  activeCaseContext?: string;
  omittedAttachmentNotice?: string;
}): string {
  const sections: string[] = [];

  if (params.activeCaseContext) {
    sections.push(params.activeCaseContext);
  }

  if (params.userMessage) {
    sections.push(`User request:\n${params.userMessage}`);
  }

  if (params.conversationContext) {
    sections.push(`Recent conversation:\n${params.conversationContext}`);
  }

  if (params.omittedAttachmentNotice?.trim()) {
    sections.push(params.omittedAttachmentNotice.trim());
  }

  if (params.documents.length > 0) {
    sections.push(`Attached documents:\n${formatDocuments(params.documents)}`);
  }

  if (sections.length === 0) {
    sections.push("No user message or document text was provided.");
  }

  return sections.join("\n\n");
}

function isImageDocument(document: UploadedDocument): boolean {
  return isOpenAiVisionCompatibleImage({
    mime: document.mime,
    imageDataUrl: document.imageDataUrl,
  });
}

function isVideoDocument(document: UploadedDocument): boolean {
  return Boolean(document.mime?.startsWith("video/")) || /\.(?:mp4|mov|webm)$/i.test(document.filename ?? "");
}

function buildOpenAIInput(params: {
  userMessage: string;
  conversationContext: string;
  documents: UploadedDocument[];
  activeCaseContext?: string;
  omittedAttachmentNotice?: string;
}) {
  const textContext = buildTextContext(params);
  const content: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "auto" }
  > = [{ type: "input_text", text: textContext }];

  params.documents.forEach((document, index) => {
    if (!isImageDocument(document) || !document.imageDataUrl) {
      return;
    }

    content.push({
      type: "input_text",
      text: `Image attachment ${index + 1}: ${document.filename}${
        document.mime ? ` (${document.mime})` : ""
      }`,
    });
    content.push({
      type: "input_image",
      image_url: document.imageDataUrl,
      detail: "auto",
    });
  });

  return [
    {
      role: "user" as const,
      content,
    },
  ];
}

function buildActiveCaseChatContext(params: {
  activeCase: StoredCaseData;
  documents: UploadedDocument[];
  conversationContext: string;
}): string {
  const factualCore = params.activeCase.factualCore;
  const delta = params.activeCase.reassessmentDelta;
  const hasStoredEvidence =
    params.activeCase.files.length > 0 ||
    params.activeCase.estimateText.trim().length > 0 ||
    params.activeCase.evidenceRegistry.length > 0 ||
    Boolean(factualCore);
  const newUploadSummary = buildNewUploadSummary(params.documents);
  const issueContext = factualCore?.issueAssessments.length
    ? factualCore.issueAssessments
        .slice(0, 10)
        .map(
          (issue) =>
            `- ${issue.key}: ${issue.title} | ${issue.status} | ${issue.severity} | ${issue.summary}`
        )
        .join("\n")
    : "- No stored issue assessment table.";
  const registryContext = factualCore?.evidenceRegistrySummary.length
    ? factualCore.evidenceRegistrySummary.slice(0, 12).map((item) => `- ${item}`).join("\n")
    : "- No stored evidence registry summary.";
  const reportEvidenceRegistryContext = params.activeCase.evidenceRegistry.length
    ? params.activeCase.evidenceRegistry
        .slice(0, 12)
        .map((item) =>
          [
            `- ${item.id}: ${item.label}`,
            `  Type: ${item.sourceType}`,
            `  Status: ${item.evidenceStatus}`,
            `  Ingestion: ${item.ingestionState}`,
            item.extractedSummary ? `  Summary: ${item.extractedSummary}` : "",
          ]
            .filter(Boolean)
            .join("\n")
        )
        .join("\n")
    : "- No report evidence registry entries.";
  const storedAttachmentsContext = params.activeCase.files.length
    ? params.activeCase.files
        .slice(0, 5)
        .map((file, index) =>
          [
            `ATTACHMENT ${index + 1}: ${file.name} (${file.type || "unknown"})`,
            limitText(redactExternalDocumentUrls(file.text || file.summary || ""), 1800),
          ]
            .filter(Boolean)
            .join("\n")
        )
        .join("\n\n")
    : "No stored attachments.";
  const supportGapsContext = params.activeCase.supportGaps.length
    ? params.activeCase.supportGaps.slice(0, 12).map((gap) => `- ${gap}`).join("\n")
    : "- None";
  const linkedEvidenceContext = params.activeCase.linkedEvidence.length
    ? params.activeCase.linkedEvidence
        .slice(0, 8)
        .map((doc) => `- ${doc.title || "Linked supporting document"} | ${doc.status} | ${doc.sourceType}`)
        .join("\n")
    : "- None";
  const deltaContext = delta
    ? [
        `Summary: ${delta.summary}`,
        `Added evidence: ${delta.addedEvidenceIds.join(", ") || "None"}`,
        `Affected issues: ${delta.affectedIssueKeys.join(", ") || "None"}`,
        `Newly documented: ${delta.newlyDocumented.join(", ") || "None"}`,
        `Still open: ${delta.stillOpen.slice(0, 8).join(", ") || "None"}`,
        `Determination changed: ${delta.determinationChanged ? "yes" : "no"}`,
      ].join("\n")
    : "No prior reassessment delta stored.";

  return `
ACTIVE CASE CONTINUATION
This upload belongs to the existing active case ${params.activeCase.id}. It is not a new review.
Stored case evidence exists: ${hasStoredEvidence ? "yes" : "no"}.

Stable factual core:
- Vehicle: ${factualCore?.vehicleSummary ?? "Vehicle not fully established"}
- Current case summary: ${factualCore?.currentCaseSummary ?? params.activeCase.transcriptSummary ?? "No stored case summary"}
- Current determination: ${factualCore?.currentDetermination ?? params.activeCase.determination ?? "Provisional / not established"}

Structured vehicle identity:
${JSON.stringify(params.activeCase.vehicle, null, 2)}

Extracted facts:
${JSON.stringify(params.activeCase.extractedFacts, null, 2)}

Stored issue assessments:
${issueContext}

Stored evidence registry:
${registryContext}

Report evidence registry:
${reportEvidenceRegistryContext}

Support gaps:
${supportGapsContext}

Linked evidence:
${linkedEvidenceContext}

Latest stored reassessment delta:
${deltaContext}

Stored estimate excerpt:
${limitText(redactExternalDocumentUrls(params.activeCase.estimateText), 3500) || "No stored estimate text."}

Stored report attachments:
${storedAttachmentsContext}

New evidence uploaded in this turn:
${newUploadSummary}

Recent relevant turns:
${params.conversationContext || "No recent turns provided."}

Continuation rules:
- Answer from the merged active case state, not only the newest upload.
- Treat stored active-case evidence as the current source of truth for this conversation.
- If uploaded files, stored attachments, estimate text, factual core, extracted facts, or evidence registry entries exist, do not ask the user to upload the estimate or provide the VIN again.
- If vehicle identity is present in Structured vehicle identity, Extracted facts, Stable factual core, Stored estimate excerpt, or Stored report attachments, answer from that identity directly.
- Only say the vehicle is not established if it is genuinely absent from all stored active-case evidence above.
- Never reveal raw external document URLs, and never tell the user to open or visit a linked external document.
- If linked supporting documents are present, summarize what they support without linking.
- Treat the new upload as additional evidence to be merged into this case.
- Lead with what the new material appears to add or clarify, then state what remains stable/open.
- Do not emit a fresh "start analysis" or first-review style response.
- Do not imply open items were not performed just because support is incomplete.
`.trim();
}

function buildNewUploadSummary(documents: UploadedDocument[]): string {
  return documents.length
    ? documents
        .map((document) => {
          const kind = document.mime?.startsWith("image/") ? "image" : "document";
          const textLength = document.text?.trim().length ?? 0;
          return `- ${document.filename} (${kind}, extracted text ${textLength} chars)`;
        })
        .join("\n")
    : "- None in this turn";
}

function isLegalAdjacentNegotiationRequest(userMessage: string): boolean {
  const lower = userMessage.toLowerCase();

  return [
    "negotiate",
    "negotiation",
    "rebuttal",
    "carrier",
    "appraisal",
    "appraiser",
    "settlement",
    "diminished value",
    "total loss",
    "aftermarket",
    "oem part",
    "consumer rights",
    "pennsylvania",
    "pa law",
    "statute",
  ].some((term) => lower.includes(term));
}

function logOpenAIPhaseFailure(
  phase: "first-pass" | "second-pass",
  attempt: 1 | 2,
  error: unknown
) {
  const providerError = classifyRetryableProviderError(error, {
    provider: "openai",
    stage: `chat_${phase}`,
  });
  console.warn("[chat-openai] upstream failure", {
    phase,
    attempt,
    retryable: providerError.retryable,
    status: providerError.status,
    statusCode: providerError.statusCode,
    code: providerError.code,
    message: providerError.message,
  });
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function createOpenAIResponseWithRetry(
  _deps: unknown,
  phase: "first-pass" | "second-pass",
  input: ChatGenerationRequest,
  options: {
    retryInput?: ChatGenerationRequest;
    retryReason?: string;
  } = {}
) {
  const generationInput = input;
  try {
    return await generatePrimaryText({
      stage: `chat_${phase}`,
      instructions: generationInput.instructions,
      input: generationInput.input,
      temperature: generationInput.temperature,
    });
  } catch (error) {
    logOpenAIPhaseFailure(phase, 1, error);
    const providerError = classifyRetryableProviderError(error, {
      provider: "openai",
      stage: `chat_${phase}`,
    });
    const serverError =
      (providerError.status !== null && providerError.status >= 500) ||
      (providerError.statusCode !== null && providerError.statusCode >= 500) ||
      /server_error/i.test(providerError.code ?? "");
    if (!providerError.retryable && !(serverError && options.retryInput)) {
      throw error;
    }
  }

  await delay(OPENAI_RETRY_DELAY_MS);

  const retryGenerationInput = options.retryInput ?? input;
  if (options.retryInput) {
    console.warn("[chat-claude] retrying with reduced context", {
      phase,
      reason: options.retryReason ?? "reduced_context",
    });
  }

  try {
    return await generatePrimaryText({
      stage: `chat_${phase}`,
      instructions: retryGenerationInput.instructions,
      input: retryGenerationInput.input,
      temperature: retryGenerationInput.temperature,
    });
  } catch (error) {
    logOpenAIPhaseFailure(phase, 2, error);
    if (options.retryInput) {
      throw Object.assign(
        new Error("Large chat attachment review could not be completed after reducing image context. Please retry with fewer photos or ask for a targeted photo review."),
        {
          provider: "openai",
          stage: `chat_${phase}`,
          status: 503,
          statusCode: 503,
          code: "temporarily_unavailable_large_chat_context_retry_failed",
        }
      );
    }
    throw error;
  }
}

function getOpenAIOutputText(response: unknown): string | undefined {
  if (!response || typeof response !== "object") {
    return undefined;
  }

  const candidate = response as { output_text?: unknown };
  return typeof candidate.output_text === "string" ? candidate.output_text : undefined;
}

function enforceModeResponseShape(text: string, mode: OutputMode): string {
  if (mode !== "UMPIRING" || /appraisal recommendation/i.test(text)) {
    return text;
  }

  return [
    "**Appraisal Recommendation**",
    "Based on the reviewed file, use the appraisal record to make a directional amount-of-loss recommendation based on safe, complete, OEM-consistent repair scope rather than lowest cost or automatic shop preference.",
    "",
    "**Award Posture**",
    "Use one of these postures: award shop estimate, award carrier estimate, award reconciled supported amount, defer final award because full-file review is incomplete, or defer final award because amount-of-loss maturity is incomplete.",
    "",
    buildAppraisalAwardEvaluatorInstruction(),
    "",
    text,
  ].join("\n");
}

function countVerifiedLegalCitations(
  retrieval: DriveRetrievalResponse | null | undefined,
  jurisdiction: { stateCode?: string } | undefined
): number {
  if (!retrieval?.results.length) return 0;

  const stateCode = jurisdiction?.stateCode?.trim().toUpperCase();
  return retrieval.results.filter((result) => {
    const isLegalResult =
      result.sourceBucket === "pa_law" ||
      result.documentClass === "state_law_pa" ||
      result.metadata.sourceLane === "pa_law_lane";
    const jurisdictionText = `${result.metadata.jurisdictionRelevance ?? ""} ${result.filename}`;
    const jurisdictionMatches =
      !stateCode ||
      (stateCode === "PA" && /\b(PA|Pennsylvania)\b/i.test(jurisdictionText));

    return isLegalResult && jurisdictionMatches && result.confidence !== "low";
  }).length;
}

function containsNamedLegalCitation(value: string): boolean {
  return (
    /\u00a7|\u00c2\u00a7|P\.?\s*S\.?|Pa\.?\s*C\.?\s*S\.?|Fla\.?\s*Stat\.?|Insurance\s+Code|C\.R\.S\.|G\.L\.?\s+c\.|La\.?\s*R\.?\s*S\.?|RCW|WAC|Chapters?\s+\d{2,}/i.test(
      value
    ) ||
    /\b(?:statute|statutory|code section|administrative code|regulation citation)\b/i.test(value)
  );
}

function applyLegalCitationGate(params: {
  text: string;
  verifiedLegalCitationCount: number;
  jurisdiction?: { stateCode?: string };
  applies: boolean;
}): string {
  if (!params.applies || params.verifiedLegalCitationCount > 0) {
    return params.text;
  }

  const stateCode = params.jurisdiction?.stateCode?.trim().toUpperCase();
  const fallback =
    stateCode === "PA" || !stateCode
      ? PENNSYLVANIA_COUNSEL_REVIEW_FALLBACK
      : "Counsel should review applicable claim-handling and bad-faith law in the confirmed jurisdiction.";
  const lines = params.text.split("\n");
  let insertedFallback = false;
  const scrubbedLines = lines.map((line) => {
    if (!containsNamedLegalCitation(line)) {
      return line;
    }

    if (insertedFallback) {
      return "";
    }

    insertedFallback = true;
    return fallback;
  });

  if (!insertedFallback) {
    scrubbedLines.push("", fallback);
  }

  return scrubbedLines
    .join("\n")
    .replace(new RegExp(`(?:${escapeRegExp(fallback)}\\s*){2,}`, "g"), fallback)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- Anonymous (signed-out) text chat support (Phase 1) -------------------------------------
// Signed-out users share a single guest identity for entitlements (free tier). They cannot
// upload — uploads stay auth-gated — and the client carries the transcript, so no per-user
// server state is needed. A best-effort in-memory IP rate limit caps cost/abuse on this now-
// public endpoint (per serverless instance; not a global limiter).
const ANON_GUEST_CLERK_ID = "anonymous-guest";
// getOrCreateUser requires a non-null email; use a stable, non-deliverable synthetic address for
// the shared guest so the row provisions cleanly (User.email is unique, so this is one guest row).
const ANON_GUEST_EMAIL = "anonymous-guest@guest.collision-iq.local";
const ANON_RATE_LIMIT_MAX = 12;
const ANON_RATE_LIMIT_WINDOW_MS = 60_000;
const anonRequestHits = new Map<string, number[]>();

function getRequestIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

function allowAnonymousChatRequest(req: Request): boolean {
  const ip = getRequestIp(req);
  const now = Date.now();
  const recent = (anonRequestHits.get(ip) ?? []).filter((ts) => now - ts < ANON_RATE_LIMIT_WINDOW_MS);
  if (recent.length >= ANON_RATE_LIMIT_MAX) {
    anonRequestHits.set(ip, recent);
    return false;
  }
  recent.push(now);
  anonRequestHits.set(ip, recent);
  return true;
}

async function resolveChatActor(req: Request): Promise<{
  user: Awaited<ReturnType<typeof requireCurrentUser>>["user"];
  verifiedEmails: string[];
  isPlatformAdmin: boolean;
  isAnonymous: boolean;
}> {
  try {
    const resolved = await requireCurrentUser();
    return {
      user: resolved.user,
      verifiedEmails: resolved.verifiedEmails,
      isPlatformAdmin: resolved.isPlatformAdmin,
      isAnonymous: false,
    };
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
    const guest = await getOrCreateUser({
      clerkUserId: ANON_GUEST_CLERK_ID,
      email: ANON_GUEST_EMAIL,
      firstName: "Guest",
      lastName: null,
      imageUrl: null,
    });
    return { user: guest, verifiedEmails: [], isPlatformAdmin: false, isAnonymous: true };
  }
}

export async function POST(req: Request) {
  let agentTrace: AgentRetrievalTrace | null = null;

  try {
    // Chat text generation runs on Anthropic (post-migration); OpenAI is only a legacy fallback.
    // Gate on either provider key being present so a Claude-only production env isn't falsely
    // reported as "not configured" (was previously OPENAI_API_KEY-only → 503 on Anthropic-only).
    if (!process.env.ANTHROPIC_API_KEY?.trim() && !process.env.OPENAI_API_KEY?.trim()) {
      return NextResponse.json(
        { error: "Chat service is not configured." },
        { status: 503 }
      );
    }

    const deps = await loadChatRouteDeps();
    const baseSystemInstructions = buildSystemInstructions(
      deps.ADAS_POLICY,
      deps.EVIDENCE_POLICY
    );
    const {
      buildDriveRefinementContext,
      detectChatTaskType,
      retrieveDriveSupport,
      retrieveWebSupport,
      buildWebRefinementContext,
      inferDriveVehicleContext,
      extractEstimateLinksFromDocuments,
      isFetchableEstimateLink,
      prioritizeEstimateLinks,
      buildLinkedProcedureRefinementContext,
      retrieveEstimateLinkedProcedureDocs,
      cleanDisplayText,
    } = deps;
    const { user, verifiedEmails, isPlatformAdmin, isAnonymous } = await resolveChatActor(req);
    if (isAnonymous && !allowAnonymousChatRequest(req)) {
      return NextResponse.json(
        { error: "You've sent a lot of messages quickly. Please wait a moment, or sign in for full access." },
        { status: 429 }
      );
    }
    const requestStartedAt = Date.now();
    const body = (await req.json()) as ChatRequestBody;
    const explicitJurisdiction = resolveJurisdictionFromBody(body);
    const incomingAttachmentCount = Array.isArray(body.attachmentIds)
      ? body.attachmentIds.length
      : Array.isArray(body.attachments)
        ? body.attachments.length
        : 0;
    const userMessage = extractLatestUserMessage(body.messages || []);
    const chatIntent = classifyChatIntent(userMessage);

    // Anonymous (signed-out) users get text chat only. Uploads, file review, citation density,
    // and report generation stay auth-gated — surface a clear sign-in prompt instead of failing.
    if (
      isAnonymous &&
      (incomingAttachmentCount > 0 ||
        body.uploadState?.pending ||
        chatIntent === "estimate_file_review" ||
        chatIntent === "citation_density_request" ||
        chatIntent === "report_export_request")
    ) {
      return NextResponse.json({
        reply:
          "To upload and review estimates, OEM procedures, or photos — and to generate reports — please sign in. That keeps your files and reports private to your account. You can keep asking general repair questions here without signing in.",
        requiresSignIn: true,
      });
    }

    if (
      body.uploadState?.pending &&
      (chatIntent === "estimate_file_review" ||
        chatIntent === "citation_density_request" ||
        chatIntent === "report_export_request")
    ) {
      return NextResponse.json({
        reply: "I'm receiving and extracting the ZIP now. I'll start review as soon as files are available.",
        uploadPending: true,
        phase: body.uploadState.phase ?? null,
      });
    }

    if (
      incomingAttachmentCount === 0 &&
      !body.activeCaseId &&
      chatIntent === "estimate_file_review"
    ) {
      return NextResponse.json({
        reply:
          "I'm ready to review this, but I do not have extracted estimate files available yet. I'll start as soon as the upload finishes.",
        needsFiles: true,
      });
    }

    const normalizedEmail = normalizeEmail(user.email);
    let effectiveIsAdmin = isPlatformAdmin;
    const subscriptionTier = await getCurrentSubscriptionTierForUser(user.id);
    const trialActive = resolveProductTrialActive({
      activeSubscriptionId: subscriptionTier ? "active-subscription" : null,
      activeSubscriptionStatus:
        subscriptionTier === "trial" ? "TRIALING" : subscriptionTier ? "ACTIVE" : null,
      createdAt: user.createdAt,
      plan: subscriptionTier ?? "pro",
    });
    const entitlements = await getCurrentProductEntitlements({
      userEmail: normalizedEmail,
      userEmails: verifiedEmails,
      trialActive,
      subscriptionTier,
      isPlatformAdmin: effectiveIsAdmin,
    });
    effectiveIsAdmin = entitlements.isPlatformAdmin;
    const uploadLimits = resolveUploadPlanLimits(entitlements);

    if (incomingAttachmentCount > uploadLimits.maxFilesPerReview) {
      console.info("[chat-attachments] rejected oversized batch", {
        fileCount: incomingAttachmentCount,
        maxFileCount: uploadLimits.maxFilesPerReview,
        plan: uploadLimits.plan,
        ownerUserId: user.id,
      });
      return NextResponse.json(
        { error: getUploadBatchLimitMessage(uploadLimits) },
        { status: 400 }
      );
    }

    const documents = await extractDocuments({
      body,
      ownerUserId: user.id,
      deps,
    });

    console.info("[chat-attachments] accepted batch", {
      fileCount: documents.length,
      totalPdfPages: documents.reduce((sum, document) => sum + (document.pageCount ?? 0), 0),
      ownerUserId: user.id,
      isPlatformAdmin,
      attachments: documents.map((document) => ({
        id: document.id ?? null,
        filename: document.filename,
        mimeType: document.mime || "unknown",
        textLength: document.text?.length ?? 0,
        hasImageDataUrl: Boolean(document.imageDataUrl),
        pageCount: document.pageCount ?? null,
      })),
      timeToAnalysisStartMs: Date.now() - requestStartedAt,
    });

    if (shouldGenerateAnnotatedCitationDensityEstimate(userMessage)) {
      return new Response(
        "Delta Citation Density Report PDFs must be generated through the annotated-estimate export. Select the original carrier or shop estimate PDF and run the Delta Citation Density Report export so original estimate pages are copied and visibly marked up.",
        {
          status: 409,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
          },
        }
      );
    }
    const conversationContext = formatRecentConversation(body.messages || []);
    const outputMode = buildModeContext(`${userMessage}\n\n${conversationContext}`);
    const responseMode = determineResponseMode({
      userMessage,
      hasUploadedFiles: documents.length > 0,
      isFollowup: isFollowupTurn(body.messages || []),
    });
    const responseShapeInstruction = buildReviewResponseShapeInstruction(userMessage);
    const activeCase = body.activeCaseId
      ? await getCaseById(body.activeCaseId, {
          ownerUserId: user.id,
        })
      : null;
    const openActiveCase = activeCase && !activeCase.isClosed ? activeCase : null;
    agentTrace = createAgentRetrievalTrace({
      flow: "chat",
      caseId: openActiveCase?.id ?? body.activeCaseId ?? null,
      userId: user.id,
    });
    const activeCaseAttachmentCount = openActiveCase?.files.length ?? 0;
    const activeCaseHasEstimateText = Boolean(
      openActiveCase &&
        (openActiveCase.estimateText.trim().length > 0 ||
          openActiveCase.files.some((file) => file.text?.trim()))
    );
    const activeCaseHasFactualCore = Boolean(openActiveCase?.factualCore);
    const activeCaseHasStoredEvidence = Boolean(
      openActiveCase &&
        (activeCaseAttachmentCount > 0 ||
          activeCaseHasEstimateText ||
          activeCaseHasFactualCore ||
          openActiveCase.evidenceRegistry.length > 0 ||
          Object.keys(openActiveCase.extractedFacts ?? {}).length > 0)
    );
    const activeCaseHasVehicleContext = Boolean(
      openActiveCase &&
        (openActiveCase.vehicle.vin ||
          openActiveCase.vehicle.year ||
          openActiveCase.vehicle.make ||
          openActiveCase.vehicle.model ||
          openActiveCase.extractedFacts.vehicleLabel ||
          openActiveCase.factualCore?.vehicleSummary)
    );

    if (body.activeCaseId && openActiveCase) {
      console.info("[chat] hydrated active case", {
        activeCaseId: body.activeCaseId,
        hasActiveCase: true,
        latestReportId: openActiveCase.id,
        attachmentCount: activeCaseAttachmentCount,
        hasVehicleContext: activeCaseHasVehicleContext,
        hasEstimateText: activeCaseHasEstimateText,
        hasFactualCore: activeCaseHasFactualCore,
      });
    } else if (body.activeCaseId) {
      console.info("[chat] no active case found", {
        activeCaseId: body.activeCaseId,
        hasActiveCase: false,
        latestReportId: null,
        attachmentCount: 0,
        hasVehicleContext: false,
        hasEstimateText: false,
        hasFactualCore: false,
        activeCaseClosed: activeCase?.isClosed ?? null,
      });
    }

    const largeCaseFallback = resolveLargeCaseChatFallback(openActiveCase, documents);
    const activeCaseContext =
      openActiveCase
        ? largeCaseFallback.useFallback
          ? buildLargeCaseChatContext({
              activeCase: openActiveCase,
              conversationContext,
              newUploadSummary: buildNewUploadSummary(documents),
            })
          : buildActiveCaseChatContext({
              activeCase: openActiveCase,
              documents,
              conversationContext,
            })
        : undefined;

    if (activeCaseContext) {
      console.info("[chat] evidence context attached", {
        activeCaseId: openActiveCase?.id ?? null,
        latestReportId: openActiveCase?.id ?? null,
        attachmentCount: activeCaseAttachmentCount + documents.length,
        storedAttachmentCount: activeCaseAttachmentCount,
        turnAttachmentCount: documents.length,
        hasVehicleContext: activeCaseHasVehicleContext,
        hasEstimateText: activeCaseHasEstimateText,
        hasFactualCore: activeCaseHasFactualCore,
        contextMode: largeCaseFallback.useFallback ? "large_case_summary_fallback" : "standard",
        estimatedContextChars: largeCaseFallback.estimatedContextChars,
        fallbackReasons: largeCaseFallback.reasons,
      });
    }
    if (agentTrace && activeCaseContext && largeCaseFallback.useFallback) {
      logAgentTraceEvent("internal summaries selected", agentTrace, {
        artifactCount: countLargeCaseSummaryArtifacts(activeCaseContext),
        fileCount: largeCaseFallback.fileCount,
        estimatedContextChars: largeCaseFallback.estimatedContextChars,
        reasons: largeCaseFallback.reasons,
      });
    }

    if (openActiveCase && documents.length === 0 && activeCaseHasStoredEvidence) {
      console.info("[chat] fallback prevented because stored evidence exists", {
        activeCaseId: openActiveCase.id,
        hasActiveCase: true,
        attachmentCount: activeCaseAttachmentCount,
        hasVehicleContext: activeCaseHasVehicleContext,
        hasEstimateText: activeCaseHasEstimateText,
        hasFactualCore: activeCaseHasFactualCore,
      });
    }

    const systemInstructions = [
      baseSystemInstructions,
      buildProductAccessGuard(body.productAccess),
      buildAssistanceProfileInstruction(body.assistanceProfile),
      outputMode.instruction,
      buildResponseModeInstruction(responseMode),
      responseShapeInstruction,
      buildActiveCaseSystemGuard({
        hasStoredEvidence: activeCaseHasStoredEvidence,
        hasVehicleContext: activeCaseHasVehicleContext,
        hasEstimateText: activeCaseHasEstimateText,
        hasFactualCore: activeCaseHasFactualCore,
      }),
    ]
      .filter(Boolean)
      .join("\n\n");

    const modelEligibleDocuments = documents.filter((document) => !isVideoDocument(document));
    const attachmentBudget = budgetChatAttachments({
      documents,
      userMessage,
      isImageDocument,
      isVideoDocument,
    });
    const providerDocuments = attachmentBudget.included;
    const input = buildOpenAIInput({
      userMessage,
      conversationContext,
      documents: providerDocuments,
      activeCaseContext,
      omittedAttachmentNotice: buildChatAttachmentOmissionNotice(attachmentBudget.omitted),
    });
    const reducedRetryInput = attachmentBudget.largeMultimodalRequest
      ? buildOpenAIInput({
          userMessage,
          conversationContext,
          documents: attachmentBudget.retryIncluded,
          activeCaseContext,
          omittedAttachmentNotice: buildChatAttachmentOmissionNotice(attachmentBudget.omitted),
        })
      : undefined;
    const turnEstimateText = providerDocuments
      .map((document) => document.text?.trim())
      .filter(Boolean)
      .join("\n\n");
    const activeCaseEstimateText = largeCaseFallback.useFallback
      ? activeCaseContext ?? ""
      : [
          openActiveCase?.estimateText ?? "",
          ...(openActiveCase?.files ?? []).map((file) => file.text),
        ]
          .map((text) => text?.trim())
          .filter(Boolean)
          .join("\n\n");
    const estimateText = turnEstimateText || activeCaseEstimateText;
    const resolvedVehicle = inferDriveVehicleContext({
      estimateText,
      userQuery: userMessage,
    });
    if (openActiveCase) {
      resolvedVehicle.year ??= openActiveCase.vehicle.year ?? undefined;
      resolvedVehicle.make ??= openActiveCase.vehicle.make ?? undefined;
      resolvedVehicle.model ??= openActiveCase.vehicle.model ?? undefined;
      resolvedVehicle.trim ??= openActiveCase.vehicle.trim ?? undefined;
      resolvedVehicle.vin ??= openActiveCase.vehicle.vin ?? undefined;
    }
    const resolvedVehicleLabel = [
      resolvedVehicle.year ? String(resolvedVehicle.year) : "",
      resolvedVehicle.make ?? "",
      resolvedVehicle.model ?? "",
      resolvedVehicle.trim ?? "",
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
    console.info("[chat-linked-docs] resolved estimate vehicle", {
      year: resolvedVehicle.year ?? null,
      make: resolvedVehicle.make ?? null,
      model: resolvedVehicle.model ?? null,
      manufacturer: resolvedVehicle.manufacturer ?? null,
      trim: resolvedVehicle.trim ?? null,
      vin: resolvedVehicle.vin ?? null,
      confidence: resolvedVehicle.confidence,
    });
    const activeCaseDocuments: UploadedDocument[] = (openActiveCase?.files ?? []).map((file) => ({
      id: file.id,
      filename: file.name,
      mime: file.type,
      text: file.text,
    }));
    const activeCaseModelEligibleDocuments = activeCaseDocuments.filter(
      (document) => !isVideoDocument(document)
    );
    const documentsForEvidence =
      modelEligibleDocuments.length > 0 ? modelEligibleDocuments : activeCaseModelEligibleDocuments;
    const estimateLinks = extractEstimateLinksFromDocuments(documentsForEvidence);
    // Fetch high-value links (OEM procedure, Egnyte DMS, ADAS/REVV reports)
    // first — the retriever caps at maxLinks, so ordering decides what is read.
    const fetchableEstimateLinks = prioritizeEstimateLinks(
      estimateLinks.filter(isFetchableEstimateLink)
    );
    const rejectedEstimateLinks = estimateLinks.filter((link) => !isFetchableEstimateLink(link));
    logAgentTraceEvent("estimate links detected", agentTrace, {
      found: estimateLinks.length,
      fetchable: fetchableEstimateLinks.length,
    });
    console.info("[chat-linked-docs] estimate links scanned", {
      found: estimateLinks.length,
      fetchable: fetchableEstimateLinks.length,
      rejected: rejectedEstimateLinks.map((link) => ({
        url: link.url,
        domain: link.domain,
        classification: link.classification,
        sourceFilename: link.sourceFilename ?? null,
      })),
      links: estimateLinks.map((link) => ({
        url: link.url,
        domain: link.domain,
        classification: link.classification,
        sourceFilename: link.sourceFilename ?? null,
      })),
    });

    console.info("[chat-openai] request attachments", {
      ownerUserId: user.id,
      activeCaseId: activeCase && !activeCase.isClosed ? activeCase.id : null,
      activeCaseClosed: activeCase?.isClosed ?? null,
      attachmentCount: documents.length,
      includedInRequest: providerDocuments.map((document, index) => ({
        index: index + 1,
        attachmentId: document.id ?? null,
        filename: document.filename,
        mimeType: document.mime || "unknown",
        includedAs: isImageDocument(document) ? "input_image+text" : "text",
        hasText: Boolean(document.text?.trim()),
        hasImageDataUrl: Boolean(document.imageDataUrl),
      })),
      attachmentBudget: {
        largeMultimodalRequest: attachmentBudget.largeMultimodalRequest,
        imageCount: attachmentBudget.imageCount,
        includedImageCount: attachmentBudget.includedImageCount,
        retryIncludedCount: attachmentBudget.retryIncluded.length,
        reasons: attachmentBudget.reasons,
        omitted: attachmentBudget.omitted.map((item) => ({
          attachmentId: item.id,
          filename: item.filename,
          mimeType: item.mimeType,
          reason: item.reason,
          textLength: item.textLength,
          hasImageDataUrl: item.hasImageDataUrl,
        })),
      },
      omittedForLargeCaseFallback: largeCaseFallback.useFallback
        ? documents.map((document) => ({
            attachmentId: document.id ?? null,
            filename: document.filename,
            mimeType: document.mime || "unknown",
            textLength: document.text?.length ?? 0,
            hasImageDataUrl: Boolean(document.imageDataUrl),
          }))
        : [],
      omittedDocumentationOnly: documents
        .filter(isVideoDocument)
        .map((document) => ({
          attachmentId: document.id ?? null,
          filename: document.filename,
          mimeType: document.mime || "unknown",
        })),
    });

    const firstPass = await createOpenAIResponseWithRetry(deps, "first-pass", {
      model: deps.collisionIqModels.primary,
      instructions: systemInstructions,
      temperature: 0.7,
      input,
    }, reducedRetryInput ? {
      retryInput: {
        model: deps.collisionIqModels.primary,
        instructions: systemInstructions,
        temperature: 0.7,
        input: reducedRetryInput,
      },
      retryReason: "large_multimodal_attachment_budget",
    } : undefined);

    const firstPassOutputText = getOpenAIOutputText(firstPass);
    const firstPassText =
      typeof firstPassOutputText === "string" && firstPassOutputText.trim()
      ? firstPassOutputText.trim()
        : "I reviewed the material, but I couldn't generate a usable response.";
    const linkedProcedureDocs = await retrieveEstimateLinkedProcedureDocs({
      links: fetchableEstimateLinks,
      vehicle: deps.resolveVehicleApplicabilityContext(resolvedVehicle),
      maxLinks: 4,
      timeoutMs: 5000,
    });
    recordAgentRetrievalStep(agentTrace, {
      order: 1,
      tool: "estimate_link_reader",
      action: "open_estimate_links",
      resultCount: linkedProcedureDocs.keptDocs.length,
      status:
        estimateLinks.length === 0
          ? "skipped"
          : linkedProcedureDocs.fetchedCount > 0 || linkedProcedureDocs.keptDocs.length > 0
            ? "success"
            : "skipped",
      reason:
        estimateLinks.length === 0
          ? "No estimate/upload document links found."
          : fetchableEstimateLinks.length === 0
            ? "Estimate links found but none were fetchable."
            : linkedProcedureDocs.keptDocs.length === 0
              ? "Estimate links attempted; no applicable document text retained."
              : undefined,
    });
    logAgentTraceEvent("estimate links attempted", agentTrace, {
      detectedCount: estimateLinks.length,
      attemptedCount: fetchableEstimateLinks.slice(0, 4).length,
      fetchedCount: linkedProcedureDocs.fetchedCount,
      keptCount: linkedProcedureDocs.keptDocs.length,
    });
    console.info("[chat-linked-docs] linked procedure retrieval", {
      fetchedSuccessfully: linkedProcedureDocs.fetchedCount,
      keptForRefinement: linkedProcedureDocs.keptDocs.map((doc) => ({
        url: doc.url,
        domain: doc.domain,
        title: doc.title ?? null,
        matchLevel: doc.matchLevel,
        vehicleSignals: doc.vehicleSignals,
      })),
      discarded: linkedProcedureDocs.discardedDocs,
    });

    const retrievalAnalysis = buildRetrievalAnalysisSnapshot({
      deps,
      taskType: detectChatTaskType({
        userQuery: userMessage,
        hasDocuments: documents.length > 0 || Boolean(openActiveCase),
      }),
      userMessage,
      estimateText,
      firstPassAnswer: firstPassText,
    });

    logAgentTraceEvent("google drive search started", agentTrace, {
      retrievalMode: retrievalAnalysis.taskType,
    });
    const retrieval = await retrieveDriveSupport({
      taskType: retrievalAnalysis.taskType,
      userQuery: userMessage,
      estimateText,
      firstPassAnswer: firstPassText,
      jurisdiction: explicitJurisdiction,
      analysis: retrievalAnalysis,
      maxResults: 5,
      maxExcerptChars: 500,
    }).catch((error) => {
      console.error("Drive retrieval refinement skipped:", error);
      recordAgentRetrievalStep(agentTrace!, {
        order: 2,
        tool: "google_drive_search",
        action: "search_internal_sources",
        resultCount: 0,
        status: "error",
        reason: "Internal retrieval failed.",
      });
      return null;
    });
    if (!agentTrace.steps.some((step) => step.order === 2)) {
      recordAgentRetrievalStep(agentTrace, {
        order: 2,
        tool: "google_drive_search",
        action: "search_internal_sources",
        resultCount: retrieval?.results.length ?? 0,
        status: retrieval ? "success" : "skipped",
        reason: retrieval
          ? undefined
          : "Google Drive/internal retrieval unavailable or no retrieval request generated.",
      });
    }
    logAgentTraceEvent("google drive search completed", agentTrace, {
      resultCount: retrieval?.results.length ?? 0,
      status: agentTrace.steps.find((step) => step.order === 2)?.status ?? "skipped",
    });
    const applicableRetrieval = retrieval
      ? filterDriveRetrievalByVehicleApplicability(deps, retrieval)
      : null;

    let webRetrieval: Awaited<ReturnType<typeof retrieveWebSupport>> | null = null;
    if (areInternalRetrievalPathsResolved(agentTrace)) {
      const driveCoverageInsufficient = (applicableRetrieval?.results.length ?? 0) === 0;
      if (retrieval?.request && driveCoverageInsufficient) {
        logAgentTraceEvent("web search allowed", agentTrace, {
          reason: "Internal sources attempted first; Drive coverage was insufficient.",
        });
        webRetrieval = await retrieveWebSupport(retrieval.request, { maxResults: 5, maxQueries: 3 }).catch(
          (error) => {
            console.error("Web retrieval refinement skipped:", error);
            return { status: "error" as const, queries: [], results: [] };
          }
        );
        recordAgentRetrievalStep(agentTrace, {
          order: 3,
          tool: "web_search",
          action: "internet_search",
          resultCount: webRetrieval.results.length,
          status: webRetrieval.status === "success" ? "success" : webRetrieval.status === "error" ? "error" : "skipped",
          reason:
            webRetrieval.status === "not_configured"
              ? "Web search provider is not configured."
              : webRetrieval.status === "no_results"
                ? "Web search ran but returned no usable results."
                : undefined,
        });
      } else {
        recordAgentRetrievalStep(agentTrace, {
          order: 3,
          tool: "web_search",
          action: "internet_search",
          resultCount: 0,
          status: "skipped",
          reason: "Internal Drive sources already provided sufficient coverage.",
        });
      }
    }

    const linkedProcedureContext =
      linkedProcedureDocs.keptDocs.length > 0
        ? buildLinkedProcedureRefinementContext(linkedProcedureDocs.keptDocs, resolvedVehicleLabel)
        : "";
    const driveContext =
      applicableRetrieval && applicableRetrieval.results.length > 0
        ? buildDriveRefinementContext(applicableRetrieval)
        : "";
    const webContext = webRetrieval ? buildWebRefinementContext(webRetrieval) : "";
    const retrievalContext = [driveContext, webContext].filter(Boolean).join("\n\n");
    const refinementMode =
      linkedProcedureContext && retrievalContext
        ? "linked_docs_and_drive"
        : linkedProcedureContext
          ? "linked_docs_only"
          : retrievalContext
            ? "drive_only"
            : "estimate_only";
    console.info("[chat-linked-docs] refinement source selection", {
      mode: refinementMode,
      usedDriveFallback: Boolean(retrievalContext),
      usedLinkedDocs: Boolean(linkedProcedureContext),
    });

    const outputText = linkedProcedureContext || retrievalContext
      ? await refineAnswerWithDriveSupport({
          deps,
          systemInstructions,
          userMessage,
          conversationContext,
          firstPassAnswer: firstPassText,
          linkedProcedureContext,
          retrievalContext,
        })
      : firstPassText;
    const needsLegalDisclaimer = isLegalAdjacentNegotiationRequest(userMessage);
    const verifiedLegalCitationCount = countVerifiedLegalCitations(
      applicableRetrieval,
      explicitJurisdiction ?? retrieval?.request.jurisdiction
    );
    const modeShapedOutput = applyLegalCitationGate({
      text: enforceModeResponseShape(outputText, outputMode.mode),
      verifiedLegalCitationCount,
      jurisdiction: explicitJurisdiction ?? retrieval?.request.jurisdiction,
      applies: needsLegalDisclaimer,
    });

    console.info("[chat-attachments] analysis complete", {
      ownerUserId: user.id,
      fileCount: documents.length,
      totalPdfPages: documents.reduce((sum, document) => sum + (document.pageCount ?? 0), 0),
      durationMs: Date.now() - requestStartedAt,
    });

    const finalTextBase = sanitizeUserFacingEvidenceText(redactExternalDocumentUrls(
      needsLegalDisclaimer
        ? `${LEGAL_INFO_DISCLAIMER}\n\n${modeShapedOutput}`
        : modeShapedOutput
      ));
    const finalText = shouldExposeSafeProviderDiagnostics(userMessage)
      ? appendSafeProviderDiagnostics(finalTextBase, {
          stage: "chat_first-pass",
          provider: firstPass.provider,
          model: firstPass.model,
        })
      : finalTextBase;

    logAgentTraceCompleted(agentTrace);

    return new Response(cleanDisplayText(finalText), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch (error) {
    if (agentTrace) {
      logAgentTraceCompleted(agentTrace);
    }

    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error && error.message === "Missing authenticated user identity") {
      console.warn("[chat] auth identity guard — returning 401");
      return NextResponse.json(
        { ok: false, error: "AUTH_REQUIRED", message: "Please sign in or accept consent before using chat." },
        { status: 401 }
      );
    }

    if (error instanceof AttachmentAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const providerError = classifyRetryableProviderError(error, {
      provider: collisionIqProvider.primary,
      stage: "chat",
    });

    if (providerError.retryable) {
      const retryableStatus =
        providerError.status === 429 || providerError.statusCode === 429 ? 429 : 503;
      console.warn("CHAT RETRYABLE PROVIDER ERROR:", {
        provider: providerError.provider,
        stage: providerError.stage,
        retryable: true,
        status: providerError.status,
        statusCode: providerError.statusCode,
        code: providerError.code,
        message: providerError.message,
      });

      return NextResponse.json(
        {
          ok: false,
          retryable: true,
          stage: providerError.stage,
          provider: providerError.provider,
          status: providerError.status,
          statusCode: providerError.statusCode,
          message: RETRYABLE_PROVIDER_USER_MESSAGE,
        },
        { status: retryableStatus }
      );
    }

    console.error("[chat-attachments] analysis failure", {
      error: error instanceof Error ? error.message : String(error),
    });
    console.error("Chat route error:", error);

    return NextResponse.json({ error: "Chat failed" }, { status: 500 });
  }
}

function buildRetrievalAnalysisSnapshot(params: {
  deps: Pick<ChatRouteDeps, "inferDriveRetrievalTopics" | "inferDriveVehicleContext">;
  taskType: ChatAnalysisOutput["taskType"];
  userMessage: string;
  estimateText: string;
  firstPassAnswer: string;
}): Pick<
  ChatAnalysisOutput,
  "taskType" | "summary" | "repairStrategy" | "keyDrivers" | "missingOperations" | "vehicleIdentification"
> {
  const vehicle = params.deps.inferDriveVehicleContext({
    estimateText: params.estimateText,
    userQuery: params.userMessage,
  });
  const inferredTopics = params.deps.inferDriveRetrievalTopics({
    estimateText: params.estimateText,
    userQuery: params.userMessage,
    analysis: {
      summary: {
        headline: "",
        overview: params.firstPassAnswer,
      },
      repairStrategy: {
        overallAssessment: params.firstPassAnswer,
        repairVsReplace: [],
        structuralImplications: [],
        calibrationImplications: [],
      },
      keyDrivers: [],
      missingOperations: [],
    },
  });

  return {
    taskType: params.taskType,
    summary: {
      headline: params.firstPassAnswer.slice(0, 120),
      overview: params.firstPassAnswer,
    },
    repairStrategy: {
      overallAssessment: params.firstPassAnswer,
      repairVsReplace: [],
      structuralImplications: [],
      calibrationImplications: [],
    },
    keyDrivers: inferredTopics.map((topic) => topic.topic.replace(/_/g, " ")).slice(0, 6),
    missingOperations: [],
    vehicleIdentification: {
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      manufacturer: vehicle.manufacturer,
      vin: vehicle.vin,
      source: vehicle.sources.includes("vin_decode_hint")
        ? "vin_decoded"
        : vehicle.sources.includes("estimate_text")
          ? "attachment"
          : vehicle.sources.includes("user_query")
            ? "user"
            : vehicle.sources.includes("analysis_output")
              ? "attachment"
              : "unknown",
      confidence:
        vehicle.confidence === "high"
          ? 0.9
          : vehicle.confidence === "medium"
            ? 0.7
            : 0.45,
    },
  };
}

async function refineAnswerWithDriveSupport(params: {
  deps: Pick<ChatRouteDeps, "collisionIqModels">;
  systemInstructions: string;
  userMessage: string;
  conversationContext: string;
  firstPassAnswer: string;
  linkedProcedureContext: string;
  retrievalContext: string;
}): Promise<string> {
  const refinementInput = [
    params.userMessage ? `User request:\n${params.userMessage}` : "",
    params.conversationContext ? `Recent conversation:\n${params.conversationContext}` : "",
    `Initial estimate judgment:\n${params.firstPassAnswer}`,
    params.linkedProcedureContext
      ? `Estimate-linked OEM/ADAS references:\n${params.linkedProcedureContext}`
      : "",
    params.retrievalContext ? `Retrieved linked external-document support:\n${params.retrievalContext}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const refined = await createOpenAIResponseWithRetry(params.deps, "second-pass", {
    model: params.deps.collisionIqModels.primary,
    instructions: `${params.systemInstructions}\n\n${REFINEMENT_INSTRUCTIONS}`,
    temperature: 0.7,
    input: refinementInput,
  });

  const refinedOutputText = getOpenAIOutputText(refined);
  return typeof refinedOutputText === "string" && refinedOutputText.trim()
    ? refinedOutputText.trim()
    : params.firstPassAnswer;
}

function filterDriveRetrievalByVehicleApplicability(
  deps: Pick<
    ChatRouteDeps,
    | "resolveVehicleApplicabilityContext"
    | "assessRetrievedDocumentApplicability"
    | "isVehicleContentApplicable"
  >,
  response: DriveRetrievalResponse
): DriveRetrievalResponse {
  const vehicleApplicability = deps.resolveVehicleApplicabilityContext(response.request.vehicle);
  const filteredResults = response.results.filter((result) => {
    const applicability = deps.assessRetrievedDocumentApplicability({
      title: result.filename,
      excerpt: result.excerpt.excerpt,
      source: result.metadata.source,
      vehicle: vehicleApplicability,
    });

    if (!applicability.keep) {
      console.info("[chat-drive-filter] discarded vehicle-mismatched Drive result", {
        estimateVehicle: {
          make: response.request.vehicle.make ?? null,
          model: response.request.vehicle.model ?? null,
          manufacturer: response.request.vehicle.manufacturer ?? null,
        },
        document: {
          filename: result.filename,
          source: result.metadata.source ?? null,
          signals: applicability.mentionedTerms,
        },
        reason: applicability.reason,
      });
      return false;
    }

    return deps.isVehicleContentApplicable(
      [
        result.filename,
        result.matchReason,
        result.excerpt.excerpt,
        result.metadata.make,
        result.metadata.model,
        result.metadata.trim,
        result.metadata.source,
        ...(result.relevanceReasons ?? []).map((reason) => reason.reason),
      ]
        .filter(Boolean)
        .join(" "),
      vehicleApplicability
    );
  });

  return {
    ...response,
    results: filteredResults,
  };
}
