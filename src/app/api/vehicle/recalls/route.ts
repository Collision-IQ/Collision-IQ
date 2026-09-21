import { NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { getVehicleProfile, saveVehicleRecallSnapshot } from "@/lib/userVehicleStore";
import { checkVehicleRecalls, mergeSeenCampaignNumbers } from "@/lib/nhtsa/vehicleRecalls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/vehicle/recalls
 *
 * On-demand NHTSA recall check for the signed-in user's stored vehicle. The
 * panel calls it after the vehicle identity is saved and on "Check for
 * recalls". The result is persisted on the profile so it renders instantly
 * on the next load, and every campaign returned is marked as seen so the
 * weekly sweep (/api/cron/check-recalls) only alerts on NEW campaigns.
 */
export async function POST() {
  try {
    const { user } = await requireCurrentUser();
    const profile = await getVehicleProfile(user.id);
    const snapshot = await checkVehicleRecalls(profile);
    const seen =
      snapshot.status === "ok"
        ? mergeSeenCampaignNumbers(profile.seenRecallCampaignNumbers, snapshot.campaigns)
        : (profile.seenRecallCampaignNumbers ?? []);
    const saved = await saveVehicleRecallSnapshot(user.id, snapshot, seen);
    return NextResponse.json({ recalls: saved.recalls }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[vehicle/recalls] check failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Could not check recalls for your vehicle." }, { status: 500 });
  }
}
