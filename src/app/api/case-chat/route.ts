import { NextRequest, NextResponse } from "next/server";
import { buildAdasNarrative } from "@/lib/analysis/adasDecision";
import { EVIDENCE_POLICY } from "@/lib/analysis/buildEvidenceCorpus";
import { generateChatCompletion } from "@/lib/ai/generateChatCompletion";
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
      determination,
      supportGaps,
      extractedFacts,
      determinationPayload,
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
                limitText(doc.text || "", 4000),
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

    const system = `
You are Collision IQ, an expert collision analysis assistant.

You are continuing an active case. Use the case evidence below before answering.

====================
VEHICLE
====================
${vehicle?.year || ""} ${vehicle?.make || ""} ${vehicle?.model || ""} ${vehicle?.trim || ""}

====================
STRUCTURED DETERMINATION (PRIMARY LOGIC LAYER)
====================
${structuredDeterminationContext}

====================
ADAS DECISION STATE (PRE-TEARDOWN LOGIC)
====================
${adasNarrative.status}: ${adasNarrative.body}

====================
KEY EVIDENCE (PRIORITIZED)
====================

--- LINKED OEM / ADAS DOCUMENTS (HIGHEST PRIORITY) ---
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
- Treat LINKED DOCUMENTS as highest authority when available.
- Use estimate + files to support or challenge conclusions.
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
