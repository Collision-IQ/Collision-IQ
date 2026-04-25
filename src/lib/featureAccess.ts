export type ProductPlan = "none" | "starter" | "pro" | "team" | "admin" | "NONE" | "STARTER" | "PRO" | "TEAM" | "ADMIN";

export type ProductFeature =
  | "snapshot_export"
  | "full_report_export"
  | "dispute_report_export"
  | "rebuttal_export"
  | "customer_report_export"
  | "chat_report_recommendations"
  | "crm_sync";

export function normalizeProductPlan(plan: ProductPlan | string | null | undefined) {
  const normalized = `${plan ?? "none"}`.toLowerCase();
  if (normalized === "admin") return "admin";
  if (normalized === "team") return "team";
  if (normalized === "pro") return "pro";
  if (normalized === "starter") return "starter";
  return "none";
}

export function canAccessFeature(
  plan: ProductPlan | string | null | undefined,
  feature: ProductFeature
): boolean {
  const normalized = normalizeProductPlan(plan);

  if (normalized === "admin" || normalized === "team") {
    return true;
  }

  if (feature === "snapshot_export") {
    return normalized === "starter" || normalized === "pro";
  }

  if (normalized === "pro") {
    return true;
  }

  return false;
}

export function buildPlanRecommendationGuard(hasProChatRecommendations: boolean) {
  return hasProChatRecommendations
    ? "Full report, Dispute Intelligence, and Rebuttal recommendations may be suggested when relevant."
    : "Snapshot export is available. Do not recommend full reports, Dispute Intelligence, Rebuttal PDF, or Customer Report as next steps unless you explicitly frame them as Pro-only upgrades.";
}

export function buildProductAccessGuard(access?: {
  plan?: string | null;
  chatReportRecommendations?: boolean | null;
  snapshotExport?: boolean | null;
} | null) {
  if (!access) return "";

  const plan = normalizeProductPlan(access.plan);
  const canRecommendReports =
    access.chatReportRecommendations === true || canAccessFeature(plan, "chat_report_recommendations");
  const canUseSnapshot = access.snapshotExport === true || canAccessFeature(plan, "snapshot_export");

  if (canRecommendReports) {
    return "Product access: Pro export recommendations are allowed when they are evidence-relevant.";
  }

  if (canUseSnapshot) {
    return "Product access: Snapshot export is available. Do not recommend full reports, Dispute Intelligence, Rebuttal PDF, or Customer Report as next steps unless you explicitly frame them as Pro-only upgrades.";
  }

  return "Product access: Do not recommend locked exports as available actions. Mention upgrade context if the user asks about reports.";
}
