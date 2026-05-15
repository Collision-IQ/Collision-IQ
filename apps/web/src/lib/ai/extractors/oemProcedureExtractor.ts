export interface OemRequirements {
  collisionDamageRequiresScan: boolean;
  frontBumperRequiresAccCalibration: boolean;
  frontBumperRequiresKafasCalibration: boolean;
}

export function extractOemRequirements(text: string): OemRequirements {
  const normalized = text.toLowerCase();

  return {
    collisionDamageRequiresScan:
      normalized.includes("procedure type: pre and post scan") &&
      normalized.includes("the vehicle has sustained collision damage"),

    frontBumperRequiresAccCalibration:
      normalized.includes("acc dynamic calibration") &&
      normalized.includes("repair/installation triggers: front bumper"),

    frontBumperRequiresKafasCalibration:
      normalized.includes("kafas camera dynamic calibration") &&
      normalized.includes("repair/installation triggers: front bumper"),
  };
}
