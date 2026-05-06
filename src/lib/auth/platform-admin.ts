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

export function getPlatformAdminEntitlementSource() {
  return {
    envKey: PLATFORM_ADMIN_ENV_KEY,
    configuredAdminCount: getPlatformAdminEmails().size,
  };
}

export function getDefaultPlatformAdminEmail() {
  return [...getPlatformAdminEmails()][0] ?? "";
}

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    console.info("[platform-admin] entitlement source resolved", {
      ...getPlatformAdminEntitlementSource(),
      matched: false,
      email: null,
    });
    return false;
  }

  const matched = getPlatformAdminEmails().has(normalized);
  console.info("[platform-admin] entitlement source resolved", {
    ...getPlatformAdminEntitlementSource(),
    matched,
    email: maskEmail(normalized),
  });

  return matched;
}

export function maskEmail(email: string | null | undefined): string | null {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const [localPart, domain] = normalized.split("@");
  if (!domain) return "***";

  const visibleLocal =
    localPart.length <= 2 ? `${localPart[0] ?? "*"}*` : `${localPart.slice(0, 2)}***`;

  return `${visibleLocal}@${domain}`;
}
