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
      console.log("[clerk-google-mobile] custom Google button rendered", {
        isNativeClient,
        isSignInLoaded,
        hasSignIn: Boolean(signIn),
      });
    }
  }, [isNativeClient, isSignInLoaded, mode, signIn]);

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
    console.log("[clerk-google-mobile] custom Google button clicked", {
      isSignInLoaded,
      hasSignIn: Boolean(signIn),
      hasSso: Boolean(signIn && typeof signIn.sso === "function"),
    });

    if (!isSignInLoaded || !signIn) {
      console.error("[clerk-google-mobile] signIn not ready");
      return;
    }

    try {
      console.log("[clerk-google-mobile] starting Clerk SSO flow");

      if (typeof signIn.sso === "function") {
        const appOrigin =
          typeof window !== "undefined"
            ? window.location.origin
            : "https://www.collision-iq.ai";
        const redirectCallbackUrl = `${appOrigin}${GOOGLE_SSO_CALLBACK_PATH}`;
        const redirectUrl = `${appOrigin}${AUTH_REDIRECT_PATH}`;

        console.log("[clerk-google-mobile] SSO redirect URLs", {
          redirectCallbackUrl,
          redirectUrl,
        });

        await signIn.sso({
          strategy: "oauth_google",
          redirectCallbackUrl,
          redirectUrl,
        });
        return;
      }

      console.error("[clerk-google-mobile] no supported Google SSO method");
    } catch (err) {
      console.error("[clerk-google-mobile] custom Google failed", err);
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
          className="relative z-50 mb-4 flex w-full items-center justify-center rounded-xl border border-white/20 bg-white px-4 py-3 text-sm font-semibold text-black shadow-sm pointer-events-auto disabled:opacity-60"
        >
          Continue with Google
        </button>
      ) : null}
      <div className={isNativeClient ? "native-email-signin-only" : undefined}>
        <SignIn
          {...redirectProps}
          signUpFallbackRedirectUrl={AUTH_REDIRECT_PATH}
          appearance={appearance}
        />
      </div>
      {isNativeClient ? (
        <style jsx global>{`
          .native-email-signin-only .cl-socialButtons,
          .native-email-signin-only .cl-socialButtonsBlockButton,
          .native-email-signin-only .cl-socialButtonsBlockButtonText,
          .native-email-signin-only [data-provider="google"],
          .native-email-signin-only [data-provider-id="google"],
          .native-email-signin-only button[aria-label*="Google"] {
            display: none !important;
          }
        `}</style>
      ) : null}
    </div>
  ) : (
    <SignUp
      {...redirectProps}
      signInFallbackRedirectUrl={AUTH_REDIRECT_PATH}
      appearance={appearance}
    />
  );
}
