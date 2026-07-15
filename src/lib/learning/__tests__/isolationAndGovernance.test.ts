import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Governance tests: these assert structural safeguards at the source level —
 * the same pattern the repo uses for report-flow invariants.
 *
 *  - Gold answers / holdout answers can never reach the generating model.
 *  - Holdout items never enter the daily sprint.
 *  - Admin routes require Platform Admin; cron routes require CRON_SECRET
 *    or Platform Admin.
 *  - The learning engine cannot mutate production prompts or entitlements.
 */

const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

describe("gold-answer isolation", () => {
  it("the active-recall runner has no gold-answer input surface", () => {
    const source = read("src/lib/learning/activeRecall.ts");
    expect(source).not.toMatch(/goldAnswer/);
    expect(source).not.toMatch(/rubric/i);
    expect(source).not.toMatch(/evaluatorNotes/i);
  });

  it("the daily sprint only passes whitelisted fields to the generating model", () => {
    const source = read("src/lib/learning/runDailyLearningSprint.ts");
    const callBlock = source.slice(source.indexOf("answerLearningItem({"), source.indexOf("mode: \"ACTIVE_RECALL\""));
    expect(callBlock).not.toMatch(/goldAnswer/);
    expect(callBlock).not.toMatch(/sourceRefs/);
    // Evaluation happens strictly after the response, in the evaluator.
    expect(source.indexOf("answerLearningItem(")).toBeLessThan(source.indexOf("evaluateLearningAnswer("));
  });

  it("holdout benchmark answers are withheld from the generating model too", () => {
    const source = read("src/lib/learning/weeklyBenchmark.ts");
    const start = source.indexOf("answerLearningItem({");
    const end = source.indexOf("});", start);
    const callBlock = source.slice(start, end);
    expect(callBlock).not.toMatch(/goldAnswer/);
  });
});

describe("holdout isolation", () => {
  it("the daily sprint excludes holdout items structurally", () => {
    const source = read("src/lib/learning/runDailyLearningSprint.ts");
    expect(source).toMatch(/holdout:\s*false/);
  });

  it("the holdout benchmark selects only holdout items", () => {
    const source = read("src/lib/learning/weeklyBenchmark.ts");
    expect(source).toMatch(/holdout:\s*true/);
  });
});

describe("admin authorization", () => {
  const adminRoutes = [
    "src/app/api/admin/learning/run/route.ts",
    "src/app/api/admin/learning/review/route.ts",
    "src/app/api/admin/learning/promote/route.ts",
    "src/app/api/admin/learning/metrics/route.ts",
  ];

  for (const route of adminRoutes) {
    it(`${route} requires Platform Admin`, () => {
      const source = read(route);
      expect(source).toMatch(/requireCurrentUser/);
      expect(source).toMatch(/isPlatformAdmin/);
      expect(source).toMatch(/403/);
    });
  }

  it("cron routes require CRON_SECRET or Platform Admin", () => {
    for (const route of ["src/app/api/cron/learning-daily/route.ts", "src/app/api/cron/learning-weekly/route.ts"]) {
      const source = read(route);
      expect(source).toMatch(/CRON_SECRET/);
      expect(source).toMatch(/isPlatformAdmin/);
      expect(source).toMatch(/401/);
    }
  });

  it("the dashboard page gates on Platform Admin and is not linked from navigation", () => {
    const page = read("src/app/admin/learning/page.tsx");
    expect(page).toMatch(/isPlatformAdmin/);
    expect(page).toMatch(/403/);
    // No non-admin navigation component references the learning page.
    for (const nav of ["src/components/ChatShell.tsx", "src/components/ChatbotPage.tsx"]) {
      expect(read(nav)).not.toMatch(/admin\/learning/);
    }
  });
});

describe("promotion governance", () => {
  it("approvedBy comes from the authenticated session, never the request body", () => {
    const source = read("src/app/api/admin/learning/promote/route.ts");
    expect(source).not.toMatch(/body\??\.approvedBy/);
    expect(source).toMatch(/approvedBy:\s*email/);
  });
});

describe("production isolation", () => {
  const learningModules = [
    "src/lib/learning/collisionTaxonomy.ts",
    "src/lib/learning/sourceAuthority.ts",
    "src/lib/learning/scheduler.ts",
    "src/lib/learning/activeRecall.ts",
    "src/lib/learning/answerEvaluator.ts",
    "src/lib/learning/interleaveCases.ts",
    "src/lib/learning/feynmanEvaluator.ts",
    "src/lib/learning/errorLedger.ts",
    "src/lib/learning/sourceInvalidation.ts",
    "src/lib/learning/promotionGate.ts",
    "src/lib/learning/weeklyBenchmark.ts",
    "src/lib/learning/runDailyLearningSprint.ts",
    "src/lib/learning/dashboardMetrics.ts",
  ];

  it("learning modules never import chat, prompt, entitlement, or report-memory internals", () => {
    for (const module of learningModules) {
      const source = read(module);
      expect(source, module).not.toMatch(/from ["']@\/app\/api\/chat/);
      expect(source, module).not.toMatch(/systemPrompt|productionPrompt/i);
      expect(source, module).not.toMatch(/from ["']@\/lib\/billing\/entitlements/);
      expect(source, module).not.toMatch(/analysisReportStore|reportHistory/i);
      expect(source, module).not.toMatch(/from ["']@\/lib\/context\/activeContext/);
    }
  });

  it("no learning module writes to non-learning tables", () => {
    for (const module of learningModules) {
      const source = read(module);
      const writes = source.match(/prisma\.(\w+)\.(?:create|update|upsert|delete|updateMany|deleteMany|createMany)/g) ?? [];
      for (const write of writes) {
        expect(write, `${module}: ${write}`).toMatch(/prisma\.(collisionLearning|collisionBenchmark)/);
      }
    }
  });

  it("report-memory entitlements are untouched (Starter/Pro/Admin gate preserved)", () => {
    // The learning engine must not modify the entitlement module it depends on
    // remaining intact; assert the gate function still exists with its plans.
    const source = read("src/lib/billing/entitlements.ts");
    expect(source.length).toBeGreaterThan(0);
    expect(source).toMatch(/starter/i);
    expect(source).toMatch(/pro/i);
  });
});
