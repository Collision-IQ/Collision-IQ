import { describe, expect, it } from "vitest";
import {
  composeInterleavedCasePrompt,
  interleaveLearningItems,
  isWellInterleaved,
} from "../interleaveCases";

function item(id: string, domain: string) {
  return { id, domain };
}

describe("interleaveLearningItems", () => {
  it("avoids consecutive same-domain items when alternatives exist", () => {
    const items = [
      item("a1", "adas-calibration"),
      item("a2", "adas-calibration"),
      item("a3", "adas-calibration"),
      item("e1", "estimating"),
      item("e2", "estimating"),
      item("s1", "structural-repair"),
    ];
    const mixed = interleaveLearningItems(items);
    expect(mixed).toHaveLength(items.length);
    expect(new Set(mixed.map((entry) => entry.id)).size).toBe(items.length);
    expect(isWellInterleaved(mixed)).toBe(true);
  });

  it("keeps single-domain batches intact", () => {
    const items = [item("a", "glass"), item("b", "glass"), item("c", "glass")];
    expect(interleaveLearningItems(items).map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("preserves within-domain ordering (safety-critical first ordering survives)", () => {
    const items = [
      item("critical-1", "srs"),
      item("normal-1", "estimating"),
      item("critical-2", "srs"),
      item("normal-2", "estimating"),
    ];
    const mixed = interleaveLearningItems(items);
    const srsOrder = mixed.filter((entry) => entry.domain === "srs").map((entry) => entry.id);
    expect(srsOrder).toEqual(["critical-1", "critical-2"]);
  });
});

describe("composeInterleavedCasePrompt", () => {
  it("combines multiple domains into one case with numbered asks and no answers", () => {
    const prompt = composeInterleavedCasePrompt([
      { id: "1", domain: "damage-analysis", safetyCritical: false, objective: "o1", prompt: "Identify damage migration paths." },
      { id: "2", domain: "adas-calibration", safetyCritical: true, objective: "o2", prompt: "Which sensors require calibration?" },
      { id: "3", domain: "estimating", safetyCritical: false, objective: "o3", prompt: "Which operations are not-included?" },
    ]);
    expect(prompt).toContain("damage-analysis");
    expect(prompt).toContain("adas-calibration");
    expect(prompt).toContain("estimating");
    expect(prompt).toContain("1. Identify damage migration paths.");
    expect(prompt).toContain("3. Which operations are not-included?");
    expect(prompt.toLowerCase()).not.toContain("gold");
    expect(prompt.toLowerCase()).not.toContain("answer key");
  });
});
