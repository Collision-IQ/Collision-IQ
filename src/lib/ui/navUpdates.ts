"use client";

import { useSyncExternalStore } from "react";

/**
 * Sidebar update indicators: a red dot on a left-rail item whenever that
 * section has something new (reports generated, vehicle maintenance due).
 * Flags persist in localStorage and clear when the user opens the section.
 */

export type NavUpdateSection =
  | "workspace"
  | "evidence"
  | "vehicle"
  | "scaniq"
  | "reports"
  | "history";

const STORAGE_KEY = "ciq_nav_updates_v1";
const CHANGE_EVENT = "ciq-nav-updates-changed";

type NavUpdateFlags = Partial<Record<NavUpdateSection, boolean>>;

const EMPTY_FLAGS: NavUpdateFlags = {};
let cachedRaw: string | null = null;
let cachedFlags: NavUpdateFlags = EMPTY_FLAGS;

function readFlags(): NavUpdateFlags {
  if (typeof window === "undefined") return EMPTY_FLAGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw) return cachedFlags;
    cachedRaw = raw;
    cachedFlags = raw ? ((JSON.parse(raw) as NavUpdateFlags) ?? EMPTY_FLAGS) : EMPTY_FLAGS;
    return cachedFlags;
  } catch {
    return EMPTY_FLAGS;
  }
}

function writeFlags(flags: NavUpdateFlags) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
  } catch {
    // Non-persistent environments still get in-session dots via the event.
    cachedRaw = null;
    cachedFlags = flags;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function markNavUpdate(section: NavUpdateSection) {
  const flags = { ...readFlags() };
  if (flags[section]) return;
  flags[section] = true;
  writeFlags(flags);
}

export function clearNavUpdate(section: NavUpdateSection) {
  const flags = { ...readFlags() };
  if (!flags[section]) return;
  delete flags[section];
  writeFlags(flags);
}

function subscribe(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function useNavUpdateFlags(): NavUpdateFlags {
  return useSyncExternalStore(subscribe, readFlags, () => EMPTY_FLAGS);
}

/**
 * Remember which maintenance-due set the user has already been notified
 * about, so the vehicle dot fires only when the due picture CHANGES.
 */
export function markVehicleMaintenanceIfChanged(dueKeys: string[]) {
  if (typeof window === "undefined" || dueKeys.length === 0) return;
  const fingerprint = [...dueKeys].sort().join("|");
  try {
    const seen = window.localStorage.getItem(`${STORAGE_KEY}:vehicle-due`);
    if (seen === fingerprint) return;
    window.localStorage.setItem(`${STORAGE_KEY}:vehicle-due`, fingerprint);
  } catch {
    // fall through — still mark once per session
  }
  markNavUpdate("vehicle");
}
