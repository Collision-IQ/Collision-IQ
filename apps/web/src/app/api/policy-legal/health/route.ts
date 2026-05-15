import { NextResponse } from "next/server";
import { buildPolicyLegalHealthPayload } from "@/lib/policyLegal/health";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const payload = await buildPolicyLegalHealthPayload({
    countVerifiedRegulations: () =>
      prisma.regulation.count({
        where: {
          NOT: {
            citation: {
              startsWith: "TBD",
            },
          },
        },
      }),
    findLastSnapshot: () =>
      prisma.policyLegalReviewSnapshot.findFirst({
        orderBy: [{ generatedAt: "desc" }, { createdAt: "desc" }],
        select: { generatedAt: true },
      }),
  });

  return NextResponse.json(payload);
}
