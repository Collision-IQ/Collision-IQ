import "./globals.css";
import type { Metadata } from "next";
import FloatingWidgetMount from "@/components/FloatingWidgetMount";

export const metadata: Metadata = {
  title: "Collision Academy",
  description: "Automotive Appraisal & Collision Technology Experts.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className="min-h-screen text-white overflow-x-hidden bg-black root-layout-body"
      >
        {/* Cinematic overlays (non-interactive, won’t block clicks) */}
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

        {/* Content layer ABOVE overlays */}
        <div className="relative z-10 min-h-screen">
          {children}
          <FloatingWidgetMount />
        </div>
      </body>
    </html>
  );
}
