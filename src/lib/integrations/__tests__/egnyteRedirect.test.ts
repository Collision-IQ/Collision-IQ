/**
 * ONE STABLE REDIRECT URI, NEVER A PER-DEPLOYMENT ONE.
 *
 * The redirect_uri must be byte-identical in the authorize request and in
 * every token exchange, and must match what is registered with Egnyte. It was
 * previously a literal repeated in three routes plus the app manifest — four
 * copies that must never diverge — all naming a BRANCH-PREVIEW deployment of a
 * different Vercel project. Preview hosts are ephemeral and can sit behind
 * deployment protection, so the flow rested on a URL that could disappear
 * without anything in this repository changing.
 *
 * The regression these tests exist to prevent is subtler than a wrong string:
 * resolving the origin from VERCEL_URL (as the general getAppUrl helper does)
 * would mint a DIFFERENT, unregistered URI on every deployment. That fails
 * only at the provider, long after the build is green.
 */
import { describe, it, expect, afterEach } from "vitest";
import { getEgnyteRedirectUri } from "../egnyteRedirect";

const ENV_KEYS = ["NEXT_PUBLIC_APP_URL", "APP_BASE_URL", "VERCEL_URL"] as const;
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = process.env[key];

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("the Egnyte redirect URI is stable and registrable", () => {
  it("defaults to the production origin, not a deployment URL", () => {
    for (const key of ENV_KEYS) delete process.env[key];
    expect(getEgnyteRedirectUri()).toBe(
      "https://www.collision-iq.ai/oauth/egnyte/callback"
    );
  });

  it("IGNORES VERCEL_URL — the whole point", () => {
    for (const key of ENV_KEYS) delete process.env[key];
    // A per-deployment host would produce an unregistered URI that fails only
    // at the provider, which is exactly the defect being removed.
    process.env.VERCEL_URL = "collision-iq-abc123-collision-academy.vercel.app";
    expect(getEgnyteRedirectUri()).toBe(
      "https://www.collision-iq.ai/oauth/egnyte/callback"
    );
  });

  it("honours an explicit origin, so a registered override still works", () => {
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.collision-iq.ai";
    expect(getEgnyteRedirectUri()).toBe(
      "https://staging.collision-iq.ai/oauth/egnyte/callback"
    );
  });

  it("tolerates a trailing slash rather than emitting a double slash", () => {
    // "//oauth/..." is a different string to the provider, so it would not match.
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.APP_BASE_URL = "https://www.collision-iq.ai/";
    expect(getEgnyteRedirectUri()).toBe(
      "https://www.collision-iq.ai/oauth/egnyte/callback"
    );
  });

  it("never names the retired preview project", () => {
    for (const key of ENV_KEYS) delete process.env[key];
    expect(getEgnyteRedirectUri()).not.toMatch(/collision-academy-new/);
  });
});
