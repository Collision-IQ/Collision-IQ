import { describe, expect, it } from "vitest";
import { canAccessRekeySheet, REKEY_SHEET_ALLOWED_EMAILS } from "./rekeyAccess";

describe("canAccessRekeySheet", () => {
  it("admits only the listed account", () => {
    expect(REKEY_SHEET_ALLOWED_EMAILS).toEqual(["vinny@collision.academy"]);
    expect(canAccessRekeySheet("vinny@collision.academy")).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(canAccessRekeySheet("  Vinny@Collision.Academy ")).toBe(true);
  });

  it("refuses every other account, including other platform admins", () => {
    expect(canAccessRekeySheet("olga@collision.academy")).toBe(false);
    expect(canAccessRekeySheet("shop@example.com")).toBe(false);
    expect(canAccessRekeySheet("vinny@collision.academy.evil.com")).toBe(false);
  });

  it("refuses a missing or empty email", () => {
    expect(canAccessRekeySheet(null)).toBe(false);
    expect(canAccessRekeySheet(undefined)).toBe(false);
    expect(canAccessRekeySheet("")).toBe(false);
  });
});
