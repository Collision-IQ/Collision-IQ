import { NextRequest, NextResponse } from "next/server";

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

// Reserved for upcoming event-type-specific job routing.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    console.info("[external-doc-webhook] ignored legacy provider events", {
      count: events.length,
      source: "legacy_egnyte",
    });

    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "legacy_provider_disabled",
      received: events.length,
      jobsCreated: 0,
    });
  } catch (error) {
    console.error("Legacy external-doc webhook error:", error);

    return NextResponse.json(
      { ok: false, error: "Invalid webhook payload" },
      { status: 400 }
    );
  }
}
