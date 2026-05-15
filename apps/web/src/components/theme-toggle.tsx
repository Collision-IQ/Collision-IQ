"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (theme !== "light" && theme !== "dark") {
      setTheme("dark");
    }
    setMounted(true);
  }, [setTheme, theme]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <div
      className="inline-flex h-9 shrink-0 items-center rounded-xl bg-muted/80 p-0.5 shadow-[0_8px_22px_rgba(15,23,42,0.08)] ring-1 ring-border/70 dark:shadow-[0_12px_28px_rgba(0,0,0,0.24)]"
      aria-label="Theme"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = mounted && (theme === value || (!theme && value === "dark"));

        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-[12px] font-medium transition ${
              active
                ? "bg-card text-foreground shadow-sm ring-1 ring-border/60"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-pressed={active}
            title={`${label} theme`}
          >
            <Icon className={`h-3.5 w-3.5 ${active && value === "dark" ? "text-[#C65A2A]" : ""}`} aria-hidden />
            <span className="hidden xl:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
