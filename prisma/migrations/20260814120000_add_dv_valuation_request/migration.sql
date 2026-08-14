-- Paid self-service ACV + Diminished Value generator requests.
-- Lifecycle: draft -> paid -> processing -> ready (or failed).
CREATE TABLE "DvValuationRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "attachmentId" TEXT,
    "extraction" JSONB,
    "intake" JSONB,
    "result" JSONB,
    "stripeSessionId" TEXT,
    "paidAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DvValuationRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DvValuationRequest_stripeSessionId_key"
  ON "DvValuationRequest"("stripeSessionId");

CREATE INDEX "DvValuationRequest_userId_idx" ON "DvValuationRequest"("userId");

CREATE INDEX "DvValuationRequest_status_idx" ON "DvValuationRequest"("status");
