import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type EgnyteWebhookEvent = {
  eventType?: string;
  path?: string;
  fileId?: string;
  modifiedTime?: string;
  [key: string]: unknown;
};

function normalizeEgnyteEvents(body: unknown): EgnyteWebhookEvent[] {
  if (!body || typeof body !== "object") return [];

  const value = body as Record<string, unknown>;

  if (Array.isArray(value.events)) {
    return value.events.filter(
      (item): item is EgnyteWebhookEvent =>
        !!item && typeof item === "object"
    );
  }

  return [value as EgnyteWebhookEvent];
}

function getNormalizedEventType(event: EgnyteWebhookEvent): string {
  const raw = String(event.eventType ?? "unknown").toLowerCase();

  if (raw.includes("delete")) return "deleted";
  if (raw.includes("remove")) return "deleted";
  if (raw.includes("upload")) return "updated";
  if (raw.includes("create")) return "created";
  if (raw.includes("update")) return "updated";
  if (raw.includes("modify")) return "updated";

  return "unknown";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const events = normalizeEgnyteEvents(body);

    if (events.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No events found" },
        { status: 400 }
      );
    }

    const jobs = await prisma.$transaction(
      events.map((event) =>
        prisma.syncJob.create({
          data: {
            type: "WEBHOOK",
            status: "pending",
            egnytePath: typeof event.path === "string" ? event.path : null
          }
        })
      )
    );

    return NextResponse.json({
      ok: true,
      received: events.length,
      jobsCreated: jobs.length,
      jobIds: jobs.map((j) => j.id),
    });
  } catch (error) {
    console.error("Egnyte webhook error:", error);

    return NextResponse.json(
      { ok: false, error: "Invalid webhook payload" },
      { status: 400 }
    );
  }
}