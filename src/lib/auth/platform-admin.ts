const PLATFORM_ADMIN_ENV_KEY = "COLLISION_IQ_PLATFORM_ADMIN_EMAILS";

export function normalizeEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() || "";
}

export function getPlatformAdminEmails() {
  const raw = process.env[PLATFORM_ADMIN_ENV_KEY] ?? "";
  return new Set(
    raw
      .split(",")
      .map((value) => normalizeEmail(value))
      .filter(Boolean)
  );
}

export function getDefaultPlatformAdminEmail() {
  return [...getPlatformAdminEmails()][0] ?? "";
}

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return false;
  }

  return getPlatformAdminEmails().has(normalized);
}
