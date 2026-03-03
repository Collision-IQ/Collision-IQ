export const runtime = "nodejs";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const job = await prisma.syncJob.create({
    data: {
      type: "BACKFILL",
      status: "pending",
      stage: "LIST",
      cursor: {}
    }
  });

  return Response.json(job);
}