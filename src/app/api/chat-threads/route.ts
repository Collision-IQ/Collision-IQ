import { NextResponse } from "next/server";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import { chatHistoryReopenLimit } from "@/lib/featureAccess";
import { listChatThreads, saveChatThread } from "@/lib/chatThreads/chatThreadStore";

export const runtime = "nodejs";

/**
 * Saved chats (reopenable chat history). Strictly per-user. The visible list
 * is bounded by plan: free none, Starter 5, Pro 10, Team/Admin unlimited —
 * enforced here, never client-side.
 */
export async function GET() {
  try {
    const { user, isPlatformAdmin } = await requireCurrentUser();
    const entitlements = await getCurrentEntitlements({ isPlatformAdmin });
    const limit = chatHistoryReopenLimit(entitlements.plan, isPlatformAdmin);
    if (limit <= 0) {
      return NextResponse.json(
        { ok: true, locked: true, limit: 0, threads: [] },
        { status: 200 }
      );
    }
    const threads = await listChatThreads(user.id, limit);
    return NextResponse.json(
      {
        ok: true,
        locked: false,
        limit: Number.isFinite(limit) ? limit : null,
        threads,
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[chat-threads] list failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false, error: "CHAT_THREADS_UNAVAILABLE" }, { status: 502 });
  }
}

/**
 * Autosave the active chat. Every signed-in user may save (an upgrade then
 * unlocks the already-saved history); reopening is what the plan limit gates.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requireCurrentUser();
    const body = (await request.json().catch(() => null)) as {
      id?: string;
      caseId?: string;
      messages?: unknown;
    } | null;
    if (!body || !Array.isArray(body.messages)) {
      return NextResponse.json({ ok: false, error: "MESSAGES_REQUIRED" }, { status: 400 });
    }
    const id = await saveChatThread({
      ownerUserId: user.id,
      threadId: typeof body.id === "string" ? body.id : null,
      caseId: typeof body.caseId === "string" ? body.caseId : null,
      messages: body.messages,
    });
    return NextResponse.json({ ok: true, id, skipped: id === null }, { status: 200 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[chat-threads] save failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false, error: "CHAT_THREAD_SAVE_FAILED" }, { status: 502 });
  }
}
