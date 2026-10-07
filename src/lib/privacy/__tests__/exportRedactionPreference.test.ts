/**
 * The "Redact exports" checkbox: one remembered choice every export reads.
 * Privacy fails closed — no browser, no stored choice, or storage that throws
 * all mean REDACT.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  currentExportRedaction,
  exportRedactionRequestFlag,
  readExportRedactionPreference,
  subscribeExportRedaction,
  writeExportRedactionPreference,
} from "../exportRedactionPreference";

type FakeWindow = {
  localStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void };
  addEventListener(): void;
  removeEventListener(): void;
};

function installWindow(storage: FakeWindow["localStorage"]) {
  (globalThis as unknown as { window?: FakeWindow }).window = {
    localStorage: storage,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

function memoryStorage(): FakeWindow["localStorage"] {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: FakeWindow }).window;
});

describe("export redaction preference", () => {
  it("redacts on the server (no window)", () => {
    expect(readExportRedactionPreference()).toBe(true);
    expect(exportRedactionRequestFlag()).toEqual({ redactSensitive: true });
  });

  it("redacts by default when the user never chose", () => {
    installWindow(memoryStorage());
    expect(currentExportRedaction()).toBe(true);
  });

  it("remembers an unchecked box, and a re-checked one, and notifies listeners", () => {
    installWindow(memoryStorage());
    let notified = 0;
    const unsubscribe = subscribeExportRedaction(() => {
      notified += 1;
    });
    writeExportRedactionPreference(false);
    expect(currentExportRedaction()).toBe(false);
    expect(exportRedactionRequestFlag()).toEqual({ redactSensitive: false });
    writeExportRedactionPreference(true);
    expect(currentExportRedaction()).toBe(true);
    expect(notified).toBe(2);
    unsubscribe();
  });

  it("falls back to redacting when storage throws on read", () => {
    installWindow({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    });
    expect(readExportRedactionPreference()).toBe(true);
  });
});
