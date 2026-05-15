export function validateCalibration({
  make,
  text,
}: {
  make: string;
  text: string;
}) {
  const normalizedMake = make.trim().toLowerCase();
  const lower = text.toLowerCase();

  if (normalizedMake !== "bmw" && lower.includes("kafas")) {
    return false;
  }

  return true;
}

export function cleanResponse(make: string, response: string) {
  if (!validateCalibration({ make, text: response })) {
    return response.replace(/kafas/gi, "[REMOVED - INVALID FOR VEHICLE]");
  }

  return response;
}
