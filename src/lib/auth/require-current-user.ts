import { auth, currentUser } from "@clerk/nextjs/server";
import { hasClerkConfig } from "@/lib/auth/config";
import {
  getDefaultPlatformAdminEmail,
  isPlatformAdminEmail,
  normalizeEmail,
} from "@/lib/auth/platform-admin";

export class CurrentUserRequiredError extends Error {
  constructor(message = "Authentication is required.") {
    super(message);
    this.name = "CurrentUserRequiredError";
  }
}

export async function requireCurrentUser() {
  if (!hasClerkConfig()) {
    const fallbackEmail = normalizeEmail(getDefaultPlatformAdminEmail()) || "local-dev@collision.academy";
    return {
      clerkUserId: "local-dev-user",
      orgId: null,
      email: fallbackEmail,
      isPlatformAdmin: isPlatformAdminEmail(fallbackEmail),
    };
  }

  const state = await auth();
  if (!state.userId) {
    throw new CurrentUserRequiredError();
  }

  const clerkUser = await currentUser();
  const primaryEmail =
    clerkUser?.emailAddresses.find(
      (emailAddress) => emailAddress.id === clerkUser?.primaryEmailAddressId
    )?.emailAddress ?? clerkUser?.emailAddresses[0]?.emailAddress;
  const normalizedEmail = normalizeEmail(primaryEmail);

  return {
    clerkUserId: state.userId,
    orgId: state.orgId ?? null,
    email: normalizedEmail || null,
    isPlatformAdmin: isPlatformAdminEmail(normalizedEmail),
  };
}
