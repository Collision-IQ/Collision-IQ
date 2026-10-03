/**
 * The user's answer to which upload is the insurer's estimate, saved with the
 * case, against a real Postgres: saveCounterpartAnswer sets only
 * report.counterpartAnswers[annotated estimate] in one statement, is
 * owner-scoped, and a full rewrite of the report (a re-analysis) keeps it.
 *
 * Runs when TEST_DATABASE_URL names a database migrated with
 * prisma/migrations; skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RepairIntelligenceReport } from "@/lib/ai/types/analysis";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("counterpart answers saved with the case (Postgres)", () => {
  let store: typeof import("@/lib/analysisReportStore");
  const created: string[] = [];
  const baseReport = {
    summary: { riskScore: "low", confidence: "low", criticalIssues: 0, evidenceQuality: "weak" },
    issues: [],
    requiredProcedures: [],
    presentProcedures: [],
    missingProcedures: [],
    supplementOpportunities: [],
    evidence: [],
    recommendedActions: [],
    analysis: { marker: "analysis written before the answer" },
  } as unknown as RepairIntelligenceReport;
  const answer = (insurerDocumentId: string) => ({ insurerDocumentId, candidateIds: ["sor1", "doe"], answeredAt: "2026-10-03T03:00:00.000Z" });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    store = await import("@/lib/analysisReportStore");
  });
  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.analysisReport.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  });
  const newCase = async (ownerUserId = "user-1", report = baseReport) => {
    const saved = await store.saveAnalysisReport({ ownerUserId, artifactIds: [], report });
    created.push(saved.id);
    return saved.id;
  };
  const read = async (id: string, ownerUserId = "user-1") => (await store.getAnalysisReport(id, { ownerUserId }))!.report;

  it("sets only the answer for that annotated estimate, leaving the rest of the report", async () => {
    const id = await newCase();
    expect(await store.saveCounterpartAnswer({ reportId: id, ownerUserId: "user-1", annotatedDocumentId: "shop-final", answer: answer("sor1") })).toBe(true);
    expect(await store.saveCounterpartAnswer({ reportId: id, ownerUserId: "user-1", annotatedDocumentId: "shop-posttd", answer: answer("doe") })).toBe(true);
    // A new answer for the same estimate replaces the old one.
    expect(await store.saveCounterpartAnswer({ reportId: id, ownerUserId: "user-1", annotatedDocumentId: "shop-final", answer: answer("doe") })).toBe(true);
    const report = await read(id);
    expect(report.counterpartAnswers).toEqual({ "shop-final": answer("doe"), "shop-posttd": answer("doe") });
    expect((report as unknown as { analysis: unknown }).analysis).toEqual({ marker: "analysis written before the answer" });
    expect(report.summary.riskScore).toBe("low");
  });

  it("never writes another owner's case", async () => {
    const id = await newCase("user-1");
    expect(await store.saveCounterpartAnswer({ reportId: id, ownerUserId: "user-2", annotatedDocumentId: "shop-final", answer: answer("sor1") })).toBe(false);
    expect(await store.saveCounterpartAnswer({ reportId: "no-such-case", ownerUserId: "user-1", annotatedDocumentId: "shop-final", answer: answer("sor1") })).toBe(false);
    expect((await read(id)).counterpartAnswers).toBeUndefined();
  });

  it("a re-analysis that rewrites the report keeps the saved answers", async () => {
    const id = await newCase();
    await store.saveCounterpartAnswer({ reportId: id, ownerUserId: "user-1", annotatedDocumentId: "shop-final", answer: answer("sor1") });
    const rewritten = { ...baseReport, analysis: { marker: "re-analysis" } } as unknown as RepairIntelligenceReport;
    await store.updateAnalysisReport({ id, ownerUserId: "user-1", artifactIds: [], report: rewritten });
    const report = await read(id);
    expect(report.counterpartAnswers).toEqual({ "shop-final": answer("sor1") });
    expect((report as unknown as { analysis: unknown }).analysis).toEqual({ marker: "re-analysis" });
  });

  it("starts the answers afresh when the stored key is not an object", async () => {
    const id = await newCase("user-1", { ...baseReport, counterpartAnswers: null } as unknown as RepairIntelligenceReport);
    expect(await store.saveCounterpartAnswer({ reportId: id, ownerUserId: "user-1", annotatedDocumentId: "shop-final", answer: answer("sor1") })).toBe(true);
    expect((await read(id)).counterpartAnswers).toEqual({ "shop-final": answer("sor1") });
  });
});
