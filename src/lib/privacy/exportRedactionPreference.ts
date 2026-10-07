/**
 * THE USER'S EXPORT REDACTION CHOICE.
 *
 * One switch, remembered, that every export reads: the chat download, the
 * client-built report PDFs (customer, snapshot, carrier, rebuttal) and the
 * server-built report PDFs (Citation Density, Forensic, Appraisal Dispute,
 * OEM). Default is ON — privacy fails closed: a reader with no stored choice,
 * a blocked or private-mode storage, or a server render all redact.
 *
 * Remembered per browser (localStorage). Every read and write is wrapped:
 * storage can throw (private mode, blocked site data) and must never break an
 * export — it falls back to redacting.
 *
 * Turning redaction OFF never releases licensed estimating-guide addresses;
 * those are a licensing rule, not a privacy one, and stay scrubbed
 * (redactExternalDocumentUrls).
 */
const STORAGE_KEY = "collision-iq:export-redaction:v1";
const listeners = new Set<() => void>();
/** Set only when storage refused a write, so the toggle still works this session. */
let memoryOverride: boolean | null = null;

/** True when exports should be redacted. Always true outside a browser. */
export function readExportRedactionPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeExportRedactionPreference(redact: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, redact ? "on" : "off");
  } catch {
    // Storage unavailable: the choice holds for this page only.
    memoryOverride = redact;
  }
  for (const listener of listeners) listener();
}

/** The effective choice, including a session-only choice storage refused. */
export function currentExportRedaction(): boolean {
  return memoryOverride ?? readExportRedactionPreference();
}

export function subscribeExportRedaction(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/**
 * The request flag a server export route reads. Explicit in every body, so a
 * route never infers the user's choice: `false` only when the user unchecked
 * the box.
 */
export function exportRedactionRequestFlag(): { redactSensitive: boolean } {
  return { redactSensitive: currentExportRedaction() };
}
