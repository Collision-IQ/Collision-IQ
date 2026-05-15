import { ParsedEstimate, hasLine } from "./estimateExtractor";

export function buildFactsFromEstimate(parsed: ParsedEstimate) {
  return {
    preScan: hasLine(parsed, /pre-?repair scan|pre scan/i),
    inProcessScan: hasLine(parsed, /in-?proc|in process scan/i),
    postScan: hasLine(parsed, /post-?repair scan|post scan/i),
    radarCalibration: hasLine(
      parsed,
      /acc.*calibration|adaptive cruise.*calibration|radar sensor calibration|wave radar sensor aim|radar aim/i
    ),
    cameraCalibration: hasLine(
      parsed,
      /kafas.*calibration|front camera aim|forward camera calibration|camera calibration/i
    ),
    surroundCalibration: hasLine(
      parsed,
      /all-?around vision.*calibration|surround vision.*calibration/i
    ),
    steeringAngleCalibration: hasLine(
      parsed,
      /steering angle (?:sensor )?calibration|sas calibration/i
    ),
    stabilityAssistCalibration: hasLine(
      parsed,
      /vehicle stability assist calibration|stability assist calibration|yaw rate calibration/i
    ),
    seatWeightSensorCalibration: hasLine(
      parsed,
      /seat weight sensor calibration|seat occupancy calibration|seat weight calibration/i
    ),
    calibrationTransport: hasLine(
      parsed,
      /transport vehicle to sublet|transport vehicle from sublet|transport.*sublet|transport.*alignment|transport.*calibration/i
    ),
    fourWheelAlignment: hasLine(
      parsed,
      /four wheel alignment|4 wheel alignment|wheel alignment|align suspension/i
    ),
    setupMeasure: hasLine(parsed, /setup (?:and|&)? measure|set up (?:and|&)? measure/i),
    unibodyAlignment: hasLine(
      parsed,
      /pull .*unibody|align unibody|unibody alignment|frame alignment/i
    ),
    dimensionalVerification: hasLine(
      parsed,
      /dimensional verification|dimension check|measure and verify/i
    ),
    clampZoneRepair: hasLine(parsed, /clamp zone|pinch weld repair|clamping area/i),
    cavityWax: hasLine(parsed, /cavity wax/i),
    corrosionProtection: hasLine(
      parsed,
      /corrosion protection|anti-corrosion|rust proofing|corrosion resistant/i
    ),
    roadTest: hasLine(parsed, /road test/i),
    finalRoadTest: hasLine(parsed, /final road test|road test.*safety|quality check/i),
    seatBeltDynamicFunctionTest: hasLine(
      parsed,
      /seat belt dynamic function test|seat belt function test/i
    ),
    maskJambs: hasLine(parsed, /mask jambs/i),
    maskingInnerStructure: hasLine(
      parsed,
      /mask(?:ing)? jambs|mask(?:ing)? inner structure|mask(?:ing)?\b/i
    ),
    tintColor: hasLine(parsed, /tint color/i),
    letDownPanel: hasLine(parsed, /let-?down panel/i),
    tintOrLetDownPanel: hasLine(parsed, /tint color|let-?down panel/i),
    finishSandPolish: hasLine(parsed, /finish sand.*polish/i),
    flexAdditive: hasLine(parsed, /flex additive/i),
    threeStageRefinish: hasLine(parsed, /three-?stage|3-?stage|tri-?coat|three stage/i),
    seamSealerReplacePanel: hasLine(
      parsed,
      /seam sealer.*replace|replace.*seam sealer/i
    ),
    seamSealerRepairPanel: hasLine(
      parsed,
      /seam sealer.*repair|repair.*seam sealer/i
    ),
    weldThruPrimer: hasLine(parsed, /weld-?thru primer|weld through primer/i),
    frameMeasurement: hasLine(
      parsed,
      /frame measure|frame measurement|measure and alignment|frame alignment/i
    ),
    aftermarketStructural: hasLine(
      parsed,
      /\b(a\/m|aftermarket)\b.*(reinforcement|rebar|bar|support|hood|rail|apron|pillar|member|tie bar|core support)/i
    ),
    aftermarketSensorAdjacent: hasLine(
      parsed,
      /\b(a\/m|aftermarket)\b.*(bumper|grille|shutter|cover|lamp|radar|sensor|camera|headlamp|fascia)/i
    ),
    recycledStructural: hasLine(
      parsed,
      /\b(lkq|recycled)\b.*(reinforcement|bar|support|hood|rail|apron|pillar|member|core support)/i
    ),
    recycledMechanical: hasLine(
      parsed,
      /\b(lkq|recycled)\b.*(intercooler|radiator|condenser|fan|cooler|mechanical|support)/i
    ),
    positionStatementWarning: hasLine(
      parsed,
      /position statement|non-?oem warning|oem warning|warranty concern|safety concern/i
    ),
    accCalibration: hasLine(
      parsed,
      /acc.*calibration|adaptive cruise.*calibration|radar sensor calibration|wave radar sensor aim|radar aim/i
    ),
    kafasCalibration: hasLine(
      parsed,
      /kafas.*calibration|front camera aim|forward camera calibration|camera calibration/i
    ),
  };
}
