import { NextResponse } from "next/server";
import { UnauthorizedError, requireCurrentUser } from "@/lib/auth/require-current-user";
import { getAnalysisReport, getLatestActiveAnalysisReport } from "@/lib/analysisReportStore";
import { getUploadedAttachments, type StoredAttachment } from "@/lib/uploadedAttachmentStore";
import { dataUrlToPdfBytes } from "@/lib/reports/annotatedCitationDensityEstimate";
import { isPdfDocument } from "@/lib/reports/citationDensitySourcePdf";
import { classifyCitationDensityAttachment } from "@/lib/reports/citationDensityDocumentClassifier";
import { extractPdfWords, type PdfWord } from "@/lib/reports/citationDensityRowAnchors";
import {
  FORENSIC_SINGLE_REPORT_FILENAME,
  planReports,
  renderForensicSingleReportPdf,
  runForensicSingle,
} from "@/lib/reports/forensicSingle";
import { buildNormalizedEstimate } from "@/lib/reports/forensicSingle/fromEstimateText";

/**
 * Forensic Estimate Review — the single-estimate report.
 *
 * Product rule (Sep 2026): one estimate on file → this report; two or more →
 * the two-estimate Forensic Estimate Analysis + Citation Density annotation
 * (existing routes, unchanged). This route is the FORENSIC_SINGLE document of
 * `planReports()`. It never runs the delta release gate — there is no
 * comparison to gate — and it never produces a comparison: when the case
 * carries more than one estimate and the caller did not name one, it says so
 * (409) and the client falls back to the two-estimate flow.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RequestBody = {
  caseId?: unknown;
  sourceDocumentId?: unknown;
  selectedSourceDocumentId?: unknown;
  redactSensitive?: unknown;
  audience?: unknown;
};

const NO_ACTIVE_CASE_ERROR = "No active review was found. Open the case or run analysis before requesting a Forensic Estimate Review.";
const NO_ESTIMATE_ERROR = "No estimate document was found on this case.";
const NO_ESTIMATE_USER_MESSAGE =
  "Upload the estimate (CCC ONE, Mitchell or Audatex PDF) to this case and run analysis, then generate the Forensic Estimate Review.";

export async function POST(request: Request) {
  try {
    const { user } = await requireCurrentUser();
    const body = (await request.json().catch(() => ({}))) as RequestBody;
    const caseId = coerceString(body.caseId);
    const sourceDocumentId = coerceString(body.selectedSourceDocumentId) || coerceString(body.sourceDocumentId);
    const redactSensitive = body.redactSensitive !== false;
    const audience = body.audience === "CARRIER" || body.audience === "OWNER" ? body.audience : "INTERNAL";

    const report = caseId
      ? await getAnalysisReport(caseId, { ownerUserId: user.id })
      : await getLatestActiveAnalysisReport({ ownerUserId: user.id });
    if (!report) {
      return NextResponse.json(
        { ok: false, error: caseId ? "Case was not found." : NO_ACTIVE_CASE_ERROR, reportType: "forensic-estimate-review" },
        { status: caseId ? 404 : 400 }
      );
    }

    const candidateIds = uniqueStrings([...report.artifactIds, sourceDocumentId || undefined]);
    const attachments = await getUploadedAttachments(candidateIds, { ownerUserId: user.id });
    const estimates = attachments.filter(isEstimateDocument);

    const explicit = sourceDocumentId ? estimates.find((document) => document.id === sourceDocumentId) ?? null : null;
    if (sourceDocumentId && !explicit) {
      return NextResponse.json(
        {
          ok: false,
          error: "The selected estimate could not be found.",
          userMessage: estimates.length
            ? `The selected estimate could not be found. Estimates on file: ${estimates.map((document) => document.filename).join(", ")}.`
            : NO_ESTIMATE_USER_MESSAGE,
          reportType: "forensic-estimate-review",
        },
        { status: 400 }
      );
    }

    const plan = planReports({ estimateIds: estimates.map((document) => document.id) });
    if (!explicit && plan.mode !== "FORENSIC_SINGLE") {
      return NextResponse.json(
        {
          ok: false,
          error: "More than one estimate is on file; the two-estimate Forensic Estimate Analysis and Citation Density report apply.",
          userMessage: "This case carries more than one estimate. Use the two-estimate report, or name the estimate to review.",
          reportType: "forensic-estimate-review",
          mode: plan.mode,
          estimateCandidates: estimates.map((document) => ({ id: document.id, filename: document.filename })),
        },
        { status: 409 }
      );
    }
    const source = explicit ?? estimates[0] ?? null;
    if (!source) {
      return NextResponse.json(
        { ok: false, error: NO_ESTIMATE_ERROR, userMessage: NO_ESTIMATE_USER_MESSAGE, reportType: "forensic-estimate-review" },
        { status: 422 }
      );
    }

    // Prefer the measured word layer (column bands measured from the page's
    // own header row). A PDF whose text layer is unreadable, or a non-PDF
    // estimate, reads through the flattened text instead; the response says
    // which lane produced the line grid.
    const warnings: string[] = [];
    let words: PdfWord[] | null = null;
    if (isPdfDocument(source.type, source.filename) && source.imageDataUrl) {
      try {
        const bytes = dataUrlToPdfBytes(source.imageDataUrl);
        if (bytes) words = await extractPdfWords(bytes);
      } catch (error) {
        warnings.push(
          `The PDF word layer could not be read (${error instanceof Error ? error.message : "unknown error"}); the text layer was used instead.`
        );
      }
    }

    const read = buildNormalizedEstimate({ text: source.text ?? "", words, fileName: source.filename });
    warnings.push(...read.warnings);
    if (read.estimate.lines.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "The estimate's line items could not be read.",
          userMessage:
            "No line items could be read from the estimate. A scanned or image-only PDF needs a text layer before it can be reviewed; re-export the estimate from the estimating system and upload it again.",
          reportType: "forensic-estimate-review",
          lane: read.lane,
          warnings,
        },
        { status: 422 }
      );
    }

    const forensic = runForensicSingle(read.estimate);
    const rendered = await renderForensicSingleReportPdf(forensic, {
      audience,
      redactSensitive,
      sourceFileName: source.filename,
    });

    return NextResponse.json({
      ok: true,
      reportType: "forensic-estimate-review",
      mode: plan.mode,
      filename: FORENSIC_SINGLE_REPORT_FILENAME,
      pdfBase64: Buffer.from(rendered.bytes).toString("base64"),
      pageCount: rendered.pageCount,
      selectedSourceDocumentId: source.id,
      selectedSourceLabel: source.filename,
      lane: read.lane,
      warnings,
      summary: {
        headline: forensic.verdict.headline,
        recommendation: forensic.verdict.recommendation,
        holdRelease: forensic.verdict.holdRelease,
        unexplained: forensic.reconciliation.unexplained,
        findingCount: forensic.findings.length,
        criticalOrHighCount: forensic.findings.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH").length,
        quantifiedLow: forensic.exposure.quantifiedLow,
        quantifiedHigh: forensic.exposure.quantifiedHigh,
        findings: forensic.findings.map((f) => ({ id: f.id, ruleId: f.ruleId, severity: f.severity, title: f.title, lineRefs: f.lineRefs })),
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }
    console.error("[forensic_estimate_review_failed]", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Forensic Estimate Review failed.",
        reportType: "forensic-estimate-review",
      },
      { status: 500 }
    );
  }
}

/** An estimate-like document with readable text — PDF or otherwise. */
function isEstimateDocument(attachment: StoredAttachment): boolean {
  if (!attachment.text?.trim()) return false;
  return classifyCitationDensityAttachment(attachment).isEstimateLike;
}

function coerceString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
