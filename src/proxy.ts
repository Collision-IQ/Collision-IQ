import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const hasClerkPublishableKey = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()
);

const isProtectedRoute = createRouteMatcher([
  "/account(.*)",
  // /api/chat is intentionally NOT protected: anonymous (signed-out) users may have a
  // text-only conversation. The route resolves a guest identity, blocks uploads for
  // anonymous users, and rate-limits anonymous traffic. Uploads/analysis remain auth-gated.
  "/billing(.*)",
  "/chatbot(.*)",
  "/dashboard(.*)",
]);

const withClerk = clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export default hasClerkPublishableKey
  ? withClerk
  : function fallback() {
      return NextResponse.next();
    };

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
