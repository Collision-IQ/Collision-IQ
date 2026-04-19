import { NextResponse } from "next/server";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import { UsageAccessError, recordUsage } from "@/lib/billing/usage";
import { getUsageCount, incrementUsage } from "@/lib/usage";
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

async function requireExportAccess() {
  const { user, isPlatformAdmin } = await requireCurrentUser();
  const entitlements = await getCurrentEntitlements();

  if (!isPlatformAdmin && !entitlements.canExport) {
    return NextResponse.json(
      { error: "EXPORT_NOT_INCLUDED_IN_PLAN" },
      { status: 403 }
    );
  }

  if (!isPlatformAdmin && entitlements.exportCap !== null) {
    const exportsUsed = await getUsageCount(user.id, "REPORT_EXPORT");

    if (exportsUsed >= entitlements.exportCap) {
      return NextResponse.json(
        { error: "EXPORT_LIMIT_REACHED" },
        { status: 403 }
      );
    }
  }

  return { userId: user.id, isPlatformAdmin };
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
  const BODY_FONT = 10.5;
  const HEADER_FONT = 14;

  const doc = new jsPDF({
    unit: "mm",
    format: "letter",
  });

  const marginX = 16;
  const topMargin = 18;
  const firstPageContentY = 36;
  const blockWidth = 178;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottomMargin = 18;
  const contentBottomY = pageHeight - bottomMargin;
  const blocks = parsePdfMessageBlocks(text);

  const drawPageChrome = (showIntro = false) => {
    doc.setFont("Helvetica", "Bold");
    doc.setFontSize(HEADER_FONT);
    doc.setTextColor(35, 35, 35);
    doc.text("Redacted Chat Export", marginX, showIntro ? 18 : 14);

    if (showIntro) {
      doc.setFont("Helvetica", "Normal");
      doc.setFontSize(BODY_FONT);
      doc.text(
        "This download preserves the chat content while removing sensitive values from the exported copy.",
        marginX,
        26,
        { maxWidth: blockWidth }
      );
    }

    doc.setFont("Helvetica", "Normal");
    doc.setFontSize(BODY_FONT);
    doc.setTextColor(120, 120, 120);
    doc.text(`Page ${doc.getCurrentPageInfo().pageNumber}`, pageWidth - marginX, pageHeight - 8, {
      align: "right",
    });
  };

  let y = firstPageContentY;
  drawPageChrome(true);

  const addPage = () => {
    doc.addPage();
    y = topMargin;
    drawPageChrome(false);
  };

  const ensurePageSpace = (requiredHeight: number) => {
    if (y + requiredHeight <= contentBottomY) return;
    addPage();
  };

  // Render each line safely so long chat blocks can continue across pages
  // instead of being clipped by a single oversized text call.
  for (const block of blocks.length > 0 ? blocks : [{ role: "MESSAGE", body: text.trim() }]) {
    const labelHeight = 7.5;
    const bodyLineHeight = 4.8;
    const bodyTopGap = 4;
    const blockBottomGap = 6;
    const labelBoxY = y - 5;
    const labelTextY = y + 0.7;
    const labelWidth = Math.min(54, Math.max(24, doc.getTextWidth(block.role) + 10));
    const bodyLines = doc.splitTextToSize(block.body, blockWidth - 6);
    ensurePageSpace(labelHeight + bodyTopGap + bodyLineHeight + blockBottomGap);

    doc.setFillColor(238, 241, 245);
    doc.roundedRect(marginX, labelBoxY, labelWidth, labelHeight, 1.4, 1.4, "F");
    doc.setTextColor(67, 76, 94);
    doc.setFont("Helvetica", "Bold");
    doc.setFontSize(BODY_FONT);
    doc.text(block.role, marginX + 3, labelTextY);

    y += bodyTopGap;
    doc.setTextColor(35, 35, 35);
    doc.setFont("Times", "Normal");
    doc.setFontSize(BODY_FONT);

    for (let index = 0; index < bodyLines.length; index += 1) {
      ensurePageSpace(bodyLineHeight);
      doc.text(bodyLines[index], marginX, y + 4);
      y += bodyLineHeight;
    }

    y += blockBottomGap;
  }

  return doc.output("arraybuffer");
}

export async function GET() {
  const access = await requireExportAccess();
  if (access instanceof NextResponse) {
    return access;
  }

  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  try {
    const access = await requireExportAccess();
    if (access instanceof NextResponse) {
      return access;
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

    if (!access.isPlatformAdmin) {
      await recordUsage({
        userId: access.userId,
        kind: "REPORT_EXPORT",
        metadataJson: {
          source: "chat_export",
        },
      });
      await incrementUsage(access.userId, "REPORT_EXPORT");
    }

    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="chat-export-${filenameDate}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof UsageAccessError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }

    console.error("CHAT_EXPORT_ERROR", error);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
