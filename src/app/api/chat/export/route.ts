import { NextResponse } from "next/server";
import { UnauthorizedError } from "@/lib/auth/require-current-user";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import { redactDownloadContent } from "@/lib/privacy/redactDownloadContent";

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
  if (typeof body.text === "string" && body.text.trim()) {
    return body.text;
  }

  if (typeof body.content === "string" && body.content.trim()) {
    return body.content;
  }

  if (typeof body.analysisText === "string" && body.analysisText.trim()) {
    return body.analysisText;
  }

  if (Array.isArray(body.messages)) {
    return (body.messages as ChatExportMessage[])
      .map((message) => {
        const role = typeof message.role === "string" ? message.role.toUpperCase() : "MESSAGE";
        const content = extractMessageText(message.content).trim();
        return content ? `${role}:\n${content}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
  }

  return "";
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

    return new Response(redacted, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="chat-export-redacted-${filenameDate}.txt"`,
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
