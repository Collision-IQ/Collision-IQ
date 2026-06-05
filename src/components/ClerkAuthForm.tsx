"use client";

import { SignIn, SignUp, useAuth, useSignIn, useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { isNative } from "@/lib/native";

const AUTH_REDIRECT_PATH = "/chatbot";
const GOOGLE_SSO_CALLBACK_PATH = "/sign-in/sso-callback";

type Props = {
  mode: "sign-in" | "sign-up";
};

export default function ClerkAuthForm({ mode }: Props) {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  const { signIn } = useSignIn();
  const { user } = useUser();
  const [isNativeClient, setIsNativeClient] = useState(false);
  const isSignInLoaded = Boolean(signIn);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const native = isNative();
      setIsNativeClient(native);
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
    if (mode === "sign-in" && isNativeClient) {
      console.warn("[clerk-google-mobile] Use custom Google button on native");
    }
  }, [isNativeClient, mode]);

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
  };

  const handleGoogleSignIn = async () => {
    if (!isSignInLoaded || !signIn) return;

    try {
      await signIn.sso({
        strategy: "oauth_google",
        redirectCallbackUrl: GOOGLE_SSO_CALLBACK_PATH,
        redirectUrl: AUTH_REDIRECT_PATH,
      });
    } catch (err) {
      console.error("[clerk-google-mobile] Google sign-in failed", err);
    }
  };

  const appearance = isNativeClient
    ? {
        elements: {
          socialButtonsBlockButton: "hidden",
          socialButtonsProviderIcon: "hidden",
          dividerRow: "hidden",
        },
      }
    : undefined;

  return mode === "sign-in" ? (
    <div className="w-full max-w-md">
      {isNativeClient ? (
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={!isSignInLoaded}
          className="mb-4 flex w-full items-center justify-center rounded-lg border border-white/15 bg-white px-4 py-3 text-sm font-semibold text-neutral-950 shadow-[0_12px_32px_rgba(0,0,0,0.24)] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Continue with Google
        </button>
      ) : null}
      <SignIn
        {...redirectProps}
        signUpFallbackRedirectUrl={AUTH_REDIRECT_PATH}
        appearance={appearance}
      />
    </div>
  ) : (
    <SignUp
      {...redirectProps}
      signInFallbackRedirectUrl={AUTH_REDIRECT_PATH}
      appearance={appearance}
    />
  );
}
