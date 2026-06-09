CREATE TABLE "CccSecureShareWebhookEvent" (
  "id" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "environment_source" TEXT NOT NULL,
  "request_kind" TEXT NOT NULL,
  "app_id" TEXT,
  "trigger" TEXT,
  "rq_uid" TEXT,
  "raw_xml_sha256" TEXT,
  "body_length" INTEGER NOT NULL DEFAULT 0,
  "content_type" TEXT,
  "source_ip" TEXT,
  "header_names_json" JSONB NOT NULL DEFAULT '[]',
  "secret_present" BOOLEAN NOT NULL DEFAULT false,
  "secret_matched" BOOLEAN NOT NULL DEFAULT false,
  "duplicate" BOOLEAN NOT NULL DEFAULT false,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processing_status" TEXT NOT NULL DEFAULT 'received',
  "parse_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CccSecureShareWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CccSecureShareWebhookEvent_environment_rq_uid_idx"
  ON "CccSecureShareWebhookEvent"("environment", "rq_uid");

CREATE INDEX "CccSecureShareWebhookEvent_environment_received_at_idx"
  ON "CccSecureShareWebhookEvent"("environment", "received_at");

CREATE INDEX "CccSecureShareWebhookEvent_request_kind_idx"
  ON "CccSecureShareWebhookEvent"("request_kind");

CREATE INDEX "CccSecureShareWebhookEvent_processing_status_idx"
  ON "CccSecureShareWebhookEvent"("processing_status");
