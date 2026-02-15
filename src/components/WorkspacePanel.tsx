"use client";

import { ReactNode } from "react";

interface Props {
  variant?: "left" | "right";
  children?: ReactNode;
}

export default function WorkspacePanel({ children }: Props) {
  return (
    <div
      className="
        relative
        rounded-3xl
        border border-white/10
        bg-black/40
        backdrop-blur-2xl
        shadow-[0_30px_80px_rgba(0,0,0,0.6)]
        transition
        duration-300
        hover:shadow-[0_40px_120px_rgba(0,0,0,0.75)]
        hover:-translate-y-1
        overflow-hidden
      "
    >
      {/* Subtle glass inner glow */}
      <div
        className="
          pointer-events-none
          absolute inset-0 rounded-3xl
          bg-gradient-to-b
          from-white/5
          to-transparent
        "
      />

      <div className="relative p-5 space-y-5">
        {children}
      </div>
    </div>
  );
}
