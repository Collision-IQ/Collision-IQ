"use client";

import type { ReactNode } from "react";
import { useState } from "react";

type TechnicalSystemCheckoutPlan =
  | "shop_flow"
  | "parts_app"
  | "shop_hub"
  | "executive_onboarding"
  | "virtual_onboarding";

type TechnicalSystemCheckoutButtonProps = {
  plan: TechnicalSystemCheckoutPlan;
  children: ReactNode;
  className?: string;
};

async function startCheckout(plan: TechnicalSystemCheckoutPlan) {
  const response = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  });

  const data = (await response.json().catch(() => null)) as
    | { url?: string; error?: string }
    | null;

  if (data?.url) {
    window.location.href = data.url;
    return;
  }

  throw new Error(data?.error || "Unable to start checkout.");
}

export function TechnicalSystemCheckoutButton({
  plan,
  children,
  className,
}: TechnicalSystemCheckoutButtonProps) {
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    try {
      setError(null);
      setIsRedirecting(true);
      await startCheckout(plan);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Unable to start checkout.");
      setIsRedirecting(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isRedirecting}
        className={className}
      >
        {isRedirecting ? "Redirecting..." : children}
      </button>
      {error ? (
        <span className="max-w-xs text-sm leading-5 text-red-700 dark:text-red-300">
          {error}
        </span>
      ) : null}
    </span>
  );
}
