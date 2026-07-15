/**
 * Collision Learning Engine — pure invalidation rules (no server imports).
 * sourceInvalidation.ts applies them against the database.
 */

/** Which items does a fingerprint change invalidate? */
export function shouldInvalidate(
  item: { sourceFingerprint: string },
  changedFingerprint: string
): boolean {
  return item.sourceFingerprint === changedFingerprint;
}
