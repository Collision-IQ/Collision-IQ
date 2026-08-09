import { NextResponse } from "next/server";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import { toolboxSlotLimit } from "@/lib/featureAccess";
import {
  getToolboxThread,
  removeFromToolbox,
} from "@/lib/chatThreads/toolboxStore";

export const runtime = "nodejs";

/**
 * Reopen a saved chat in full — every message plus the documents and photos it
 * carried, so the user resumes where they left off rather than re-uploading.
 * Not gated by the history recency window: a chat occupying a toolbox slot is
 * always openable, or "saved" would mean nothing.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { user, isPlatformAdmin } = await requireCurrentUser();
    const entitlements = await getCurrentEntitlements({ isPlatformAdmin });
    if (toolboxSlotLimit(entitlements.plan, isPlatformAdmin) <= 0) {
      return NextResponse.json(
        { ok: false, error: "The Toolbox is available on Starter, Pro, and Team plans." },
        { status: 403 }
      );
    }
    const thread = await getToolboxThread(user.id, id);
    if (!thread) {
      return NextResponse.json({ ok: false, error: "THREAD_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, thread }, { status: 200 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[toolbox] reopen failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false, error: "TOOLBOX_UNAVAILABLE" }, { status: 502 });
  }
}

/** Free a slot by hand. Removes toolbox membership, not the conversation. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { user } = await requireCurrentUser();
    const removed = await removeFromToolbox(user.id, id);
    if (!removed) {
      return NextResponse.json({ ok: false, error: "THREAD_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[toolbox] remove failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false, error: "TOOLBOX_REMOVE_FAILED" }, { status: 502 });
  }
}
