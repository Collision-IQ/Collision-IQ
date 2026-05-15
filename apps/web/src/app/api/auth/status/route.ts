import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { hasClerkConfig } from "@/lib/auth/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasClerkConfig()) {
    return NextResponse.json({
      ok: false,
      configured: false,
      authenticated: false,
      reason: "Clerk server config is missing.",
    });
  }

  const state = await auth();

  return NextResponse.json({
    ok: true,
    configured: true,
    authenticated: Boolean(state.userId),
    userId: state.userId ?? null,
    orgId: state.orgId ?? null,
    host: process.env.VERCEL_URL ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
  });
}
