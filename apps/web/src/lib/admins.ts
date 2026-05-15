import { isPlatformAdminEmail } from "@/lib/auth/platform-admin";

/**
 * @deprecated Use "@/lib/auth/platform-admin" directly. This compatibility shim
 * keeps older call sites on the env-backed platform admin allow-list.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  return isPlatformAdminEmail(email);
}
