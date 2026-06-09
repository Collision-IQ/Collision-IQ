import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { emitSafeCrmEvent } from "@/lib/crm/serverEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ReportKind =
  | "snapshot"
  | "customer_report"
  | "repair_intelligence"
  | "estimate_scrubber"
  | "policy_rights_review";

type DestinationType = "customer" | "carrier" | "internal";

type SendReportRequest = {
  reportType?: unknown;
  destinationType?: unknown;
  recipientEmail?: unknown;
  subject?: unknown;
  message?: unknown;
  pdfBase64?: unknown;
  filename?: unknown;
  metadata?: {
    caseId?: unknown;
    vehicle?: unknown;
    vin?: unknown;
    customerName?: unknown;
    customerEmail?: unknown;
  };
};

const REPORT_TYPES: ReportKind[] = [
  "snapshot",
  "customer_report",
  "repair_intelligence",
  "estimate_scrubber",
  "policy_rights_review",
];
const DESTINATION_TYPES: DestinationType[] = ["customer", "carrier", "internal"];

export async function POST(request: Request) {
  let body: SendReportRequest;

  try {
    body = (await request.json()) as SendReportRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const reportType = coerceReportType(body.reportType);
  const destinationType = coerceDestinationType(body.destinationType);
  const recipientEmail = coerceText(body.recipientEmail);
  const subject = coerceText(body.subject);
  const message = sanitizeMessage(coerceText(body.message));
  const pdfBase64 = coerceText(body.pdfBase64);
  const filename = sanitizeFilename(coerceText(body.filename));
  const caseId = coerceOptionalText(body.metadata?.caseId);

  if (
    !reportType ||
    !destinationType ||
    !isValidEmail(recipientEmail) ||
    !subject ||
    !message ||
    !isLikelyPdfBase64(pdfBase64) ||
    !filename
  ) {
    return NextResponse.json({ error: "Report email request is incomplete." }, { status: 400 });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.SNAPSHOT_FROM_EMAIL;

  if (!resendApiKey || !fromEmail) {
    const sentAt = new Date();
    const reportSendId = await persistReportSend({
      caseId,
      reportType,
      destinationType,
      recipientEmail,
      subject,
      resendEmailId: null,
      status: "manual",
      sentAt,
    });

    return NextResponse.json({
      ok: true,
      deliveryMode: "manual",
      message: "Email provider is not configured. Download the PDF and send manually.",
      sentAt: sentAt.toISOString(),
      reportSendId,
    });
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Collision IQ <${fromEmail}>`,
      to: [recipientEmail],
      reply_to: ["support@collision-iq.ai"],
      subject,
      text: message,
      html: messageToHtml(message, safeReportLabel(reportType)),
      attachments: [{ filename, content: pdfBase64 }],
    }),
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Email send failed." }, { status: 502 });
  }

  const result = (await response.json().catch(() => null)) as { id?: string } | null;
  const resendEmailId = result?.id ?? null;
  const sentAt = new Date();
  const reportSendId = await persistReportSend({
    caseId,
    reportType,
    destinationType,
    recipientEmail,
    subject,
    resendEmailId,
    status: "sent",
    sentAt,
  });

  console.info("[report_sent]", {
    sent_at: sentAt.toISOString(),
    report_type: reportType,
    destination_type: destinationType,
    recipient: recipientEmail,
    resend_id: resendEmailId,
    case_id: caseId,
    report_send_id: reportSendId,
  });

  try {
    await emitSafeCrmEvent({
      event: "report_sent",
      source: "server",
      destinationType,
      exportType: reportType,
      caseId,
      reportType,
      recipient: recipientEmail,
      sentAt: sentAt.toISOString(),
      resendId: resendEmailId,
      reportSendId,
    });
  } catch (error) {
    console.warn("[report_sent_crm_failed]", {
      reportType,
      reportSendId,
      message: error instanceof Error ? error.message : "Unknown CRM error",
    });
  }

  return NextResponse.json({
    ok: true,
    deliveryMode: "email",
    id: resendEmailId,
    sentAt: sentAt.toISOString(),
    reportSendId,
  });
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function messageToHtml(message: string, reportLabel = "Report"): string {
  const paragraphs = sanitizeMessage(message)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const content = escapeHtml(paragraph).replace(/\n/g, "<br>");
      return `<p style="margin:0 0 14px">${content}</p>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f6f3ef;color:#242426;font-family:Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:28px 18px">
    <div style="border-top:4px solid #C65A2A;background:#ffffff;border-radius:10px;padding:24px;box-shadow:0 10px 30px rgba(26,26,28,0.08)">
      <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#8a4d2f;margin-bottom:14px">Collision IQ</div>
      <h1 style="font-size:20px;line-height:1.3;margin:0 0 18px;color:#161618">${escapeHtml(reportLabel)}</h1>
      <div style="font-size:15px;line-height:1.6;color:#33363a">${paragraphs}</div>
      <hr style="border:none;border-top:1px solid #e5e1dc;margin:24px 0">
      <p style="font-size:12px;line-height:1.5;color:#7b7f86;margin:0">This report was sent by Collision IQ. Please review the attached PDF.</p>
    </div>
  </div>
</body>
</html>`;
}

function sanitizeMessage(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().slice(0, 5000);
}

function safeReportLabel(reportType: ReportKind): string {
  switch (reportType) {
    case "snapshot":
      return "1-Page Snapshot";
    case "repair_intelligence":
      return "Repair Intelligence Report";
    case "estimate_scrubber":
      return "Citation Density Gap Report";
    case "policy_rights_review":
      return "Policy & Rights Review";
    case "customer_report":
      return "Customer Repair Summary";
  }
}

function coerceReportType(value: unknown): ReportKind | null {
  return typeof value === "string" && REPORT_TYPES.includes(value as ReportKind)
    ? (value as ReportKind)
    : null;
}

function coerceDestinationType(value: unknown): DestinationType | null {
  return typeof value === "string" && DESTINATION_TYPES.includes(value as DestinationType)
    ? (value as DestinationType)
    : null;
}

function coerceText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function coerceOptionalText(value: unknown): string | null {
  const text = coerceText(value);
  return text || null;
}

function sanitizeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 160);
}

function isLikelyPdfBase64(value: string): boolean {
  return value.length > 20 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

async function persistReportSend(params: {
  caseId: string | null;
  reportType: ReportKind;
  destinationType: DestinationType;
  recipientEmail: string;
  subject: string;
  resendEmailId: string | null;
  status: "sent" | "manual";
  sentAt: Date;
}): Promise<string | null> {
  try {
    const saved = await prisma.reportSend.create({
      data: {
        caseId: params.caseId,
        reportType: params.reportType,
        destinationType: params.destinationType,
        recipient: params.recipientEmail,
        subject: params.subject,
        resendId: params.resendEmailId,
        status: params.status,
        sentAt: params.sentAt,
      },
      select: {
        id: true,
      },
    });

    console.info("[report_send_saved]", {
      report_send_id: saved.id,
      report_type: params.reportType,
      destination_type: params.destinationType,
      status: params.status,
      case_id: params.caseId,
      resend_id: params.resendEmailId,
    });
    return saved.id;
  } catch (error) {
    console.warn("[report_send_persist_failed]", {
      reportType: params.reportType,
      destinationType: params.destinationType,
      status: params.status,
      caseId: params.caseId,
      resendId: params.resendEmailId,
      message: error instanceof Error ? error.message : "Unknown persistence error",
    });
    return null;
  }
}
