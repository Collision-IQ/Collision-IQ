import { NextRequest, NextResponse } from "next/server";
import { buildAdasNarrative } from "@/lib/analysis/adasDecision";
import { EVIDENCE_POLICY } from "@/lib/analysis/buildEvidenceCorpus";
import { generateChatCompletion } from "@/lib/ai/generateChatCompletion";
import { NON_BIAS_ACCURACY_DIRECTIVE } from "@/lib/ai/nonBiasDirective";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import { getCaseById } from "@/lib/cases/getCaseById";
import { cleanResponse } from "@/lib/vehicle/oemGuardrails";

export const runtime = "nodejs";

function limitText(text: string, max = 12000) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}\n...[truncated]` : text;
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireCurrentUser();
    const body = await req.json();

    const {
      caseId,
      message,
      history = [],
    }: {
      caseId: string;
      message: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
    } = body;

    if (!caseId || !message) {
      return NextResponse.json(
        { error: "Missing caseId or message" },
        { status: 400 }
      );
    }

    const caseData = await getCaseById(caseId, {
      ownerUserId: user.id,
    });

    if (!caseData) {
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
                  ? limitText(doc.text || "", 4000)
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
                file.text || file.summary || "",
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

    const system = `
You are Collision IQ, an expert collision analysis assistant.

You are continuing an active case. Use the accumulated case evidence below before answering.

${NON_BIAS_ACCURACY_DIRECTIVE}

====================
VEHICLE
====================
${vehicle?.year || ""} ${vehicle?.make || ""} ${vehicle?.model || ""} ${vehicle?.trim || ""}

====================
STRUCTURED DETERMINATION (PRIMARY LOGIC LAYER)
====================
${structuredDeterminationContext}

====================
STABLE FACTUAL CORE
====================
${factualCoreContext}

====================
LATEST REASSESSMENT DELTA
====================
${reassessmentDeltaContext}

====================
ARTIFACT REFRESH POLICY
====================
${artifactRefreshContext}

====================
ADAS DECISION STATE (PRE-TEARDOWN LOGIC)
====================
${adasNarrative.status}: ${adasNarrative.body}

====================
KEY EVIDENCE (PRIORITIZED)
====================

--- LINKED OEM / ADAS DOCUMENTS (INGESTED SUPPORT OR REFERENCED LINKS) ---
${prioritizedLinkedEvidenceContext}

--- ESTIMATE (STRUCTURAL + OPERATIONS CONTEXT) ---
${limitText(estimateText, 6000)}

--- UPLOADED FILES (SUPPORTING CONTEXT) ---
${prioritizedFilesContext}

====================
CASE CONTEXT
====================

TRANSCRIPT SUMMARY
${transcriptSummary || "None"}

SUPPORT GAPS
${Array.isArray(supportGaps) ? supportGaps.join("\n") : "None"}

EXTRACTED FACTS
${JSON.stringify(extractedFacts || {}, null, 2)}

====================
RULES
====================
- Treat uploaded documents and images as the primary active case evidence.
- Treat successfully ingested linked documents as case-specific supporting evidence.
- Treat blocked or failed linked documents as referenced but not yet produced, not as absent.
- If the user asks what changed, answer from LATEST REASSESSMENT DELTA first.
- If the user asks where the case stands now, answer from STABLE FACTUAL CORE first and then mention relevant delta.
- If the user asks whether this is a new review, answer no while the active case remains open; explain it is a continuation with added evidence.
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

${EVIDENCE_POLICY}
`;

    const rawReply = await generateChatCompletion({
      system,
      messages: [...history, { role: "user", content: message }],
    });
    const reply = cleanResponse(vehicle?.make || "", rawReply);

    return NextResponse.json({
      success: true,
      reply,
      debug: {
        filesCount: files.length,
        linkedEvidenceCount: linkedEvidence.length,
        linkedEvidenceUrls: linkedEvidence.map((doc) => ({
          url: doc.url,
          status: doc.status,
          title: doc.title,
        })),
      },
    });
  } catch (error: unknown) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("case-chat error", error);

    return NextResponse.json(
      {
        error: "Internal server error",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
