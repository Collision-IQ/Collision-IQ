import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ALLOWED_STATUSES = [
  "PENDING_INTAKE",
  "IN_REVIEW",
  "IN_PROGRESS",
  "AWAITING_INFO",
  "COMPLETE",
  "CANCELLED",
] as const;

function isValidStatus(value: unknown): value is (typeof ALLOWED_STATUSES)[number] {
  return typeof value === "string" && ALLOWED_STATUSES.includes(value as (typeof ALLOWED_STATUSES)[number]);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const body = await req.json().catch(() => null);
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Missing case id" }, { status: 400 });
  }

  if (!body || !isValidStatus(body.status)) {
    return NextResponse.json(
      { error: "Invalid status" },
      { status: 400 }
    );
  }

  try {
    const updated = await prisma.academyServiceCase.update({
      where: { id },
      data: {
        status: body.status,
        lastUpdate: typeof body.lastUpdate === "string" ? body.lastUpdate : null,
        intakeNotes: typeof body.intakeNotes === "string" ? body.intakeNotes : null,
        internalNotes: typeof body.internalNotes === "string" ? body.internalNotes : null,
      },
    });

    return NextResponse.json({ case: updated });
  } catch {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }
}
