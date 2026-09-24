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

const PRODUCTION_APP_ORIGIN = "https://www.collision-iq.ai";

function isLoopbackUrl(value: string) {
  try {
    const { hostname } = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(hostname);
  } catch {
    return false;
  }
}

/**
 * Public origin used for links that leave the app and come back (Stripe
 * success/cancel URLs). On a deployed Vercel build a loopback value in
 * NEXT_PUBLIC_APP_URL / APP_BASE_URL is ignored: live Stripe sessions were
 * created with success_url http://localhost:3000/..., sending paying
 * customers to a dead page. Locally (no VERCEL_ENV) behavior is unchanged.
 */
export function getAppUrl() {
  const deployed = Boolean(process.env.VERCEL_ENV);
  const configured = [process.env.NEXT_PUBLIC_APP_URL, process.env.APP_BASE_URL]
    .map((value) => value?.trim() || "")
    .filter(Boolean);
  const usable = configured.find((value) => !(deployed && isLoopbackUrl(value)));
  if (deployed && configured.length > 0 && usable !== configured[0]) {
    console.warn("[app-url] ignoring loopback app URL on a deployed build", {
      vercelEnv: process.env.VERCEL_ENV,
    });
  }

  return (
    usable ||
    (process.env.VERCEL_ENV === "production" ? PRODUCTION_APP_ORIGIN : "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "http://localhost:3000"
  );
}
