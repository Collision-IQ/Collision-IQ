import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/pricing",
  "/terms",
  "/privacy",
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

const isProtectedRoute = createRouteMatcher([
  "/chatbot(.*)",
  "/account(.*)",
  "/billing(.*)",
  "/api/chat(.*)",
  "/api/analysis(.*)",
  "/api/upload(.*)",
  "/api/transcribe(.*)",
  "/api/tts(.*)",
]);

const protectedProxy = clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) {
    return;
  }

  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export default function proxy(req: NextRequest, event: unknown) {
  const hasClerkConfig = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() &&
      process.env.CLERK_SECRET_KEY?.trim()
  );

  if (!hasClerkConfig) {
    return NextResponse.next();
  }

  return protectedProxy(req, event as never);
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/api/:path*"],
};
