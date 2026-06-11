import { NextRequest, NextResponse } from "next/server";
import { buildAdasNarrative } from "@/lib/analysis/adasDecision";
import { EVIDENCE_POLICY } from "@/lib/analysis/buildEvidenceCorpus";
import { generateChatCompletion } from "@/lib/ai/generateChatCompletion";
import { buildAssistanceProfileInstruction } from "@/lib/ai/assistanceProfile";
import { NON_BIAS_ACCURACY_DIRECTIVE } from "@/lib/ai/nonBiasDirective";
import { JURISDICTIONAL_INSURANCE_APPRAISAL_PROMPT } from "@/lib/ai/jurisdictionalInsurancePrompt";
import { DOCUMENT_REVIEW_TWO_PASS_PROTOCOL } from "@/lib/ai/documentReviewProtocol";
import { buildModeContext, type OutputMode } from "@/lib/ai/outputMode";
import { buildResponseModeInstruction, determineResponseMode } from "@/lib/ai/responseMode";
import { buildReviewResponseShapeInstruction } from "@/lib/ai/reviewResponseShape";
import { buildAppraisalAwardEvaluatorInstruction } from "@/lib/ai/appraisalAwardEvaluator";
import {
  classifyRetryableProviderError,
  RETRYABLE_PROVIDER_USER_MESSAGE,
} from "@/lib/ai/providerRetryableError";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import { getCaseById } from "@/lib/cases/getCaseById";
import { cleanResponse } from "@/lib/vehicle/oemGuardrails";
import { redactExternalDocumentUrls } from "@/lib/externalDocuments";
import { sanitizeUserFacingEvidenceText } from "@/lib/ui/presentationText";
import { shouldGenerateAnnotatedCitationDensityEstimate } from "@/lib/reports/citationDensityIntent";

export const runtime = "nodejs";

function limitText(text: string, max = 12000) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}\n...[truncated]` : text;
}

function extractCurrentTopic(
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }>
) {
  const explicit = message.match(/Current active topic\/mode:\s*([^\n.]+)/i)?.[1]?.trim();
  if (explicit) return explicit;

  const latestUserMessage =
    [...history].reverse().find((entry) => entry.role === "user" && entry.content.trim())?.content ??
    message;
  const lower = latestUserMessage.toLowerCase();

  if (/(position statement|oem statement|oem position|position statements|oem support)/i.test(lower)) {
    return "OEM position statements";
  }
  if (/(calibration|calibrate|aiming|initialization|adas|sensor|camera|radar|lidar)/i.test(lower)) {
    return "calibration requirements";
  }
  if (/(structural|measure|measurement|dimension|geometry|frame|unibody|mounting)/i.test(lower)) {
    return "structural verification";
  }
  if (/(corrosion|cavity|seam sealer|rust|anti-corrosion)/i.test(lower)) {
    return "corrosion protection";
  }
  if (/(valuation|value|acv|total loss|market|comparable|comps)/i.test(lower)) {
    return "valuation";
  }
  if (/(umpire|appraisal|appraiser|award|amount of loss|amount-of-loss|which amount|decide between estimates|which estimate)/i.test(lower)) {
    return "appraisal award recommendation";
  }
  if (/(doi|department of insurance|insurance department|regulator|complaint|bad faith|unfair claim)/i.test(lower)) {
    return "DOI preparation";
  }
  if (/(rebuttal|carrier|insurer|email|negotia|pushback|ask for|request revision)/i.test(lower)) {
    return "rebuttal strategy";
  }
  if (/(customer report|customer-facing|layman|owner explanation|plain language)/i.test(lower)) {
    return "customer explanation";
  }
  if (/(complete|completeness|included|missing|scope|repair plan|repair path)/i.test(lower)) {
    return "repair completeness";
  }
  if (/(hidden damage|supplement|teardown|bracket|support|absorber|mount|connector invoice|invoice enough)/i.test(lower)) {
    return "hidden damage concerns";
  }
  if (/(scan|pre-scan|post-scan|diagnostic|dtc|codes)/i.test(lower)) {
    return "scan documentation";
  }

  return "general case summary";
}

function enforceModeResponseShape(text: string, mode: OutputMode): string {
  if (mode !== "UMPIRING" || /appraisal recommendation/i.test(text)) {
    return text;
  }

  return [
    "**Appraisal Recommendation**",
    "Based on the reviewed file, make a directional amount-of-loss recommendation when the reviewed evidence supports one. The recommendation must be based on safe, complete, OEM-consistent repair scope, not lowest cost and not automatic shop preference.",
    "",
    "**Award Posture**",
    "Use one posture: award shop estimate, award carrier estimate, award reconciled supported amount, defer for incomplete full-file review, or defer for incomplete amount-of-loss maturity.",
    "",
    buildAppraisalAwardEvaluatorInstruction(),
    "",
    text,
  ].join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireCurrentUser();
    const body = await req.json();

    const {
      caseId,
      message,
      history = [],
      assistanceProfile,
    }: {
      caseId: string;
      message: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
      assistanceProfile?: string | null;
    } = body;

    if (!caseId || !message) {
      return NextResponse.json(
        { error: "Missing caseId or message" },
        { status: 400 }
      );
    }

    if (shouldGenerateAnnotatedCitationDensityEstimate(message)) {
      return NextResponse.json(
        {
          success: false,
          error: "Annotated Citation Density estimate PDFs must be generated through the annotated-estimate export. Select the original carrier or shop estimate PDF and run the Citation Density annotated estimate export so original estimate pages are copied and visibly marked up.",
        },
        { status: 409 }
      );
    }

    const caseData = await getCaseById(caseId, {
      ownerUserId: user.id,
    });

    if (!caseData) {
      console.info("[chat] no active case found", {
        activeCaseId: caseId,
        hasActiveCase: false,
        latestReportId: null,
        attachmentCount: 0,
        hasVehicleContext: false,
      });
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    const {
      vehicle,
      estimateText = "",
      files = [],
      linkedEvidence = [],
      transcriptSummary,
      supportGaps,
      extractedFacts,
      determinationPayload,
      factualCore,
      reassessmentDelta,
      artifactRefreshPolicy,
    } = caseData;
    const hasVehicleContext = Boolean(
      vehicle?.vin ||
        vehicle?.year ||
        vehicle?.make ||
        vehicle?.model ||
        extractedFacts?.vehicleLabel ||
        factualCore?.vehicleSummary
    );
    const hasEstimateText = Boolean(
      estimateText.trim() || files.some((file) => file.text?.trim())
    );
    const hasFactualCore = Boolean(factualCore);
    const hasStoredEvidence = Boolean(
      files.length > 0 ||
        hasEstimateText ||
        hasFactualCore ||
        linkedEvidence.length > 0 ||
        Object.keys(extractedFacts ?? {}).length > 0
    );

    console.info("[chat] hydrated active case", {
      activeCaseId: caseId,
      hasActiveCase: true,
      latestReportId: caseData.id,
      attachmentCount: files.length,
      hasVehicleContext,
      hasEstimateText,
      hasFactualCore,
    });

    const adasNarrative = buildAdasNarrative({
      vehicle: {
        year: vehicle?.year ?? undefined,
        make: vehicle?.make ?? undefined,
        model: vehicle?.model ?? undefined,
      },
      estimateText,
      extractedFacts,
      files,
    });

    const prioritizedLinkedEvidenceContext = linkedEvidence.length
      ? linkedEvidence
          .slice(0, 3)
          .map(
            (doc, index) =>
              [
                `DOC ${index + 1}: ${doc.title || "Untitled"}`,
                `STATUS: ${doc.status || "unknown"}`,
                doc.status === "ok"
                  ? limitText(redactExternalDocumentUrls(doc.text || ""), 4000)
                  : "Referenced link detected, but the underlying document content was not reviewed.",
              ].join("\n")
          )
          .join("\n\n")
      : "No linked documents available.";
    const prioritizedFilesContext = files.length
      ? files
          .slice(0, 3)
          .map(
            (file, index) =>
              `FILE ${index + 1}: ${file.name}\n${limitText(
                redactExternalDocumentUrls(file.text || file.summary || ""),
                2500
              )}`
          )
          .join("\n\n")
      : "No uploaded files.";
    const structuredDeterminationContext = determinationPayload
      ? `
STRUCTURED DETERMINATION
Headline: ${determinationPayload.headline}
Confidence: ${determinationPayload.confidence}

SCANS
${determinationPayload.sections.scans.summary}

ADAS
${determinationPayload.sections.adas.summary}

STRUCTURAL
${determinationPayload.sections.structural.summary}

CORROSION
${determinationPayload.sections.corrosion.summary}

VALUATION
${determinationPayload.sections.valuation.summary}

LINKED EVIDENCE
${determinationPayload.sections.linkedEvidence.summary}

SUPPORT GAPS
${determinationPayload.supportGaps.join("\n") || "None"}

CAUTION FLAGS
${determinationPayload.cautionFlags.join("\n") || "None"}
`
      : "No structured determination payload available.";
    const factualCoreContext = factualCore
      ? `
VEHICLE SUMMARY
${factualCore.vehicleSummary}

CURRENT CASE SUMMARY
${factualCore.currentCaseSummary}

VISIBLE DAMAGE OBSERVATIONS
${factualCore.visibleDamageObservations.map((item) => `- ${item}`).join("\n") || "- None"}

DOCUMENTED REPAIR OPERATIONS / INVOICE SUPPORT
${factualCore.documentedRepairOperations.map((item) => `- ${item}`).join("\n") || "- None"}

EVIDENCE REGISTRY SUMMARY
${factualCore.evidenceRegistrySummary.map((item) => `- ${item}`).join("\n") || "- None"}

OPEN ISSUES
${factualCore.openIssues.map((item) => `- ${item}`).join("\n") || "- None"}

UNRESOLVED VERIFICATION NEEDS
${factualCore.unresolvedVerificationNeeds.map((item) => `- ${item}`).join("\n") || "- None"}

LINKED EVIDENCE STATE
${factualCore.linkedEvidenceState.map((item) => `- ${item}`).join("\n") || "- None"}
`.trim()
      : "No stored factual core available.";
    const reassessmentDeltaContext = reassessmentDelta
      ? `
SUMMARY
${reassessmentDelta.summary}

ADDED EVIDENCE
${reassessmentDelta.addedEvidenceIds.map((item) => `- ${item}`).join("\n") || "- None"}

AFFECTED ISSUES
${reassessmentDelta.affectedIssueKeys.map((item) => `- ${item}`).join("\n") || "- None"}

STATUS CHANGES
${reassessmentDelta.statusChanges.map((change) => `- ${change.key}: ${change.from ?? "new"} -> ${change.to}`).join("\n") || "- None"}

NEWLY DOCUMENTED
${reassessmentDelta.newlyDocumented.map((item) => `- ${item}`).join("\n") || "- None"}

STILL OPEN
${reassessmentDelta.stillOpen.slice(0, 8).map((item) => `- ${item}`).join("\n") || "- None"}

DETERMINATION CHANGED
${reassessmentDelta.determinationChanged ? "Yes" : "No"}
`.trim()
      : "No reassessment delta stored.";
    const artifactRefreshContext = artifactRefreshPolicy
      ? `
MAIN REPORT: ${artifactRefreshPolicy.mainReport.shouldRefresh ? "refresh recommended" : "no full refresh needed"} - ${artifactRefreshPolicy.mainReport.reason}
CUSTOMER REPORT: ${artifactRefreshPolicy.customerReport.shouldRefresh ? "refresh recommended" : "no refresh needed"} - ${artifactRefreshPolicy.customerReport.reason}
DISPUTE REPORT: ${artifactRefreshPolicy.disputeReport.shouldRefresh ? "refresh recommended" : "no refresh needed"} - ${artifactRefreshPolicy.disputeReport.reason}
REBUTTAL OUTPUT: ${artifactRefreshPolicy.rebuttalOutput.shouldRefresh ? "refresh recommended" : "no refresh needed"} - ${artifactRefreshPolicy.rebuttalOutput.reason}
CHAT/UI ONLY: ${artifactRefreshPolicy.chatSummaryOnly.shouldRefresh ? "yes" : "no"} - ${artifactRefreshPolicy.chatSummaryOnly.reason}
`.trim()
      : "No artifact refresh policy stored.";
    const currentTopic = extractCurrentTopic(message, history);
    const outputMode = buildModeContext(`${message}\n\n${currentTopic}\n\n${transcriptSummary}`);
    const responseMode = determineResponseMode({
      userMessage: message,
      hasUploadedFiles: files.length > 0,
      isFollowup: history.some((entry) => entry.role === "user"),
    });
    const responseShapeInstruction = buildReviewResponseShapeInstruction(message);

    console.info("[chat] evidence context attached", {
      activeCaseId: caseId,
      latestReportId: caseData.id,
      attachmentCount: files.length,
      hasVehicleContext,
      hasEstimateText,
      hasFactualCore,
    });

    if (hasStoredEvidence) {
      console.info("[chat] fallback prevented because stored evidence exists", {
        activeCaseId: caseId,
        hasActiveCase: true,
        attachmentCount: files.length,
        hasVehicleContext,
        hasEstimateText,
        hasFactualCore,
      });
    }

    const system = `
You are Collision IQ, an expert collision analysis assistant.

You are continuing an active case. Use the accumulated case evidence below before answering.

${NON_BIAS_ACCURACY_DIRECTIVE}

${JURISDICTIONAL_INSURANCE_APPRAISAL_PROMPT}

${buildAssistanceProfileInstruction(assistanceProfile)}

${outputMode.instruction}

${buildResponseModeInstruction(responseMode)}

${responseShapeInstruction}

--------------------
VEHICLE
--------------------
${vehicle?.year || ""} ${vehicle?.make || ""} ${vehicle?.model || ""} ${vehicle?.trim || ""}

--------------------
STRUCTURED DETERMINATION (PRIMARY LOGIC LAYER)
--------------------
${structuredDeterminationContext}

--------------------
STABLE FACTUAL CORE
--------------------
${factualCoreContext}

--------------------
LATEST REASSESSMENT DELTA
--------------------
${reassessmentDeltaContext}

--------------------
ARTIFACT REFRESH POLICY
--------------------
${artifactRefreshContext}

--------------------
ADAS DECISION STATE (PRE-TEARDOWN LOGIC)
--------------------
${adasNarrative.status}: ${adasNarrative.body}

--------------------
KEY EVIDENCE (PRIORITIZED)
--------------------

--- ESTIMATE (STRUCTURAL + OPERATIONS CONTEXT) ---
${limitText(redactExternalDocumentUrls(estimateText), 6000)}

--- UPLOADED FILES (SUPPORTING CONTEXT) ---
${prioritizedFilesContext}

--- LINKED EXTERNAL OEM / PROCEDURE DOCUMENTS (OPTIONAL ENRICHMENT) ---
${prioritizedLinkedEvidenceContext}

--------------------
CASE CONTEXT
--------------------

CURRENT CONVERSATIONAL TOPIC
${currentTopic}

TRANSCRIPT SUMMARY
${transcriptSummary || "None"}

SUPPORT GAPS
${Array.isArray(supportGaps) ? supportGaps.join("\n") : "None"}

EXTRACTED FACTS
${JSON.stringify(extractedFacts || {}, null, 2)}

--------------------
RULES
--------------------
- Treat uploaded documents and images as the primary active case evidence.
- Treat stored report JSON, the factual core, and the evidence registry as primary active-case evidence after uploaded documents.
- Treat successfully ingested linked external documents as optional case-specific supporting evidence.
- Treat blocked, skipped, or failed linked documents as referenced but not yet produced, not as absent.
- Stored case evidence is already loaded here. Never fall back to generic onboarding just because this turn has no fresh attachment.
- Never reveal raw external document URLs.
- When supporting OEM/procedure/external documents are present, describe their relevance without linking.
- If asked for more detail, summarize the findings from those documents as reflected in the case evidence.
- Do not tell the user to open or visit an external document link.
- Preserve both evidence continuity and topic continuity. The current conversational topic is "${currentTopic}".
- Answer the current topic first. If the topic is narrow, do not lead with or drift into a broad case recap.
- A new upload enriches the current topic; it does not reset the topic to general review.
- Only provide a broad case summary when the current topic is "general case summary" or the user explicitly asks for one.
- Rank issues before answering by: topic relevance, safety significance, repair-completeness impact, evidence strength, actionability, and whether the issue changed in LATEST REASSESSMENT DELTA.
- Default active-case answers should include: a direct answer, the top 1-3 relevant supporting points, only the most relevant open item(s), and an optional brief change note.
- Suppress unrelated or low-signal support gaps unless the user asks for the full picture.
- Do not repeat the same unresolved issue in every answer unless it is the most relevant topic item, the user asks about it, or it materially changed.
- Use this compact answer shape for most active-case answers:
  1. Direct Answer
  2. Why
  3. What Remains Open (only if relevant)
  4. What Changed (only if LATEST REASSESSMENT DELTA materially affects the answer)
- Start with a direct answer to the user's actual question in 1-3 sentences. Do not begin with a broad recap unless the user asked for one.
- In "Why", include only the top 1-3 supporting points as short bullets or compact lines.
- In "What Remains Open", include only 1-2 relevant open items by default. Put material uncertainty here or in the direct answer; do not bury it.
- In "What Changed", mention reassessment changes only when they materially affect the answer. Keep it short.
- Avoid long uninterrupted blocks. Prefer short paragraphs, tight bullets, and stable compact sections.
- Do not duplicate the same point across "Why" and "What Remains Open".
- Topic-specific shape:
  - OEM position statements: Direct Answer, most relevant likely position-statement areas, What Remains Open.
  - Calibration requirements: Direct Answer, why calibration may be relevant, What Remains Open, What Changed if new evidence affected calibration support.
  - Structural verification: Direct Answer, visible/documented reasons, What Remains Open to further documentation.
  - Customer explanation: Direct Answer in plain language, top practical implications, what the customer should expect next.
  - Rebuttal/dispute: Direct Answer, top actionable unresolved points, best next evidence ask.
- Topic priority guide:
  - OEM position statements: prioritize procedures, scans, calibrations, structural limits, corrosion, and one-time-use parts.
  - Calibration requirements: prioritize sensors, scans, aiming, initialization, and disturbed mounting/support areas.
  - Structural verification: prioritize measurement, pull/setup confirmation, and geometry/fit verification tied to the documented impact zone.
  - Customer explanation: prioritize plain-language safety, drivability, fit, and next steps.
  - Rebuttal strategy: prioritize actionable unresolved support asks.
  - Valuation: prioritize market evidence, severity indicators, and repair-impact significance.
- If the user asks what changed, answer from LATEST REASSESSMENT DELTA first.
- If the user asks where the case stands now, answer from STABLE FACTUAL CORE first and then mention relevant delta.
- If the user asks whether this is a new review, answer no while the active case remains open; explain it is a continuation with added evidence.
- For active-case upload continuations, prefer a compact case-posture answer that starts with "Current case now includes..." or equivalent.
- After an active-case upload, preserve and rejoin the user's latest question or topic from the chat history/message instead of drifting into a generic case intro.
- The newest upload is additive evidence; it does not replace prior user intent, prior documents, or the stored factual core.
- Do not ask for VIN, year, make, model, or a starter upload when those facts are already present in VEHICLE, EXTRACTED FACTS, STABLE FACTUAL CORE, or uploaded files.
- If uploaded files, case evidence, factual core, extracted facts, or report attachments exist, never tell the user to upload the estimate again.
- Treat active-case evidence as the current source of truth.
- If vehicle identity is present in VEHICLE, EXTRACTED FACTS, STABLE FACTUAL CORE, ESTIMATE, or uploaded files, answer from that vehicle identity directly.
- Only state "vehicle not established" if it is genuinely absent from every stored active-case evidence section.
- If stored case evidence exists, never say you do not know which vehicle this is.
- In that case-posture answer, separate what is visible in photos, what documents/invoices support, and what remains open pending further documentation.
- Photos may support visible bumper, lamp, fender, mounting, bracket, support, trim, wheel-area, or teardown observations, but do not claim hidden damage from photos alone.
- If invoice evidence supports connector, electrical, wiring, or harness repair, state it as invoice-supported repair documentation rather than an inferred hidden-damage conclusion.
- Keep bracket/support damage, structural/wheel-area checks, calibration-related verification, and geometry/fit checks open only when tied to the documented impact zone or directly supported evidence.
- Do not repeat the full factual core when only the delta matters.
- If the delta says no material change, say that plainly and do not invent novelty.
- Do not recommend regenerating every artifact by default; use ARTIFACT REFRESH POLICY to decide whether chat/UI summary is enough.
- Do not invent OEM procedures.
- Do not name a calibration unless supported by evidence or teardown/interruption logic.
- Before teardown: calibration scope is provisional.
- Pre/post scans are typically appropriate baseline.
- Disconnect/reconnect or module/system disturbance can trigger calibration.
- Never leak OEM-specific systems across brands (e.g., BMW KAFAS on Chevrolet).
- If a document was blocked, explicitly state that it was not accessible.
- Be precise, concise, and evidence-driven.

${DOCUMENT_REVIEW_TWO_PASS_PROTOCOL}

${EVIDENCE_POLICY}
`;

    const rawReply = await generateChatCompletion({
      system,
      messages: [...history, { role: "user", content: message }],
    });
    const reply = sanitizeUserFacingEvidenceText(
      redactExternalDocumentUrls(
        enforceModeResponseShape(cleanResponse(vehicle?.make || "", rawReply), outputMode.mode)
      )
    );

    return NextResponse.json({
      success: true,
      reply,
      debug: {
        filesCount: files.length,
        linkedEvidenceCount: linkedEvidence.length,
        linkedEvidence: linkedEvidence.map((doc) => ({
          status: doc.status,
          title: doc.title,
        })),
      },
    });
  } catch (error: unknown) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const providerError = classifyRetryableProviderError(error, {
      provider: "openai",
      stage: "case_chat",
    });

    if (providerError.retryable) {
      const retryableStatus =
        providerError.status === 429 || providerError.statusCode === 429 ? 429 : 503;
      console.warn("CASE CHAT RETRYABLE PROVIDER ERROR:", {
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

    console.error("case-chat error", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
