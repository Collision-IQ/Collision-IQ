import { normalizeEmail } from "@/lib/auth/platform-admin";

/**
 * Rekey Sheet access while the tool is under construction.
 *
 * The sheet stays live for the accounts listed here and reads "under
 * construction" (nav disabled, API refused) for everyone else. Plain module —
 * no server-only import — so the workspace shell and the API route share the
 * same rule instead of two copies drifting apart.
 */
export const REKEY_SHEET_ALLOWED_EMAILS: ReadonlyArray<string> = ["vinny@collision.academy"];

export const REKEY_UNDER_CONSTRUCTION_MESSAGE =
  "The Rekey Sheet is under construction and will reopen when the estimator-facing release is ready.";

export function canAccessRekeySheet(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return REKEY_SHEET_ALLOWED_EMAILS.some((allowed) => normalizeEmail(allowed) === normalized);
}
