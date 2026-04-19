import { NextRequest, NextResponse } from "next/server";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";
import { getUsageCount } from "@/lib/usage";
import { getAssignment } from "@/lib/assignmentStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { user, isPlatformAdmin } = await requireCurrentUser();
    const entitlements = await getCurrentEntitlements();

    if (!isPlatformAdmin && !entitlements.canUpload) {
      return NextResponse.json(
        { error: "UPLOAD_NOT_INCLUDED_IN_PLAN" },
        { status: 403 }
      );
    }

    if (!isPlatformAdmin && entitlements.uploadCap !== null) {
      const uploadsUsed = await getUsageCount(user.id, "FILE_UPLOAD");

      if (uploadsUsed >= entitlements.uploadCap) {
        return NextResponse.json(
          { error: "UPLOAD_LIMIT_REACHED" },
          { status: 403 }
        );
      }
    }

    const url = new URL(req.url);
    const parts = url.pathname.split("/");
    const assignmentId = parts[parts.indexOf("assignments") + 1];

    if (!assignmentId) {
      return NextResponse.json(
        { error: "Missing assignmentId" },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 }
      );
    }

    const assignment = getAssignment(assignmentId);
    if (!assignment) {
      return NextResponse.json(
        { error: "Unknown assignmentId" },
        { status: 404 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as { message?: unknown };
    const userText = String(body?.message ?? "").trim();

    if (!userText) {
      return NextResponse.json(
        { error: "Missing message" },
        { status: 400 }
      );
    }

    // Upload or assistant logic can go here...

    return NextResponse.json({ success: true }, { status: 200 });

  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Server error",
      },
      { status: 500 }
    );
  }
}
