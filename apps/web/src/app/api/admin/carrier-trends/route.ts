import { NextRequest, NextResponse } from "next/server";
import { getCarrierTrendAnalytics } from "@/lib/analytics/carrierTrends";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { isPlatformAdmin } = await requireCurrentUser();
    if (!isPlatformAdmin) {
      return NextResponse.json({ error: "Platform admin access is required." }, { status: 403 });
    }

    const windowDays = Number(request.nextUrl.searchParams.get("windowDays") ?? "90");
    const payload = await getCarrierTrendAnalytics(Number.isFinite(windowDays) ? windowDays : 90);

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[carrier-trends] failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Carrier trend analytics failed." }, { status: 500 });
  }
}
