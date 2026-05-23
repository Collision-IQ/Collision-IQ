export type AdasDecisionState =
  | "baseline_scan_required"
  | "teardown_dependent"
  | "calibration_supported";

type EvidenceInput = {
  vehicle?: {
    make?: string;
    model?: string;
    year?: number;
  };
  estimateText?: string;
  extractedFacts?: Record<string, unknown>;
  files?: Array<{
    name?: string;
    text?: string | null;
    summary?: string | null;
  }>;
};

const TEARDOWN_SIGNALS = [
  "teardown",
  "disassemble",
  "disassembly",
  "after teardown",
  "hidden damage",
  "damage analysis complete",
];

const SCAN_SIGNALS = [
  "pre-repair scan",
  "post-repair scan",
  "pre scan",
  "post scan",
  "diagnostic scan",
];

const INTERRUPTION_SIGNALS = [
  "disconnect",
  "reconnect",
  "battery disconnect",
  "module replacement",
  "bumper removal",
  "bumper replace",
  "headlamp replace",
  "mirror replace",
  "radar",
  "camera",
  "sensor",
  "blind spot",
  "lane departure",
  "park sensor",
  "adas",
];

const SPECIFIC_CALIBRATION_SIGNALS = [
  "calibration",
  "static calibration",
  "dynamic calibration",
  "aiming",
  "initialization",
  "programming",
  "setup procedure",
];

export const ADAS_POLICY = `
ADAS POLICY:
- Do not assume a specific ADAS calibration simply because a vehicle may be ADAS-equipped.
- Before teardown, missing calibration detail is not by itself proof that no calibration will be needed.
- If teardown is incomplete, default to: baseline pre/post scan supported; final ADAS calibration scope provisional.
- Recognize that disconnect/reconnect, module interruption, R&I, aiming disturbance, and sensor/mount/component replacement can trigger calibration or initialization requirements even where direct sensor damage is not yet confirmed.
- Only name a specific calibration when supported by the estimate, OEM procedure, scan documentation, teardown findings, or other file evidence.
- Avoid overcommitting to a specific ADAS operation before teardown clarifies the full scope.
`.trim();

function joinCaseText(input: EvidenceInput) {
  const parts = [
    input.estimateText || "",
    JSON.stringify(input.extractedFacts || {}),
    ...(input.files || []).map((file) => `${file.name || ""}\n${file.text || file.summary || ""}`),
  ];

  return parts.join("\n\n").toLowerCase();
}

export function getAdasDecision(input: EvidenceInput) {
  const text = joinCaseText(input);

  const hasTeardownSignal = TEARDOWN_SIGNALS.some((signal) => text.includes(signal));
  const hasScanSignal = SCAN_SIGNALS.some((signal) => text.includes(signal));
  const hasInterruptionSignal = INTERRUPTION_SIGNALS.some((signal) => text.includes(signal));
  const hasSpecificCalibrationSignal = SPECIFIC_CALIBRATION_SIGNALS.some((signal) =>
    text.includes(signal)
  );

  if (hasSpecificCalibrationSignal) {
    return {
      state: "calibration_supported" as AdasDecisionState,
      reasoning:
        "Current file support includes calibration, aiming, initialization, or other procedure-specific language.",
    };
  }

  if (!hasTeardownSignal && (hasScanSignal || hasInterruptionSignal)) {
    return {
      state: "teardown_dependent" as AdasDecisionState,
      reasoning:
        "Pre/post scan support is present, but teardown appears incomplete. Additional ADAS calibration scope remains provisional pending confirmation of damage, R&I, or interruption.",
    };
  }

  if (hasScanSignal) {
    return {
      state: "baseline_scan_required" as AdasDecisionState,
      reasoning:
        "Current support establishes standard pre/post diagnostic scanning, but not a confirmed procedure-specific calibration requirement.",
    };
  }

  return {
    state: "teardown_dependent" as AdasDecisionState,
    reasoning:
      "No explicit calibration support is present yet. ADAS scope should remain provisional until teardown clarifies full damage and any interruption-related requirements.",
  };
}

export function buildAdasNarrative(input: EvidenceInput) {
  const result = getAdasDecision(input);

  switch (result.state) {
    case "calibration_supported":
      return {
        title: "ADAS / Calibration Support",
        status: "supported" as const,
        body:
          "The current file set supports calibration-related procedures. The record includes procedure-level language indicating calibration, aiming, initialization, programming, or equivalent post-repair setup requirements.",
      };
    case "baseline_scan_required":
      return {
        title: "ADAS / Calibration Support",
        status: "partial" as const,
        body:
          "The current documentation supports standard pre-repair and post-repair scanning. It does not yet independently confirm a procedure-specific ADAS calibration requirement.",
      };
    case "teardown_dependent":
    default:
      return {
        title: "ADAS / Calibration Support",
        status: "provisional" as const,
        body:
          "The current documentation supports baseline scanning, but full ADAS calibration scope remains teardown-dependent. Additional requirements may be triggered if teardown confirms sensor/component damage, mounting disturbance, or interruption from disconnect/reconnect or related repair operations.",
      };
  }
}
