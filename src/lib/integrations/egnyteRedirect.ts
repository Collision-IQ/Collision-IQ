/**
 * THE EGNYTE OAUTH REDIRECT URI, IN ONE PLACE.
 *
 * OAuth requires the redirect_uri to be byte-identical in the authorize
 * request and in every token exchange, and to match what is registered with
 * the provider. It was previously written out as a literal in three routes
 * plus the app manifest — four copies of a value that must never diverge, all
 * pointing at a BRANCH-PREVIEW deployment of a different Vercel project:
 *
 *   https://collision-academy-new-git-cha-bfa414-…vercel.app/oauth/egnyte/callback
 *
 * That host was ephemeral by construction. Preview deployments are subject to
 * retention and can sit behind deployment protection, so the flow depended on
 * a URL that could vanish or start refusing the callback without anything in
 * this repository changing.
 *
 * DELIBERATELY NOT getAppUrl(). That helper falls back to VERCEL_URL, which is
 * per-deployment — exactly the kind of unregistered, changing URI this module
 * exists to eliminate. A redirect URI must be ONE stable registered value, so
 * the fallback here is the production origin, mirroring the same decision in
 * capacitor.config.ts. Override with NEXT_PUBLIC_APP_URL or APP_BASE_URL only
 * when the overriding origin is also registered with Egnyte.
 */
const PRODUCTION_ORIGIN = "https://www.collision-iq.ai";

export function getEgnyteRedirectUri(): string {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_BASE_URL?.trim();
  const origin = (configured || PRODUCTION_ORIGIN).replace(/\/+$/, "");
  return `${origin}/oauth/egnyte/callback`;
}
