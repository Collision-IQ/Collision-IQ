// src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import Image from "next/image";
import FloatingWidgetGate from "./components/FloatingWidgetGate";

export const metadata: Metadata = {
  title: "Collision Academy",
  description:
    "Insurance-grade vehicle valuations, diminished value, repair planning, and Right to Appraisal support.",
};

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-sm text-[color:var(--muted)] hover:text-[color:var(--text)] transition"
    >
      {children}
    </Link>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        <header className="sticky top-0 z-50 border-b border-[color:var(--border)] bg-[color:var(--bg)]/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-3">
              <Image
                src="/brand/logos/logo-white.png"
                alt="Collision Academy"
                width={120}
                height={32}
                priority
              />
            </Link>

            <nav className="hidden gap-6 md:flex">
              <NavLink href="/services">Services</NavLink>
              <NavLink href="/upload">Upload</NavLink>
              <NavLink href="/chatbot">Chatbot</NavLink>
              <NavLink href="/contact">Contact</NavLink>
            </nav>

            <div className="flex gap-2">
              <Link
                href="/services"
                className="rounded-xl border border-[color:var(--border)] px-4 py-2 text-sm hover:bg-white/5"
              >
                View Packages
              </Link>
              <Link
                href="/upload"
                className="rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-black"
              >
                Start Intake
              </Link>
            </div>
          </div>
        </header>

        {children}

        {/* ✅ GLOBAL FLOATING WIDGET (hidden on /widget) */}
        <FloatingWidgetGate />
      </body>
    </html>
  );
}
