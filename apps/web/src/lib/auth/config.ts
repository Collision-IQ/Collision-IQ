function readRequiredEnv(name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" | "CLERK_SECRET_KEY") {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing ${name}`);
  }

  return value;
}

export function assertClerkConfig() {
  return {
    publishableKey: readRequiredEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"),
    secretKey: readRequiredEnv("CLERK_SECRET_KEY"),
  };
}

export function hasClerkPublishableKey() {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim());
}

export function hasClerkServerConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() &&
      process.env.CLERK_SECRET_KEY?.trim()
  );
}

export function hasClerkConfig() {
  return hasClerkServerConfig();
}

export function getClerkKeyDiagnostics() {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() || "";
  const sk = process.env.CLERK_SECRET_KEY?.trim() || "";

  return {
    hasPublishableKey: Boolean(pk),
    hasSecretKey: Boolean(sk),
    publishableKeyType: pk.startsWith("pk_live_")
      ? "live"
      : pk.startsWith("pk_test_")
        ? "test"
        : "unknown",
    secretKeyType: sk.startsWith("sk_live_")
      ? "live"
      : sk.startsWith("sk_test_")
        ? "test"
        : "unknown",
    keysLookMatched:
      (pk.startsWith("pk_live_") && sk.startsWith("sk_live_")) ||
      (pk.startsWith("pk_test_") && sk.startsWith("sk_test_")),
  };
}

export function hasStripeConfig() {
  return Boolean(
    process.env.STRIPE_SECRET_KEY?.trim() &&
      process.env.NEXT_PUBLIC_APP_URL?.trim()
  );
}

export function getAppUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_BASE_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "http://localhost:3000"
  );
}
