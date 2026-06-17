"use client";

import type { ThemeProviderProps } from "next-themes";

export function ThemeProvider({ children }: ThemeProviderProps) {
  return <>{children}</>;
}
