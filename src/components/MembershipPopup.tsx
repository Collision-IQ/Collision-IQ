"use client";

// Membership promo card pinned in the workspace left rail. Small by default so
// it sits inside the 208px rail; hovering scales it 2x from the bottom-left so
// the QR is scannable off-screen without pushing the nav around.

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

export function MembershipPopup() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-2 px-1">
      <Link
        href="/technical-systems"
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        onFocus={() => setExpanded(true)}
        onBlur={() => setExpanded(false)}
        className="relative block rounded-xl border border-[var(--accent)]/35 bg-[var(--accent)]/10 p-2 shadow-lg transition-transform duration-300 hover:border-[var(--accent)]"
        style={{
          transform: expanded ? "scale(2)" : "scale(1)",
          transformOrigin: "bottom left",
          zIndex: expanded ? 60 : 1,
        }}
        aria-label="Collision iQ memberships — 30 days of Pro free at sign-up"
      >
        <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">
          30 days of Pro — free
        </div>

        <div className="mt-1.5 overflow-hidden rounded-md bg-white p-1">
          <Image
            src="/brand/qr-technical-systems.png"
            alt="QR code linking to Collision iQ memberships"
            width={600}
            height={600}
            className="h-auto w-full"
          />
        </div>

        <div className="mt-1.5 text-[9px] leading-tight text-muted-foreground">
          Scan or tap to see plans
        </div>
      </Link>
    </div>
  );
}
