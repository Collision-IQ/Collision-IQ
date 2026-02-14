"use client";

import type { ReactNode } from "react";

export default function WidgetClient({
  children,
}: {
  children: ReactNode;
}) {
  // In Next.js App Router, client components render directly.
  // No mounted-state logic needed.
  return <>{children}</>;
}
