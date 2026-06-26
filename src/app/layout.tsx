import "./globals.css";
import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import NativeAuthBridge from "@/components/NativeAuthBridge";
import { ThemeProvider } from "@/components/theme-provider";

function getSiteUrl() {
  const rawUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.APP_BASE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ??
    "https://www.collision.academy";

  try {
    return new URL(rawUrl.trim());
  } catch {
    return new URL("https://www.collision.academy");
  }
}

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: "Collision Academy",
  description: "Automotive Appraisal & Collision Technology Experts.",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: "/brand/logos/icons/Favicon.svg",
    shortcut: "/brand/logos/icons/Favicon.svg",
    apple: "/brand/logos/icons/Favicon.svg",
  },
  openGraph: {
    title: "Collision Academy",
    description: "Automotive Appraisal & Collision Technology Experts.",
    url: siteUrl,
    siteName: "Collision Academy",
    images: [
      {
        url: "/brand/logos/logo-horizontal.png",
        width: 1200,
        height: 630,
        alt: "Collision Academy",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Collision Academy",
    description: "Automotive Appraisal & Collision Technology Experts.",
    images: ["/brand/logos/logo-horizontal.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const content = (
    <>
      {/* Cinematic overlays (non-interactive) */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 bg-background"
      >
        {/* Directional base wash */}
        <div className="absolute inset-0 bg-gradient-to-b from-white via-[#f4f2ec] to-[#efe9df] dark:from-[#0d1014] dark:via-[#0b0d10] dark:to-[#080a0c]" />

        {/* Signal-orange aurora, top-right */}
        <div className="absolute inset-0 bg-[radial-gradient(60%_45%_at_82%_4%,rgba(196,90,36,0.18),transparent_60%)] dark:bg-[radial-gradient(60%_45%_at_82%_4%,rgba(226,117,56,0.20),transparent_60%)]" />

        {/* Cool counter-glow, bottom-left, for depth */}
        <div className="absolute inset-0 bg-[radial-gradient(55%_40%_at_8%_92%,rgba(70,100,130,0.10),transparent_60%)] dark:bg-[radial-gradient(55%_40%_at_8%_92%,rgba(80,120,170,0.12),transparent_60%)]" />

        {/* Fine technical grid */}
        <div className="absolute inset-0 opacity-[0.5] dark:opacity-[0.35] bg-[linear-gradient(to_right,rgba(91,102,113,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(91,102,113,0.06)_1px,transparent_1px)] bg-[size:40px_40px]" />

        {/* Soft vignette to settle edges */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_55%,rgba(20,25,31,0.06))] dark:bg-[radial-gradient(circle_at_center,transparent_45%,rgba(0,0,0,0.55))]" />
      </div>

      {/* App layer */}
      <div
        className="
          relative
          z-10
          min-h-screen
          flex
          flex-col
        "
      >
        {children}
      </div>
    </>
  );

  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
    >
      <html lang="en" className="h-full" suppressHydrationWarning>
        <head>
          {/* Safe-area support for mobile */}
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1, viewport-fit=cover"
          />
        </head>

        <body
          className="
            h-full
            bg-background
            text-foreground antialiased
            overflow-x-hidden
            root-layout-body
          "
        >
          <ThemeProvider>
            {content}
          </ThemeProvider>
          <NativeAuthBridge />
          <SpeedInsights />
          <Analytics />
        </body>
      </html>
    </ClerkProvider>
  );
}
