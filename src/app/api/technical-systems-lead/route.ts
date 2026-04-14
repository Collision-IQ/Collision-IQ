import { NextResponse } from "next/server";

type TechnicalSystemsLeadRequest = {
  name?: string;
  business?: string;
  email?: string;
  phone?: string;
  shopSize?: string;
  currentWorkflow?: string;
  goals?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as TechnicalSystemsLeadRequest;

    if (!body.name?.trim() || !body.business?.trim() || !body.email?.trim() || !body.goals?.trim()) {
      return new NextResponse("Missing required lead fields.", { status: 400 });
    }

    console.info("[technical-systems-lead] submitted", {
      name: body.name.trim(),
      business: body.business.trim(),
      email: body.email.trim(),
      phone: body.phone?.trim() || null,
      shopSize: body.shopSize?.trim() || null,
      currentWorkflow: body.currentWorkflow?.trim() || null,
      goals: body.goals.trim(),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to submit lead request.";

    return new NextResponse(message, { status: 500 });
  }
}
