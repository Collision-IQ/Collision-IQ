"use client";

import Link from "next/link";

export default function UpgradeModal({
  open,
  onClose,
  title = "Continue with full access",
  description = "You've reached the limits of your current access. Upgrade to continue running analyses, exports, and advanced workflows.",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-black/80 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
        <div className="text-sm uppercase tracking-[0.2em] text-white/40">
          Upgrade Required
        </div>

        <h2 className="mt-3 text-xl font-semibold text-white">{title}</h2>

        <p className="mt-3 text-sm text-white/65">
          {description}
        </p>

        <div className="mt-6 flex gap-3">
          <Link
            href="/billing"
            className="flex-1 rounded-xl bg-[#C65A2A] px-4 py-3 text-center text-sm font-semibold text-black"
          >
            Upgrade Access
          </Link>

          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-white/10 px-4 py-3 text-sm text-white/70"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
