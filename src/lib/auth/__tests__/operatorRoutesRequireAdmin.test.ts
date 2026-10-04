/**
 * Drive ingest, RAG re-indexing and debug probe routes spend model, embedding
 * and Drive quota and write to document_chunks. They were reachable by anyone
 * with the URL; they now answer only a signed-in platform admin.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => {
  class UnauthorizedError extends Error {
    status = 401;
  }
  return { requireCurrentUser: vi.fn(), UnauthorizedError };
});

vi.mock("@/lib/auth/require-current-user", () => ({
  requireCurrentUser: auth.requireCurrentUser,
  UnauthorizedError: auth.UnauthorizedError,
}));

describe("requirePlatformAdminResponse", () => {
  beforeEach(() => {
    auth.requireCurrentUser.mockReset();
  });

  it("returns 401 for a signed-out caller", async () => {
    auth.requireCurrentUser.mockImplementation(() => {
      throw new auth.UnauthorizedError("Authentication required.");
    });
    const { requirePlatformAdminResponse } = await import("@/lib/auth/requirePlatformAdminResponse");
    const response = await requirePlatformAdminResponse();
    expect(response?.status).toBe(401);
  });

  it("returns 403 for a signed-in caller who is not a platform admin", async () => {
    auth.requireCurrentUser.mockResolvedValue({ isPlatformAdmin: false });
    const { requirePlatformAdminResponse } = await import("@/lib/auth/requirePlatformAdminResponse");
    const response = await requirePlatformAdminResponse();
    expect(response?.status).toBe(403);
  });

  it("lets a platform admin through", async () => {
    auth.requireCurrentUser.mockResolvedValue({ isPlatformAdmin: true });
    const { requirePlatformAdminResponse } = await import("@/lib/auth/requirePlatformAdminResponse");
    expect(await requirePlatformAdminResponse()).toBeNull();
  });
});

describe("operator routes check for a platform admin before doing any work", () => {
  const apiRoot = path.join(process.cwd(), "src/app/api");
  const operatorDirs = ["drive", "rag", "debug"];
  const routeFiles = operatorDirs.flatMap((dir) => listRouteFiles(path.join(apiRoot, dir)));

  it("finds the operator routes", () => {
    expect(routeFiles.length).toBeGreaterThanOrEqual(10);
  });

  it.each(routeFiles.map((file) => [path.relative(process.cwd(), file), file]))(
    "%s: every handler starts with the admin guard",
    (_name, file) => {
      const source = fs.readFileSync(file, "utf8");
      const handlers = [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\([^)]*\)[^{]*\{\s*([^\n]*)/g)];
      expect(handlers.length).toBeGreaterThan(0);
      for (const [, method, firstStatement] of handlers) {
        expect(firstStatement, `${method} must call the guard first`).toBe(
          "const denied = await requirePlatformAdminResponse();"
        );
      }
      expect(source).not.toMatch(/export const (GET|POST|PUT|PATCH|DELETE)\b/);
    }
  );
});

function listRouteFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listRouteFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}
