import { NextResponse } from "next/server";
import { buildIntegrationsHealth } from "@/lib/admin/integrationsHealth";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { isPlatformAdmin } = await requireCurrentUser();
    if (!isPlatformAdmin) {
      return NextResponse.json({ error: "Platform admin access is required." }, { status: 403 });
    }

    const payload = await buildIntegrationsHealth();
    return NextResponse.json(payload, {
      status: payload.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[integrations-health] failed", {
      message: error instanceof Error ? error.message : "Unknown integrations health error",
    });
    return NextResponse.json({ error: "Integrations health check failed." }, { status: 500 });
  }
}
