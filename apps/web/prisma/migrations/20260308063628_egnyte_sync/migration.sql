-- CreateTable
CREATE TABLE "FileMirrorMap" (
    "egnytePath" TEXT NOT NULL,
    "egnyteFileId" TEXT,
    "driveFileId" TEXT NOT NULL,
    "drivePath" TEXT,
    "modifiedTime" TEXT,
    "contentHash" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileMirrorMap_pkey" PRIMARY KEY ("egnytePath")
);

-- CreateIndex
CREATE INDEX "FileMirrorMap_driveFileId_idx" ON "FileMirrorMap"("driveFileId");
