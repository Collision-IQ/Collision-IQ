import { ParsedEstimate, hasLine } from "./estimateExtractor";

export interface ComparisonFacts {
  shop: Record<string, boolean>;
  insurer: Record<string, boolean>;
}

export function extractComparisonFacts(
  shop: ParsedEstimate,
  insurer: ParsedEstimate
): ComparisonFacts {
  const fact = (parsed: ParsedEstimate) => ({
    preScan: hasLine(parsed, /pre-?repair scan|pre scan/i),
    inProcessScan: hasLine(parsed, /in-?proc|in process scan/i),
    postScan: hasLine(parsed, /post-?repair scan|post scan/i),
    accCalibration: hasLine(parsed, /acc.*calibration|adaptive cruise.*calibration/i),
    kafasCalibration: hasLine(parsed, /kafas.*calibration/i),
    surroundCalibration: hasLine(
      parsed,
      /all-?around vision.*calibration|surround vision.*calibration/i
    ),
    calibrationTransport: hasLine(
      parsed,
      /transport vehicle to sublet|transport vehicle from sublet/i
    ),
    cavityWax: hasLine(parsed, /cavity wax/i),
    roadTest: hasLine(parsed, /road test/i),
    maskJambs: hasLine(parsed, /mask jambs/i),
    tintColor: hasLine(parsed, /tint color/i),
    finishSandPolish: hasLine(parsed, /finish sand.*polish/i),
  });

  return {
    shop: fact(shop),
    insurer: fact(insurer),
  };
}
