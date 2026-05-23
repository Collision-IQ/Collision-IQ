import { NextResponse } from "next/server";
import type { SafeCrmEventPayload } from "@/lib/crm/events";
import { emitSafeCrmEvent } from "@/lib/crm/serverEvents";

export async function POST(request: Request) {
  let payload: SafeCrmEventPayload;

  try {
    payload = (await request.json()) as SafeCrmEventPayload;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  await emitSafeCrmEvent({ ...payload, source: "server" });
  return NextResponse.json({ ok: true });
}
