export type ProductPlan = "none" | "free" | "starter" | "trial" | "pro" | "team" | "admin" | "NONE" | "FREE" | "STARTER" | "TRIAL" | "PRO" | "TEAM" | "ADMIN";

export type ProductFeature =
  | "snapshot_export"
  | "repair_intelligence_export"
  /** @deprecated Use repair_intelligence_export. */
  | "full_report_export"
  /** @deprecated Merged into repair_intelligence_export. */
  | "dispute_report_export"
  | "estimate_scrubber_export"
  | "policy_rights_review_export"
  | "doi_complaint_packet_export"
  | "customer_report_export"
  | "chat_report_recommendations"
  | "crm_sync";

export function normalizeProductPlan(plan: ProductPlan | string | null | undefined) {
  const normalized = `${plan ?? "none"}`.toLowerCase();
  if (normalized === "admin") return "admin";
  if (normalized === "team") return "team";
  if (normalized === "trial") return "pro";
  if (normalized === "pro") return "pro";
  if (normalized === "starter") return "starter";
  if (normalized === "free") return "none";
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

  if (feature === "full_report_export" || feature === "dispute_report_export") {
    return canAccessFeature(plan, "repair_intelligence_export");
  }

  if (normalized === "pro") {
    return true;
  }

  return false;
}

export function buildPlanRecommendationGuard(hasProChatRecommendations: boolean) {
  return hasProChatRecommendations
    ? "Repair Intelligence Report, Delta Citation Density Report, OEM Citation Density Report, DOI Complaint Packet, and rebuttal recommendations may be suggested when relevant."
    : "Snapshot export is available. Do not recommend Repair Intelligence, Delta Citation Density Report, OEM Citation Density Report, DOI Complaint Packet, or Customer Report exports as next steps unless you explicitly frame them as Pro-only upgrades.";
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
    return "Product access: Snapshot export is available. Do not recommend Repair Intelligence, Delta Citation Density Report, OEM Citation Density Report, DOI Complaint Packet, or Customer Report exports as next steps unless you explicitly frame them as Pro-only upgrades.";
  }

  return "Product access: Do not recommend locked exports as available actions. Mention upgrade context if the user asks about reports.";
}
