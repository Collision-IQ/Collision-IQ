import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import { assertClerkConfig } from "@/lib/auth/config";

const clerkConfig = assertClerkConfig();

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
  "/api/transcribe(.*)",
  "/api/tts(.*)",
]);

const protectedProxy = clerkMiddleware(async (auth, req) => {
  console.info("[proxy] request", {
    pathname: req.nextUrl.pathname,
    protectedMatch: isProtectedRoute(req),
    hasClerkConfig: Boolean(clerkConfig.publishableKey && clerkConfig.secretKey),
  });

  if (isPublicRoute(req)) return;

  if (isProtectedRoute(req)) {
    await auth.protect();
  }
}, { debug: process.env.NODE_ENV === "development" });

export default function proxy(req: NextRequest, event: unknown) {
  return protectedProxy(req, event as never);
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/api/:path*"],
};
