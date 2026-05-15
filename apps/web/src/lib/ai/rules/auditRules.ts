import type { AuditRuleDefinition } from "../validators/auditRuleEngine";

function compareRule(config: {
  id: string;
  category: AuditRuleDefinition["category"];
  title: string;
  severity: AuditRuleDefinition["severity"];
  shopFact: string;
  insurerFact: string;
  rationale: string;
  evidence: AuditRuleDefinition["evidence"];
  included: string;
  missing: string;
}): AuditRuleDefinition {
  return {
    id: config.id,
    category: config.category,
    trigger: (context) => context.facts[`shop.${config.shopFact}`] === true,
    evaluate: (context) =>
      context.facts[`insurer.${config.insurerFact}`] === true ? "included" : "missing",
    severity: config.severity,
    severityByStatus: {
      included: "low",
    },
    title: config.title,
    rationale: config.rationale,
    evidence: config.evidence,
    conclusion: {
      included: config.included,
      missing: config.missing,
      not_shown: `${config.title} is not established from the provided documents.`,
    },
  };
}

function exposureRule(config: {
  id: string;
  category: AuditRuleDefinition["category"];
  title: string;
  severity: AuditRuleDefinition["severity"];
  trigger: AuditRuleDefinition["trigger"];
  rationale: string;
  evidence: AuditRuleDefinition["evidence"];
  missing: string;
  included?: string;
}): AuditRuleDefinition {
  return {
    id: config.id,
    category: config.category,
    trigger: config.trigger,
    evaluate: () => "missing",
    severity: config.severity,
    title: config.title,
    rationale: config.rationale,
    evidence: config.evidence,
    conclusion: {
      included: config.included ?? `${config.title} is addressed in the insurer estimate.`,
      missing: config.missing,
      not_shown: `${config.title} is not established from the provided documents.`,
    },
  };
}

export const auditRules: AuditRuleDefinition[] = [
  compareRule({ id: "diag-pre-scan", category: "scan", title: "Pre-Repair Diagnostic Scan", severity: "high", shopFact: "preScan", insurerFact: "preScan", rationale: "The shop blueprint documents pre-repair diagnostics before repairs begin.", evidence: [{ source: "Shop estimate", page: 1 }], included: "Insurance estimate includes a pre-repair diagnostic scan.", missing: "Insurance estimate does not document the pre-repair diagnostic scan shown in the shop estimate." }),
  compareRule({ id: "diag-post-scan", category: "scan", title: "Post-Repair Diagnostic Scan", severity: "high", shopFact: "postScan", insurerFact: "postScan", rationale: "The shop blueprint documents post-repair diagnostics for verification.", evidence: [{ source: "Shop estimate", page: 1 }], included: "Insurance estimate includes a post-repair diagnostic scan.", missing: "Insurance estimate does not document the post-repair diagnostic scan shown in the shop estimate." }),
  compareRule({ id: "diag-in-process-scan", category: "scan", title: "In-Process Diagnostic Scan", severity: "medium", shopFact: "inProcessScan", insurerFact: "inProcessScan", rationale: "The shop blueprint documents an in-process diagnostic step during repair execution.", evidence: [{ source: "Shop estimate", page: 1 }], included: "Insurance estimate includes the in-process diagnostic scan documented by the shop.", missing: "Insurance estimate does not document the in-process diagnostic scan shown in the shop estimate." }),
  compareRule({ id: "qc-seat-belt-function-test", category: "qc", title: "Seat Belt Dynamic Function Test", severity: "medium", shopFact: "seatBeltDynamicFunctionTest", insurerFact: "seatBeltDynamicFunctionTest", rationale: "The shop estimate includes a seat belt dynamic function test as a safety verification step.", evidence: [{ source: "Shop estimate", page: 2 }], included: "Insurance estimate includes seat belt dynamic function testing.", missing: "Insurance estimate does not document the seat belt dynamic function test shown in the shop estimate." }),
  compareRule({ id: "qc-final-road-test", category: "qc", title: "Final Road Test / QC", severity: "medium", shopFact: "finalRoadTest", insurerFact: "finalRoadTest", rationale: "The shop estimate documents a final road test for safety and quality verification.", evidence: [{ source: "Shop estimate", page: 2 }], included: "Insurance estimate includes the final road test / quality verification step.", missing: "Insurance estimate does not document the final road test / quality verification step shown in the shop estimate." }),
  compareRule({ id: "adas-radar-calibration", category: "calibration", title: "Radar Sensor Aim / Calibration", severity: "high", shopFact: "radarCalibration", insurerFact: "radarCalibration", rationale: "The shop estimate documents radar aiming or calibration for the repair blueprint.", evidence: [{ source: "Shop estimate", page: 2 }], included: "Insurance estimate includes radar sensor aim / calibration.", missing: "Insurance estimate does not document the radar sensor aim / calibration shown in the shop estimate." }),
  compareRule({ id: "adas-camera-calibration", category: "calibration", title: "Front Camera Aim / Calibration", severity: "high", shopFact: "cameraCalibration", insurerFact: "cameraCalibration", rationale: "The shop estimate documents front camera aiming or calibration.", evidence: [{ source: "Shop estimate", page: 2 }], included: "Insurance estimate includes front camera aim / calibration.", missing: "Insurance estimate does not document the front camera aim / calibration shown in the shop estimate." }),
  compareRule({ id: "adas-steering-angle", category: "calibration", title: "Steering Angle Calibration", severity: "medium", shopFact: "steeringAngleCalibration", insurerFact: "steeringAngleCalibration", rationale: "The shop estimate documents steering angle calibration as part of the repair plan.", evidence: [{ source: "Shop estimate", page: 2 }], included: "Insurance estimate includes steering angle calibration.", missing: "Insurance estimate does not document the steering angle calibration shown in the shop estimate." }),
  compareRule({ id: "adas-vsa-calibration", category: "calibration", title: "Vehicle Stability Assist Calibration", severity: "medium", shopFact: "stabilityAssistCalibration", insurerFact: "stabilityAssistCalibration", rationale: "The shop estimate documents vehicle stability assist calibration.", evidence: [{ source: "Shop estimate", page: 2 }], included: "Insurance estimate includes vehicle stability assist calibration.", missing: "Insurance estimate does not document the vehicle stability assist calibration shown in the shop estimate." }),
  compareRule({ id: "adas-seat-weight-calibration", category: "calibration", title: "Seat Weight Sensor Calibration", severity: "medium", shopFact: "seatWeightSensorCalibration", insurerFact: "seatWeightSensorCalibration", rationale: "The shop estimate documents seat weight sensor calibration.", evidence: [{ source: "Shop estimate", page: 2 }], included: "Insurance estimate includes seat weight sensor calibration.", missing: "Insurance estimate does not document the seat weight sensor calibration shown in the shop estimate." }),
  compareRule({ id: "adas-calibration-transport", category: "calibration", title: "Sublet Calibration / Alignment Transport", severity: "low", shopFact: "calibrationTransport", insurerFact: "calibrationTransport", rationale: "The shop estimate shows transport to or from sublet alignment or calibration services.", evidence: [{ source: "Shop estimate", page: 2 }], included: "Insurance estimate includes sublet transport related to alignment or calibration.", missing: "Insurance estimate does not show the sublet transport operation documented in the shop estimate." }),
  compareRule({ id: "struct-setup-measure", category: "qc", title: "Setup and Measure", severity: "high", shopFact: "setupMeasure", insurerFact: "setupMeasure", rationale: "The shop estimate documents setup and measure operations for structural verification.", evidence: [{ source: "Shop estimate", page: 2 }], included: "Insurance estimate includes setup and measure operations.", missing: "Insurance estimate does not document the setup and measure operation shown in the shop estimate." }),
  compareRule({ id: "struct-unibody-alignment", category: "qc", title: "Pull / Align Unibody", severity: "high", shopFact: "unibodyAlignment", insurerFact: "unibodyAlignment", rationale: "The shop estimate documents pull or unibody alignment operations.", evidence: [{ source: "Shop estimate", page: 2 }], included: "Insurance estimate includes pull / align unibody operations.", missing: "Insurance estimate does not document the pull / align unibody operation shown in the shop estimate." }),
  compareRule({ id: "struct-dimensional-verification", category: "qc", title: "Dimensional Verification", severity: "medium", shopFact: "dimensionalVerification", insurerFact: "dimensionalVerification", rationale: "The shop estimate documents dimensional verification of repaired structure.", evidence: [{ source: "Shop estimate", page: 2 }], included: "Insurance estimate includes dimensional verification.", missing: "Insurance estimate does not document the dimensional verification shown in the shop estimate." }),
  compareRule({ id: "struct-clamp-zone-repair", category: "qc", title: "Clamp Zone Repair / Refinish", severity: "medium", shopFact: "clampZoneRepair", insurerFact: "clampZoneRepair", rationale: "The shop estimate documents clamp zone repair or refinish work.", evidence: [{ source: "Shop estimate", page: 2 }], included: "Insurance estimate includes clamp zone repair / refinish work.", missing: "Insurance estimate does not document the clamp zone repair / refinish operation shown in the shop estimate." }),
  compareRule({ id: "corr-weld-thru-primer", category: "corrosion", title: "Weld-Through Primer", severity: "low", shopFact: "weldThruPrimer", insurerFact: "weldThruPrimer", rationale: "The shop estimate documents weld-through primer for repair protection.", evidence: [{ source: "Shop estimate", page: 3 }], included: "Insurance estimate includes weld-through primer.", missing: "Insurance estimate does not document the weld-through primer shown in the shop estimate." }),
  compareRule({ id: "corr-seam-sealer-replace", category: "corrosion", title: "Seam Sealer Replace-Panel", severity: "medium", shopFact: "seamSealerReplacePanel", insurerFact: "seamSealerReplacePanel", rationale: "The shop estimate documents seam sealer restoration tied to replacement operations.", evidence: [{ source: "Shop estimate", page: 3 }], included: "Insurance estimate includes replace-panel seam sealer operations.", missing: "Insurance estimate does not document the replace-panel seam sealer operation shown in the shop estimate." }),
  compareRule({ id: "corr-seam-sealer-repair", category: "corrosion", title: "Seam Sealer Repair-Panel", severity: "medium", shopFact: "seamSealerRepairPanel", insurerFact: "seamSealerRepairPanel", rationale: "The shop estimate documents seam sealer restoration tied to repair operations.", evidence: [{ source: "Shop estimate", page: 3 }], included: "Insurance estimate includes repair-panel seam sealer operations.", missing: "Insurance estimate does not document the repair-panel seam sealer operation shown in the shop estimate." }),
  compareRule({ id: "corr-cavity-wax", category: "corrosion", title: "Cavity Wax Corrosion Protection", severity: "medium", shopFact: "cavityWax", insurerFact: "cavityWax", rationale: "The shop estimate documents cavity wax corrosion protection.", evidence: [{ source: "Shop estimate", page: 3 }], included: "Insurance estimate includes cavity wax corrosion protection.", missing: "Insurance estimate does not document the cavity wax corrosion protection shown in the shop estimate." }),
  exposureRule({ id: "corr-corrosion-softened", category: "corrosion", title: "Generic Corrosion Protection Substituted", severity: "medium", trigger: (context) => context.facts["shop.cavityWax"] === true && context.facts["insurer.corrosionProtection"] === true && context.facts["insurer.cavityWax"] !== true, rationale: "The insurer estimate shows a generic corrosion protection line but not the same cavity-wax-specific operation shown by the shop.", evidence: [{ source: "Shop estimate", page: 3 }, { source: "Insurance estimate", page: 3 }], missing: "Insurance estimate includes generic corrosion protection but does not mirror the cavity wax operation documented by the shop." }),
  compareRule({ id: "refinish-tint-letdown", category: "refinish", title: "Tint Color / Let-Down Panel", severity: "medium", shopFact: "tintOrLetDownPanel", insurerFact: "tintOrLetDownPanel", rationale: "The shop estimate documents tint color or let-down panel work for color match.", evidence: [{ source: "Shop estimate", page: 3 }], included: "Insurance estimate includes tint color / let-down panel refinishing steps.", missing: "Insurance estimate does not document the tint color / let-down panel work shown in the shop estimate." }),
  compareRule({ id: "refinish-finish-sand-polish", category: "refinish", title: "Finish Sand and Polish", severity: "low", shopFact: "finishSandPolish", insurerFact: "finishSandPolish", rationale: "The shop estimate documents finish sand and polish as a finishing step.", evidence: [{ source: "Shop estimate", page: 3 }], included: "Insurance estimate includes finish sand and polish.", missing: "Insurance estimate does not document the finish sand and polish step shown in the shop estimate." }),
  compareRule({ id: "refinish-masking", category: "refinish", title: "Masking / Inner Structure Masking", severity: "low", shopFact: "maskingInnerStructure", insurerFact: "maskingInnerStructure", rationale: "The shop estimate documents masking or inner structure masking operations.", evidence: [{ source: "Shop estimate", page: 3 }], included: "Insurance estimate includes masking or inner structure masking operations.", missing: "Insurance estimate does not document the masking operations shown in the shop estimate." }),
  compareRule({ id: "refinish-flex-additive", category: "refinish", title: "Flex Additive", severity: "low", shopFact: "flexAdditive", insurerFact: "flexAdditive", rationale: "The shop estimate documents flex additive as part of the refinish process.", evidence: [{ source: "Shop estimate", page: 3 }], included: "Insurance estimate includes flex additive.", missing: "Insurance estimate does not document the flex additive shown in the shop estimate." }),
  compareRule({ id: "refinish-three-stage", category: "refinish", title: "Three-Stage Refinish Operation", severity: "medium", shopFact: "threeStageRefinish", insurerFact: "threeStageRefinish", rationale: "The shop estimate documents a three-stage refinish process.", evidence: [{ source: "Shop estimate", page: 3 }], included: "Insurance estimate includes the three-stage refinish operation.", missing: "Insurance estimate does not document the three-stage refinish operation shown in the shop estimate." }),
  exposureRule({ id: "parts-aftermarket-structural", category: "parts", title: "Aftermarket Structural Part Exposure", severity: "medium", trigger: (context) => context.facts["insurer.aftermarketStructural"] === true, rationale: "The insurer estimate includes aftermarket structural content.", evidence: [{ source: "Insurance estimate", page: 1 }], missing: "Insurance estimate includes aftermarket structural parts, which creates sourcing exposure." }),
  exposureRule({ id: "parts-aftermarket-sensor-adjacent", category: "parts", title: "Aftermarket Sensor-Adjacent Part Exposure", severity: "medium", trigger: (context) => context.facts["insurer.aftermarketSensorAdjacent"] === true, rationale: "The insurer estimate includes aftermarket parts near ADAS sensor or front-end mounting zones.", evidence: [{ source: "Insurance estimate", page: 1 }], missing: "Insurance estimate includes aftermarket parts in sensor-adjacent areas, which creates calibration and fit exposure." }),
  exposureRule({ id: "parts-recycled-structural", category: "parts", title: "Recycled Structural Part Exposure", severity: "medium", trigger: (context) => context.facts["insurer.recycledStructural"] === true, rationale: "The insurer estimate includes recycled structural content.", evidence: [{ source: "Insurance estimate", page: 1 }], missing: "Insurance estimate includes recycled structural parts, which creates sourcing exposure." }),
  exposureRule({ id: "parts-recycled-mechanical", category: "parts", title: "Recycled Cooling / Mechanical Part Exposure", severity: "low", trigger: (context) => context.facts["insurer.recycledMechanical"] === true, rationale: "The insurer estimate includes recycled cooling or mechanical content.", evidence: [{ source: "Insurance estimate", page: 1 }], missing: "Insurance estimate includes recycled cooling or mechanical parts, which creates sourcing exposure." }),
  exposureRule({ id: "parts-oem-position-warning", category: "parts", title: "OEM Position Statement / Non-OEM Warning", severity: "low", trigger: (context) => context.facts["shop.positionStatementWarning"] === true && (context.facts["insurer.aftermarketStructural"] === true || context.facts["insurer.aftermarketSensorAdjacent"] === true || context.facts["insurer.recycledStructural"] === true || context.facts["insurer.recycledMechanical"] === true), rationale: "The shop file documents OEM or safety-position-statement warnings while the insurer estimate still carries non-OEM or recycled content.", evidence: [{ source: "Shop estimate", page: 1 }, { source: "Insurance estimate", page: 1 }], missing: "Shop documentation references OEM / non-OEM warnings while the insurer estimate still includes non-OEM or recycled sourcing." }),
];
