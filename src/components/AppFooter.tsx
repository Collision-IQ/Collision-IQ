"use client";

import Link from "next/link";

export function AppFooter() {
  return (
    <footer className="relative z-20 border-t border-white/10 bg-black/40 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="text-sm text-white/60">
            © 2026 Collision Academy
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-6 text-sm">
            <Link href="/" className="text-white/70 hover:text-white transition">
              Home
            </Link>
            <Link href="/dashboard" className="text-white/70 hover:text-white transition">
              Dashboard
            </Link>
            <Link href="/technical-systems/shop-hub" className="text-white/70 hover:text-white transition">
              Shop Hub
            </Link>
            <Link href="/services" className="text-white/70 hover:text-white transition">
              Services
            </Link>
            <Link href="/collision-iq-v2" className="text-white/70 hover:text-white transition">
              Collision iQ
            </Link>
            <Link href="/privacy" className="text-white/70 hover:text-white transition">
              Privacy
            </Link>
            <Link href="/terms" className="text-white/70 hover:text-white transition">
              Terms
            </Link>
            <Link href="/delete-account" className="text-white/70 hover:text-white transition">
              Delete Account
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
