"use client";

import { usePathname } from "next/navigation";
import FloatingWidgetMount from "./FloatingWidgetMount";

export default function FloatingWidgetGate() {
  const pathname = usePathname();

  // Never show the floating launcher inside the widget iframe page.
  if (pathname === "/widget" || pathname.startsWith("/widget/")) return null;

  // Optional: also hide on full-page chatbot route
  // if (pathname === "/chatbot" || pathname.startsWith("/chatbot/")) return null;

  return <FloatingWidgetMount />;
}
