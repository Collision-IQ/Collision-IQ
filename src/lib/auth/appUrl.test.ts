import { afterEach, describe, expect, it, vi } from "vitest";
import { getAppUrl } from "./config";

function env(values: Record<string, string | undefined>) {
  for (const key of ["NEXT_PUBLIC_APP_URL", "APP_BASE_URL", "VERCEL_ENV", "VERCEL_URL"]) {
    vi.stubEnv(key, values[key] ?? "");
  }
}

describe("getAppUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("never returns localhost on a production deployment (live Stripe success_url regression)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    env({ NEXT_PUBLIC_APP_URL: "http://localhost:3000", VERCEL_ENV: "production", VERCEL_URL: "x.vercel.app" });
    expect(getAppUrl()).toBe("https://www.collision-iq.ai");
  });

  it("falls through a loopback NEXT_PUBLIC_APP_URL to a real APP_BASE_URL", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    env({ NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000", APP_BASE_URL: "https://www.collision-iq.ai", VERCEL_ENV: "production" });
    expect(getAppUrl()).toBe("https://www.collision-iq.ai");
  });

  it("uses the preview deployment URL on a preview build with a loopback setting", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    env({ NEXT_PUBLIC_APP_URL: "http://localhost:3000", VERCEL_ENV: "preview", VERCEL_URL: "pr-50.vercel.app" });
    expect(getAppUrl()).toBe("https://pr-50.vercel.app");
  });

  it("keeps a correctly configured URL and local development unchanged", () => {
    env({ NEXT_PUBLIC_APP_URL: "https://www.collision-iq.ai", VERCEL_ENV: "production" });
    expect(getAppUrl()).toBe("https://www.collision-iq.ai");
    env({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" });
    expect(getAppUrl()).toBe("http://localhost:3000");
    env({});
    expect(getAppUrl()).toBe("http://localhost:3000");
  });
});
