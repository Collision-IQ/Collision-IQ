import { NextResponse } from "next/server";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import { recordUsage } from "@/lib/billing/usage";
import { incrementUsage } from "@/lib/usage";
import { generateCustomerReport } from "@/lib/ai/generateCustomerReport";
import { renderCustomerReportHtml } from "@/lib/ai/renderCustomerReportHtml";
import { collisionIqModels } from "@/lib/modelConfig";
import { openai } from "@/lib/openai";

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
};

export async function POST(req: Request) {
  try {
    const { user, isPlatformAdmin } = await requireCurrentUser();
    const entitlements = await getCurrentEntitlements();

    if (!isPlatformAdmin && !entitlements.canUseCustomerReport) {
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
    };

    if (!input.determination && !input.estimateSummary && input.supportGaps.length === 0) {
      return NextResponse.json(
        { error: "CUSTOMER_REPORT_INPUT_REQUIRED" },
        { status: 400 }
      );
    }

    const report = await generateCustomerReport(input, {
      generateText: async (prompt) => {
        const response = await openai.responses.create({
          model: collisionIqModels.helper,
          temperature: 0.2,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: prompt,
                },
              ],
            },
          ],
        });

        return response.output_text ?? "";
      },
    });
    const generatedAt = new Date().toLocaleString();
    const html = renderCustomerReportHtml({
      report,
      vehicle: input.vehicle || "Vehicle not specified",
      vin: coerceNullableText(body.vin),
      insurer: input.insurer,
      mileage: coerceNullableText(body.mileage),
      estimateTotal: input.estimateTotal,
      generatedAt,
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

    return NextResponse.json({
      ok: true,
      fileName: "customer-report.pdf",
      mimeType: "application/pdf",
      html,
      report,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("CUSTOMER_REPORT_ERROR", error);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
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
