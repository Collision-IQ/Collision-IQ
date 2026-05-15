import { NextResponse } from "next/server";
import { getCurrentViewerAccess } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const access = await getCurrentViewerAccess();
  return NextResponse.json(access);
}
