export type RepairGraphNode = {
  component: string;
  affects?: string[];
  sensors?: string[];
  systems?: string[];
  procedures?: string[];
  qualitySteps?: string[];
};

export const repairGraph: RepairGraphNode[] = [
  {
    component: "front bumper",
    sensors: ["radar sensor", "front distance sensor"],
    systems: ["ADAS"],
    procedures: ["distance sensor aim", "radar calibration", "front camera aim"],
  },
  {
    component: "radiator support",
    affects: ["front-end geometry", "lamp mounting", "sensor mounting"],
    systems: ["ADAS", "structural"],
    procedures: ["headlamp aim", "front camera aim", "dimensional verification"],
    qualitySteps: ["test fit", "measurement"],
  },
  {
    component: "panel replacement",
    affects: ["corrosion protection"],
    procedures: ["cavity wax", "seam sealer", "weld-thru primer"],
  },
];
