import { requireCurrentUser } from "@/lib/auth/require-current-user";
import { isPlatformAdminEmail, normalizeEmail } from "@/lib/auth/platform-admin";
import {
  canUploadFiles as resolveCanUploadFiles,
  getCurrentProductEntitlements,
  getCurrentSubscriptionTierForUser,
  resolveProductTrialActive,
} from "@/lib/billing/productEntitlements";
import { resolveUploadPlanLimits } from "@/lib/uploadSafety/uploadLimits";

/**
 * Resolve the current user's upload entitlements and plan limits. Shared by
 * the direct-storage token route and the chunked relay route so both enforce
 * identical plan rules.
 */
export async function resolveUploadLimitsForCurrentUser() {
  const { user, verifiedEmails, isPlatformAdmin } = await requireCurrentUser();
  const normalizedEmail = normalizeEmail(user.email);
  const effectiveIsAdmin = isPlatformAdmin || isPlatformAdminEmail(normalizedEmail);
  const subscriptionTier = await getCurrentSubscriptionTierForUser(user.id);
  const trialActive = resolveProductTrialActive({
    activeSubscriptionId: subscriptionTier ? "active-subscription" : null,
    activeSubscriptionStatus:
      subscriptionTier === "trial" ? "TRIALING" : subscriptionTier ? "ACTIVE" : null,
    createdAt: user.createdAt,
    plan: subscriptionTier ?? "pro",
  });
  const entitlements = await getCurrentProductEntitlements({
    userEmail: normalizedEmail,
    userEmails: verifiedEmails,
    trialActive,
    subscriptionTier,
    isPlatformAdmin: effectiveIsAdmin,
  });

  return {
    user,
    entitlements,
    canUploadFiles: resolveCanUploadFiles(entitlements),
    uploadLimits: resolveUploadPlanLimits(entitlements),
  };
}
