const PLATFORM_ADMIN_ENV_KEY = "COLLISION_IQ_PLATFORM_ADMIN_EMAILS";
const PLATFORM_ADMIN_ENV_KEYS = [
  PLATFORM_ADMIN_ENV_KEY,
  "PLATFORM_ADMIN_EMAILS",
  "ADMIN_EMAILS",
  "ADMIN_EMAIL",
];
const BUILT_IN_FREE_ACCESS_EMAILS = [
  "vinny@collision.academy",
  "olga@collision.academy",
  "max@conestogacollision.com",
  "anthony@conestogacollision.com",
  "john@johnmcshane.com",
  "hempsteadcollision@gmail.com",
];

export function normalizeEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() || "";
}

export function getPlatformAdminEmails() {
  const envEmails = PLATFORM_ADMIN_ENV_KEYS.flatMap((key) =>
    (process.env[key] ?? "")
      .split(/[,;\n]/)
      .map((value) => normalizeEmail(value))
      .filter(Boolean)
  );

  return new Set([...BUILT_IN_FREE_ACCESS_EMAILS, ...envEmails]);
}

export function getPlatformAdminEntitlementSource() {
  return {
    envKey: PLATFORM_ADMIN_ENV_KEY,
    envKeys: PLATFORM_ADMIN_ENV_KEYS,
    configuredAdminCount: getPlatformAdminEmails().size,
    usesLegacyAdminEnv: PLATFORM_ADMIN_ENV_KEYS.slice(1).some((key) =>
      Boolean(process.env[key]?.trim())
    ),
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

export function isPlatformAdminEmailList(emails: Array<string | null | undefined>): boolean {
  const adminEmails = getPlatformAdminEmails();
  const normalizedEmails = emails.map((email) => normalizeEmail(email)).filter(Boolean);
  const matched = normalizedEmails.some((email) => adminEmails.has(email));

  console.info("[platform-admin] entitlement source resolved", {
    ...getPlatformAdminEntitlementSource(),
    matched,
    emails: normalizedEmails.map((email) => maskEmail(email)),
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
