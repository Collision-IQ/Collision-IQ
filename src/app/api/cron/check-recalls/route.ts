import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";
import { prisma } from "@/lib/prisma";
import { listAllVehicleProfiles, saveVehicleRecallSnapshot } from "@/lib/userVehicleStore";
import type { VehicleProfile } from "@/lib/vehicleMaintenance";
import { getRecallsForVehicle } from "@/lib/nhtsa/recalls";
import {
  buildRecallAlertText,
  buildRecallSnapshot,
  describeIdentity,
  groupByIdentity,
  identityKey,
  mergeSeenCampaignNumbers,
  resolveRecallIdentity,
  selectNewCampaigns,
  type ResolvedRecallIdentity,
} from "@/lib/nhtsa/vehicleRecalls";
import { sendRecallAlert } from "@/lib/email/sendAlerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Be a polite citizen of a free, shared, unauthenticated government API.
const PAUSE_BETWEEN_CONFIGS_MS = 250;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface SweepVehicle {
  userId: string;
  profile: VehicleProfile;
  identity: ResolvedRecallIdentity["identity"];
  resolved: ResolvedRecallIdentity;
}

/**
 * GET /api/cron/check-recalls
 *
 * Weekly sweep (vercel.json) that catches NEW NHTSA recall campaigns for
 * vehicles already stored in "My Vehicle". Authorized by CRON_SECRET bearer
 * (Vercel Cron) or an authenticated Platform Admin, like the learning crons.
 *
 * Vehicles are grouped by distinct year/make/model so NHTSA usage scales with
 * distinct configurations, not users. A VIN is decoded at most once: the
 * identity is cached on the profile snapshot after the first decode.
 */
async function isAuthorizedCronRequest(request: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const header = request.headers.get("authorization") ?? "";
    if (header === `Bearer ${secret}`) return true;
  }
  try {
    const { isPlatformAdmin } = await requireCurrentUser();
    return isPlatformAdmin;
  } catch (error) {
    if (error instanceof UnauthorizedError) return false;
    throw error;
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!(await isAuthorizedCronRequest(request))) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const stored = await listAllVehicleProfiles();
    const errors: string[] = [];
    let skippedNoIdentity = 0;

    // Resolve an identity per vehicle (cached decode → vPIC → typed profile).
    const resolvable: SweepVehicle[] = [];
    for (const { userId, profile } of stored) {
      try {
        const resolved = await resolveRecallIdentity(profile);
        if (!resolved) {
          skippedNoIdentity++;
          continue;
        }
        resolvable.push({ userId, profile, identity: resolved.identity, resolved });
      } catch (error) {
        errors.push(`decode ${userId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const groups = groupByIdentity(resolvable);
    const ownerIds = [...new Set(resolvable.map((v) => v.userId))];
    const owners = ownerIds.length
      ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, email: true } })
      : [];
    const emailByUserId = new Map(owners.map((o) => [o.id, o.email?.trim() || null]));

    let checkedConfigs = 0;
    let vehiclesWithNewRecalls = 0;
    let emailsSent = 0;

    for (const group of groups) {
      checkedConfigs++;
      const key = identityKey(group.identity);
      let campaigns;
      try {
        campaigns = await getRecallsForVehicle(group.identity);
      } catch (error) {
        errors.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
        await sleep(PAUSE_BETWEEN_CONFIGS_MS);
        continue;
      }

      for (const vehicle of group.vehicles) {
        const newCampaigns = selectNewCampaigns(campaigns, vehicle.profile.seenRecallCampaignNumbers);
        const snapshot = buildRecallSnapshot({ checkedAt: new Date(), resolved: vehicle.resolved, campaigns });
        const seen = mergeSeenCampaignNumbers(vehicle.profile.seenRecallCampaignNumbers, campaigns);
        try {
          await saveVehicleRecallSnapshot(vehicle.userId, snapshot, seen);
        } catch (error) {
          errors.push(`save ${vehicle.userId}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        if (newCampaigns.length === 0) continue;
        vehiclesWithNewRecalls++;

        const to = emailByUserId.get(vehicle.userId);
        if (!to) continue;
        const sent = await sendRecallAlert({
          to,
          vehicleLabel: describeIdentity(group.identity),
          campaignCount: newCampaigns.length,
          text: buildRecallAlertText({ identity: group.identity, campaigns: newCampaigns }),
        });
        if (sent) emailsSent++;
      }

      await sleep(PAUSE_BETWEEN_CONFIGS_MS);
    }

    const result = {
      vehicles: stored.length,
      skippedNoIdentity,
      checkedConfigs,
      vehiclesWithNewRecalls,
      emailsSent,
      errors,
    };
    console.info("[recall-cron] weekly sweep complete", result);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[recall-cron] weekly sweep failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Weekly recall check failed." }, { status: 500 });
  }
}
