"use client";

import { useId, useSyncExternalStore } from "react";
import {
  currentExportRedaction,
  subscribeExportRedaction,
  writeExportRedactionPreference,
} from "@/lib/privacy/exportRedactionPreference";

/** The remembered export redaction choice, shared by every toggle on the page. */
export function useExportRedaction(): [boolean, (redact: boolean) => void] {
  const redact = useSyncExternalStore(subscribeExportRedaction, currentExportRedaction, () => true);
  return [redact, writeExportRedactionPreference];
}

/**
 * "Redact exports" checkbox. Checked (the default) removes owner name, claim
 * and policy numbers, addresses and the last 8 of the VIN from every download;
 * unchecked exports the file as written. The choice is remembered.
 */
export function ExportRedactionToggle({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const [redact, setRedact] = useExportRedaction();
  const id = useId();
  return (
    <label
      htmlFor={id}
      title={
        redact
          ? "Downloads remove owner name, claim/policy numbers, addresses and the last 8 of the VIN. Uncheck to export unredacted."
          : "Downloads are NOT redacted: names, claim numbers and full VINs will print. Check to redact."
      }
      className={[
        "inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md border px-2 font-medium transition",
        compact ? "min-h-9 py-1.5 text-[11px]" : "min-h-10 py-2 text-xs",
        redact
          ? "border-border bg-card text-muted-foreground hover:text-foreground"
          : "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        className,
      ].join(" ")}
      data-tour="redact-toggle"
    >
      <input
        id={id}
        type="checkbox"
        checked={redact}
        onChange={(event) => setRedact(event.target.checked)}
        className="h-3.5 w-3.5 accent-[#E4571C]"
      />
      {redact ? "Redact exports" : "Unredacted"}
    </label>
  );
}
