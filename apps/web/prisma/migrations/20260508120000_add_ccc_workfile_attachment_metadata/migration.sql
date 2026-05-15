ALTER TABLE "UploadedAttachment"
ADD COLUMN "classification" TEXT,
ADD COLUMN "sizeBytes" INTEGER,
ADD COLUMN "sha256" TEXT,
ADD COLUMN "metadata" JSONB,
ADD COLUMN "source" TEXT,
ADD COLUMN "sourceArchive" TEXT;

CREATE INDEX "UploadedAttachment_classification_idx" ON "UploadedAttachment"("classification");
CREATE INDEX "UploadedAttachment_sha256_idx" ON "UploadedAttachment"("sha256");
