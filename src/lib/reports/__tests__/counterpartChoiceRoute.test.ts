/**
 * The Delta Citation Density route asks which upload is the insurer's
 * estimate when nothing printed settles it (counterpartChoice), and takes the
 * answer on the next request (comparisonDocumentId). An answer naming
 * anything but one of the case's comparison estimates is refused, never
 * ignored. The stores, auth and the network retrieval lane are stubbed; the
 * route and the builder run as in production.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";

const store = vi.hoisted(() => ({
  attachments: [] as Array<{ id: string; filename: string; type: string; text: string; imageDataUrl: string }>,
  evidenceRegistry: [] as Array<{ id: string; label: string; sourceType: string }>,
}));

vi.mock("@/lib/auth/require-current-user", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireCurrentUser: vi.fn(async () => ({ user: { id: "user-1" } })),
}));
vi.mock("@/lib/analysisReportStore", () => ({
  getAnalysisReport: vi.fn(async () => ({
    id: "case-1",
    artifactIds: store.attachments.map((attachment) => attachment.id),
    // A case with no analysis findings yet: the required report arrays, empty.
    report: {
      summary: { riskScore: "low", confidence: "low", criticalIssues: 0, evidenceQuality: "weak" },
      issues: [],
      requiredProcedures: [],
      presentProcedures: [],
      missingProcedures: [],
      supplementOpportunities: [],
      evidence: [],
      recommendedActions: [],
      evidenceRegistry: store.evidenceRegistry,
    },
  })),
  getLatestActiveAnalysisReport: vi.fn(async () => null),
}));
vi.mock("@/lib/uploadedAttachmentStore", () => ({
  getUploadedAttachments: vi.fn(async (ids: string[]) => store.attachments.filter((attachment) => ids.includes(attachment.id))),
}));
vi.mock("@/lib/reports/oemAuthorityRetrieval", () => ({
  buildOemAuthorityTrace: vi.fn(async () => null),
  mapAuthorityTraceToResolvedAuthorities: vi.fn(() => []),
}));

import { POST } from "@/app/api/reports/citation-density/annotated-estimate/route";

async function pdfOf(lines: string[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  lines.forEach((text, index) => page.drawText(text, { x: 42, y: 752 - index * 16, size: 9, font }));
  return `data:application/pdf;base64,${Buffer.from(await pdf.save()).toString("base64")}`;
}

const shopLines = ["Preliminary Estimate", "Claim #: 00-0000000-01", "Net Cost of Repairs $28,840.26", "155 Repl RT Side rail 5760153070 727.53 12.5"];
const versionLines = ["Preliminary Estimate", "Claim #: 00-0000000-01", "Net Cost of Repairs $20,100.00", "31 Repl RT Side rail 57601-53070 727.53 2.5"];
const carrierLines = ["Supplement of Record S2", "Claim #: 00-0000000-01", "Total Cost of Repairs $15,441.55", "31 Repl RT Side rail 57601-53070 727.53 2.5"];

const post = (body: Record<string, unknown>) =>
  POST(new Request("http://localhost/api/reports/citation-density/annotated-estimate", { method: "POST", body: JSON.stringify({ caseId: "case-1", ...body }) }));

describe("the route asks which upload is the insurer's estimate, and takes the answer", () => {
  let attachments: typeof store.attachments;
  beforeAll(async () => {
    process.env.CITATION_DENSITY_RELEASE_GATE = "off";
    const attach = async (id: string, filename: string, lines: string[]) => ({ id, filename, type: "application/pdf", text: lines.join("\n"), imageDataUrl: await pdfOf(lines) });
    attachments = [
      await attach("shop-final", "Shop Final Estimate.pdf", shopLines),
      await attach("final", "22279 final.pdf", versionLines),
      await attach("b", "22279 b.pdf", carrierLines),
    ];
  });
  beforeEach(() => {
    store.attachments = attachments;
    store.evidenceRegistry = [];
  });
  const annotateOurs = { selectedSourceDocumentId: "shop-final", selectedEstimateRole: "shop" };

  it("returns the question when nothing printed settles which comparison is the insurer's", async () => {
    const response = await post(annotateOurs);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.plainSummaryArtifactId).toBeUndefined();
    expect(body.counterpartChoice).toMatchObject({ required: true, confirmedByUser: false });
    expect(body.counterpartChoice.candidates.map((candidate: { sourceDocumentId: string }) => candidate.sourceDocumentId).sort()).toEqual(["b", "final"]);
  }, 60_000);

  it("compares the estimate the user names as the insurer's", async () => {
    const response = await post({ ...annotateOurs, comparisonDocumentId: "b" });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.counterpartChoice).toMatchObject({ required: false, confirmedByUser: true, comparedDocumentId: "b" });
    expect(body.warnings.join("\n")).toContain("Compared against 22279 b.pdf, which you identified as the insurer's estimate. Not compared: 22279 final.pdf.");
  }, 60_000);

  it("annotating both estimates, the answer applies to the run it is a comparison for", async () => {
    // Two estimates the case classified: ours and the insurer's.
    store.attachments = attachments.filter((attachment) => attachment.id !== "final");
    store.evidenceRegistry = [
      { id: "shop-final", label: "Shop Final Estimate.pdf", sourceType: "shop_estimate" },
      { id: "b", label: "22279 b.pdf", sourceType: "carrier_estimate" },
    ];
    const response = await post({ targetEstimate: "both", comparisonDocumentId: "b" });
    const body = await response.json();
    expect(response.status).toBe(200);
    const byId = new Map(body.outputs.map((output: { sourceDocumentId: string }) => [output.sourceDocumentId, output]));
    expect([...byId.keys()].sort()).toEqual(["b", "shop-final"]);
    // Our estimate's run takes the answer; the insurer's own run (b annotated) is not refused for it.
    expect((byId.get("shop-final") as { warnings: string[] }).warnings.join("\n")).toContain("Compared against 22279 b.pdf, which you identified as the insurer's estimate.");
  }, 120_000);

  it("refuses an answer that is the annotated estimate or not on the case", async () => {
    for (const comparisonDocumentId of ["shop-final", "someone-elses-upload"]) {
      const response = await post({ ...annotateOurs, comparisonDocumentId });
      const body = await response.json();
      expect(response.status).toBe(400);
      expect(body.userMessage).toMatch(/The estimate chosen as the insurer's is not one of this case's other estimates/);
    }
  }, 60_000);
});
