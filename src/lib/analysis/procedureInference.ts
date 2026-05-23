export type ReferencedProcedureSignal = {
  category: "adas" | "structural" | "calibration" | "alignment" | "fit_finish" | "general";
  strength: number;
  sourceLabel: string;
  rationale: string;
};

function normalize(text: string) {
  return text.toLowerCase();
}

export function inferReferencedProcedureSignals(input: {
  title?: string | null;
  description?: string | null;
  documentType?: string | null;
}): ReferencedProcedureSignal[] {
  const haystack = normalize(
    [input.title ?? "", input.description ?? "", input.documentType ?? ""].join(" ")
  );

  const signals: ReferencedProcedureSignal[] = [];

  const push = (
    category: ReferencedProcedureSignal["category"],
    strength: number,
    rationale: string
  ) => {
    signals.push({
      category,
      strength,
      sourceLabel: "referenced_oem_or_procedure_doc",
      rationale,
    });
  };

  if (/(adas|camera|radar|sensor|blind spot|lane|park assist)/i.test(haystack)) {
    push("adas", 0.45, "Referenced procedure language suggests ADAS-related support.");
  }

  if (/(calibration|initialize|program|aiming|set up|setup|coding|scan)/i.test(haystack)) {
    push("calibration", 0.5, "Referenced procedure language suggests scan/calibration support.");
  }

  if (/(measure|structural|frame|aperture|section|rail|quarter|unibody)/i.test(haystack)) {
    push("structural", 0.4, "Referenced procedure language suggests structural verification support.");
  }

  if (/(alignment|toe|camber|caster|steering angle)/i.test(haystack)) {
    push("alignment", 0.4, "Referenced procedure language suggests alignment/verification support.");
  }

  if (/(test fit|fit check|fit-check|pre-paint|gap|flush|closure|door shell)/i.test(haystack)) {
    push("fit_finish", 0.35, "Referenced procedure language suggests fit/finish verification support.");
  }

  if (signals.length === 0 && /(oem|procedure|repair manual|service information)/i.test(haystack)) {
    push("general", 0.2, "Referenced OEM/procedure documentation suggests some repair-path support.");
  }

  return signals;
}
