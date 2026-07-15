import "server-only";
import { prisma } from "@/lib/prisma";
import { computeSourceFingerprint, type LearningSourceRef } from "./sourceAuthority";

/**
 * Collision Learning Engine — source-version invalidation.
 *
 * When an authoritative source changes (new OEM procedure revision, updated
 * position statement, new MOTOR database version), every learning item built
 * on the old fingerprint is stale:
 *   1. Linked mastery is marked INVALIDATED.
 *   2. The item is requeued (due now) with its repetition ladder reset.
 *   3. Prior attempts are PRESERVED for audit history.
 *   4. The previous source reference is kept on the item's attempt history —
 *      nothing is silently overwritten; the new refs are recorded alongside a
 *      ledger entry.
 *   5. The item must pass re-verification (VERIFIED) before it can ever be
 *      promoted again.
 */

export { shouldInvalidate } from "./invalidationRules";

export async function applySourceFingerprintChange(params: {
  previousFingerprint: string;
  updatedRefs: LearningSourceRef[];
  reason?: string;
}): Promise<{ invalidatedItemIds: string[]; newFingerprint: string }> {
  const newFingerprint = computeSourceFingerprint(params.updatedRefs);
  if (newFingerprint === params.previousFingerprint) {
    return { invalidatedItemIds: [], newFingerprint };
  }

  const affected = await prisma.collisionLearningItem.findMany({
    where: { sourceFingerprint: params.previousFingerprint },
    select: { id: true, domain: true, sourceRefs: true },
  });

  const now = new Date();
  for (const item of affected) {
    await prisma.$transaction([
      prisma.collisionLearningItem.update({
        where: { id: item.id },
        data: {
          status: "INVALIDATED",
          // Requeue immediately; mastery ladder restarts after re-verification.
          dueAt: now,
          intervalDays: 0,
          repetitions: 0,
          sourceRefs: {
            // Keep the superseded refs visible instead of silently replacing.
            current: params.updatedRefs,
            superseded: item.sourceRefs,
            supersededFingerprint: params.previousFingerprint,
            supersededAt: now.toISOString(),
          } as object,
          sourceFingerprint: newFingerprint,
        },
      }),
      prisma.collisionLearningError.create({
        data: {
          itemId: item.id,
          domain: item.domain,
          errorCode: "SOURCE_VERSION_INVALIDATED",
          severity: "high",
          description:
            params.reason ??
            `Source fingerprint changed (${params.previousFingerprint.slice(0, 12)} → ${newFingerprint.slice(0, 12)}); mastery invalidated pending re-verification.`,
        },
      }),
    ]);
  }

  return { invalidatedItemIds: affected.map((item) => item.id), newFingerprint };
}
