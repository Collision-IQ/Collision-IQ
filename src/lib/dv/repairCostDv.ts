// Repair-Cost Diminished Value method — TypeScript port of the owner's
// repair_cost_dv.py reference module (Collision Academy Repair-Cost Schedule
// v1.0). Adds a second DV method WITHOUT changing the market method; the two
// reconcile per DV_SCHEDULE.reconciliation.
//
//   Damage Severity Ratio (DSR) = Gross Repair Cost / Pre-Loss ACV
//   Base Factor                 = DSR tier lookup
//   Adders                      = structural repair, airbag deployment,
//                                 repaired (not replaced) outer panels,
//                                 non-OEM/aftermarket parts
//   Repair-Cost DV              = Gross Repair Cost × (Base + Adders), capped
//   Market DV (when present)    = Pre-Loss ACV − post-loss market value
//   Reconciled DV               = "average" | "market_primary" | "greater_of"
//                                 (one method present → that method)
//
// Pure functions, no I/O. Every factor lives in DV_SCHEDULE so the shop tunes
// them in ONE place. Golden numbers from the McLaren / 2022 BMW X3 packet are
// enforced in acvMath.test.cjs.

import { roundCents } from "./acvMath";

export type DvReconciliationMode = "average" | "market_primary" | "greater_of";

export const DV_SCHEDULE = {
  /** [upper bound of DSR, base factor applied to gross repair cost] */
  dsrTiers: [
    [0.1, 0.15], // DSR < 10%  → 15% of repair cost (light cosmetic)
    [0.2, 0.25], // 10–20%     → 25%
    [0.3, 0.35], // 20–30%     → 35%
    [0.45, 0.45], // 30–45%    → 45%
    [9.99, 0.55], // > 45%     → 55% (heavy / near-total)
  ] as ReadonlyArray<readonly [number, number]>,
  structuralAdder: 0.1, // any panel coded structural repaired/replaced
  airbagAdder: 0.1, // airbag deployment on the estimate
  repairedPanelAdder: 0.05, // outer panels REPAIRED w/ filler vs replaced
  aftermarketAdder: 0.0, // set > 0 to price non-OEM parts risk
  maxFactor: 0.65,
  reconciliation: "average" as DvReconciliationMode,
  label: "Collision Academy Repair-Cost Schedule v1.0",
} as const;

export type RepairCharacter = {
  structuralRepair: boolean;
  airbagDeployed: boolean;
  /** Count of outer body panels REPAIRED (not replaced). */
  repairedOuterPanels: number;
  aftermarketParts: boolean;
  totalLaborHours?: number;
  structuralLineRef?: string;
  repairedPanelRefs?: string;
};

export type RepairCostDvResult = {
  dsr: number;
  baseFactor: number;
  adders: Record<string, number>;
  appliedFactor: number;
  repairCostDv: number;
  scheduleLabel: string;
};

export function baseFactorFor(dsr: number): number {
  for (const [upper, factor] of DV_SCHEDULE.dsrTiers) {
    if (dsr < upper) return factor;
  }
  return DV_SCHEDULE.dsrTiers[DV_SCHEDULE.dsrTiers.length - 1][1];
}

export function computeRepairCostDv(params: {
  preLossAcv: number;
  grossRepairCost: number;
  character: RepairCharacter;
}): RepairCostDvResult {
  const dsr = params.preLossAcv > 0 ? params.grossRepairCost / params.preLossAcv : 0;
  const baseFactor = baseFactorFor(dsr);

  const adders: Record<string, number> = {};
  if (params.character.structuralRepair) {
    adders["structural repair"] = DV_SCHEDULE.structuralAdder;
  }
  if (params.character.airbagDeployed) {
    adders["airbag deployment"] = DV_SCHEDULE.airbagAdder;
  }
  if (params.character.repairedOuterPanels > 0) {
    adders["repaired outer panels"] = DV_SCHEDULE.repairedPanelAdder;
  }
  if (params.character.aftermarketParts && DV_SCHEDULE.aftermarketAdder > 0) {
    adders["aftermarket parts"] = DV_SCHEDULE.aftermarketAdder;
  }

  const appliedFactor = Math.min(
    baseFactor + Object.values(adders).reduce((sum, value) => sum + value, 0),
    DV_SCHEDULE.maxFactor
  );

  return {
    dsr,
    baseFactor,
    adders,
    appliedFactor,
    repairCostDv: roundCents(params.grossRepairCost * appliedFactor),
    scheduleLabel: DV_SCHEDULE.label,
  };
}

export function reconcileDv(params: {
  marketDv: number | null;
  repairCostDv: number;
  mode?: DvReconciliationMode;
}): { reconciledDv: number; reconciliationUsed: string } {
  const mode = params.mode ?? DV_SCHEDULE.reconciliation;
  if (params.marketDv === null) {
    return {
      reconciledDv: params.repairCostDv,
      reconciliationUsed: "repair_cost_only (no market post-loss value in packet)",
    };
  }
  if (mode === "market_primary") {
    return {
      reconciledDv: params.marketDv,
      reconciliationUsed: "market_primary (repair-cost method corroborates)",
    };
  }
  if (mode === "greater_of") {
    return {
      reconciledDv: Math.max(params.marketDv, params.repairCostDv),
      reconciliationUsed: "greater_of",
    };
  }
  return {
    reconciledDv: roundCents((params.marketDv + params.repairCostDv) / 2),
    reconciliationUsed: "average of market and repair-cost methods",
  };
}
