"use client";

import { usePathname } from "next/navigation";
import FloatingWidgetMount from "./FloatingWidgetMount";

export default function FloatingWidgetGate() {
  const pathname = usePathname();

  // Never show the launcher inside the embeddable widget page.
  if (pathname === "/widget" || pathname.startsWith("/widget/")) return null;

  return <FloatingWidgetMount />;
}
