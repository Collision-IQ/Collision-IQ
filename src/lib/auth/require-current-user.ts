import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { hasClerkConfig } from "@/lib/auth/config";
import {
  getDefaultPlatformAdminEmail,
  isPlatformAdminEmail,
  normalizeEmail,
} from "@/lib/auth/platform-admin";

export class UnauthorizedError extends Error {
  status = 401;

  constructor(message = "Authentication is required.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

const isDevelopment =
  process.env.NODE_ENV !== "production" || process.env.VERCEL_ENV !== "production";

async function upsertAppUser(params: {
  clerkUserId: string;
  email: string | null;
  firstName?: string | null;
  lastName?: string | null;
  imageUrl?: string | null;
  isPlatformAdmin: boolean;
}) {
  const user = await prisma.user.upsert({
    where: {
      clerkUserId: params.clerkUserId,
    },
    update: {
      email: params.email,
      firstName: params.firstName ?? null,
      lastName: params.lastName ?? null,
      imageUrl: params.imageUrl ?? null,
      isPlatformAdmin: params.isPlatformAdmin,
    },
    create: {
      clerkUserId: params.clerkUserId,
      email: params.email,
      firstName: params.firstName ?? null,
      lastName: params.lastName ?? null,
      imageUrl: params.imageUrl ?? null,
      isPlatformAdmin: params.isPlatformAdmin,
    },
  });

  return user;
}

export async function requireCurrentUser() {
  if (!hasClerkConfig()) {
    if (!isDevelopment) {
      throw new UnauthorizedError("Authentication is not configured on the server.");
    }

    const fallbackEmail =
      normalizeEmail(getDefaultPlatformAdminEmail()) || "local-dev@collision.academy";
    const isPlatformAdmin = isPlatformAdminEmail(fallbackEmail);
    console.info("[auth] resolved local fallback user", {
      email: fallbackEmail,
      isPlatformAdmin,
    });
    const user = await upsertAppUser({
      clerkUserId: "local-dev-user",
      email: fallbackEmail || null,
      firstName: "Local",
      lastName: "Developer",
      imageUrl: null,
      isPlatformAdmin,
    });

    return {
      user,
      clerkUserId: user.clerkUserId,
      orgId: null,
      email: user.email,
      isPlatformAdmin,
    };
  }

  const state = await auth();
  console.info("[auth] clerk session check", {
    hasUserId: Boolean(state.userId),
    hasOrgId: Boolean(state.orgId),
    publishableKeyPrefix:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.slice(0, 8) ?? null,
    secretKeyPrefix: process.env.CLERK_SECRET_KEY?.slice(0, 8) ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
  });

  if (!state.userId) {
    throw new UnauthorizedError("No authenticated Clerk session was found for this request.");
  }

  const clerkUser = await currentUser();
  const primaryEmail =
    clerkUser?.emailAddresses.find(
      (emailAddress) => emailAddress.id === clerkUser?.primaryEmailAddressId
    )?.emailAddress ?? clerkUser?.emailAddresses[0]?.emailAddress;
  const normalizedEmail = normalizeEmail(primaryEmail) || null;
  const isPlatformAdmin = isPlatformAdminEmail(normalizedEmail);
  console.info("[auth] resolved clerk user", {
    clerkUserId: state.userId,
    email: normalizedEmail,
    isPlatformAdmin,
  });
  const user = await upsertAppUser({
    clerkUserId: state.userId,
    email: normalizedEmail,
    firstName: clerkUser?.firstName ?? null,
    lastName: clerkUser?.lastName ?? null,
    imageUrl: clerkUser?.imageUrl ?? null,
    isPlatformAdmin,
  });

  return {
    user,
    clerkUserId: user.clerkUserId,
    orgId: state.orgId ?? null,
    email: user.email,
    isPlatformAdmin,
  };
}
