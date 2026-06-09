import { NextRequest, NextResponse } from "next/server";
import {
  listCccSecureSharePreviewEvents,
  requireCccSecureSharePreviewAdminAccess,
  UnauthorizedError,
} from "@/lib/ccc/secureSharePreview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const access = await requireCccSecureSharePreviewAdminAccess();
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "25");
    const events = await listCccSecureSharePreviewEvents({
      limit: Number.isFinite(limit) ? limit : 25,
    });

    return NextResponse.json(
      { ok: true, events },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[admin-ccc-secure-share-events] failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "CCC Secure Share events failed." }, { status: 500 });
  }
}
