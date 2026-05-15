export interface RetrievalContext {
  vehicle?: string;
  system?: string;
  component?: string;
  procedure?: string;
}

export function extractContext(text: string): RetrievalContext {
  const lower = text.toLowerCase();

  return {
    vehicle: lower.includes("accord")
      ? "Honda Accord"
      : lower.includes("honda")
        ? "Honda"
        : lower.includes("bmw")
          ? "BMW"
          : undefined,
    component: lower.includes("radiator support")
      ? "radiator support"
      : lower.includes("bumper")
        ? "front bumper"
        : lower.includes("hood")
          ? "hood"
          : undefined,
    system: lower.includes("adas")
      ? "ADAS"
      : lower.includes("radar")
        ? "radar"
        : lower.includes("camera")
          ? "camera"
          : undefined,
    procedure: lower.includes("calibration")
      ? "calibration"
      : lower.includes("scan")
        ? "diagnostic scan"
        : lower.includes("alignment")
          ? "alignment"
          : undefined,
  };
}
