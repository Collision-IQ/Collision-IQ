import type { EstimateLine, NormalizedEstimate, Finding, Severity, Authority, Exposure, FindingClass } from "../types";
import { panelRefinishGroups, type PanelGroup } from "../reconcile";

/** Everything a rule may read. Built once per run. */
export interface RuleContext {
  est: NormalizedEstimate;
  lines: EstimateLine[];
  text: string;                       // all descs + notes + boilerplate, lower-cased
  rates: { body: number; refinish: number; mech: number; supplies: number };
  panels: PanelGroup[];
  impact: ImpactProfile;
  has(re: RegExp): boolean;           // any line desc/notes match
  find(re: RegExp): EstimateLine[];
  inSection(re: RegExp): EstimateLine[];
  hasOption(re: RegExp): boolean;
}

export interface ImpactProfile {
  side: "LT" | "RT" | null;
  isSideImpact: boolean;              // T-bone / side codes
  isFront: boolean;
  isRear: boolean;
  label: string;
}

export interface Rule {
  id: string;
  cls: FindingClass;
  /** Return null when the rule does not fire. */
  run(ctx: RuleContext): Omit<Finding, "id"> | null;
}

export function buildContext(est: NormalizedEstimate): RuleContext {
  const lines = est.lines;
  const text = [
    ...lines.map(l => `${l.section} ${l.oper} ${l.desc} ${(l.notes ?? []).join(" ")}`),
    est.boilerplate ?? "",
  ].join("\n").toLowerCase();
  const rate = (c: string) => est.totals.labor.find(l => l.category === c)?.rate ?? 0;
  const body = rate("BODY");
  const rates = { body, refinish: rate("REFINISH") || body, mech: rate("MECH") || body, supplies: est.totals.paintSupplies?.rate ?? 0 };
  const opts = (est.header.vehicle.options ?? []).join(" | ").toLowerCase();
  const impact = impactProfile(est);
  const matchLine = (l: EstimateLine, re: RegExp) => re.test(`${l.desc} ${(l.notes ?? []).join(" ")}`);
  return {
    est, lines, text, rates, panels: panelRefinishGroups(est), impact,
    has: re => lines.some(l => matchLine(l, re)),
    find: re => lines.filter(l => matchLine(l, re)),
    inSection: re => lines.filter(l => re.test(l.section)),
    hasOption: re => re.test(opts),
  };
}

export function impactProfile(est: NormalizedEstimate): ImpactProfile {
  const label = (est.header.pointOfImpact?.label ?? "").toLowerCase();
  const code = est.header.pointOfImpact?.code ?? "";
  const side = /right|rt\b/.test(label) ? "RT" : /left|lt\b/.test(label) ? "LT" : null;
  // CCC POI codes: 01 front, 02 RF, 03 right side / T-bone, 04 RR, 05 rear, 06 LR, 07 left side, 08 LF
  const isSideImpact = /t-bone|side/.test(label) || ["03", "07"].includes(code);
  return {
    side, isSideImpact,
    isFront: /front/.test(label) || ["01", "02", "08"].includes(code),
    isRear: /rear/.test(label) || ["04", "05", "06"].includes(code),
    label: est.header.pointOfImpact?.label ?? "",
  };
}

/* helpers for rule authors */
export const f = (
  p: { ruleId: string; cls: FindingClass; severity: Severity; title: string; lineRefs?: number[];
       facts: string[]; authorities?: Authority[]; action: string; exposure?: Partial<Exposure> },
): Omit<Finding, "id"> => ({
  ruleId: p.ruleId, cls: p.cls, severity: p.severity, title: p.title,
  lineRefs: p.lineRefs ?? [], facts: p.facts, authorities: p.authorities ?? [], action: p.action,
  exposure: { quantified: 0, direction: "INCREASE", ...p.exposure },
});

export const A = {
  motor: (label: string): Authority => ({ kind: "MOTOR_GTE", label: `MOTOR Guide to Estimating — ${label}` }),
  ccc: (label: string): Authority => ({ kind: "CCC_GTE", label: `CCC ONE / MOTOR not-included operations — ${label}` }),
  oem: (make: string, topic: string): Authority => ({ kind: "OEM_POSITION", label: `${make} position statement — ${topic}` }),
  icar: (topic: string): Authority => ({ kind: "ICAR", label: `I-CAR — ${topic}` }),
  reg: (label: string, citation?: string): Authority => ({ kind: "REGULATION", label, citation }),
  tax: (label: string, citation?: string): Authority => ({ kind: "TAX_GUIDANCE", label, citation }),
  industry: (label: string): Authority => ({ kind: "INDUSTRY", label }),
};

export const money = (n: number) => `$${n.toFixed(2)}`;
export const lineNos = (ls: EstimateLine[]) => ls.map(l => l.lineNo).filter((n): n is number => n != null);
