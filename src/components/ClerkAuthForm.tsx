"use client";

import { SignIn, SignUp, useAuth, useUser } from "@clerk/nextjs";
import { useEffect } from "react";
import { isNative } from "@/lib/native";

const AUTH_REDIRECT_PATH = "/chatbot";

type Props = {
  mode: "sign-in" | "sign-up";
};

export default function ClerkAuthForm({ mode }: Props) {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  const { user } = useUser();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const native = isNative();
      console.log("[auth] page loaded", {
        href: window.location.href,
        mode,
        isNative: native,
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [mode]);

  useEffect(() => {
    if (!isLoaded) {
      console.log("[auth] clerk loading", {
        href: window.location.href,
        mode,
      });
      return;
    }

    void getToken()
      .then((token) => {
        console.log("[auth] clerk state", {
          href: window.location.href,
          mode,
          isLoaded,
          isSignedIn,
          userId,
          userPrimaryEmail: user?.primaryEmailAddress?.emailAddress ?? null,
          tokenPresent: Boolean(token),
        });
      })
      .catch((error) => {
        console.warn("[auth] token read failed", {
          mode,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }, [getToken, isLoaded, isSignedIn, mode, user, userId]);

  const redirectProps = {
    fallbackRedirectUrl: AUTH_REDIRECT_PATH,
    forceRedirectUrl: AUTH_REDIRECT_PATH,
    oauthFlow: "popup" as const,
  };

  return mode === "sign-in" ? (
    <SignIn {...redirectProps} signUpFallbackRedirectUrl={AUTH_REDIRECT_PATH} />
  ) : (
    <SignUp {...redirectProps} signInFallbackRedirectUrl={AUTH_REDIRECT_PATH} />
  );
}
