export type EstimateOperation = {
  panel: "front bumper";
  operation: "R&I";
  labor_hours: 1.7;
};

export type Estimate = {
  vehicle: "2024 BMW 330i";
  vin: "3MW89FF07R8E75552";
  operations: EstimateOperation[];
};

export const procedureTriggers = [
  {
    component: "front bumper",
    triggers: [
      "ACC calibration",
      "KAFAS calibration",
    ],
  },
  {
    component: "collision damage",
    triggers: [
      "pre-scan",
      "post-scan",
    ],
  },
] as const;
