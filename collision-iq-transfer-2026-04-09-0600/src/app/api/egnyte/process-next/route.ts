import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    ok: true,
    message: "Disabled. Drive is the ingestion source of truth.",
  });
}