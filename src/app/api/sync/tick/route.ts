export const runtime = "nodejs";

import { prisma } from "@/lib/prisma";

const WORKER_ID = "worker-1";
const CHUNK_SIZE = 5;
type SyncCursor = { processed: number };

async function claimJob() {
  const job = await prisma.syncJob.findFirst({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" }
  });

  if (!job) return null;

  return prisma.syncJob.update({
    where: { id: job.id },
    data: {
      status: "processing",
      lockedAt: new Date(),
      lockedBy: WORKER_ID
    }
  });
}

export async function POST() {
  const job = await claimJob();

  if (!job) {
    return Response.json({ message: "No jobs" });
  }

  try {
    const cursor =
      job.cursor && typeof job.cursor === "object" && "processed" in job.cursor
        ? (job.cursor as SyncCursor)
        : { processed: 0 };

    switch (job.stage) {

      case "LIST": {
        const remaining = 20 - cursor.processed; // simulate 20 items total
        const toProcess = Math.min(CHUNK_SIZE, remaining);

        const newProcessed = cursor.processed + toProcess;

        if (newProcessed >= 20) {
          await prisma.syncJob.update({
            where: { id: job.id },
            data: {
              stage: "MIRROR_FOLDERS",
              cursor: { processed: 0 }
            }
          });
        } else {
          await prisma.syncJob.update({
            where: { id: job.id },
            data: {
              cursor: { processed: newProcessed }
            }
          });
        }

        break;
      }

      case "MIRROR_FOLDERS": {
        const remaining = 10 - cursor.processed;
        const toProcess = Math.min(CHUNK_SIZE, remaining);
        const newProcessed = cursor.processed + toProcess;

        if (newProcessed >= 10) {
          await prisma.syncJob.update({
            where: { id: job.id },
            data: {
              stage: "MIRROR_FILES",
              cursor: { processed: 0 }
            }
          });
        } else {
          await prisma.syncJob.update({
            where: { id: job.id },
            data: {
              cursor: { processed: newProcessed }
            }
          });
        }

        break;
      }

      case "MIRROR_FILES": {
        const remaining = 15 - cursor.processed;
        const toProcess = Math.min(CHUNK_SIZE, remaining);
        const newProcessed = cursor.processed + toProcess;

        if (newProcessed >= 15) {
          await prisma.syncJob.update({
            where: { id: job.id },
            data: {
              status: "complete"
            }
          });
        } else {
          await prisma.syncJob.update({
            where: { id: job.id },
            data: {
              cursor: { processed: newProcessed }
            }
          });
        }

        break;
      }

      default:
        throw new Error(`Unknown stage: ${job.stage}`);
    }

    return Response.json({ success: true });

  } catch (err) {
    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        attempts: { increment: 1 },
        errorMessage: String(err)
      }
    });

    return Response.json({ error: String(err) }, { status: 500 });
  }
}
