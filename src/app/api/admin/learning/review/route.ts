import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { prisma } from "@/lib/prisma";
import { computeSourceFingerprint, validateSourceRefs, type LearningSourceRef } from "@/lib/learning/sourceAuthority";
import { isKnownDomain } from "@/lib/learning/collisionTaxonomy";
import { applySourceFingerprintChange } from "@/lib/learning/sourceInvalidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Platform-Admin-only review surface:
 *  GET  — list recent attempts + items pending review (?itemId= to filter).
 *  POST — item lifecycle actions performed by a human admin:
 *         create (DRAFT), verify (DRAFT/INVALIDATED → VERIFIED), retire,
 *         and source-refresh (fingerprint invalidation).
 *
 * Attempt payloads returned here include gold answers ONLY to the reviewing
 * admin — never back into a generation prompt.
 */
export async function GET(request: NextRequest) {
  try {
    const { isPlatformAdmin } = await requireCurrentUser();
    if (!isPlatformAdmin) {
      return NextResponse.json({ error: "Platform admin access is required." }, { status: 403 });
    }
    const itemId = request.nextUrl.searchParams.get("itemId")?.trim() || undefined;
    const [attempts, pendingItems, errors] = await Promise.all([
      prisma.collisionLearningAttempt.findMany({
        where: itemId ? { itemId } : undefined,
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { item: { select: { slug: true, domain: true, safetyCritical: true, status: true } } },
      }),
      prisma.collisionLearningItem.findMany({
        where: { status: { in: ["DRAFT", "INVALIDATED"] } },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }),
      prisma.collisionLearningError.findMany({
        where: { resolvedAt: null },
        orderBy: { lastSeenAt: "desc" },
        take: 50,
      }),
    ]);
    return NextResponse.json(
      { attempts, pendingItems, errors },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[learning-review] failed", { message: error instanceof Error ? error.message : "Unknown" });
    return NextResponse.json({ error: "Learning review failed." }, { status: 500 });
  }
}

type ReviewAction =
  | { action: "create"; item: Record<string, unknown> }
  | { action: "verify"; itemId: string }
  | { action: "retire"; itemId: string }
  | { action: "resolve-error"; errorId: string }
  | { action: "source-refresh"; previousFingerprint: string; updatedRefs: LearningSourceRef[]; reason?: string };

export async function POST(request: NextRequest) {
  try {
    const { isPlatformAdmin } = await requireCurrentUser();
    if (!isPlatformAdmin) {
      return NextResponse.json({ error: "Platform admin access is required." }, { status: 403 });
    }
    const body = (await request.json().catch(() => null)) as ReviewAction | null;
    if (!body || typeof body !== "object" || !("action" in body)) {
      return NextResponse.json({ error: "An action is required." }, { status: 400 });
    }

    if (body.action === "create") {
      const item = body.item ?? {};
      const domain = String(item.domain ?? "");
      if (!isKnownDomain(domain)) {
        return NextResponse.json({ error: `Unknown taxonomy domain: ${domain}` }, { status: 400 });
      }
      const sourceRefs = (item.sourceRefs ?? []) as LearningSourceRef[];
      const refCheck = validateSourceRefs(sourceRefs);
      if (!refCheck.valid) {
        return NextResponse.json({ error: refCheck.reasons.join(" ") }, { status: 400 });
      }
      const created = await prisma.collisionLearningItem.create({
        data: {
          slug: String(item.slug ?? "").trim(),
          domain,
          subdomain: item.subdomain ? String(item.subdomain) : null,
          objective: String(item.objective ?? ""),
          skillTags: Array.isArray(item.skillTags) ? item.skillTags.map(String) : [],
          prompt: String(item.prompt ?? ""),
          goldAnswer: (item.goldAnswer ?? { keyPoints: [] }) as object,
          sourceRefs: sourceRefs as unknown as object,
          sourceFingerprint: computeSourceFingerprint(sourceRefs),
          authorityTier: Number(item.authorityTier ?? 8),
          oem: item.oem ? String(item.oem) : null,
          jurisdiction: item.jurisdiction ? String(item.jurisdiction) : null,
          vehicleScope: (item.vehicleScope as object | undefined) ?? undefined,
          safetyCritical: Boolean(item.safetyCritical),
          holdout: Boolean(item.holdout),
          status: "DRAFT",
        },
      });
      return NextResponse.json({ created: created.id });
    }

    if (body.action === "verify" || body.action === "retire") {
      const updated = await prisma.collisionLearningItem.update({
        where: { id: body.itemId },
        data: { status: body.action === "verify" ? "VERIFIED" : "RETIRED" },
      });
      return NextResponse.json({ itemId: updated.id, status: updated.status });
    }

    if (body.action === "resolve-error") {
      await prisma.collisionLearningError.update({
        where: { id: body.errorId },
        data: { resolvedAt: new Date() },
      });
      return NextResponse.json({ resolved: body.errorId });
    }

    if (body.action === "source-refresh") {
      const refCheck = validateSourceRefs(body.updatedRefs ?? []);
      if (!refCheck.valid) {
        return NextResponse.json({ error: refCheck.reasons.join(" ") }, { status: 400 });
      }
      const result = await applySourceFingerprintChange({
        previousFingerprint: body.previousFingerprint,
        updatedRefs: body.updatedRefs,
        reason: body.reason,
      });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[learning-review] failed", { message: error instanceof Error ? error.message : "Unknown" });
    return NextResponse.json({ error: "Learning review action failed." }, { status: 500 });
  }
}
