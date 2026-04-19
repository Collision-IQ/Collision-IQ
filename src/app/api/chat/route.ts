export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import type { ChatAnalysisOutput } from "@/lib/ai/contracts/chatAnalysisSchema";
import type { DriveRetrievalResponse } from "@/lib/ai/contracts/driveRetrievalContract";
import { NON_BIAS_ACCURACY_DIRECTIVE } from "@/lib/ai/nonBiasDirective";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";

const MAX_UPLOAD_BATCH_FILES = 6;
const UPLOAD_CAP_MESSAGE = "You can upload up to 6 files at once for now.";
const TRANSIENT_CHAT_ERROR_MESSAGE =
  "The analysis service had a temporary issue. Please retry.";
const OPENAI_RETRY_DELAY_MS = 400;
const LEGAL_INFO_DISCLAIMER =
  "Informational support only — not legal advice. I'm not a lawyer, and any legal position should be reviewed by qualified counsel.";

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
  jurisdiction?: IncomingJurisdiction;
};

type OpenAIErrorMeta = {
  requestId?: string;
  status?: number;
  type?: string;
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
  inferDriveRetrievalTopics: typeof import("@/lib/ai/contracts/driveRetrievalContract").inferDriveRetrievalTopics;
  inferDriveVehicleContext: typeof import("@/lib/ai/contracts/driveRetrievalContract").inferDriveVehicleContext;
  cleanDisplayText: typeof import("@/lib/ai/displayText").cleanDisplayText;
  assessRetrievedDocumentApplicability: typeof import("@/lib/ai/vehicleApplicability").assessRetrievedDocumentApplicability;
  isVehicleContentApplicable: typeof import("@/lib/ai/vehicleApplicability").isVehicleContentApplicable;
  resolveVehicleApplicabilityContext: typeof import("@/lib/ai/vehicleApplicability").resolveVehicleApplicabilityContext;
  extractEstimateLinksFromDocuments: typeof import("@/lib/ai/estimateLinkExtractor").extractEstimateLinksFromDocuments;
  isFetchableEstimateLink: typeof import("@/lib/ai/estimateLinkExtractor").isFetchableEstimateLink;
  buildLinkedProcedureRefinementContext: typeof import("@/lib/ai/linkedProcedureRetriever").buildLinkedProcedureRefinementContext;
  retrieveEstimateLinkedProcedureDocs: typeof import("@/lib/ai/linkedProcedureRetriever").retrieveEstimateLinkedProcedureDocs;
  collisionIqModels: typeof import("@/lib/modelConfig").collisionIqModels;
  openai: typeof import("@/lib/openai").openai;
  ADAS_POLICY: typeof import("@/lib/analysis/adasDecision").ADAS_POLICY;
  EVIDENCE_POLICY: typeof import("@/lib/analysis/buildEvidenceCorpus").EVIDENCE_POLICY;
};

let chatRouteDepsPromise: Promise<ChatRouteDeps> | null = null;

function loadChatRouteDeps(): Promise<ChatRouteDeps> {
  if (!chatRouteDepsPromise) {
    chatRouteDepsPromise = Promise.all([
      import("@/lib/uploadedAttachmentStore"),
      import("@/lib/ai/driveRetrievalService"),
      import("@/lib/ai/contracts/driveRetrievalContract"),
      import("@/lib/ai/displayText"),
      import("@/lib/ai/vehicleApplicability"),
      import("@/lib/ai/estimateLinkExtractor"),
      import("@/lib/ai/linkedProcedureRetriever"),
      import("@/lib/modelConfig"),
      import("@/lib/openai"),
      import("@/lib/analysis/adasDecision"),
      import("@/lib/analysis/buildEvidenceCorpus"),
    ]).then(
      ([
        uploadedAttachmentStore,
        driveRetrievalService,
        driveRetrievalContract,
        displayText,
        vehicleApplicability,
        estimateLinkExtractor,
        linkedProcedureRetriever,
        modelConfig,
        openaiModule,
        adasDecision,
        evidenceCorpus,
      ]) => ({
        getUploadedAttachments: uploadedAttachmentStore.getUploadedAttachments,
        saveUploadedAttachment: uploadedAttachmentStore.saveUploadedAttachment,
        buildDriveRefinementContext: driveRetrievalService.buildDriveRefinementContext,
        detectChatTaskType: driveRetrievalService.detectChatTaskType,
        retrieveDriveSupport: driveRetrievalService.retrieveDriveSupport,
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
        buildLinkedProcedureRefinementContext:
          linkedProcedureRetriever.buildLinkedProcedureRefinementContext,
        retrieveEstimateLinkedProcedureDocs:
          linkedProcedureRetriever.retrieveEstimateLinkedProcedureDocs,
        collisionIqModels: modelConfig.collisionIqModels,
        openai: openaiModule.openai,
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
- never use humor in safety-critical, legal-adjacent, injury-related, diminished value, ACV, or other valuation-sensitive conclusions
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

For ACV or diminished value answers:
- you may provide a rough preview range when the current material supports it
- do not present any ACV or diminished value result as a final appraisal, final ACV, or binding diminished value conclusion
- if you provide a number or range, label it as a preliminary preview
- mention confidence and missing inputs when they materially limit the preview
- if the value is not determinable, explain why and list the key missing inputs when possible
- every ACV or diminished value answer must end with: For a full valuation, continue at https://www.collision.academy/

Write in short paragraphs.
Use bullets only when they genuinely improve comparison, negotiation, or rebuttal clarity.
Avoid rigid templates.

${NON_BIAS_ACCURACY_DIRECTIVE}

${adasPolicy}

${evidencePolicy}
`.trim();
}

const REFINEMENT_INSTRUCTIONS = `
You are refining an existing collision-repair answer after targeted Google Drive retrieval.

Rules:
- keep the original estimator-style conclusion as the base
- use retrieved OEM support only to reinforce or adjust repair/procedure/compliance conclusions
- use retrieved PA law support only for rights, appraisal, aftermarket, valuation, settlement, or claim-handling questions
- if both OEM and PA law support are present, keep them logically separate in the final answer
- do not dump or paraphrase whole documents
- use the retrieved support as compact supporting context, not as replacement reasoning
- estimate-linked OEM or ADAS references for the resolved vehicle are higher priority than broad Drive retrieval
- stay concise, natural, and direct
- if the retrieved support is weak or only partially applicable, say that clearly
- do not let retrieved support for a different make, model, or manufacturer override the submitted vehicle context
- preserve the ACV/DV product rules, including the Collision Academy handoff
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
}): string {
  const sections: string[] = [];

  if (params.userMessage) {
    sections.push(`User request:\n${params.userMessage}`);
  }

  if (params.conversationContext) {
    sections.push(`Recent conversation:\n${params.conversationContext}`);
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
  return Boolean(document.imageDataUrl) && Boolean(document.mime?.startsWith("image/"));
}

function buildOpenAIInput(params: {
  userMessage: string;
  conversationContext: string;
  documents: UploadedDocument[];
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

function extractOpenAIErrorMeta(error: unknown): OpenAIErrorMeta {
  if (!error || typeof error !== "object") {
    return {};
  }

  const candidate = error as {
    request_id?: string;
    requestId?: string;
    status?: number;
    error?: { type?: string };
    type?: string;
  };

  return {
    requestId: candidate.request_id ?? candidate.requestId,
    status: candidate.status,
    type: candidate.error?.type ?? candidate.type,
  };
}

function isTransientOpenAIError(error: unknown): boolean {
  const meta = extractOpenAIErrorMeta(error);
  return meta.type === "server_error" || (typeof meta.status === "number" && meta.status >= 500);
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
  const meta = extractOpenAIErrorMeta(error);
  console.warn("[chat-openai] upstream failure", {
    phase,
    attempt,
    requestId: meta.requestId ?? null,
    status: meta.status ?? null,
    type: meta.type ?? null,
    message: error instanceof Error ? error.message : String(error),
  });
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function createOpenAIResponseWithRetry(
  deps: Pick<ChatRouteDeps, "openai">,
  phase: "first-pass" | "second-pass",
  input: Parameters<ChatRouteDeps["openai"]["responses"]["create"]>[0]
) {
  try {
    return await deps.openai.responses.create(input);
  } catch (error) {
    logOpenAIPhaseFailure(phase, 1, error);
    if (!isTransientOpenAIError(error)) {
      throw error;
    }
  }

  await delay(OPENAI_RETRY_DELAY_MS);

  try {
    return await deps.openai.responses.create(input);
  } catch (error) {
    logOpenAIPhaseFailure(phase, 2, error);
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

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      return NextResponse.json(
        { error: "Chat service is not configured." },
        { status: 503 }
      );
    }

    const deps = await loadChatRouteDeps();
    const systemInstructions = buildSystemInstructions(
      deps.ADAS_POLICY,
      deps.EVIDENCE_POLICY
    );
    const {
      buildDriveRefinementContext,
      detectChatTaskType,
      retrieveDriveSupport,
      inferDriveVehicleContext,
      extractEstimateLinksFromDocuments,
      isFetchableEstimateLink,
      buildLinkedProcedureRefinementContext,
      retrieveEstimateLinkedProcedureDocs,
      cleanDisplayText,
    } = deps;
    const { user, isPlatformAdmin } = await requireCurrentUser();
    const requestStartedAt = Date.now();
    const body = (await req.json()) as ChatRequestBody;
    const explicitJurisdiction = resolveJurisdictionFromBody(body);
    const incomingAttachmentCount = Array.isArray(body.attachmentIds)
      ? body.attachmentIds.length
      : Array.isArray(body.attachments)
        ? body.attachments.length
        : 0;

    if (incomingAttachmentCount > MAX_UPLOAD_BATCH_FILES) {
      console.info("[chat-attachments] rejected oversized batch", {
        fileCount: incomingAttachmentCount,
        ownerUserId: user.id,
      });
      return NextResponse.json({ error: UPLOAD_CAP_MESSAGE }, { status: 400 });
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

    const userMessage = extractLatestUserMessage(body.messages || []);
    const conversationContext = formatRecentConversation(body.messages || []);
    const input = buildOpenAIInput({
      userMessage,
      conversationContext,
      documents,
    });
    const estimateText = documents
      .map((document) => document.text?.trim())
      .filter(Boolean)
      .join("\n\n");
    const resolvedVehicle = inferDriveVehicleContext({
      estimateText,
      userQuery: userMessage,
    });
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
    const estimateLinks = extractEstimateLinksFromDocuments(documents);
    const fetchableEstimateLinks = estimateLinks.filter(isFetchableEstimateLink);
    const rejectedEstimateLinks = estimateLinks.filter((link) => !isFetchableEstimateLink(link));
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
      attachmentCount: documents.length,
      includedInRequest: documents.map((document, index) => ({
        index: index + 1,
        attachmentId: document.id ?? null,
        filename: document.filename,
        mimeType: document.mime || "unknown",
        includedAs: isImageDocument(document) ? "input_image+text" : "text",
        hasText: Boolean(document.text?.trim()),
        hasImageDataUrl: Boolean(document.imageDataUrl),
      })),
    });

    const firstPass = await createOpenAIResponseWithRetry(deps, "first-pass", {
      model: deps.collisionIqModels.primary,
      instructions: systemInstructions,
      temperature: 0.7,
      input,
    });

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
        hasDocuments: documents.length > 0,
      }),
      userMessage,
      estimateText,
      firstPassAnswer: firstPassText,
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
      return null;
    });

    const applicableRetrieval = retrieval
      ? filterDriveRetrievalByVehicleApplicability(deps, retrieval)
      : null;
    const linkedProcedureContext =
      linkedProcedureDocs.keptDocs.length > 0
        ? buildLinkedProcedureRefinementContext(linkedProcedureDocs.keptDocs, resolvedVehicleLabel)
        : "";
    const retrievalContext =
      applicableRetrieval && applicableRetrieval.results.length > 0
        ? buildDriveRefinementContext(applicableRetrieval)
        : "";
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

    console.info("[chat-attachments] analysis complete", {
      ownerUserId: user.id,
      fileCount: documents.length,
      totalPdfPages: documents.reduce((sum, document) => sum + (document.pageCount ?? 0), 0),
      durationMs: Date.now() - requestStartedAt,
    });

    const needsLegalDisclaimer = isLegalAdjacentNegotiationRequest(userMessage);

    const finalText = needsLegalDisclaimer
      ? `${LEGAL_INFO_DISCLAIMER}\n\n${outputText}`
      : outputText;

    return new Response(cleanDisplayText(finalText), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof AttachmentAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (isTransientOpenAIError(error)) {
      return NextResponse.json(
        { error: TRANSIENT_CHAT_ERROR_MESSAGE },
        { status: 503 }
      );
    }

    console.error("[chat-attachments] analysis failure", {
      error: error instanceof Error ? error.message : String(error),
    });
    console.error("Chat route error:", error);

    const message =
      error instanceof Error ? error.message : "Unexpected chat route failure.";

    return NextResponse.json({ error: message }, { status: 500 });
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
  deps: Pick<ChatRouteDeps, "collisionIqModels" | "openai">;
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
    params.retrievalContext ? `Retrieved Drive support:\n${params.retrievalContext}` : "",
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
