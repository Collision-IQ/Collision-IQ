CREATE TABLE "ReportSend" (
    "id" TEXT NOT NULL,
    "caseId" TEXT,
    "reportType" TEXT NOT NULL,
    "destinationType" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "resendId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "rawEvent" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSend_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportSend_caseId_idx" ON "ReportSend"("caseId");
CREATE INDEX "ReportSend_resendId_idx" ON "ReportSend"("resendId");
CREATE INDEX "ReportSend_reportType_idx" ON "ReportSend"("reportType");
CREATE INDEX "ReportSend_destinationType_idx" ON "ReportSend"("destinationType");
CREATE INDEX "ReportSend_status_idx" ON "ReportSend"("status");
