import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import Image from "next/image";

export const metadata: Metadata = {
  title: "Collision Academy",
  description:
    "Insurance-grade vehicle valuations, diminished value, repair planning, and Right to Appraisal support.",
  icons: {
    icon: [
      { url: "/brand/icons/favicon.ico" },
      { url: "/brand/icons/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: ["/brand/icons/favicon.ico"],
    // Only include this if you actually add the file:
    // public/brand/icons/apple-touch-icon.png
  },
};

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="text-sm hover:text-[color:var(--accent)] transition">
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
    <html lang="en" className="dark">
      <body>
        <header className="sticky top-0 z-50 border-b border-[color:var(--border)] bg-[color:var(--bg)]/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-3">
             <Image
               src="/brand/logos/badge.png"
               alt="Collision Academy"
               width={36}
               height={36}
               priority
             />
               <div className="leading-tight">
                <Image
                  src="/brand/logos/logo-horizontal.png"
                  alt="Collision Academy"
                  width={210}
                  height={42}
                  priority
                />
                <div className="text-xs text-[color:var(--muted)]">
                  Policyholders • Repair Centers
                </div>
              </div>
            </Link>

            <nav className="hidden items-center gap-6 md:flex">
              <NavLink href="/services">Services</NavLink>
              <NavLink href="/upload">Upload</NavLink>
              <NavLink href="/chatbot">Chatbot</NavLink>
              <NavLink href="/mission">Mission</NavLink>
              <NavLink href="/contact">Contact</NavLink>
            </nav>

            <div className="flex items-center gap-2">
              <Link
                href="/services"
                className="rounded-xl border border-[color:var(--border)] px-4 py-2 text-sm hover:bg-white/5 transition"
              >
                View Packages
              </Link>
              <Link
                href="/upload"
                className="rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90 transition"
              >
                Start Intake
              </Link>
            </div>
          </div>
        </header>

        {children}

        <footer className="mt-20 border-t border-[color:var(--border)]">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 md:grid-cols-3">
            <div>
              <div className="font-semibold">Collision Academy</div>
              <p className="mt-2 text-sm text-[color:var(--muted)]">
                Documentation-first valuation and appraisal support built for
                real-world claims.
              </p>
            </div>

            <div className="text-sm">
              <div className="font-semibold">Pages</div>
              <div className="mt-2 grid gap-2">
                <Link
                  href="/services"
                  className="text-[color:var(--muted)] hover:text-[color:var(--text)]"
                >
                  Services
                </Link>
                <Link
                  href="/chatbot"
                  className="text-[color:var(--muted)] hover:text-[color:var(--text)]"
                >
                  Chatbot
                </Link>
                <Link
                  href="/upload"
                  className="text-[color:var(--muted)] hover:text-[color:var(--text)]"
                >
                  Upload
                </Link>
                <Link
                  href="/contact"
                  className="text-[color:var(--muted)] hover:text-[color:var(--text)]"
                >
                  Contact
                </Link>
              </div>
            </div>

            <div className="text-sm">
              <div className="font-semibold">Contact</div>
              <div className="mt-2 text-[color:var(--muted)]">
                <div>Office@collision.academy</div>
                <div>267-983-8615</div>
                <div className="mt-2">PA • NJ • DE • MD • NC</div>
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}

