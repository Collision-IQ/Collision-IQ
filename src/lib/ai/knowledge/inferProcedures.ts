import { repairGraph } from "./repairGraph";

export function inferProcedures(components: string[]) {
  const matches = repairGraph.filter((node) =>
    components.some((component) =>
      component.toLowerCase().includes(node.component.toLowerCase())
    )
  );

  return {
    procedures: [...new Set(matches.flatMap((match) => match.procedures ?? []))],
    qualitySteps: [...new Set(matches.flatMap((match) => match.qualitySteps ?? []))],
    systems: [...new Set(matches.flatMap((match) => match.systems ?? []))],
  };
}
