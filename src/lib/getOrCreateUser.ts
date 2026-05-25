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
  const clerkUserId = input.clerkUserId?.trim();
  const normalizedEmail = input.email?.trim().toLowerCase() || null;

  if (!clerkUserId || !normalizedEmail) {
    throw new Error("Missing authenticated user identity");
  }

  const platformAdmin = isPlatformAdminEmail(normalizedEmail);
  const profileData = {
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    imageUrl: input.imageUrl ?? null,
    isPlatformAdmin: platformAdmin,
  };

  const existingByClerkId = await prisma.user.findUnique({
    where: { clerkUserId },
    include: { subscriptions: true },
  });

  if (existingByClerkId) {
    const emailOwner =
      existingByClerkId.email === normalizedEmail
        ? null
        : await prisma.user.findUnique({ where: { email: normalizedEmail } });

    return prisma.user.update({
      where: { id: existingByClerkId.id },
      data: {
        ...profileData,
        ...(emailOwner && emailOwner.id !== existingByClerkId.id
          ? {}
          : { email: normalizedEmail }),
      },
      include: { subscriptions: true },
    });
  }

  const existingByEmail = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { subscriptions: true },
  });

  if (existingByEmail) {
    return prisma.user.update({
      where: { id: existingByEmail.id },
      data: {
        clerkUserId,
        email: normalizedEmail,
        ...profileData,
      },
      include: { subscriptions: true },
    });
  }

  return prisma.user.create({
    data: {
      clerkUserId,
      email: normalizedEmail,
      ...profileData,
    },
    include: { subscriptions: true },
  });
}
