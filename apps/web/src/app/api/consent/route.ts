import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDbUser } from "@/lib/entitlements";

export const runtime = "nodejs";

type ConsentRequestBody = {
  consentStatus?: "accepted";
  acceptedAt?: string;
  termsVersion?: string;
  privacyVersion?: string;
  checkboxChecked?: boolean;
};

export async function POST(req: Request) {
  const dbUser = await ensureDbUser();
  if (!dbUser) {
    return NextResponse.json({ ok: true, persisted: false });
  }

  const body = (await req.json()) as ConsentRequestBody;
  if (
    body.consentStatus !== "accepted" ||
    !body.acceptedAt ||
    !body.termsVersion ||
    !body.privacyVersion ||
    body.checkboxChecked !== true
  ) {
    return NextResponse.json({ error: "Invalid consent payload" }, { status: 400 });
  }

  const forwardedFor =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const userAgent = req.headers.get("user-agent");

  await prisma.chatConsent.create({
    data: {
      userId: dbUser.id,
      status: "ACCEPTED",
      acceptedAt: new Date(body.acceptedAt),
      termsVersion: body.termsVersion,
      privacyVersion: body.privacyVersion,
      checkboxChecked: true,
      ipAddress: forwardedFor,
      userAgent,
    },
  });

  return NextResponse.json({ ok: true, persisted: true });
}
