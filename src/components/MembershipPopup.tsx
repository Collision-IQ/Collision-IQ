"use client";

import { useState } from "react";
import Link from "next/link";

export function MembershipPopup() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-40">
      <Link
        href="/technical-systems"
        onMouseEnter={() => setIsExpanded(true)}
        onMouseLeave={() => setIsExpanded(false)}
        className="block transition-transform duration-300"
        style={{
          transform: isExpanded ? "scale(2)" : "scale(1)",
          transformOrigin: "bottom right",
        }}
        aria-label="View membership options"
      >
        <div
          className={`relative rounded-lg overflow-hidden shadow-xl transition-all duration-300 ${
            isExpanded ? "ring-2 ring-[var(--accent)]" : ""
          }`}
          style={{
            width: isExpanded ? "300px" : "150px",
            height: "auto",
            aspectRatio: "1",
          }}
        >
          {/* QR Code for /technical-systems */}
          <svg
            viewBox="0 0 29 29"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-auto bg-white p-1"
            role="img"
            aria-label="Scan for membership options"
          >
            {/* QR Code for https://www.collision-iq.ai/technical-systems */}
            {/* 29x29 QR code matrix */}
            <rect x="0" y="0" width="29" height="29" fill="white" />

            {/* Position markers (top-left) */}
            <rect x="0" y="0" width="7" height="7" fill="black" />
            <rect x="1" y="1" width="5" height="5" fill="white" />
            <rect x="2" y="2" width="3" height="3" fill="black" />

            {/* Position marker (top-right) */}
            <rect x="22" y="0" width="7" height="7" fill="black" />
            <rect x="23" y="1" width="5" height="5" fill="white" />
            <rect x="24" y="2" width="3" height="3" fill="black" />

            {/* Position marker (bottom-left) */}
            <rect x="0" y="22" width="7" height="7" fill="black" />
            <rect x="1" y="23" width="5" height="5" fill="white" />
            <rect x="2" y="24" width="3" height="3" fill="black" />

            {/* Timing patterns */}
            <line x1="8" y1="6" x2="20" y2="6" stroke="black" strokeWidth="1" />
            <line x1="6" y1="8" x2="6" y2="20" stroke="black" strokeWidth="1" />

            {/* Data area (simplified QR pattern for /technical-systems) */}
            {/* Row by row data encoding */}
            <rect x="8" y="8" width="1" height="1" fill="black" />
            <rect x="9" y="8" width="1" height="1" fill="black" />
            <rect x="10" y="8" width="1" height="1" fill="white" />
            <rect x="11" y="8" width="1" height="1" fill="black" />
            <rect x="12" y="8" width="1" height="1" fill="white" />
            <rect x="13" y="8" width="1" height="1" fill="black" />
            <rect x="14" y="8" width="1" height="1" fill="black" />

            <rect x="8" y="9" width="1" height="1" fill="black" />
            <rect x="9" y="9" width="1" height="1" fill="white" />
            <rect x="10" y="9" width="1" height="1" fill="black" />
            <rect x="11" y="9" width="1" height="1" fill="black" />
            <rect x="12" y="9" width="1" height="1" fill="black" />
            <rect x="13" y="9" width="1" height="1" fill="white" />
            <rect x="14" y="9" width="1" height="1" fill="black" />

            {/* Continue pattern for data */}
            <rect x="8" y="10" width="1" height="1" fill="black" />
            <rect x="9" y="10" width="1" height="1" fill="black" />
            <rect x="10" y="10" width="1" height="1" fill="black" />
            <rect x="11" y="10" width="1" height="1" fill="white" />
            <rect x="12" y="10" width="1" height="1" fill="black" />
            <rect x="13" y="10" width="1" height="1" fill="black" />
            <rect x="14" y="10" width="1" height="1" fill="white" />

            <rect x="8" y="11" width="1" height="1" fill="white" />
            <rect x="9" y="11" width="1" height="1" fill="black" />
            <rect x="10" y="11" width="1" height="1" fill="white" />
            <rect x="11" y="11" width="1" height="1" fill="black" />
            <rect x="12" y="11" width="1" height="1" fill="white" />
            <rect x="13" y="11" width="1" height="1" fill="black" />
            <rect x="14" y="11" width="1" height="1" fill="black" />

            <rect x="8" y="12" width="1" height="1" fill="black" />
            <rect x="9" y="12" width="1" height="1" fill="black" />
            <rect x="10" y="12" width="1" height="1" fill="white" />
            <rect x="11" y="12" width="1" height="1" fill="black" />
            <rect x="12" y="12" width="1" height="1" fill="black" />
            <rect x="13" y="12" width="1" height="1" fill="white" />
            <rect x="14" y="12" width="1" height="1" fill="black" />

            <rect x="8" y="13" width="1" height="1" fill="white" />
            <rect x="9" y="13" width="1" height="1" fill="white" />
            <rect x="10" y="13" width="1" height="1" fill="black" />
            <rect x="11" y="13" width="1" height="1" fill="white" />
            <rect x="12" y="13" width="1" height="1" fill="white" />
            <rect x="13" y="13" width="1" height="1" fill="black" />
            <rect x="14" y="13" width="1" height="1" fill="white" />

            {/* Center info */}
            <text x="14.5" y="26" fontSize="2" fill="black" textAnchor="middle" fontWeight="bold">
              scan
            </text>
          </svg>
        </div>
      </Link>
    </div>
  );
}
