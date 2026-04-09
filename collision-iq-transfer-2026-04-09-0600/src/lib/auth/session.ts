import { auth, currentUser } from "@clerk/nextjs/server";
import { hasClerkConfig } from "./config";

export type OptionalAuthState = {
  userId: string | null;
  orgId: string | null;
  isAuthenticated: boolean;
};

export async function getOptionalAuth(): Promise<OptionalAuthState> {
  if (!hasClerkConfig()) {
    return {
      userId: null,
      orgId: null,
      isAuthenticated: false,
    };
  }

  const state = await auth();
  return {
    userId: state.userId ?? null,
    orgId: state.orgId ?? null,
    isAuthenticated: Boolean(state.userId),
  };
}

export async function getOptionalCurrentUser() {
  if (!hasClerkConfig()) {
    return null;
  }

  return currentUser();
}
