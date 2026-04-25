import type { EstimateOperation } from "../extractors/estimateExtractor";
import type { AgentFindingEnhanced } from "../types/analysis";

export type ADASAgentFinding = {
  system: "ADAS";
  signal: string;
  implication: string;
  enhanced: AgentFindingEnhanced;
};

export async function runADASAgent(
  operations: EstimateOperation[]
): Promise<ADASAgentFinding[]> {
  const findings: ADASAgentFinding[] = [];

  const bumperRemoved = operations.some((operation) =>
    operation.component.toLowerCase().includes("bumper")
  );

  const windshieldWork = operations.some((operation) =>
    /windshield|glass|w\/s/.test(operation.component.toLowerCase())
  );

  const grilleFascia = operations.some((operation) =>
    /grille|fascia|hood|headlamp|radar|sensor/.test(operation.component.toLowerCase())
  );

  if (bumperRemoved) {
    findings.push({
      system: "ADAS",
      signal: "Front-end work detected",
      implication:
        "ADAS calibration may be relevant depending on system involvement.",
      enhanced: {
        issue: "ADAS calibration triggered by front-end work",
        finding:
          "Bumper removal is present on the estimate. For vehicles equipped with front-facing radar, camera, or ultrasonic systems, OEM procedures require dynamic or static recalibration after bumper R&I.",
        evidenceLevel: "referenced",
        supportSources: ["upload"],
        risk: "high",
        confidence: 0.8,
        secondLevelReasoning:
          "If the vehicle is a high-trim ADAS-equipped model, skipped calibration creates safety liability. Many insurers exclude calibration as a line item unless specifically demanded with OEM procedure reference. The gap is almost always disputable.",
        thirdLevelAction:
          "Identify the exact ADAS systems on this vehicle by VIN or trim. Pull the OEM calibration procedure (static vs. dynamic, targets required, equipment required). Then confirm whether the insurer estimate includes a calibration line or sublet authorization.",
      },
    });
  }

  if (windshieldWork) {
    findings.push({
      system: "ADAS",
      signal: "Windshield or glass work detected",
      implication:
        "Forward-facing camera calibration is commonly required after windshield replacement per OEM.",
      enhanced: {
        issue: "Forward camera calibration after windshield replacement",
        finding:
          "Windshield work appears on the estimate. Vehicles with lane-keep assist, automatic emergency braking, or forward collision warning require camera recalibration after windshield removal.",
        evidenceLevel: "referenced",
        supportSources: ["upload"],
        risk: "high",
        confidence: 0.82,
        secondLevelReasoning:
          "Windshield replacement is one of the most common triggers for missed ADAS calibration. The cost is typically $250–$600 for static calibration, and omitting it exposes the vehicle owner to lane departure or AEB system failure.",
        thirdLevelAction:
          "Request the OEM service bulletin or position statement for this make/model covering windshield replacement and forward camera recalibration requirements. Add as a supplement line with sublet authorization.",
      },
    });
  }

  if (grilleFascia) {
    findings.push({
      system: "ADAS",
      signal: "Grille, fascia, or sensor-area work detected",
      implication:
        "Radar or sensor alignment may be required depending on sensor mounting location.",
      enhanced: {
        issue: "Radar or sensor realignment after fascia/grille work",
        finding:
          "Components in the sensor mounting zone are included on the estimate. Radar sensors mounted in grille, fascia, or bumper brackets may require realignment or calibration after removal.",
        evidenceLevel: "inferred",
        supportSources: ["upload"],
        risk: "medium",
        confidence: 0.65,
        secondLevelReasoning:
          "Even if the radar unit itself is not replaced, displacement of the mounting bracket or surrounding panel can shift sensor aim. OEM position statements for many makes require scan and alignment verification after any front-end structural or cosmetic work.",
        thirdLevelAction:
          "Confirm sensor mounting location for this vehicle's radar unit. Pull OEM position statement on sensor re-aim requirements after fascia or grille work. Document and add as a supplement if not already included.",
      },
    });
  }

  return findings;
}
