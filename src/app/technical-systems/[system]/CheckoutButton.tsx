"use client";

import { useState } from "react";

type Plan = "shop_hub" | "shop_flow" | "parts_app";

export default function CheckoutButton({ plan, label }: { plan: Plan; label: string }) {
  const [loading, setLoading] = useState(false);

  async function startCheckout() {
    setLoading(true);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      window.location.href = "/professional";
    } catch {
      window.location.href = "/professional";
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void startCheckout()}
      disabled={loading}
      className="rounded-full bg-[#c65a2a] px-6 py-3 text-sm font-semibold text-white shadow-[0_18px_38px_rgba(198,90,42,0.24)] transition hover:bg-[#ad4d23] disabled:opacity-60"
    >
      {loading ? "Opening..." : label}
    </button>
  );
}
