// @ts-check
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const SERVICE_PRICES = [
  {
    serviceType: "academy_rekey_estimating",
    stripePriceId: "price_1QekAMGG7AvpJVXdf5FBLp1J",
    label: "Rekey Estimating",
  },
  {
    serviceType: "academy_legal_assist",
    stripePriceId: "price_1QdnbrGG7AvpJVXd2yrjTpGt",
    label: "Legal Assist",
  },
  {
    serviceType: "academy_acv_review",
    stripePriceId: "price_1QdnXaGG7AvpJVXdlfq3D1hQ",
    label: "ACV Review",
  },
  {
    serviceType: "academy_appraisal",
    stripePriceId: "price_1QdnWaGG7AvpJVXdxwsB08qx",
    label: "Appraisal",
  },
  {
    serviceType: "academy_appraisal_clause",
    stripePriceId: "price_1QdnVuGG7AvpJVXdEAOGrsA1",
    label: "Right to Appraisal Clause",
  },
  {
    serviceType: "academy_value_dispute",
    stripePriceId: "price_1QdnMiGG7AvpJVXd4vKwxNJs",
    label: "Value Dispute",
  },
  {
    serviceType: "academy_diminished_value",
    stripePriceId: "price_1QdnJMGG7AvpJVXdF1C6crgE",
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
