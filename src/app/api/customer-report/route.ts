import { NextResponse } from "next/server";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import { recordUsage } from "@/lib/billing/usage";
import { incrementUsage } from "@/lib/usage";
import { generateCustomerReport } from "@/lib/ai/generateCustomerReport";
import { sanitizeCustomerReportForRender } from "@/lib/ai/customerFacingText";
import { renderCustomerReportHtml } from "@/lib/ai/renderCustomerReportHtml";
import type { EstimatePostureDecision } from "@/lib/ai/estimatePosture";
import { finalizeExportPayload } from "@/lib/ai/policy/finalizeExportPayload";
import {
  collisionIqModels,
  logCollisionIqModelDiagnostic,
} from "@/lib/modelConfig";
import { generateClaudeMessage } from "@/lib/anthropic";
import { canAccessFeature } from "@/lib/featureAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CustomerReportRequestBody = {
  vehicle?: unknown;
  vin?: unknown;
  insurer?: unknown;
  mileage?: unknown;
  estimateTotal?: unknown;
  determination?: unknown;
  documentedPositives?: unknown;
  supportGaps?: unknown;
  estimateSummary?: unknown;
  imageSummary?: unknown;
  selectedEstimatePosture?: unknown;
};

export async function POST(req: Request) {
  try {
    const { user, isPlatformAdmin } = await requireCurrentUser();
    const entitlements = await getCurrentEntitlements();

    if (!isPlatformAdmin && !canAccessFeature(entitlements.plan, "customer_report_export")) {
      return NextResponse.json({ error: "PRO_REQUIRED" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as CustomerReportRequestBody;
    const input = {
      vehicle: coerceInputText(body.vehicle),
      insurer: coerceNullableText(body.insurer),
      estimateTotal: coerceNullableText(body.estimateTotal),
      determination: coerceInputText(body.determination),
      documentedPositives: coerceStringArray(body.documentedPositives),
      supportGaps: coerceStringArray(body.supportGaps),
      estimateSummary: coerceInputText(body.estimateSummary),
      imageSummary: coerceNullableText(body.imageSummary),
      reportMode: "action_guided" as const,
      policyholderOptionsContext: [
        "Owner may have shop-choice options if supported by the estimate or carrier file.",
        "Owner may have supplement-review options if additional teardown findings are documented.",
        "Owner may be able to request a written explanation or written status update if the claim position remains unclear.",
        "Owner may have an appraisal-related option if supported by the policy text provided to the system.",
        "Any Pennsylvania-specific consumer or claims-handling guidance should only be included when supported by provided policy or law material.",
      ].join("\n"),
      policySignals: {
        hasAppraisalClause: true,
        appraisalAppliesToAmountDisputes: true,
        appraisalDoesNotApplyToCoverage: true,
        hasShopChoice: true,
        hasSupplementProcess: true,
        hasPAConsumerRights: true,
        estimateGapDetected: true,
      },
    };

    if (!input.determination && !input.estimateSummary && input.supportGaps.length === 0) {
      return NextResponse.json(
        { error: "CUSTOMER_REPORT_INPUT_REQUIRED" },
        { status: 400 }
      );
    }

    const report = sanitizeCustomerReportForRender(await generateCustomerReport(input, {
      generateText: async (prompt) => {
        logCollisionIqModelDiagnostic({
          stage: "customer_report_generation",
          provider: "anthropic",
          role: "anthropicPrimary",
          model: collisionIqModels.anthropicPrimary,
        });
        const response = await generateClaudeMessage({
          effort: "medium",
          messages: [{ role: "user", content: prompt }],
        });

        return response.text;
      },
    }));
    const generatedAt = new Date().toLocaleString();
    const html = renderCustomerReportHtml({
      report,
      vehicle: input.vehicle || "Vehicle not specified",
      vin: coerceNullableText(body.vin),
      insurer: input.insurer,
      mileage: coerceNullableText(body.mileage),
      estimateTotal: input.estimateTotal,
      generatedAt,
      selectedEstimatePosture: coerceEstimatePosture(body.selectedEstimatePosture),
    });

    if (!isPlatformAdmin) {
      await recordUsage({
        userId: user.id,
        kind: "REPORT_EXPORT",
        metadataJson: {
          source: "customer_report",
        },
      });
      await incrementUsage(user.id, "REPORT_EXPORT");
    }

    const exportPayload = finalizeExportPayload({
      ok: true,
      fileName: "customer-report.pdf",
      mimeType: "application/pdf",
      html,
      report,
    });

    return NextResponse.json(exportPayload);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("CUSTOMER_REPORT_ERROR", error);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}

function coerceEstimatePosture(value: unknown): EstimatePostureDecision | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const rawSelectedEstimateLabel = record.selectedEstimateLabel;
  const selectedEstimateLabel =
    rawSelectedEstimateLabel === "inconclusive" ? "undetermined" : rawSelectedEstimateLabel;
  const selectedEstimateReason = record.selectedEstimateReason;
  const confidence = record.confidence;
  const limitations = record.limitations;
  if (
    (
      selectedEstimateLabel !== "shop" &&
      selectedEstimateLabel !== "carrier" &&
      selectedEstimateLabel !== "insurer" &&
      selectedEstimateLabel !== "mixed" &&
      selectedEstimateLabel !== "undetermined"
    ) ||
    typeof selectedEstimateReason !== "string" ||
    (confidence !== "high" && confidence !== "medium" && confidence !== "low")
  ) {
    return undefined;
  }
  return {
    selectedEstimateLabel,
    selectedEstimateReason,
    confidence,
    limitations: Array.isArray(limitations)
      ? limitations.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function coerceInputText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function coerceNullableText(value: unknown): string | null {
  const text = coerceInputText(value);
  return text || null;
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const text = coerceInputText(value);
    return text ? [text] : [];
  }

  return value
    .map((item) => coerceInputText(item))
    .filter(Boolean);
}
