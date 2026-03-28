import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { hasClerkConfig } from "@/lib/auth/config";
import { isPlatformAdminEmail, normalizeEmail } from "@/lib/auth/platform-admin";
import { requireCurrentUser } from "@/lib/auth/require-current-user";

export async function getOrCreateAppUser() {
  const authUser = await requireCurrentUser();
  const { clerkUserId } = authUser;

  if (!hasClerkConfig()) {
    return prisma.user.upsert({
      where: {
        clerkUserId,
      },
      update: {
        email: authUser.email,
        firstName: "Local",
        lastName: "Developer",
        imageUrl: null,
        isPlatformAdmin: authUser.isPlatformAdmin,
      },
      create: {
        clerkUserId,
        email: authUser.email,
        firstName: "Local",
        lastName: "Developer",
        imageUrl: null,
        isPlatformAdmin: authUser.isPlatformAdmin,
      },
    });
  }

  const clerkUser = await currentUser();
  const primaryEmail =
    clerkUser?.emailAddresses.find(
      (emailAddress) => emailAddress.id === clerkUser.primaryEmailAddressId
    )?.emailAddress ?? clerkUser?.emailAddresses[0]?.emailAddress;
  const normalizedEmail = normalizeEmail(primaryEmail);
  const isPlatformAdmin = isPlatformAdminEmail(normalizedEmail);

  return prisma.user.upsert({
    where: {
      clerkUserId,
    },
    update: {
      email: normalizedEmail || null,
      firstName: clerkUser?.firstName ?? null,
      lastName: clerkUser?.lastName ?? null,
      imageUrl: clerkUser?.imageUrl ?? null,
      isPlatformAdmin,
    },
    create: {
      clerkUserId,
      email: normalizedEmail || null,
      firstName: clerkUser?.firstName ?? null,
      lastName: clerkUser?.lastName ?? null,
      imageUrl: clerkUser?.imageUrl ?? null,
      isPlatformAdmin,
    },
  });
}
