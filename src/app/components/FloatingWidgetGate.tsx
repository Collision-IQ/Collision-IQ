"use client";

import { usePathname } from "next/navigation";
import FloatingWidgetMount from "./FloatingWidgetMount";

export default function FloatingWidgetGate() {
  const pathname = usePathname();
  if (pathname === "/widget" || pathname.startsWith("/widget/")) return null;
  return <FloatingWidgetMount />;
}
