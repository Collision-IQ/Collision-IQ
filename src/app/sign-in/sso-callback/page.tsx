"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

export default function SignInSsoCallbackPage() {
  return (
    <AuthenticateWithRedirectCallback
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/chatbot"
      signInForceRedirectUrl="/chatbot"
      signUpFallbackRedirectUrl="/chatbot"
      signUpForceRedirectUrl="/chatbot"
    />
  );
}
