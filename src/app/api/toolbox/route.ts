import { NextResponse } from "next/server";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import { toolboxSlotLimit } from "@/lib/featureAccess";
import { listToolbox, saveToToolbox } from "@/lib/chatThreads/toolboxStore";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const LOCKED_MESSAGE =
  "The Toolbox is available on Starter, Pro, and Team plans.";

/** Saved chats for the signed-in user, newest save first. */
export async function GET() {
  try {
    const { user, isPlatformAdmin } = await requireCurrentUser();
    const entitlements = await getCurrentEntitlements({ isPlatformAdmin });
    const limit = toolboxSlotLimit(entitlements.plan, isPlatformAdmin);
    const listing = await listToolbox(user.id, limit);
    return NextResponse.json({ ok: true, ...listing }, { status: 200 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[toolbox] list failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false, error: "TOOLBOX_UNAVAILABLE" }, { status: 502 });
  }
}

/**
 * Save a chat to the toolbox.
 *
 * Two-phase when the slots are full: the first call returns 409 with the entry
 * that would be displaced and writes NOTHING, so the client can warn. The
 * client repeats the call with `confirmed: true` only if the user accepts.
 * Declining simply never sends the second call, and every saved chat is left
 * exactly as it was.
 */
export async function POST(request: Request) {
  try {
    const { user, isPlatformAdmin } = await requireCurrentUser();
    const entitlements = await getCurrentEntitlements({ isPlatformAdmin });
    const limit = toolboxSlotLimit(entitlements.plan, isPlatformAdmin);
    if (limit <= 0) {
      return NextResponse.json({ ok: false, locked: true, error: LOCKED_MESSAGE }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as {
      threadId?: unknown;
      confirmed?: unknown;
    } | null;
    const threadId = typeof body?.threadId === "string" ? body.threadId.trim() : "";
    if (!threadId) {
      return NextResponse.json({ ok: false, error: "THREAD_ID_REQUIRED" }, { status: 400 });
    }

    // "latest" = the open conversation. Autosave writes the active chat every
    // 1.5s, so the most recently updated thread IS what the user is looking at;
    // resolving it here avoids coupling the Toolbox panel to ChatWidget's
    // internal thread ref purely to pass an id back down.
    let resolvedThreadId = threadId;
    if (threadId === "latest") {
      const latest = await prisma.chatThread.findFirst({
        where: { ownerUserId: user.id },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      });
      if (!latest) {
        return NextResponse.json({ ok: false, error: "NO_CHAT_TO_SAVE" }, { status: 404 });
      }
      resolvedThreadId = latest.id;
    }

    const result = await saveToToolbox({
      ownerUserId: user.id,
      threadId: resolvedThreadId,
      limit,
      confirmed: body?.confirmed === true,
    });

    if (result.status === "locked") {
      return NextResponse.json({ ok: false, locked: true, error: LOCKED_MESSAGE }, { status: 403 });
    }
    if (result.status === "not_found") {
      return NextResponse.json({ ok: false, error: "THREAD_NOT_FOUND" }, { status: 404 });
    }
    if (result.status === "needs_confirmation") {
      return NextResponse.json(
        {
          ok: false,
          needsConfirmation: true,
          evicts: result.evicts,
          limit,
          error: "TOOLBOX_FULL",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      {
        ok: true,
        entry: result.status === "saved" ? result.entry : result.entry,
        evicted: result.status === "saved" ? result.evicted : null,
        alreadySaved: result.status === "already_saved",
        limit,
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[toolbox] save failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false, error: "TOOLBOX_SAVE_FAILED" }, { status: 502 });
  }
}
