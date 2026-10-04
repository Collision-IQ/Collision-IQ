/**
 * Report PDFs reach the client under Vercel's 4.5 MB response limit, from any
 * instance. RO 21548's response was 3.68 MB, 85% of it the Citation Density
 * copy embedded inline, and its download links worked only on the instance
 * that built them (in-memory, 30 minutes).
 *
 * Each PDF is stored in the private Blob store under its owner; a response
 * over the budget leaves out stored PDFs, largest first, and the download
 * route serves an owner's stored copy when memory does not have it. The Blob
 * SDK is replaced by an in-memory store; the route and builder run as in
 * production.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";

const blobs = vi.hoisted(() => ({
  files: new Map<string, { bytes: Buffer; uploadedAt: Date }>(),
  failPut: false,
}));
vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string, body: Buffer, options: { access: string; contentType: string }) => {
    if (blobs.failPut) throw new Error("store unavailable");
    expect(options).toMatchObject({ access: "private", contentType: "application/pdf" });
    blobs.files.set(pathname, { bytes: Buffer.from(body), uploadedAt: new Date() });
    return { pathname, url: `https://store.example/${pathname}` };
  }),
  get: vi.fn(async (pathname: string, options: { access: string }) => {
    expect(options).toMatchObject({ access: "private" });
    const file = blobs.files.get(pathname);
    if (!file) return null;
    return { statusCode: 200, stream: new Blob([file.bytes]).stream(), blob: { contentType: "application/pdf" } };
  }),
  list: vi.fn(async ({ prefix }: { prefix: string }) => ({
    blobs: [...blobs.files.entries()]
      .filter(([pathname]) => pathname.startsWith(prefix))
      .map(([pathname, file]) => ({ pathname, url: `https://store.example/${pathname}`, uploadedAt: file.uploadedAt })),
  })),
  del: vi.fn(async (urls: string[]) => {
    for (const url of urls) blobs.files.delete(url.replace("https://store.example/", ""));
  }),
}));

const store = vi.hoisted(() => ({ attachments: [] as Array<{ id: string; filename: string; type: string; text: string; imageDataUrl: string }> }));
vi.mock("@/lib/auth/require-current-user", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireCurrentUser: vi.fn(async () => ({ user: { id: "user-1" } })),
}));
vi.mock("@/lib/analysisReportStore", () => ({
  getAnalysisReport: vi.fn(async () => ({
    id: "case-1",
    artifactIds: store.attachments.map((attachment) => attachment.id),
    report: {
      summary: { riskScore: "low", confidence: "low", criticalIssues: 0, evidenceQuality: "weak" },
      issues: [],
      requiredProcedures: [],
      presentProcedures: [],
      missingProcedures: [],
      supplementOpportunities: [],
      evidence: [],
      recommendedActions: [],
      evidenceRegistry: [],
    },
  })),
  getLatestActiveAnalysisReport: vi.fn(async () => null),
  saveCounterpartAnswer: vi.fn(async () => true),
}));
vi.mock("@/lib/uploadedAttachmentStore", () => ({
  getUploadedAttachments: vi.fn(async (ids: string[]) => store.attachments.filter((attachment) => ids.includes(attachment.id))),
}));
vi.mock("@/lib/reports/oemAuthorityRetrieval", () => ({
  buildOemAuthorityTrace: vi.fn(async () => null),
  mapAuthorityTraceToResolvedAuthorities: vi.fn(() => []),
}));

import { GET, POST } from "@/app/api/reports/citation-density/annotated-estimate/route";
import { requireCurrentUser } from "@/lib/auth/require-current-user";
import {
  inlinePdfsToDrop,
  reportExportPathname,
  safePdfFilename,
  saveReportExports,
} from "@/lib/reports/reportExportStore";

async function pdfOf(lines: string[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  lines.forEach((text, index) => page.drawText(text, { x: 42, y: 752 - index * 16, size: 9, font }));
  return `data:application/pdf;base64,${Buffer.from(await pdf.save()).toString("base64")}`;
}
const shopLines = ["Preliminary Estimate", "Claim #: 00-0000000-01", "Net Cost of Repairs $28,840.26", "155 Repl RT Side rail 5760153070 727.53 12.5"];
const carrierLines = ["Supplement of Record S2", "Claim #: 00-0000000-01", "Total Cost of Repairs $15,441.55", "31 Repl RT Side rail 57601-53070 727.53 2.5"];
const post = () =>
  POST(
    new Request("http://localhost/api/reports/citation-density/annotated-estimate", {
      method: "POST",
      body: JSON.stringify({ caseId: "case-1", selectedSourceDocumentId: "shop", selectedEstimateRole: "shop", comparisonDocumentId: "sor" }),
    })
  );
const idOf = (url: string) => new URL(url, "http://localhost").searchParams.get("artifactId")!;
const UUID = "0f8e2c1a-5b3d-4e6f-8a9b-1c2d3e4f5a6b";

describe("the store holds each owner's PDFs", () => {
  beforeEach(() => {
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    blobs.files.clear();
    blobs.failPut = false;
  });
  afterEach(() => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });

  it("writes private PDFs under the owner, and only for export ids", async () => {
    const stored = await saveReportExports("user-1", [
      { exportId: UUID, bytes: new Uint8Array([1, 2, 3]) },
      { exportId: "../user-2/stolen", bytes: new Uint8Array([4]) },
    ]);
    expect([...stored]).toEqual([UUID]);
    expect([...blobs.files.keys()]).toEqual([`reports/delta/user-1/${UUID}.pdf`]);
    expect(reportExportPathname("user-1", "../x")).toBeNull();
  });

  it("a write that fails is not reported as stored, so that PDF stays inline", async () => {
    blobs.failPut = true;
    expect((await saveReportExports("user-1", [{ exportId: UUID, bytes: new Uint8Array([1]) }])).size).toBe(0);
  });

  it("nothing is stored when no store is configured", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect((await saveReportExports("user-1", [{ exportId: UUID, bytes: new Uint8Array([1]) }])).size).toBe(0);
    expect(blobs.files.size).toBe(0);
  });

  it("prunes the owner's reports older than the retention window", async () => {
    blobs.files.set("reports/delta/user-1/old.pdf", { bytes: Buffer.from([1]), uploadedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) });
    blobs.files.set("reports/delta/user-2/old.pdf", { bytes: Buffer.from([1]), uploadedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) });
    await saveReportExports("user-1", [{ exportId: UUID, bytes: new Uint8Array([1]) }]);
    expect(blobs.files.has("reports/delta/user-1/old.pdf")).toBe(false);
    expect(blobs.files.has("reports/delta/user-2/old.pdf")).toBe(true);
  });
});

describe("what leaves the response", () => {
  it("nothing when the response fits; else stored PDFs, largest first, only as many as it takes", () => {
    const inline = [
      { id: "cd", base64Length: 3_090_000 },
      { id: "dispute", base64Length: 126_000 },
      { id: "forensic", base64Length: 39_000 },
    ];
    const stored = new Set(["cd", "dispute", "forensic"]);
    expect(inlinePdfsToDrop({ responseBytes: 3_400_000, inline, stored }).size).toBe(0);
    expect([...inlinePdfsToDrop({ responseBytes: 3_620_000, inline, stored })]).toEqual(["cd"]);
    // A PDF the store does not hold is never left out: its bytes are its only copy.
    expect([...inlinePdfsToDrop({ responseBytes: 3_620_000, inline, stored: new Set(["dispute"]) })]).toEqual(["dispute"]);
  });

  it("a download name cannot break its header", () => {
    expect(safePdfFilename('evil"\r\nSet-Cookie: x', "r.pdf")).toBe("evilSet-Cookie x.pdf");
    expect(safePdfFilename(undefined, "r.pdf")).toBe("r.pdf");
  });
});

describe("the route, end to end", () => {
  beforeAll(async () => {
    process.env.CITATION_DENSITY_RELEASE_GATE = "off";
    const attach = async (id: string, filename: string, lines: string[]) => ({ id, filename, type: "application/pdf", text: lines.join("\n"), imageDataUrl: await pdfOf(lines) });
    store.attachments = [await attach("shop", "Shop Final Estimate.pdf", shopLines), await attach("sor", "22279 b.pdf", carrierLines)];
  });
  beforeEach(() => {
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    blobs.files.clear();
    blobs.failPut = false;
  });
  afterEach(() => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.CITATION_DENSITY_RESPONSE_BUDGET_BYTES;
  });

  it("a response under the budget keeps every PDF inline, as before, and stores them too", async () => {
    const body = await (await post()).json();
    expect(typeof body.pdfBase64).toBe("string");
    expect(typeof body.findingsReportPdfBase64).toBe("string");
    expect(blobs.files.has(`reports/delta/user-1/${idOf(body.downloadUrl)}.pdf`)).toBe(true);
    expect(body.downloadUrl).toMatch(/&name=.+\.pdf$/);
  }, 60_000);

  it("over the budget, stored PDFs leave the response and their links serve them", async () => {
    process.env.CITATION_DENSITY_RESPONSE_BUDGET_BYTES = "1000";
    const response = await post();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.pdfBase64).toBeUndefined();
    expect(body.findingsReportPdfBase64).toBeUndefined();
    for (const url of [body.downloadUrl, body.findingsReportUrl]) {
      const pdf = await GET(new Request(`http://localhost${url}`));
      expect(pdf.status).toBe(200);
      expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    }
  }, 60_000);

  it("over the budget with the store down, the PDFs stay inline: never a response with no copy", async () => {
    process.env.CITATION_DENSITY_RESPONSE_BUDGET_BYTES = "1000";
    blobs.failPut = true;
    const body = await (await post()).json();
    expect(typeof body.pdfBase64).toBe("string");
  }, 60_000);

  it("a link another instance built is served from the owner's stored copy, never another user's", async () => {
    blobs.files.set(`reports/delta/user-1/${UUID}.pdf`, { bytes: Buffer.from("%PDF-1.7 stored"), uploadedAt: new Date() });
    const own = await GET(new Request(`http://localhost/api/reports/citation-density/annotated-estimate?artifactId=${UUID}&name=Forensic%20Estimate%20Analysis.pdf`));
    expect(own.status).toBe(200);
    expect(own.headers.get("Content-Disposition")).toBe('attachment; filename="Forensic Estimate Analysis.pdf"');
    expect(await own.text()).toBe("%PDF-1.7 stored");
    vi.mocked(requireCurrentUser).mockResolvedValueOnce({ user: { id: "user-2" } } as never);
    expect((await GET(new Request(`http://localhost/api/reports/citation-density/annotated-estimate?artifactId=${UUID}`))).status).toBe(404);
  });
});
