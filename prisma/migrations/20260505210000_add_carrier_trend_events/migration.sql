CREATE TABLE "CarrierTrendEvent" (
  "id" TEXT NOT NULL,
  "carrier_key" TEXT NOT NULL,
  "carrier_name" TEXT NOT NULL,
  "source_report_hash" TEXT NOT NULL,
  "event_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "denied_operation_count" INTEGER NOT NULL DEFAULT 0,
  "calibration_dispute_count" INTEGER NOT NULL DEFAULT 0,
  "labor_suppression_count" INTEGER NOT NULL DEFAULT 0,
  "recurring_omission_count" INTEGER NOT NULL DEFAULT 0,
  "supplement_opportunity_count" INTEGER NOT NULL DEFAULT 0,
  "supplement_approved_count" INTEGER NOT NULL DEFAULT 0,
  "denied_operations" JSONB NOT NULL,
  "calibration_operations" JSONB NOT NULL,
  "labor_suppression_operations" JSONB NOT NULL,
  "omitted_operations" JSONB NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CarrierTrendEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CarrierTrendEvent_source_report_hash_key" ON "CarrierTrendEvent"("source_report_hash");
CREATE INDEX "CarrierTrendEvent_carrier_key_idx" ON "CarrierTrendEvent"("carrier_key");
CREATE INDEX "CarrierTrendEvent_event_date_idx" ON "CarrierTrendEvent"("event_date");
