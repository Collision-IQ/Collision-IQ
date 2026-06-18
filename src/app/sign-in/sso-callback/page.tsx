"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import { useEffect } from "react";

export default function SignInSsoCallbackPage() {
  useEffect(() => {
    console.log("[clerk-google-mobile] sso callback route loaded", {
      href: window.location.href,
      origin: window.location.origin,
      pathname: window.location.pathname,
      search: window.location.search,
    });
  }, []);

  return (
    <AuthenticateWithRedirectCallback
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signInForceRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      signUpForceRedirectUrl="/"
    />
  );
}
