// @ts-check
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const SERVICE_PRICES = [
  {
    serviceType: "academy_rekey_estimating",
    stripePriceId: requiredEnv("STRIPE_PRICE_RE-KEY_APPRAISAL_ID"),
    label: "Rekey Estimating",
  },
  {
    serviceType: "academy_legal_assist",
    stripePriceId: requiredEnv("STRIPE_PRICE_LEGAL_ASSIST_ID"),
    label: "Legal Assist",
  },
  {
    serviceType: "academy_acv_review",
    stripePriceId: requiredEnv("STRIPE_PRICE_ACTUAL_COST_VALUE"),
    label: "ACV Review",
  },
  {
    serviceType: "academy_appraisal",
    stripePriceId: requiredEnv("STRIPE_PRICE_APPRAISAL_ID"),
    label: "Appraisal",
  },
  {
    serviceType: "academy_appraisal_clause",
    stripePriceId: requiredEnv("STRIPE_RIGHT_TO_APPRAISAL_ID"),
    label: "Right to Appraisal Clause",
  },
  {
    serviceType: "academy_value_dispute",
    stripePriceId: requiredEnv("STRIPE_PRICE_VALUE_DISPUTE_ID"),
    label: "Value Dispute",
  },
  {
    serviceType: "academy_diminished_value",
    stripePriceId: requiredEnv("STRIPE_PRICE_DIMINISHED_VALUE_ID"),
    label: "Diminished Value",
  },
];

async function main() {
  console.log("Seeding ServicePriceConfig...");
  for (const entry of SERVICE_PRICES) {
    await prisma.servicePriceConfig.upsert({
      where: { serviceType: entry.serviceType },
      update: { stripePriceId: entry.stripePriceId, label: entry.label },
      create: entry,
    });
    console.log(`  upserted: ${entry.serviceType} → ${entry.stripePriceId}`);
  }
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
