import { NextResponse } from "next/server";
import { buildPolicyLegalSnapshotsEndpointResult } from "@/lib/policyLegal/snapshotsEndpoint";
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
    const result = await buildPolicyLegalSnapshotsEndpointResult({
      caseId: url.searchParams.get("caseId"),
      claimId: url.searchParams.get("claimId"),
      currentUser: {
        isPlatformAdmin: currentUser.isPlatformAdmin,
      },
      findSnapshots: ({ caseId, claimId }) =>
        prisma.policyLegalReviewSnapshot.findMany({
          where: {
            ...(caseId ? { caseId } : {}),
            ...(claimId ? { claimId } : {}),
          },
          orderBy: [{ generatedAt: "desc" }, { createdAt: "desc" }],
        }),
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[policy-legal-snapshots] failed", error);
    return NextResponse.json({ error: "Unable to load policy/legal snapshots." }, { status: 500 });
  }
}
