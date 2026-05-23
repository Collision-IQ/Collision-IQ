-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriptionPlan') THEN
    CREATE TYPE "SubscriptionPlan" AS ENUM ('STARTER', 'PRO', 'TEAM');
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriptionStatus') THEN
    CREATE TYPE "SubscriptionStatus" AS ENUM (
      'INCOMPLETE',
      'INCOMPLETE_EXPIRED',
      'TRIALING',
      'ACTIVE',
      'PAST_DUE',
      'CANCELED',
      'UNPAID',
      'PAUSED'
    );
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ShopRole') THEN
    CREATE TYPE "ShopRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ConsentStatus') THEN
    CREATE TYPE "ConsentStatus" AS ENUM ('ACCEPTED', 'REVOKED', 'EXPIRED');
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UsageKind') THEN
    CREATE TYPE "UsageKind" AS ENUM ('ANALYSIS_COMPLETED');
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ArtifactOwnerType') THEN
    CREATE TYPE "ArtifactOwnerType" AS ENUM ('ANONYMOUS', 'USER', 'SHOP');
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT NOT NULL,
  "clerkUserId" TEXT NOT NULL,
  "email" TEXT,
  "firstName" TEXT,
  "lastName" TEXT,
  "imageUrl" TEXT,
  "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
  "defaultShopId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Shop" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "stripeCustomerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ShopMembership" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "ShopRole" NOT NULL DEFAULT 'MEMBER',
  "isSeatActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ShopMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Subscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "shopId" TEXT,
  "stripeCustomerId" TEXT,
  "stripeSubscriptionId" TEXT,
  "stripePriceId" TEXT,
  "plan" "SubscriptionPlan" NOT NULL DEFAULT 'STARTER',
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'INCOMPLETE',
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "UsageRecord" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "shopId" TEXT,
  "subscriptionId" TEXT,
  "kind" "UsageKind" NOT NULL,
  "periodKey" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ChatConsent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "ConsentStatus" NOT NULL DEFAULT 'ACCEPTED',
  "acceptedAt" TIMESTAMP(3) NOT NULL,
  "termsVersion" TEXT NOT NULL,
  "privacyVersion" TEXT NOT NULL,
  "checkboxChecked" BOOLEAN NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "sessionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ChatConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FeatureOverride" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "shopId" TEXT,
  "featureKey" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "notes" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FeatureOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "UploadedAttachment" (
  "id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "imageDataUrl" TEXT,
  "pageCount" INTEGER,
  "ownerType" "ArtifactOwnerType" NOT NULL,
  "ownerId" TEXT NOT NULL,
  "sessionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UploadedAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AnalysisReport" (
  "id" TEXT NOT NULL,
  "ownerType" "ArtifactOwnerType" NOT NULL,
  "ownerId" TEXT NOT NULL,
  "sessionId" TEXT,
  "report" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AnalysisReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AnalysisReportArtifact" (
  "reportId" TEXT NOT NULL,
  "attachmentId" TEXT NOT NULL,

  CONSTRAINT "AnalysisReportArtifact_pkey" PRIMARY KEY ("reportId","attachmentId")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_clerkUserId_key" ON "User"("clerkUserId");
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "Shop_slug_key" ON "Shop"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Shop_stripeCustomerId_key" ON "Shop"("stripeCustomerId");
CREATE INDEX IF NOT EXISTS "ShopMembership_userId_idx" ON "ShopMembership"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "ShopMembership_shopId_userId_key" ON "ShopMembership"("shopId", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");
CREATE INDEX IF NOT EXISTS "Subscription_userId_idx" ON "Subscription"("userId");
CREATE INDEX IF NOT EXISTS "Subscription_shopId_idx" ON "Subscription"("shopId");
CREATE INDEX IF NOT EXISTS "Subscription_status_idx" ON "Subscription"("status");
CREATE INDEX IF NOT EXISTS "UsageRecord_userId_kind_periodKey_idx" ON "UsageRecord"("userId", "kind", "periodKey");
CREATE INDEX IF NOT EXISTS "UsageRecord_shopId_kind_periodKey_idx" ON "UsageRecord"("shopId", "kind", "periodKey");
CREATE INDEX IF NOT EXISTS "ChatConsent_userId_acceptedAt_idx" ON "ChatConsent"("userId", "acceptedAt");
CREATE INDEX IF NOT EXISTS "FeatureOverride_userId_featureKey_idx" ON "FeatureOverride"("userId", "featureKey");
CREATE INDEX IF NOT EXISTS "FeatureOverride_shopId_featureKey_idx" ON "FeatureOverride"("shopId", "featureKey");
CREATE INDEX IF NOT EXISTS "UploadedAttachment_ownerType_ownerId_createdAt_idx" ON "UploadedAttachment"("ownerType", "ownerId", "createdAt");
CREATE INDEX IF NOT EXISTS "UploadedAttachment_sessionId_createdAt_idx" ON "UploadedAttachment"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "AnalysisReport_ownerType_ownerId_createdAt_idx" ON "AnalysisReport"("ownerType", "ownerId", "createdAt");
CREATE INDEX IF NOT EXISTS "AnalysisReport_sessionId_createdAt_idx" ON "AnalysisReport"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "AnalysisReportArtifact_attachmentId_idx" ON "AnalysisReportArtifact"("attachmentId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Shop_ownerId_fkey') THEN
    ALTER TABLE "Shop"
      ADD CONSTRAINT "Shop_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_defaultShopId_fkey') THEN
    ALTER TABLE "User"
      ADD CONSTRAINT "User_defaultShopId_fkey"
      FOREIGN KEY ("defaultShopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShopMembership_shopId_fkey') THEN
    ALTER TABLE "ShopMembership"
      ADD CONSTRAINT "ShopMembership_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShopMembership_userId_fkey') THEN
    ALTER TABLE "ShopMembership"
      ADD CONSTRAINT "ShopMembership_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Subscription_userId_fkey') THEN
    ALTER TABLE "Subscription"
      ADD CONSTRAINT "Subscription_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Subscription_shopId_fkey') THEN
    ALTER TABLE "Subscription"
      ADD CONSTRAINT "Subscription_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UsageRecord_userId_fkey') THEN
    ALTER TABLE "UsageRecord"
      ADD CONSTRAINT "UsageRecord_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UsageRecord_shopId_fkey') THEN
    ALTER TABLE "UsageRecord"
      ADD CONSTRAINT "UsageRecord_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UsageRecord_subscriptionId_fkey') THEN
    ALTER TABLE "UsageRecord"
      ADD CONSTRAINT "UsageRecord_subscriptionId_fkey"
      FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatConsent_userId_fkey') THEN
    ALTER TABLE "ChatConsent"
      ADD CONSTRAINT "ChatConsent_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FeatureOverride_userId_fkey') THEN
    ALTER TABLE "FeatureOverride"
      ADD CONSTRAINT "FeatureOverride_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FeatureOverride_shopId_fkey') THEN
    ALTER TABLE "FeatureOverride"
      ADD CONSTRAINT "FeatureOverride_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AnalysisReportArtifact_reportId_fkey') THEN
    ALTER TABLE "AnalysisReportArtifact"
      ADD CONSTRAINT "AnalysisReportArtifact_reportId_fkey"
      FOREIGN KEY ("reportId") REFERENCES "AnalysisReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AnalysisReportArtifact_attachmentId_fkey') THEN
    ALTER TABLE "AnalysisReportArtifact"
      ADD CONSTRAINT "AnalysisReportArtifact_attachmentId_fkey"
      FOREIGN KEY ("attachmentId") REFERENCES "UploadedAttachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
