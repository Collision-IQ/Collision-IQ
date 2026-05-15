import { NextResponse } from "next/server";
import { buildPolicyLegalAccessLogData } from "@/lib/policyLegal/audit";
import {
  buildPolicyLegalRegulationsEndpointResult,
  validateRegulationStateParam,
} from "@/lib/policyLegal/regulationsEndpoint";
import { observePolicyLegalRegulationAccess } from "@/lib/policyLegal/observability";
import { prisma } from "@/lib/prisma";
import {
  UnauthorizedError,
  requireCurrentUser,
} from "@/lib/auth/require-current-user";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const currentUser = await requireCurrentUser();

    const url = new URL(req.url);
    const result = await buildPolicyLegalRegulationsEndpointResult({
      state: url.searchParams.get("state"),
      currentUser: {
        isPlatformAdmin: currentUser.isPlatformAdmin,
      },
      bypassCache: process.env.NODE_ENV === "test",
      findRegulations: (state) =>
        prisma.regulation.findMany({
          where: { state },
          orderBy: [{ state: "asc" }, { category: "asc" }],
        }),
      logAccess: (entry) =>
        prisma.policyLegalRegulationAccessLog.create({
          data: buildPolicyLegalAccessLogData({
            userId: currentUser.user.id,
            state: entry.state,
            requestId:
              req.headers.get("x-request-id") ??
              req.headers.get("x-vercel-id") ??
              null,
            cacheStatus: entry.cacheStatus,
            status: entry.status,
            totalCount: entry.totalCount,
            verifiedCount: entry.verifiedCount,
            placeholderCount: entry.placeholderCount,
          }),
        }).then(() => undefined),
    });

    return NextResponse.json(result.body, {
      status: result.status,
      headers: result.cacheStatus ? { "x-policy-legal-cache": result.cacheStatus } : undefined,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      const url = new URL(req.url);
      const accessEvent = {
        state: validateRegulationStateParam(url.searchParams.get("state")),
        status: error.status,
        totalCount: 0,
        verifiedCount: 0,
        placeholderCount: 0,
        cacheStatus: null,
      };
      observePolicyLegalRegulationAccess(accessEvent);

      await prisma.policyLegalRegulationAccessLog
        .create({
          data: buildPolicyLegalAccessLogData({
            userId: null,
            state: accessEvent.state,
            requestId:
              req.headers.get("x-request-id") ??
              req.headers.get("x-vercel-id") ??
              null,
            cacheStatus: accessEvent.cacheStatus,
            status: accessEvent.status,
          }),
        })
        .catch((logError) => {
          console.error("[policy-legal-regulations] access log failed", logError);
        });

      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[policy-legal-regulations] failed", error);
    return NextResponse.json({ error: "Unable to load policy/legal regulations." }, { status: 500 });
  }
}
