// Subscription conversion funnel, derived entirely from rows the app already
// writes — no event table, no client tracker — so it reaches back to launch
// instead of starting the day it shipped:
//
//   signed_up         User.createdAt
//   first_upload      earliest UploadedAttachment owned by the user (or a shop
//                     the user belongs to)
//   first_report      earliest AnalysisReport, same ownership rule
//   checkout_started  earliest Subscription row carrying a stripeCustomerId —
//                     /api/billing/checkout creates it the first time a user
//                     is sent to Stripe
//   subscribed        a Subscription with a stripeSubscriptionId (Stripe
//                     confirmed it), whatever its status today
//
// Each stage counts the accounts where that event actually happened; stages
// are NOT forced to be cumulative, so an account that subscribed without ever
// uploading is reported as exactly that.
//
// Known limit: only the FIRST checkout per account leaves a row, so repeat
// abandoned checkouts are not counted.

export const FUNNEL_STAGES = [
  "signed_up",
  "first_upload",
  "first_report",
  "checkout_started",
  "subscribed",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const FUNNEL_STAGE_LABELS: Record<FunnelStage, string> = {
  signed_up: "Signed up",
  first_upload: "First upload",
  first_report: "First report",
  checkout_started: "Checkout started",
  subscribed: "Subscribed",
};

export type FunnelAccountInput = {
  userId: string;
  email: string | null;
  name: string | null;
  signedUpAt: Date;
  firstUploadAt: Date | null;
  firstReportAt: Date | null;
  checkoutStartedAt: Date | null;
  subscribedAt: Date | null;
  /** Current Stripe status of the subscription, when one exists. */
  subscriptionStatus: string | null;
  valueIqPaidAt: Date | null;
};

export type FunnelAccount = FunnelAccountInput & {
  furthestStage: FunnelStage;
  /** Checkout started, no confirmed subscription — the outreach list. */
  abandonedCheckout: boolean;
  daysSinceSignup: number;
};

export type FunnelStageSummary = {
  stage: FunnelStage;
  label: string;
  count: number;
  /** Share of signups, 0–100, one decimal; null when there are no signups. */
  pctOfSignups: number | null;
};

export type ConversionFunnel = {
  stages: FunnelStageSummary[];
  abandonedCheckouts: number;
  valueIqPurchases: number;
  accounts: FunnelAccount[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function stageTimestamp(account: FunnelAccountInput, stage: FunnelStage): Date | null {
  switch (stage) {
    case "signed_up":
      return account.signedUpAt;
    case "first_upload":
      return account.firstUploadAt;
    case "first_report":
      return account.firstReportAt;
    case "checkout_started":
      return account.checkoutStartedAt;
    case "subscribed":
      return account.subscribedAt;
  }
}

export function furthestStageOf(account: FunnelAccountInput): FunnelStage {
  for (let index = FUNNEL_STAGES.length - 1; index >= 0; index -= 1) {
    if (stageTimestamp(account, FUNNEL_STAGES[index])) return FUNNEL_STAGES[index];
  }
  return "signed_up";
}

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

/** Pure: every input is passed in, including `now`, so it is testable. */
export function buildConversionFunnel(
  inputs: FunnelAccountInput[],
  now: Date
): ConversionFunnel {
  const accounts: FunnelAccount[] = inputs.map((account) => ({
    ...account,
    furthestStage: furthestStageOf(account),
    abandonedCheckout: Boolean(account.checkoutStartedAt) && !account.subscribedAt,
    daysSinceSignup: Math.max(0, Math.floor((now.getTime() - account.signedUpAt.getTime()) / DAY_MS)),
  }));

  const signups = accounts.length;
  const stages = FUNNEL_STAGES.map((stage) => {
    const count = accounts.filter((account) => stageTimestamp(account, stage)).length;
    return { stage, label: FUNNEL_STAGE_LABELS[stage], count, pctOfSignups: pct(count, signups) };
  });

  const rank = (stage: FunnelStage) => FUNNEL_STAGES.indexOf(stage);
  // Furthest along first (they are closest to paying), newest signup first
  // within a stage.
  accounts.sort(
    (left, right) =>
      rank(right.furthestStage) - rank(left.furthestStage) ||
      right.signedUpAt.getTime() - left.signedUpAt.getTime()
  );

  return {
    stages,
    abandonedCheckouts: accounts.filter((account) => account.abandonedCheckout).length,
    valueIqPurchases: accounts.filter((account) => account.valueIqPaidAt).length,
    accounts,
  };
}
