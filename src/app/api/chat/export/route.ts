import { NextResponse } from "next/server";
import { UnauthorizedError } from "@/lib/auth/require-current-user";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import { redactDownloadContent } from "@/lib/privacy/redactDownloadContent";
import { jsPDF } from "jspdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatExportMessage = {
  role?: unknown;
  content?: unknown;
};

type ChatExportRequestBody = {
  text?: unknown;
  content?: unknown;
  analysisText?: unknown;
  messages?: unknown;
};

function canAccessRedactedChatExport(entitlements: Awaited<ReturnType<typeof getCurrentEntitlements>>) {
  if (entitlements.isPlatformAdmin) {
    return true;
  }

  if (!entitlements.featureFlags.redacted_chat_export) {
    return false;
  }

  return (
    entitlements.activeSubscriptionStatus === "TRIALING" ||
    entitlements.activeSubscriptionStatus === "ACTIVE"
  );
}

async function handleExportAccess() {
  const entitlements = await getCurrentEntitlements();

  if (!canAccessRedactedChatExport(entitlements)) {
    return NextResponse.json(
      { error: "Redacted chat export is not available for this account." },
      { status: 403 }
    );
  }

  return NextResponse.json(
    { error: "Redacted chat export is not implemented yet." },
    { status: 501 }
  );
}

async function requireExportAccess() {
  const entitlements = await getCurrentEntitlements();

  if (!canAccessRedactedChatExport(entitlements)) {
    return NextResponse.json(
      { error: "Redacted chat export is not available for this account." },
      { status: 403 }
    );
  }

  return null;
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object" && "text" in part) {
          const candidate = part as { text?: unknown };
          return typeof candidate.text === "string" ? candidate.text : "";
        }

        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function resolveExportText(body: ChatExportRequestBody): string {
  const messageText = Array.isArray(body.messages)
    ? (body.messages as ChatExportMessage[])
        .map((message) => {
          const role = typeof message.role === "string" ? message.role.toUpperCase() : "MESSAGE";
          const content = extractMessageText(message.content).trim();
          return content ? `${role}:\n${content}` : "";
        })
        .filter(Boolean)
        .join("\n\n")
    : "";

  const directText =
    typeof body.text === "string" && body.text.trim()
      ? body.text.trim()
      : typeof body.content === "string" && body.content.trim()
        ? body.content.trim()
        : "";

  const primaryText = messageText || directText;
  const analysisText =
    typeof body.analysisText === "string" && body.analysisText.trim()
      ? body.analysisText.trim()
      : "";

  if (!analysisText) {
    return primaryText;
  }

  if (!primaryText) {
    return analysisText;
  }

  if (normalizeExportComparisonText(primaryText).includes(normalizeExportComparisonText(analysisText))) {
    return primaryText;
  }

  return `${primaryText}\n\nANALYSIS SUMMARY:\n${analysisText}`;
}

function normalizeExportComparisonText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

type PdfMessageBlock = {
  role: string;
  body: string;
};

function parsePdfMessageBlocks(text: string): PdfMessageBlock[] {
  const normalized = text.replace(/\r/g, "").trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const blocks: PdfMessageBlock[] = [];
  let currentRole = "MESSAGE";
  let currentBody: string[] = [];

  const flush = () => {
    const body = currentBody.join("\n").trim();
    if (!body) return;
    blocks.push({ role: currentRole, body });
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const roleMatch = line.match(/^(USER|ASSISTANT|ANALYSIS SUMMARY|MESSAGE):\s*$/i);
    if (roleMatch) {
      flush();
      currentRole = roleMatch[1].toUpperCase();
      currentBody = [];
      continue;
    }

    currentBody.push(line);
  }

  flush();
  return blocks;
}

function buildChatExportPdf(text: string): ArrayBuffer {
  const doc = new jsPDF({
    unit: "mm",
    format: "letter",
  });

  doc.setFont("Helvetica", "Bold");
  doc.setFontSize(16);
  doc.text("Redacted Chat Export", 16, 18);

  doc.setFont("Helvetica", "Normal");
  doc.setFontSize(10);
  doc.text(
    "This download preserves the chat content while removing sensitive values from the exported copy.",
    16,
    26,
    { maxWidth: 178 }
  );

  const marginX = 16;
  const marginY = 36;
  const blockWidth = 178;
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottomY = pageHeight - 14;
  const blocks = parsePdfMessageBlocks(text);

  let y = marginY;
  const ensurePageSpace = (requiredHeight: number) => {
    if (y + requiredHeight > bottomY) {
      doc.addPage();
      y = 18;
    }
  };

  for (const block of blocks.length > 0 ? blocks : [{ role: "MESSAGE", body: text.trim() }]) {
    const labelHeight = 6;
    const bodyLineHeight = 4.8;
    const bodyTopGap = 4;
    const blockBottomGap = 6;
    const labelWidth = Math.min(54, Math.max(24, doc.getTextWidth(block.role) + 8));
    const bodyLines = doc.splitTextToSize(block.body, blockWidth - 6);
    const estimatedHeight =
      labelHeight + bodyTopGap + bodyLines.length * bodyLineHeight + blockBottomGap;

    ensurePageSpace(estimatedHeight);

    doc.setFillColor(238, 241, 245);
    doc.roundedRect(marginX, y - 4, labelWidth, labelHeight, 1.4, 1.4, "F");
    doc.setTextColor(67, 76, 94);
    doc.setFont("Helvetica", "Bold");
    doc.setFontSize(8.5);
    doc.text(block.role, marginX + 3, y);

    y += bodyTopGap;
    doc.setTextColor(35, 35, 35);
    doc.setFont("Times", "Normal");
    doc.setFontSize(10.5);

    for (const line of bodyLines) {
      ensurePageSpace(bodyLineHeight + 2);
      doc.text(line, marginX, y + 4);
      y += bodyLineHeight;
    }

    y += blockBottomGap;
  }

  return doc.output("arraybuffer");
}

export async function GET() {
  try {
    return await handleExportAccess();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "Authentication is required." },
        { status: 401 }
      );
    }

    throw error;
  }
}

export async function POST(req: Request) {
  try {
    const accessError = await requireExportAccess();
    if (accessError) {
      return accessError;
    }

    const body = (await req.json().catch(() => ({}))) as ChatExportRequestBody;
    const exportText = resolveExportText(body);

    if (!exportText.trim()) {
      return NextResponse.json(
        { error: "No chat content was provided for export." },
        { status: 400 }
      );
    }

    const redacted = redactDownloadContent(exportText);
    const filenameDate = new Date().toISOString().slice(0, 10);
    const pdf = buildChatExportPdf(redacted);

    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="chat-export-${filenameDate}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: "Authentication is required." },
        { status: 401 }
      );
    }

    throw error;
  }
}
