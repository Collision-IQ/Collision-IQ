"use client";

import { useState } from "react";

export function MembershipPopup() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-40">
      <button
        onMouseEnter={() => setIsExpanded(true)}
        onMouseLeave={() => setIsExpanded(false)}
        className="transition-transform duration-300"
        style={{
          transform: isExpanded ? "scale(2)" : "scale(1)",
          transformOrigin: "bottom right",
        }}
        aria-label="Membership details"
      >
        <div
          className={`relative rounded-lg overflow-hidden shadow-xl transition-all duration-300 ${
            isExpanded ? "ring-2 ring-[var(--accent)]" : ""
          }`}
          style={{
            width: isExpanded ? "400px" : "200px",
            height: "auto",
          }}
        >
          <svg
            viewBox="0 0 800 600"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-auto"
            role="img"
            aria-label="Collision iQ Memberships - 30 days of Pro free at sign-up"
          >
            <defs>
              <linearGradient id="bgGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style={{ stopColor: "#0d1a2a", stopOpacity: 1 }} />
                <stop offset="100%" style={{ stopColor: "#0a0f1a", stopOpacity: 1 }} />
              </linearGradient>
            </defs>

            {/* Background */}
            <rect width="800" height="600" fill="url(#bgGradient)" />

            {/* Header */}
            <text x="40" y="50" fontSize="14" fontWeight="600" fill="#ff6b35" letterSpacing="2">
              COLLISION iQ MEMBERSHIPS
            </text>

            {/* Main Headline */}
            <text x="40" y="120" fontSize="56" fontWeight="700" fill="white">
              30 days of Pro.
            </text>
            <text x="40" y="180" fontSize="56" fontWeight="700" fill="white">
              <tspan fill="#ff6b35">Free, at</tspan>
            </text>
            <text x="40" y="240" fontSize="56" fontWeight="700" fill="white">
              <tspan fill="#ff6b35">sign-up.</tspan>
            </text>

            {/* Subheading */}
            <text x="40" y="280" fontSize="16" fill="#b0b0b0">
              One-time offer. Every new account gets the full system for a month. Then pick the plan
            </text>
            <text x="40" y="305" fontSize="16" fill="#b0b0b0">
              that fits how many files you fight.
            </text>

            {/* Pricing Cards Container */}
            {/* FREE Card */}
            <rect x="40" y="340" width="220" height="200" rx="12" fill="#1a1f2e" stroke="#404050" strokeWidth="1" />
            <text x="60" y="370" fontSize="18" fontWeight="700" fill="white">
              FREE
            </text>
            <text x="60" y="395" fontSize="24" fontWeight="700" fill="white">
              $0
            </text>
            <text x="60" y="430" fontSize="13" fill="#a0a0a0">
              • Quick-answer chat
            </text>
            <text x="60" y="455" fontSize="13" fill="#a0a0a0">
              • Read aloud
            </text>
            <text x="60" y="480" fontSize="13" fill="#a0a0a0">
              • History & Knowledge Base
            </text>
            <text x="60" y="505" fontSize="13" fill="#a0a0a0">
              • 5 uploads a month
            </text>

            {/* STARTER Card */}
            <rect x="290" y="340" width="220" height="200" rx="12" fill="#1a1f2e" stroke="#404050" strokeWidth="1" />
            <text x="310" y="370" fontSize="18" fontWeight="700" fill="white">
              STARTER
            </text>
            <text x="310" y="395" fontSize="24" fontWeight="700" fill="white">
              $50<tspan fontSize="16" fill="#a0a0a0">/mo</tspan>
            </text>
            <text x="310" y="430" fontSize="13" fill="#a0a0a0">
              • Quick chat + Research
            </text>
            <text x="310" y="455" fontSize="13" fill="#a0a0a0">
              • 15 uploads a month
            </text>
            <text x="310" y="480" fontSize="13" fill="#a0a0a0">
              • 10 image generations
            </text>
            <text x="310" y="505" fontSize="13" fill="#a0a0a0">
              • Scan iQ & Reports
            </text>

            {/* PRO Card (Featured) */}
            <rect x="540" y="340" width="220" height="200" rx="12" fill="#1a1f2e" stroke="#ff6b35" strokeWidth="2" />
            <rect x="580" y="330" width="140" height="28" rx="6" fill="#ff6b35" />
            <text x="650" y="352" fontSize="11" fontWeight="700" fill="black" textAnchor="middle" letterSpacing="1">
              EVERYTHING UNLOCKED
            </text>
            <text x="560" y="370" fontSize="18" fontWeight="700" fill="white">
              PRO
            </text>
            <text x="560" y="395" fontSize="24" fontWeight="700" fill="white">
              $200<tspan fontSize="16" fill="#a0a0a0">/mo</tspan>
            </text>
            <text x="560" y="430" fontSize="13" fill="#a0a0a0">
              • All features & reports
            </text>
            <text x="560" y="455" fontSize="13" fill="#a0a0a0">
              • Full report set
            </text>
            <text x="560" y="480" fontSize="13" fill="#a0a0a0">
              • CCC Secure Share import
            </text>
            <text x="560" y="505" fontSize="13" fill="#a0a0a0">
              • 35 uploads a month
            </text>

            {/* Footer */}
            <text x="40" y="598" fontSize="14" fontWeight="600" fill="#666666">
              collision-iq.ai
            </text>
            <text x="760" y="598" fontSize="12" fill="#666666" textAnchor="end">
              Every figure traces to the document.
            </text>
          </svg>
        </div>
      </button>
    </div>
  );
}
