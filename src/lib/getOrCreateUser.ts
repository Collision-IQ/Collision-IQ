import { prisma } from "@/lib/prisma";
import { isPlatformAdminEmail } from "@/lib/auth/platform-admin";

type ClerkUserSeed = {
  clerkUserId: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  imageUrl?: string | null;
};

/**
 * Provisions/syncs a user record by Clerk identity.
 * Does NOT create subscriptions automatically.
 */
export async function getOrCreateUser(input: ClerkUserSeed) {
  const normalizedEmail = input.email?.trim().toLowerCase() ?? null;
  const platformAdmin = isPlatformAdminEmail(normalizedEmail);

  return prisma.user.upsert({
    where: { clerkUserId: input.clerkUserId },
    update: {
      email: normalizedEmail,
      firstName: input.firstName ?? undefined,
      lastName: input.lastName ?? undefined,
      imageUrl: input.imageUrl ?? undefined,
      isPlatformAdmin: platformAdmin,
    },
    create: {
      clerkUserId: input.clerkUserId,
      email: normalizedEmail,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      imageUrl: input.imageUrl ?? null,
      isPlatformAdmin: platformAdmin,
    },
    include: {
      subscriptions: true,
    },
  });
}
