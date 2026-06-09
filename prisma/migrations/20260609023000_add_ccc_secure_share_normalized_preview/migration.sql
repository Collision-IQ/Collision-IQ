ALTER TABLE "CccSecureShareWebhookEvent"
  ADD COLUMN "signature_present" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "normalized_header_json" JSONB,
  ADD COLUMN "normalized_line_items_preview_json" JSONB,
  ADD COLUMN "normalized_line_item_count" INTEGER,
  ADD COLUMN "normalization_status" TEXT,
  ADD COLUMN "normalization_warnings_json" JSONB,
  ADD COLUMN "jurisdiction_state_code" TEXT,
  ADD COLUMN "jurisdiction_source" TEXT,
  ADD COLUMN "jurisdiction_confidence" TEXT,
  ADD COLUMN "vehicle_year" INTEGER,
  ADD COLUMN "vehicle_make" TEXT,
  ADD COLUMN "vehicle_model" TEXT,
  ADD COLUMN "vehicle_vin_tail" TEXT,
  ADD COLUMN "vehicle_vin_hash" TEXT,
  ADD COLUMN "normalized_at" TIMESTAMP(3);

CREATE INDEX "CccSecureShareWebhookEvent_normalization_status_idx"
  ON "CccSecureShareWebhookEvent"("normalization_status");
