import { NextResponse } from "next/server";
import { getCurrentEntitlements } from "@/lib/billing/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const entitlements = await getCurrentEntitlements();
  return NextResponse.json(entitlements);
}
