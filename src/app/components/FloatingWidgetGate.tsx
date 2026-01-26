"use client";

import { usePathname } from "next/navigation";
import FloatingWidgetMount from "./FloatingWidgetMount";

export default function FloatingWidgetGate() {
  const pathname = usePathname();

  // Never show the floating launcher inside the widget iframe page.
  if (pathname.startsWith("/widget")) return null;

  // Optional: also hide on the full-page chat view
  // if (pathname.startsWith("/chatbot")) return null;

  return <FloatingWidgetMount />;
}
