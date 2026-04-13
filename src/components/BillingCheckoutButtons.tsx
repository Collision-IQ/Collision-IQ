"use client";

import { useState } from "react";

export default function BillingCheckoutButtons({
  userId,
}: {
  userId: string;
}) {
  const [loadingPlan, setLoadingPlan] = useState<"starter" | "pro" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(plan: "starter" | "pro") {
    try {
      setError(null);
      setLoadingPlan(plan);

      const res = await fetch("/api/billing/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ plan, userId }),
      });

      const data = await res.json().catch(() => ({}));
      console.log("checkout response:", data);

      if (!res.ok) {
        throw new Error(data?.error || `Checkout failed (${res.status})`);
      }

      if (!data?.url) {
        throw new Error("No checkout URL returned from server");
      }

      window.location.assign(data.url);
    } catch (err) {
      console.error("checkout start failed:", err);
      setError(err instanceof Error ? err.message : "Unable to start checkout");
      setLoadingPlan(null);
    }
  }

  return (
    <div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => void startCheckout("starter")}
          disabled={loadingPlan !== null}
          className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-white/85 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loadingPlan === "starter" ? "Starting Starter..." : "Choose Starter"}
        </button>

        <button
          type="button"
          onClick={() => void startCheckout("pro")}
          disabled={loadingPlan !== null}
          className="rounded-2xl bg-[#C65A2A] px-5 py-3 text-sm font-semibold text-black transition hover:bg-[#C65A2A]/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loadingPlan === "pro" ? "Starting Pro..." : "Choose Pro"}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
    </div>
  );
}
