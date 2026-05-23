import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkZipBudget } from "../../src/lib/uploadSafety/zipSafety";

vi.mock("server-only", () => ({}));

const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/zip");

const saveState = vi.hoisted(() => ({
  nextId: 1,
}));

vi.mock("@/lib/auth/require-current-user", () => {
  class UnauthorizedError extends Error {
    status: number;

    constructor(message = "Unauthorized", status = 401) {
      super(message);
      this.status = status;
    }
  }

  return {
    UnauthorizedError,
    requireCurrentUser: vi.fn(async () => ({
      user: {
        id: "user-zip-test",
        email: "zip@example.com",
        createdAt: new Date("2026-01-01").toISOString(),
      },
      verifiedEmails: ["zip@example.com"],
      isPlatformAdmin: true,
    })),
  };
});

vi.mock("@/lib/auth/platform-admin", () => ({
  isPlatformAdminEmail: vi.fn(() => false),
  maskEmail: vi.fn((email: string) => email),
  normalizeEmail: vi.fn((email: string) => email.toLowerCase()),
}));

vi.mock("@/lib/billing/productEntitlements", () => ({
  canUploadFiles: vi.fn(() => true),
  getCurrentProductEntitlements: vi.fn(async () => ({
    plan: "admin",
    billingPlan: "team",
    isPlatformAdmin: true,
    entitlementSource: "free_access_admin",
    canUpload: true,
    uploadCount: 0,
    uploadCap: null,
    maxUploadsPerReview: 50,
    subscriptionStatus: "ACTIVE",
    usageStatus: "ok",
    trialActive: false,
  })),
  getCurrentSubscriptionTierForUser: vi.fn(async () => "pro"),
  resolveProductTrialActive: vi.fn(() => false),
}));

vi.mock("@/lib/billing/freeUploadEntitlements", () => ({
  FREE_MONTHLY_UPLOAD_LIMIT: 1,
  FREE_UPLOAD_BATCH_MESSAGE: "Free accounts can upload 1 file per analysis.",
  FREE_UPLOAD_LIMIT_MESSAGE: "Free monthly upload limit reached.",
  evaluateFreeUploadRequest: vi.fn(() => ({
    allowed: true,
    code: null,
    message: null,
    countedUploadCount: 1,
  })),
  getFreeUploadUsageCount: vi.fn(async () => 0),
  isFreeUploadEntitlement: vi.fn(() => false),
  recordFreeUploadUsage: vi.fn(async () => undefined),
}));

vi.mock("@/lib/billing/usage", () => {
  class UsageAccessError extends Error {
    code: string;
    status: number;

    constructor(message = "Usage denied", code = "USAGE_DENIED", status = 403) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }

  return {
    UsageAccessError,
    recordUsage: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/usage", () => ({
  getUsageCount: vi.fn(async () => 0),
  incrementUsage: vi.fn(async () => undefined),
}));

vi.mock("@/lib/uploadedAttachmentStore", () => ({
  saveUploadedAttachment: vi.fn(async (input: {
    filename: string;
    type: string;
    text: string;
    imageDataUrl?: string;
    pageCount?: number;
    classification?: string;
    sizeBytes?: number;
    source?: string;
    sourceArchive?: string;
  }) => ({
    id: `attachment-${saveState.nextId++}`,
    filename: input.filename,
    type: input.type,
    text: input.text,
    imageDataUrl: input.imageDataUrl,
    pageCount: input.pageCount,
    classification: input.classification,
    sizeBytes: input.sizeBytes,
    source: input.source,
    sourceArchive: input.sourceArchive,
  })),
}));

vi.mock("@/lib/analysisReportStore", () => ({
  getAnalysisReport: vi.fn(async () => null),
}));

vi.mock("@/lib/attachments/extractPreviewData", () => ({
  bufferToReusableDataUrl: vi.fn(({ mimeType }: { mimeType: string }) =>
    mimeType.startsWith("image/") ? "data:image/jpeg;base64,/9j/" : undefined
  ),
  extractPreviewDataFromBuffer: vi.fn(async ({
    filename,
  }: {
    filename: string;
  }) => ({
    text: `extracted text for ${filename}`,
    pageCount: filename.endsWith(".pdf") ? 1 : undefined,
  })),
}));

async function postZip(filename: string) {
  const data = fs.readFileSync(path.join(FX, filename));
  const blob = new Blob([data], { type: "application/zip" });
  const form = new FormData();
  form.append("files", blob, filename);
  const { POST } = await import("../../src/app/api/upload/route");

  return POST(
    new Request("http://localhost/api/upload", { method: "POST", body: form })
  );
}

beforeAll(() => {
  for (const fixture of ["valid.zip", "zip-slip.zip", "too-many-entries.zip", "encrypted.zip"]) {
    if (!fs.existsSync(path.join(FX, fixture))) {
      throw new Error(
        `Missing fixture: ${fixture}. Run "node tests/fixtures/zip/generate-fixtures.mjs".`
      );
    }
  }
});

beforeEach(() => {
  saveState.nextId = 1;
  vi.clearAllMocks();
});

describe("POST /api/upload - ZIP handling", () => {
  it("accepts a valid ZIP and returns the unwrapped file list", async () => {
    const res = await postZip("valid.zip");
    expect(res.status).toBe(200);
    const body = await res.json();
    const names: string[] = (body.files ?? []).map((file: { name: string }) => file.name);

    expect(names).toEqual(expect.arrayContaining(["estimate.pdf", "photo.jpg"]));
    expect(names).not.toContain("valid.zip");
  });

  it("rejects zip-slip path traversal", async () => {
    const res = await postZip("zip-slip.zip");
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json();
    expect(body.error).toBe("ZIP_UNSAFE_PATH");
  });

  it("rejects archives that exceed the entry-count cap", async () => {
    const res = await postZip("too-many-entries.zip");
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json();
    expect(body.error).toBe("ZIP_TOO_MANY_ENTRIES");
  });

  it("rejects encrypted archives without prompting for a password", async () => {
    const res = await postZip("encrypted.zip");
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json();
    expect(body.error).toBe("ZIP_ENCRYPTED");
  });

  it("reports budget failures for oversized and high-ratio archives", () => {
    expect(checkZipBudget({ uncompressed: 201 * 1024 * 1024 })).toEqual({
      ok: false,
      code: "ZIP_TOO_LARGE",
    });
    expect(checkZipBudget({ ratio: 250 })).toEqual({
      ok: false,
      code: "ZIP_BOMB_SUSPECTED",
    });
  });
});
