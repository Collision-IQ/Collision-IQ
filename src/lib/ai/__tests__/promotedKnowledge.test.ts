import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPromotedKnowledgeDirective,
  isEntryInScope,
  PROMOTED_KNOWLEDGE_MAX_ITEMS,
  selectPromotedEntries,
  type PromotedKnowledgeEntry,
} from "@/lib/ai/promotedKnowledgeDirective";

const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

function entry(overrides: Partial<PromotedKnowledgeEntry> = {}): PromotedKnowledgeEntry {
  return {
    slug: "base-item",
    domain: "structural",
    objective: "Sectioning the rear rail requires the OEM-specified weld pattern.",
    keyPoints: ["Use the OEM weld pattern."],
    forbiddenAssertions: [],
    authorityMentions: [],
    sources: [],
    oem: null,
    jurisdiction: null,
    vehicleScopeLabel: null,
    safetyCritical: false,
    ...overrides,
  };
}

describe("scope containment", () => {
  it("manufacturer-neutral knowledge applies everywhere", () => {
    expect(isEntryInScope(entry(), { oem: "Honda" })).toBe(true);
    expect(isEntryInScope(entry(), {})).toBe(true);
  });

  it("never applies one manufacturer's requirement to another", () => {
    const honda = entry({ oem: "Honda" });
    expect(isEntryInScope(honda, { oem: "Toyota" })).toBe(false);
  });

  it("withholds OEM-scoped knowledge when the manufacturer is unknown", () => {
    // Silence is safer than cross-applying a procedure to an unknown vehicle.
    expect(isEntryInScope(entry({ oem: "Honda" }), {})).toBe(false);
    expect(isEntryInScope(entry({ oem: "Honda" }), { oem: null })).toBe(false);
  });

  it("matches scope case-insensitively", () => {
    expect(isEntryInScope(entry({ oem: "Honda" }), { oem: "honda" })).toBe(true);
  });

  it("confines jurisdiction-scoped knowledge to its jurisdiction", () => {
    const pa = entry({ jurisdiction: "PA" });
    expect(isEntryInScope(pa, { jurisdiction: "PA" })).toBe(true);
    expect(isEntryInScope(pa, { jurisdiction: "TX" })).toBe(false);
    expect(isEntryInScope(pa, {})).toBe(false);
  });

  it("requires every declared scope to match", () => {
    const scoped = entry({ oem: "Honda", jurisdiction: "PA" });
    expect(isEntryInScope(scoped, { oem: "Honda", jurisdiction: "PA" })).toBe(true);
    expect(isEntryInScope(scoped, { oem: "Honda", jurisdiction: "TX" })).toBe(false);
  });
});

describe("selection", () => {
  it("orders safety-critical knowledge first, then deterministically by slug", () => {
    const selection = selectPromotedEntries(
      [
        entry({ slug: "zeta" }),
        entry({ slug: "alpha" }),
        entry({ slug: "omega", safetyCritical: true }),
      ],
      {}
    );
    expect(selection.selected.map((item) => item.slug)).toEqual(["omega", "alpha", "zeta"]);
  });

  it("caps the number of injected items so case evidence is never crowded out", () => {
    const many = Array.from({ length: PROMOTED_KNOWLEDGE_MAX_ITEMS + 5 }, (_, index) =>
      entry({ slug: `item-${String(index).padStart(3, "0")}` })
    );
    const selection = selectPromotedEntries(many, {});
    expect(selection.selected).toHaveLength(PROMOTED_KNOWLEDGE_MAX_ITEMS);
    expect(selection.omittedForBudget).toBe(5);
  });

  it("reports out-of-scope omissions rather than dropping them silently", () => {
    const selection = selectPromotedEntries([entry({ oem: "Honda" }), entry({ slug: "b" })], {
      oem: "Toyota",
    });
    expect(selection.omittedForScope).toBe(1);
    expect(selection.selected.map((item) => item.slug)).toEqual(["b"]);
  });
});

describe("directive rendering", () => {
  it("returns an empty string when nothing is in scope so the caller can drop it", () => {
    expect(buildPromotedKnowledgeDirective([])).toBe("");
  });

  it("labels scope on every entry and marks safety-critical knowledge", () => {
    const text = buildPromotedKnowledgeDirective([
      entry({ oem: "Honda", jurisdiction: "PA", safetyCritical: true }),
    ]);
    expect(text).toContain("[SAFETY-CRITICAL]");
    expect(text).toContain("scope: Honda; PA");
  });

  it("marks manufacturer-neutral knowledge explicitly rather than leaving scope blank", () => {
    expect(buildPromotedKnowledgeDirective([entry()])).toContain(
      "scope: manufacturer-neutral; jurisdiction-neutral"
    );
  });

  it("subordinates promoted knowledge to uploaded case evidence", () => {
    const text = buildPromotedKnowledgeDirective([entry()]);
    expect(text).toMatch(/case evidence always outranks/i);
  });

  it("forbids presenting promoted knowledge as a retrieved citation", () => {
    const text = buildPromotedKnowledgeDirective([entry()]);
    expect(text).toMatch(/not .*retrieved for this turn/i);
    expect(text).toMatch(/do not claim to have looked them up/i);
  });

  it("carries forbidden assertions through as explicit prohibitions", () => {
    const text = buildPromotedKnowledgeDirective([
      entry({ forbiddenAssertions: ["all vehicles require calibration"] }),
    ]);
    expect(text).toContain("Do not assert: all vehicles require calibration");
  });
});

describe("promotion governance on the read side", () => {
  const loader = "src/lib/ai/promotedKnowledge.ts";

  it("injects only PROMOTED items — never DRAFT, VERIFIED, RETIRED or INVALIDATED", () => {
    const source = read(loader);
    expect(source).toMatch(/status:\s*"PROMOTED"/);
    for (const status of ["DRAFT", "VERIFIED", "RETIRED", "INVALIDATED"]) {
      expect(source, `must not query ${status}`).not.toContain(`"${status}"`);
    }
  });

  it("structurally excludes holdout items so benchmarks stay honest", () => {
    expect(read(loader)).toMatch(/holdout:\s*false/);
  });

  it("never selects the recall prompt or source locators into the live prompt", () => {
    const source = read(loader);
    const select = source.slice(source.indexOf("select: {"), source.indexOf("});", source.indexOf("select: {")));
    expect(select).not.toMatch(/\bprompt:\s*true/);
    expect(select).not.toMatch(/\blocator\b/);
  });

  it("degrades to no directive instead of failing the chat turn", () => {
    const source = read(loader);
    expect(source).toMatch(/catch/);
    expect(source.slice(source.indexOf("catch"))).toMatch(/return "";/);
  });

  it("keeps the one-way direction: the learning engine still never writes prompts", () => {
    // The read side lives outside src/lib/learning precisely so the engine's
    // production-isolation invariant stays literally true.
    const source = read(loader);
    expect(source).not.toMatch(/prisma\.\w+\.(?:create|update|upsert|delete)/);
    for (const modulePath of ["src/lib/learning/promotionGate.ts", "src/lib/learning/runDailyLearningSprint.ts"]) {
      expect(read(modulePath)).not.toMatch(/promotedKnowledge/i);
    }
  });
});

describe("chat wiring", () => {
  const route = read("src/app/api/chat/route.ts");

  it("reaches both the researched and quick chat prompt stacks", () => {
    expect(route).toMatch(/promotedKnowledgeDirective,/);
    expect(route).toMatch(/promotedKnowledge:\s*promotedKnowledgeDirective/);
  });

  it("scopes the injection to the active case vehicle and request jurisdiction", () => {
    const call = route.slice(
      route.indexOf("buildPromotedKnowledgeSystemDirective({"),
      route.indexOf("});", route.indexOf("buildPromotedKnowledgeSystemDirective({"))
    );
    expect(call).toMatch(/oem:\s*openActiveCase\?\.vehicle\.make/);
    expect(call).toMatch(/jurisdiction:\s*body\.jurisdiction\?\.stateCode/);
  });
});
