/* eslint-disable @typescript-eslint/no-require-imports */
// @ts-check
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const {
  loadVerifiedRegulationSeedRecords,
} = require("../src/lib/policyLegal/verifiedRegulationSeed.cjs");

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

const REGULATION_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
  "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI",
  "WY",
];

const REGULATION_CATEGORIES = [
  "unfair_claims_practices",
  "parts_usage",
  "repair_standards",
  "steering",
  "disclosure",
  "labor_procedures",
  "total_loss",
  "diminished_value",
];

const PLACEHOLDER_CITATION = "TBD - requires official state source verification";
const VERIFIED_REGULATIONS_SEED_PATH = path.join(
  process.cwd(),
  "src",
  "lib",
  "policyLegal",
  "verifiedRegulations.seed.json"
);

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
  console.log("Seeding placeholder Regulation records...");
  await prisma.regulation.createMany({
    data: REGULATION_STATES.flatMap((state) =>
      REGULATION_CATEGORIES.map((category) => ({
        id: `${state.toLowerCase()}-${category}`,
        state,
        category,
        rule: `${category.replace(/_/g, " ")} placeholder for ${state}. Do not treat as a governing rule until verified from an official source.`,
        citation: PLACEHOLDER_CITATION,
        sourceUrl: null,
        sourceName: null,
        applicability:
          "Placeholder seed record only. Requires official state source verification before legal or regulatory support is asserted.",
        severity: "medium",
        effectiveDate: null,
        retrievedAt: null,
        verifiedBy: null,
        notes: null,
      }))
    ),
    skipDuplicates: true,
  });
  const verifiedRegulations = loadVerifiedRegulationSeedRecords(VERIFIED_REGULATIONS_SEED_PATH);
  if (verifiedRegulations.length > 0) {
    console.log(`Seeding ${verifiedRegulations.length} verified Regulation records...`);
  }
  for (const regulation of verifiedRegulations) {
    await prisma.regulation.upsert({
      where: { id: regulation.id },
      update: regulation,
      create: regulation,
    });
    console.log(`  upserted verified regulation: ${regulation.id}`);
  }
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
