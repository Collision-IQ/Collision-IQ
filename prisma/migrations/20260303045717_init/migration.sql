-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "egnytePath" TEXT NOT NULL,
    "egnyteId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileMap" (
    "id" TEXT NOT NULL,
    "egnyteId" TEXT NOT NULL,
    "egnytePath" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "driveParentId" TEXT,
    "lastModified" TIMESTAMP(3),
    "contentHash" TEXT,
    "tombstoned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FileMap_egnyteId_key" ON "FileMap"("egnyteId");
