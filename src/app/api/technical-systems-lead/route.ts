import { NextResponse } from "next/server";
import { sendMail } from "@/lib/google/sendMail";

type TechnicalSystemsLeadRequest = {
  name?: string;
  business?: string;
  email?: string;
  phone?: string;
  shopSize?: string;
  currentWorkflow?: string;
  goals?: string;
};

const LEAD_DESTINATION = "ai-sync@collision.academy";

function normalizeLead(body: TechnicalSystemsLeadRequest) {
  return {
    name: body.name?.trim() || "",
    business: body.business?.trim() || "",
    email: body.email?.trim() || "",
    phone: body.phone?.trim() || "",
    shopSize: body.shopSize?.trim() || "",
    currentWorkflow: body.currentWorkflow?.trim() || "",
    goals: body.goals?.trim() || "",
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as TechnicalSystemsLeadRequest;
    const lead = normalizeLead(body);

    if (!lead.name || !lead.business || !lead.email || !lead.goals) {
      return NextResponse.json(
        { ok: false, error: "Missing required lead fields." },
        { status: 400 }
      );
    }

    const submittedAt = new Date().toISOString();
    const text = [
      "New Technical Systems lead submission",
      "",
      `Submitted: ${submittedAt}`,
      `Name: ${lead.name}`,
      `Business: ${lead.business}`,
      `Email: ${lead.email}`,
      `Phone: ${lead.phone || "Not provided"}`,
      `Shop size: ${lead.shopSize || "Not provided"}`,
      `Current workflow pain point: ${lead.currentWorkflow || "Not provided"}`,
      "",
      "Goals",
      lead.goals,
    ].join("\n");

    await sendMail({
      to: LEAD_DESTINATION,
      subject: `Technical Systems lead: ${lead.business}`,
      text,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
          <h2 style="margin-bottom:16px;">New Technical Systems lead submission</h2>
          <p><strong>Submitted:</strong> ${submittedAt}</p>
          <p><strong>Name:</strong> ${escapeHtml(lead.name)}</p>
          <p><strong>Business:</strong> ${escapeHtml(lead.business)}</p>
          <p><strong>Email:</strong> ${escapeHtml(lead.email)}</p>
          <p><strong>Phone:</strong> ${escapeHtml(lead.phone || "Not provided")}</p>
          <p><strong>Shop size:</strong> ${escapeHtml(
            lead.shopSize || "Not provided"
          )}</p>
          <p><strong>Current workflow pain point:</strong> ${escapeHtml(
            lead.currentWorkflow || "Not provided"
          )}</p>
          <h3 style="margin:24px 0 8px;">Goals</h3>
          <p style="white-space:pre-wrap;">${escapeHtml(lead.goals)}</p>
        </div>
      `,
    });

    return NextResponse.json({ ok: true, deliveredTo: LEAD_DESTINATION });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to submit lead request.";

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
