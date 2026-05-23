-- CreateTable
CREATE TABLE "ServicePriceConfig" (
    "serviceType" TEXT NOT NULL,
    "stripePriceId" TEXT NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicePriceConfig_pkey" PRIMARY KEY ("serviceType")
);
