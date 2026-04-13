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

async function upsertAppUser(params: {
  clerkUserId: string;
  email: string | null;
  firstName?: string | null;
  lastName?: string | null;
  imageUrl?: string | null;
  isPlatformAdmin: boolean;
}) {
  const existingUser = await prisma.user.findUnique({
    where: {
      clerkUserId: params.clerkUserId,
    },
    select: {
      id: true,
    },
  });

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

  if (!existingUser) {
    // Ensure first-time users get a CHAT_ONLY record as their baseline state.
    const existingSubscription = await prisma.subscription.findFirst({
      where: {
        userId: user.id,
      },
      select: {
        id: true,
      },
    });

    if (!existingSubscription) {
      await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: "CHAT_ONLY",
          status: "ACTIVE",
        },
      });
    }
  }

  return user;
}

export async function requireCurrentUser() {
  if (!hasClerkConfig()) {
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
  if (!state.userId) {
    throw new UnauthorizedError();
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
