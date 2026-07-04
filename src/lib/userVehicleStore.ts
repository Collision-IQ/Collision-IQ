import { prisma } from "@/lib/prisma";
import type { VehicleProfile, MileageReading } from "@/lib/vehicleMaintenance";

// The vehicle profile + its attachments are persisted as rows in the existing
// UploadedAttachment table (which is present on every deployment) using only
// CORE columns — no new migration and no reliance on optional columns. Rows are
// isolated from analysis attachments by a distinctive `type` and are always
// scoped to the owning user (ownerType=USER, ownerId=user.id). Analysis flows
// only ever look up attachments by explicit id, so these rows never leak in.

const PROFILE_TYPE = "__ciq_vehicle_profile__";
const ATTACHMENT_TYPE = "__ciq_vehicle_attachment__";
const PROFILE_FILENAME = "vehicle-profile.json";

export const MAX_VEHICLE_ATTACHMENTS = 5;
export const MAX_VEHICLE_ATTACHMENT_BYTES = 4 * 1024 * 1024; // 4 MB per file
const MAX_MILEAGE_LOG = 24;

export type VehicleAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  dataUrl: string;
  sizeBytes?: number;
  uploadedAt?: string;
};

function ownerWhere(userId: string) {
  return { ownerType: "USER" as const, ownerId: userId };
}

async function findProfileRow(userId: string) {
  return prisma.uploadedAttachment.findFirst({
    where: { ...ownerWhere(userId), type: PROFILE_TYPE },
    select: { id: true, text: true },
    orderBy: { createdAt: "desc" },
  });
}

function parseProfile(text: string | null | undefined): VehicleProfile {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as VehicleProfile) : {};
  } catch {
    return {};
  }
}

export async function getVehicleProfile(userId: string): Promise<VehicleProfile> {
  const row = await findProfileRow(userId);
  return parseProfile(row?.text);
}

/**
 * Merge and persist the vehicle profile. Appends to the mileage history when the
 * odometer reading changes so average daily mileage can be derived over time.
 */
export async function saveVehicleProfile(
  userId: string,
  incoming: Partial<VehicleProfile>
): Promise<VehicleProfile> {
  const existing = await getVehicleProfile(userId);
  const nowIso = new Date().toISOString();

  const merged: VehicleProfile = {
    ...existing,
    ...incoming,
    // Preserve/extend the mileage log; a changed reading records a new datapoint.
    mileageLog: existing.mileageLog ?? [],
    updatedAt: nowIso,
  };

  const nextMileage = incoming.mileage;
  const mileageChanged =
    typeof nextMileage === "number" &&
    Number.isFinite(nextMileage) &&
    nextMileage !== existing.mileage;

  if (typeof nextMileage === "number" && Number.isFinite(nextMileage)) {
    merged.mileage = nextMileage;
    if (mileageChanged || !existing.mileageUpdatedAt) {
      merged.mileageUpdatedAt = nowIso;
      const log: MileageReading[] = [...(existing.mileageLog ?? [])];
      // Avoid duplicate consecutive readings.
      if (log.length === 0 || log[log.length - 1].mileage !== nextMileage) {
        log.push({ mileage: nextMileage, at: nowIso });
      }
      merged.mileageLog = log.slice(-MAX_MILEAGE_LOG);
    }
  }

  const text = JSON.stringify(merged);
  const row = await findProfileRow(userId);
  if (row) {
    await prisma.uploadedAttachment.update({
      where: { id: row.id },
      data: { text },
      select: { id: true },
    });
  } else {
    await prisma.uploadedAttachment.create({
      data: {
        filename: PROFILE_FILENAME,
        type: PROFILE_TYPE,
        text,
        ...ownerWhere(userId),
      },
      select: { id: true },
    });
  }

  return merged;
}

export async function listVehicleAttachments(userId: string): Promise<VehicleAttachment[]> {
  const rows = await prisma.uploadedAttachment.findMany({
    where: { ...ownerWhere(userId), type: ATTACHMENT_TYPE },
    select: { id: true, filename: true, text: true, imageDataUrl: true, sizeBytes: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  }).catch(async () => {
    // Fallback for deployments missing the optional sizeBytes column.
    return prisma.uploadedAttachment.findMany({
      where: { ...ownerWhere(userId), type: ATTACHMENT_TYPE },
      select: { id: true, filename: true, text: true, imageDataUrl: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  });

  return rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    mimeType: row.text || "application/octet-stream",
    dataUrl: row.imageDataUrl ?? "",
    sizeBytes: "sizeBytes" in row ? (row.sizeBytes ?? undefined) : undefined,
    uploadedAt: row.createdAt.toISOString(),
  }));
}

export async function countVehicleAttachments(userId: string): Promise<number> {
  return prisma.uploadedAttachment.count({
    where: { ...ownerWhere(userId), type: ATTACHMENT_TYPE },
  });
}

export async function addVehicleAttachment(
  userId: string,
  input: { filename: string; mimeType: string; dataUrl: string; sizeBytes?: number }
): Promise<VehicleAttachment> {
  // The mime type rides in `text`; the data URL rides in `imageDataUrl` (both core columns).
  const created = await prisma.uploadedAttachment.create({
    data: {
      filename: input.filename.slice(0, 200),
      type: ATTACHMENT_TYPE,
      text: input.mimeType.slice(0, 120),
      imageDataUrl: input.dataUrl,
      ...ownerWhere(userId),
    },
    select: { id: true, filename: true, text: true, imageDataUrl: true, createdAt: true },
  });

  return {
    id: created.id,
    filename: created.filename,
    mimeType: created.text || input.mimeType,
    dataUrl: created.imageDataUrl ?? input.dataUrl,
    sizeBytes: input.sizeBytes,
    uploadedAt: created.createdAt.toISOString(),
  };
}

export async function removeVehicleAttachment(userId: string, attachmentId: string): Promise<void> {
  await prisma.uploadedAttachment.deleteMany({
    where: { id: attachmentId, ...ownerWhere(userId), type: ATTACHMENT_TYPE },
  });
}
