"use client";

import { useAuth } from "@clerk/nextjs";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { isNative } from "@/lib/native";

export default function NativeAuthBridge() {
  const pathname = usePathname();
  const router = useRouter();
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();

  useEffect(() => {
    if (!isNative()) return;

    let cancelled = false;

    async function logAuthState() {
      try {
        const token = isLoaded ? await getToken() : null;
        if (cancelled) return;
        console.log("[native-auth] state", {
          href: window.location.href,
          pathname,
          clerkLoaded: isLoaded,
          isSignedIn,
          userId,
          tokenPresent: Boolean(token),
        });
      } catch (error) {
        console.warn("[native-auth] token check failed", {
          href: window.location.href,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    void logAuthState();

    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn, pathname, userId]);

  useEffect(() => {
    if (!isNative()) return;

    let remove: (() => void) | undefined;

    async function initAppUrlOpenListener() {
      const { App } = await import("@capacitor/app");
      const { Browser } = await import("@capacitor/browser");

      const handle = await App.addListener("appUrlOpen", async ({ url }) => {
        console.log("[native-auth] appUrlOpen", {
          url,
          currentHref: window.location.href,
        });

        try {
          await Browser.close();
        } catch {
          // Browser may not be open; this listener also handles verified app links.
        }

        const destination = resolveNativeAuthDestination(url);
        console.log("[native-auth] final redirect destination", {
          url,
          destination,
        });
        router.replace(destination);
      });

      remove = () => {
        handle.remove();
      };
    }

    void initAppUrlOpenListener().catch((error) => {
      console.warn("[native-auth] appUrlOpen listener failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    });

    return () => {
      remove?.();
    };
  }, [router]);

  return null;
}

const DEFAULT_AUTH_DESTINATION = "/";

function resolveNativeAuthDestination(url: string) {
  try {
    const parsed = new URL(url);

    if (parsed.protocol === "com.collisionacademy.collisioniq:") {
      return parsed.searchParams.get("redirect") || DEFAULT_AUTH_DESTINATION;
    }

    if (
      parsed.hostname === "www.collision-iq.ai" ||
      parsed.hostname === "collision-iq.ai"
    ) {
      return `${parsed.pathname || DEFAULT_AUTH_DESTINATION}${parsed.search}${parsed.hash}`;
    }
  } catch (error) {
    console.warn("[native-auth] invalid appUrlOpen url", {
      url,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return DEFAULT_AUTH_DESTINATION;
}
