import "./globals.css";
import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";

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
  const hasClerkConfig = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() &&
      process.env.CLERK_SECRET_KEY?.trim()
  );

  const content = (
    <>
      {/* Cinematic overlays (non-interactive) */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
      >
        {/* Deep base */}
        <div className="absolute inset-0 bg-black/70" />

        {/* Directional lighting */}
        <div className="absolute inset-0 bg-gradient-to-tr from-black via-black/60 to-black/25" />

        {/* Strong vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_35%,rgba(0,0,0,0.92))]" />

        {/* Orange glow accent */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_10%,rgba(198,90,42,0.22),transparent_45%)]" />

        {/* Subtle grain */}
        <div className="absolute inset-0 opacity-[0.06] mix-blend-overlay bg-[url('/brand/logos/Background.png')]" />
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
    <html lang="en" className="h-full">
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
          bg-black
          text-white antialiased
          overflow-x-hidden
          root-layout-body
        "
      >
        {hasClerkConfig ? <ClerkProvider>{content}</ClerkProvider> : content}
      </body>
    </html>
  );
}
