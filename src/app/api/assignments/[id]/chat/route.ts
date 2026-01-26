import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json(
      { error: "Missing assignment id" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    assignmentId: id,
  });
}
