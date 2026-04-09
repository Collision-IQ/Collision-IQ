export const runtime = "nodejs";
import { prisma } from "@/lib/prisma";

export async function POST() {
  console.info("[sync-backfill] creating backfill job");
  const job = await prisma.syncJob.create({
    data: {
      type: "BACKFILL",
      status: "pending",
      stage: "LIST",
      cursor: {}
    }
  });

  console.info("[sync-backfill] created backfill job", { jobId: job.id });
  return Response.json(job);
}
