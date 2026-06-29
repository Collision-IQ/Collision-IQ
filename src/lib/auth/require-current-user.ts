import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { hasClerkConfig } from "@/lib/auth/config";
import { getOrCreateUser } from "@/lib/getOrCreateUser";
import {
  getDefaultPlatformAdminEmail,
  isPlatformAdminEmail,
  isPlatformAdminEmailList,
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

function maskEmailForLog(email: string | null | undefined) {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!local || !domain) return "[redacted-email]";
  return `${local.slice(0, 2)}***@${domain}`;
}

function getVerifiedClerkEmails(clerkUser: Awaited<ReturnType<typeof currentUser>>) {
  return (
    clerkUser?.emailAddresses
      .filter((emailAddress) => {
        const verification = emailAddress.verification as { status?: string } | null | undefined;
        return verification?.status === "verified";
      })
      .map((emailAddress) => normalizeEmail(emailAddress.emailAddress))
      .filter(Boolean) ?? []
  );
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
      email: maskEmailForLog(fallbackEmail),
      isPlatformAdmin,
    });
    const user = await getOrCreateUser({
      clerkUserId: "local-dev-user",
      email: fallbackEmail || null,
      firstName: "Local",
      lastName: "Developer",
      imageUrl: null,
    });

    return {
      user,
      clerkUserId: user.clerkUserId,
      orgId: null,
      email: user.email,
      verifiedEmails: fallbackEmail ? [fallbackEmail] : [],
      isPlatformAdmin,
    };
  }

  const state = await auth();
  console.info("[auth] clerk session check", {
    hasUserId: Boolean(state.userId),
    hasOrgId: Boolean(state.orgId),
    hasPublishableKey: Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
    hasSecretKey: Boolean(process.env.CLERK_SECRET_KEY),
    vercelEnv: process.env.VERCEL_ENV ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
  });

  if (!state.userId) {
    throw new UnauthorizedError("No authenticated Clerk session was found for this request.");
  }

  let clerkUser: Awaited<ReturnType<typeof currentUser>> = null;
  let clerkUserFetchFailed = false;
  try {
    clerkUser = await currentUser();
  } catch (err) {
    clerkUserFetchFailed = true;
    console.warn("[auth] currentUser API call failed", {
      clerkUserId: state.userId,
      errorName: err instanceof Error ? err.name : typeof err,
      error: err instanceof Error ? err.message : String(err),
    });
    // Fall back to existing DB record so returning users don't get a hard 500
    const existingUser = await prisma.user.findUnique({
      where: { clerkUserId: state.userId },
    });
    if (existingUser) {
      console.info("[auth] currentUser fallback: using existing DB user", {
        clerkUserId: state.userId,
        hasEmail: Boolean(existingUser.email),
        isPlatformAdmin: existingUser.isPlatformAdmin,
      });
      return {
        user: existingUser,
        clerkUserId: existingUser.clerkUserId,
        orgId: state.orgId ?? null,
        email: existingUser.email,
        verifiedEmails: existingUser.email ? [existingUser.email] : [],
        isPlatformAdmin: existingUser.isPlatformAdmin,
      };
    }
    // New user with no DB record and currentUser() failed — re-throw so the caller sees the real error
    throw err;
  }

  const primaryEmail =
    clerkUser?.primaryEmailAddress?.emailAddress ??
    clerkUser?.emailAddresses[0]?.emailAddress;
  const normalizedEmail = normalizeEmail(primaryEmail)?.trim() || null;
  if (!state.userId || !normalizedEmail) {
    console.warn("[auth] missing Clerk identity for user bootstrap", {
      clerkUserIdPresent: Boolean(state.userId),
      emailPresent: Boolean(normalizedEmail),
    });
    throw new UnauthorizedError("Missing authenticated user identity.");
  }

  const verifiedEmails = getVerifiedClerkEmails(clerkUser);
  const adminCandidateEmails = [...new Set([normalizedEmail, ...verifiedEmails].filter(Boolean))];
  const isPlatformAdmin = isPlatformAdminEmailList(adminCandidateEmails);
  console.info("[auth] resolved clerk user", {
    clerkUserId: state.userId,
    clerkUserNull: clerkUser === null,
    clerkUserFetchFailed,
    email: maskEmailForLog(normalizedEmail),
    verifiedEmails: verifiedEmails.map((email) => maskEmailForLog(email)),
    isPlatformAdmin,
  });
  let user: Awaited<ReturnType<typeof getOrCreateUser>>;
  try {
    user = await getOrCreateUser({
      clerkUserId: state.userId,
      email: normalizedEmail,
      firstName: clerkUser?.firstName ?? null,
      lastName: clerkUser?.lastName ?? null,
      imageUrl: clerkUser?.imageUrl ?? null,
    });
  } catch (err) {
    console.error("[auth] getOrCreateUser failed", {
      clerkUserId: state.userId,
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
      errorCode: (err as { code?: string })?.code ?? null,
    });
    throw err;
  }

  return {
    user,
    clerkUserId: user.clerkUserId,
    orgId: state.orgId ?? null,
    email: user.email,
    verifiedEmails,
    isPlatformAdmin,
  };
}
