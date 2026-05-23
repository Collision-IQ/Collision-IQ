export type EstimateOperationKey =
  | "headlamp_aim"
  | "fog_lamp_aim"
  | "scan"
  | "calibration"
  | "alignment"
  | "suspension_steering"
  | "structural_work"
  | "structural_measurement_support"
  | "final_structural_measurement_record"
  | "final_scan_report"
  | "final_calibration_certificate"
  | "final_alignment_printout";

export type EstimateOperationSnapshot = Record<EstimateOperationKey, boolean> & {
  impactSide: "right_front" | "left_front" | "unknown";
};

const OPERATION_PATTERNS: Record<EstimateOperationKey, RegExp[]> = {
  headlamp_aim: [
    /\baim\s+head\s*lamps?\b/i,
    /\baim\s+headlights?\b/i,
    /\bhead\s*lamp\s+aim(?:ing)?\b/i,
    /\bheadlight\s+aim(?:ing)?\b/i,
    /\blamp\s+aim(?:ing)?\b/i,
  ],
  fog_lamp_aim: [
    /\baim\s+fog\s+lamps?\b/i,
    /\bfog\s+lamp\s+aim(?:ing)?\b/i,
    /\bfog\s+light\s+aim(?:ing)?\b/i,
  ],
  scan: [
    /\bpre[-\s]?repair\s+scan\b/i,
    /\bpost[-\s]?repair\s+scan\b/i,
    /\bin[-\s]?(?:proc|process)\s+(?:repair\s+)?scan\b/i,
    /\bdiagnostic\s+scan\b/i,
    /\bscan\s+(?:and\s+)?(?:clear|diagnos)/i,
  ],
  calibration: [
    /\bcalibration\b/i,
    /\bcalibrate\b/i,
    /\binitiali[sz]ation\b/i,
    /\b(static|dynamic)\s+aim(?:ing)?\b/i,
  ],
  alignment: [
    /\bfour[-\s]?wheel\s+suspension\s+alignment\b/i,
    /\bfour[-\s]?wheel\s+alignment\b/i,
    /\b4[-\s]?wheel\s+alignment\b/i,
    /\bsuspension\s+alignment\b/i,
    /\bwheel\s+alignment\b/i,
  ],
  suspension_steering: [
    /\bsuspension\b/i,
    /\bsteering\s+gear\b/i,
    /\bsteering\b/i,
    /\bstrut\b/i,
    /\bcontrol\s+arm\b/i,
    /\btie\s+rod\b/i,
    /\bknuckle\b/i,
  ],
  structural_work: [
    /\bright\s+apron\b/i,
    /\bupper\s+frame\b/i,
    /\blower\s+rail\b/i,
    /\bframe\s+bench\b/i,
    /\brealign\s+unibody\b/i,
    /\brough\s+pull\b/i,
    /\bapron\b/i,
    /\brail\b/i,
  ],
  structural_measurement_support: [
    /\bmeasure[-\s]?diagnostic\s+prior\s+to\s+pull\b/i,
    /\bsetup\s+and\s+measure\b/i,
    /\bframe\s+bench\s+setup\b/i,
    /\brealign\s+unibody\b/i,
    /\brough\s+pull\b/i,
    /\bmeasure\b/i,
  ],
  final_structural_measurement_record: [
    /\bmeasurement\s+(?:printout|report|record)\b/i,
    /\bframe\s+(?:measurement|measure)\s+(?:printout|report|record)\b/i,
    /\bdimensional\s+(?:printout|report|record)\b/i,
  ],
  final_scan_report: [
    /\bscan\s+report\b/i,
    /\bpre[-\s]?scan\s+report\b/i,
    /\bpost[-\s]?scan\s+report\b/i,
    /\bdtc\s+report\b/i,
  ],
  final_calibration_certificate: [
    /\bcalibration\s+(?:certificate|certification|report|results?)\b/i,
    /\badas\s+(?:certificate|report|results?)\b/i,
  ],
  final_alignment_printout: [
    /\balignment\s+(?:printout|report|record|results?)\b/i,
    /\btoe\s+(?:printout|report|record|results?)\b/i,
  ],
};

export function analyzeEstimateOperations(text: string): EstimateOperationSnapshot {
  const normalized = text.replace(/\s+/g, " ");
  return {
    headlamp_aim: hasEstimateOperation(normalized, "headlamp_aim"),
    fog_lamp_aim: hasEstimateOperation(normalized, "fog_lamp_aim"),
    scan: hasEstimateOperation(normalized, "scan"),
    calibration: hasEstimateOperation(normalized, "calibration"),
    alignment: hasEstimateOperation(normalized, "alignment"),
    suspension_steering: hasEstimateOperation(normalized, "suspension_steering"),
    structural_work: hasEstimateOperation(normalized, "structural_work"),
    structural_measurement_support: hasEstimateOperation(normalized, "structural_measurement_support"),
    final_structural_measurement_record: hasEstimateOperation(normalized, "final_structural_measurement_record"),
    final_scan_report: hasEstimateOperation(normalized, "final_scan_report"),
    final_calibration_certificate: hasEstimateOperation(normalized, "final_calibration_certificate"),
    final_alignment_printout: hasEstimateOperation(normalized, "final_alignment_printout"),
    impactSide: inferImpactSide(normalized),
  };
}

export function hasEstimateOperation(text: string, key: EstimateOperationKey): boolean {
  return OPERATION_PATTERNS[key].some((pattern) => pattern.test(text));
}

export function inferImpactSide(text: string): EstimateOperationSnapshot["impactSide"] {
  if (/\bpoint\s+of\s+impact\s*:?\s*0?1\s+right\s+front\b/i.test(text)) {
    return "right_front";
  }
  if (/\bpoint\s+of\s+impact\s*:?\s*0?1\s+left\s+front\b/i.test(text)) {
    return "left_front";
  }
  if (/\bright[-\s]?front\b|\bfront[-\s]?right\b|\bpassenger[-\s]?front\b|\brh\s+front\b/i.test(text)) {
    return "right_front";
  }
  if (/\bleft[-\s]?front\b|\bfront[-\s]?left\b|\bdriver[-\s]?front\b|\blh\s+front\b/i.test(text)) {
    return "left_front";
  }
  return "unknown";
}

export function isOperationAlreadyRepresented(
  text: string,
  operation: "headlamp_aim" | "fog_lamp_aim" | "scan" | "calibration" | "alignment" | "suspension_steering"
): boolean {
  const snapshot = analyzeEstimateOperations(text);
  return Boolean(snapshot[operation]);
}
