import { NextResponse } from "next/server";
import { buildEnterpriseAuditDashboard } from "@/lib/admin/enterpriseAuditDashboard";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { isPlatformAdmin } = await requireCurrentUser();
    if (!isPlatformAdmin) {
      return NextResponse.json({ error: "Platform admin access is required." }, { status: 403 });
    }

    const payload = await buildEnterpriseAuditDashboard();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[enterprise-audit] failed", {
      message: error instanceof Error ? error.message : "Unknown enterprise audit error",
    });
    return NextResponse.json({ error: "Enterprise audit dashboard failed." }, { status: 500 });
  }
}
