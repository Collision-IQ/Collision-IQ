export type StateLeverageResult = {
  state?: string;
  points: string[];
  disclaimer?: string;
};

export function buildStateLeverage(state?: string): StateLeverageResult {
  if (!state) {
    return {
      points: [
        "Focus on repair defensibility, verification, and documented support.",
        "Push on whether the estimate clearly supports a complete and validated repair.",
      ],
      disclaimer: "State-specific claim handling and appraisal rights may vary.",
    };
  }

  const key = state.trim().toUpperCase();

  if (key === "TX") {
    return {
      state: "TX",
      points: [
        "Emphasize prompt, fair claim handling and documented basis for reductions.",
        "Frame omissions as repair-support deficiencies, not preference differences.",
        "If major value gaps remain unresolved, appraisal discussion becomes stronger.",
      ],
    };
  }

  if (key === "CA") {
    return {
      state: "CA",
      points: [
        "Focus on complete repair support, documentation, and reasonable investigation.",
        "Challenge broad reductions that are not clearly tied to actual repair methodology.",
        "Push for written basis where operations are reduced or omitted.",
      ],
    };
  }

  if (key === "FL") {
    return {
      state: "FL",
      points: [
        "Focus on whether the estimate supports a proper and fully documented repair.",
        "Challenge vague denials or reductions that shift repair risk back to the shop.",
        "Where value differences remain material, appraisal positioning may become useful.",
      ],
    };
  }

  return {
    state: key,
    points: [
      "Frame the dispute around repair support, verification, and defensibility.",
      "Ask for written basis for reductions, omissions, and unsupported substitutions.",
    ],
    disclaimer:
      "Add state-specific claim handling language if local counsel or policy review supports it.",
  };
}
