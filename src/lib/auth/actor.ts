import type { ArtifactOwnerType } from "@prisma/client";
import { hasFeature, type ViewerAccess } from "@/lib/entitlements";

const CHAT_SESSION_COOKIE = "collision_iq_session";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type OwnerContext = {
  ownerType: ArtifactOwnerType;
  ownerId: string;
  sessionId: string | null;
};

export function getChatSessionCookieName() {
  return CHAT_SESSION_COOKIE;
}

export function getOrCreateAnonymousSessionId(req: Request) {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const existing = parseCookie(cookieHeader, CHAT_SESSION_COOKIE);
  if (existing) {
    return {
      sessionId: existing,
      shouldSetCookie: false,
    };
  }

  return {
    sessionId: crypto.randomUUID(),
    shouldSetCookie: true,
  };
}

export function buildAnonymousOwnerContext(req: Request): OwnerContext & {
  shouldSetCookie: boolean;
  cookieValue: string;
} {
  const { sessionId, shouldSetCookie } = getOrCreateAnonymousSessionId(req);
  return {
    ownerType: "ANONYMOUS",
    ownerId: sessionId,
    sessionId,
    shouldSetCookie,
    cookieValue: buildSessionCookieValue(sessionId),
  };
}

export function buildOwnerContextFromAccess(
  access: ViewerAccess,
  req: Request
): OwnerContext & {
  shouldSetCookie: boolean;
  cookieValue?: string;
} {
  if (access.dbUserId) {
    if (access.activeShopId && hasFeature(access, "pooled_usage")) {
      return {
        ownerType: "SHOP",
        ownerId: access.activeShopId,
        sessionId: null,
        shouldSetCookie: false,
      };
    }

    return {
      ownerType: "USER",
      ownerId: access.dbUserId,
      sessionId: null,
      shouldSetCookie: false,
    };
  }

  return buildAnonymousOwnerContext(req);
}

export function ownerMatchesContext(
  owner: Pick<OwnerContext, "ownerType" | "ownerId">,
  context: Pick<OwnerContext, "ownerType" | "ownerId">
) {
  return owner.ownerType === context.ownerType && owner.ownerId === context.ownerId;
}

function buildSessionCookieValue(sessionId: string) {
  return `${CHAT_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

function parseCookie(cookieHeader: string, name: string) {
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const prefix = `${name}=`;
    if (!trimmed.startsWith(prefix)) continue;
    return decodeURIComponent(trimmed.slice(prefix.length));
  }

  return null;
}
