/**
 * CR-3 (Citation fix v2): Mitchell bold rows print every glyph twice. The
 * collapse is structure-keyed (even chars == odd chars), with the CR-3a row
 * guard so a real 4-digit value never collapses on a plain row. Test 100 read
 * neither totals block because of this; the same doubling hid the changelog
 * header ("DDeellttaa RReeppoorrtt") from a raw-string marker check.
 */
import { describe, expect, it } from "vitest";
import { normalizeOverprintLine, normalizeOverprintText } from "../overprintNormalize";
import { parseEstimateNetTotal } from "../estimateDeltaMatcher";
import { readClaimIdentity } from "../claimIdentityGate";

describe("overprint collapse", () => {
  it("collapses doubled money and doubled words", () => {
    expect(normalizeOverprintLine("$$77,,117744..8811")).toBe("$7,174.81");
    expect(normalizeOverprintLine("DDeellttaa RReeppoorrtt")).toBe("Delta Report");
  });

  it("CR-3a: a uniform token survives on a plain row, collapses on a bold row", () => {
    // "1111" alone is far more likely a real qty/part-code/year than bold "11".
    expect(normalizeOverprintLine("qty 1111 shims")).toBe("qty 1111 shims");
    // The same token on a row that PROVES it is bold collapses with the rest.
    expect(normalizeOverprintLine("QQttyy 1111 SShhiimmss")).toBe("Qty 11 Shims");
  });

  it("splits fused money tokens", () => {
    expect(normalizeOverprintLine("$411.60$411.60")).toBe("$411.60 $411.60");
    expect(normalizeOverprintLine("3.1$100.00")).toBe("3.1 $100.00");
  });

  it("is the identity on plain CCC text", () => {
    const line = "155 Repl RT Side rail 5760153070 727.53 12.5";
    expect(normalizeOverprintLine(line)).toBe(line);
  });
});

describe("normalization feeds the readers (R-2)", () => {
  it("parseEstimateNetTotal reads a bold Mitchell totals line", () => {
    expect(parseEstimateNetTotal("TToottaall CCoosstt ooff RReeppaaiirrss $$77,,117744..8811")).toBe(
      7174.81
    );
  });

  it("readClaimIdentity reads a bold header once normalized", () => {
    const raw = "CCllaaiimm ##:: 00883355118855443300\nVVIINN:: 55FFNNYYFF88HH5588PPBB000011002222";
    const identity = readClaimIdentity(normalizeOverprintText(raw));
    expect(identity.claimNumber).toBe("0835185430");
    expect(identity.vin).toBe("5FNYF8H58PB001022");
  });
});
