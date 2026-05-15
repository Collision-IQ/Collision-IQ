export const TTS_STYLE_PROMPT =
  "Female-coded voice. Warm, confident, quick-witted, conversational, and natural. Subtle Northeast energy. Smart, grounded, expressive, and slightly dry in tone. Brisk pacing with clear articulation. Sounds like a sharp professional explaining something clearly under pressure. Avoid parody, caricature, celebrity imitation, or cloning any real person's voice.";

export const VOICE_PRESETS = [
  {
    id: "default",
    label: "Default",
    rate: 1,
    pitch: 1,
    description: "Use your browser's default system voice.",
  },
  {
    id: "clear-professional-female",
    label: "Clear Professional Female",
    rate: 0.94,
    pitch: 1.02,
    description: "Clear, measured readout. Actual voice depends on your browser/system voices.",
  },
  {
    id: "firm-ny-advisor",
    label: "Firm NY Advisor",
    rate: 1.02,
    pitch: 1,
    description: "female-coded, fast, confident, assertive, New York-style delivery",
  },
  {
    id: "calm-customer-explainer",
    label: "Calm Customer Explainer",
    rate: 0.88,
    pitch: 1,
    description: "Slower, calmer pacing for customer-facing explanations.",
  },
  {
    id: "carrier-negotiation-voice",
    label: "Carrier Negotiation Voice",
    rate: 0.96,
    pitch: 0.98,
    description: "Steady, concise pacing for negotiation notes.",
  },
] as const;
