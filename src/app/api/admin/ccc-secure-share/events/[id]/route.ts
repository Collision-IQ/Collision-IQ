import { NextResponse } from "next/server";
import {
  getCccSecureSharePreviewEvent,
  requireCccSecureSharePreviewAdminAccess,
  UnauthorizedError,
} from "@/lib/ccc/secureSharePreview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const access = await requireCccSecureSharePreviewAdminAccess();
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await context.params;
    const event = await getCccSecureSharePreviewEvent(id);
    if (!event) {
      return NextResponse.json({ error: "CCC Secure Share event not found." }, { status: 404 });
    }

    return NextResponse.json(
      { ok: true, event },
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

    console.error("[admin-ccc-secure-share-event-detail] failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "CCC Secure Share event detail failed." }, { status: 500 });
  }
}
