import { NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";

/**
 * Gate for operator-only API routes (Drive ingest, RAG re-indexing, debug
 * probes): null when the caller is a signed-in platform admin, otherwise the
 * 401/403 response to return. These routes spend model, embedding and Drive
 * quota, so they are never open to anonymous or ordinary signed-in callers.
 */
export async function requirePlatformAdminResponse(): Promise<NextResponse | null> {
  try {
    const { isPlatformAdmin } = await requireCurrentUser();
    if (isPlatformAdmin) return null;
    return NextResponse.json({ error: "Platform admin access is required." }, { status: 403 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
