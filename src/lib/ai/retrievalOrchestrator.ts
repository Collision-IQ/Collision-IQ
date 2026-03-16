import { type ActiveContext } from "@/lib/context/activeContext";
import { inferGraphRelations } from "./graph/repairKnowledgeGraph";
import {
  runRetrieval,
  type RetrievalHit,
} from "./orchestrator/retrievalOrchestrator";
import { type RepairPipelineResult } from "./pipeline/repairPipeline";

type RetrievalOrchestratorParams = {
  userQuery: string;
  activeContext: ActiveContext | null;
  intelligence: RepairPipelineResult;
  limit?: number;
};

export async function orchestrateRetrieval({
  userQuery,
  activeContext,
  intelligence,
  limit = 5,
}: RetrievalOrchestratorParams): Promise<RetrievalHit[]> {
  const graphInferences = inferGraphRelations(
    intelligence.operations.map((operation) => operation.component)
  );

  const queryPlans = [
    {
      query: userQuery,
      vehicle: activeContext?.vehicle?.make ?? null,
      system: activeContext?.repair?.system ?? null,
      component: activeContext?.repair?.component ?? null,
      procedure: activeContext?.repair?.procedure ?? null,
      limit,
    },
    ...graphInferences.slice(0, 4).map((inference) => ({
      query: `${userQuery} ${inference.evidenceQuery}`.trim(),
      vehicle: activeContext?.vehicle?.make ?? null,
      system: inference.system,
      component: inference.component,
      procedure: inference.procedure,
      limit: 3,
    })),
    ...intelligence.requiredProcedures.slice(0, 3).map((procedure) => ({
      query: `${userQuery} ${procedure.procedure}`.trim(),
      vehicle: activeContext?.vehicle?.make ?? null,
      system: activeContext?.repair?.system ?? null,
      component: procedure.matchedOperation,
      procedure: procedure.procedure,
      limit: 3,
    })),
  ];

  const settled = await Promise.all(
    queryPlans.map(async (plan) => {
      try {
        return await runRetrieval({
          query: plan.query,
          vehicle: plan.vehicle ?? undefined,
          system: plan.system ?? undefined,
          component: plan.component ?? undefined,
          procedure: plan.procedure ?? undefined,
        });
      } catch (error) {
        console.error("Retrieval plan failed:", plan, error);
        return [];
      }
    })
  );

  return dedupeResults(settled.flat()).slice(0, limit);
}

function dedupeResults(results: RetrievalHit[]): RetrievalHit[] {
  const seen = new Map<string, RetrievalHit>();

  for (const result of results) {
    const key = `${result.drive_path ?? ""}:${result.text}`.trim();
    const existing = seen.get(key);

    if (!existing || (result.similarity ?? 0) > (existing.similarity ?? 0)) {
      seen.set(key, result);
    }
  }

  return [...seen.values()].sort(
    (a, b) => (b.similarity ?? 0) - (a.similarity ?? 0)
  );
}
