"use client";

import { hasClerkPublishableKey } from "@/lib/auth/config";

if (!hasClerkPublishableKey()) {
  throw new Error("Missing NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
}
