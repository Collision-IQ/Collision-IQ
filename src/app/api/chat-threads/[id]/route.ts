import { NextResponse } from "next/server";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import { chatHistoryReopenLimit } from "@/lib/featureAccess";
import {
  deleteChatThread,
  getChatThreadForReopen,
} from "@/lib/chatThreads/chatThreadStore";

export const runtime = "nodejs";

const REOPEN_LOCKED_MESSAGE =
  "Reopening saved chats is available on Starter, Pro, and Team plans.";

/** Reopen one saved chat — owned, and within the plan's visible window. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { user, isPlatformAdmin } = await requireCurrentUser();
    const entitlements = await getCurrentEntitlements({ isPlatformAdmin });
    const limit = chatHistoryReopenLimit(entitlements.plan, isPlatformAdmin);
    if (limit <= 0) {
      return NextResponse.json({ ok: false, error: REOPEN_LOCKED_MESSAGE }, { status: 403 });
    }
    const thread = await getChatThreadForReopen(user.id, id, limit);
    if (!thread) {
      return NextResponse.json({ ok: false, error: "THREAD_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, thread }, { status: 200 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[chat-threads] reopen failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false, error: "CHAT_THREAD_UNAVAILABLE" }, { status: 502 });
  }
}

/** Owners may always delete their own saved chats (frees a history slot). */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { user } = await requireCurrentUser();
    const deleted = await deleteChatThread(user.id, id);
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "THREAD_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[chat-threads] delete failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false, error: "CHAT_THREAD_DELETE_FAILED" }, { status: 502 });
  }
}
