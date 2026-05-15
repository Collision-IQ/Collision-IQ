CREATE TABLE "ExportResearchAuditSnapshot" (
  "id" TEXT NOT NULL,
  "case_id" TEXT,
  "report_type" TEXT NOT NULL,
  "snapshot_hash" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "generated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ExportResearchAuditSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExportResearchAuditSnapshot_case_id_idx" ON "ExportResearchAuditSnapshot"("case_id");
CREATE INDEX "ExportResearchAuditSnapshot_report_type_idx" ON "ExportResearchAuditSnapshot"("report_type");
CREATE INDEX "ExportResearchAuditSnapshot_generated_at_idx" ON "ExportResearchAuditSnapshot"("generated_at");
