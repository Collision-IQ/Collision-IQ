import type { Finding, ForensicReport, NormalizedEstimate, Severity } from "./types";
import { reconcile } from "./reconcile";
import { buildContext } from "./rules/context";
import { RULES } from "./rules/catalog";

const SEV_ORDER: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };

export interface EngineOptions {
  /** Disable rules by id (tenant / profile config). */
  disabledRules?: string[];
}

/**
 * Deterministic pass. Produces a complete ForensicReport with templated
 * prose; `narrative.ts` optionally enriches findings afterward.
 */
export function runForensicSingle(est: NormalizedEstimate, opts: EngineOptions = {}): ForensicReport {
  const recon = reconcile(est);           // may normalize ambiguous column bands in place
  const ctx = buildContext(est);
  const disabled = new Set(opts.disabledRules ?? []);

  const raw: Omit<Finding, "id">[] = [];
  if (recon.unexplained > 0) {
    raw.push({
      ruleId: "RC-001", cls: "RECONCILIATION", severity: "CRITICAL",
      title: "Printed totals do not rebuild from the line items",
      lineRefs: [], authorities: [],
      facts: recon.rows.filter(r => r.variance !== 0).map(r => `${r.category}: rebuilt ${r.rebuilt} vs printed ${r.printed} (variance ${r.variance}).`),
      action: "Resolve the extraction or the estimate before relying on any finding below; a report that does not close to $0.00 is not releasable.",
      exposure: { quantified: 0, direction: "MIXED" },
    });
  }
  for (const rule of RULES) {
    if (disabled.has(rule.id)) continue;
    const r = rule.run(ctx);
    if (r) raw.push(r);
  }
  raw.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  const findings: Finding[] = raw.map((r, i) => ({ id: `F-${String(i + 1).padStart(2, "0")}`, ...r }));

  // Each finding contributes [min, max] of its quantified alternatives; the report range is the sum.
  const lo = findings.reduce((s, f) => s + Math.min(f.exposure.quantified, f.exposure.quantifiedAlt ?? f.exposure.quantified), 0);
  const hi = findings.reduce((s, f) => s + Math.max(f.exposure.quantified, f.exposure.quantifiedAlt ?? f.exposure.quantified), 0);
  const quantifiedLow = r2(lo), quantifiedHigh = r2(hi);

  const top = findings[0];
  const holdRelease = findings.some(f => f.severity === "CRITICAL" || f.severity === "HIGH");
  const verdict = {
    headline: recon.unexplained === 0
      ? `Arithmetically clean; ${findings.length} finding(s), ${findings.filter(f => f.severity === "CRITICAL" || f.severity === "HIGH").length} critical/high.`
      : `Printed totals do not reconcile (${recon.unexplained.toFixed(2)} unexplained).`,
    recommendation: holdRelease
      ? `Hold release. Resolve ${top.id} (${top.title}) and work the revision checklist before the estimate leaves the file.`
      : "Release with the low-severity corrections applied.",
    holdRelease,
  };

  return {
    mode: "SINGLE",
    generatedAt: new Date().toISOString(),
    header: est.header,
    printedTotals: est.totals,
    reconciliation: recon,
    verdict,
    findings,
    correctlyWritten: correctlyWritten(est),
    exposure: {
      quantifiedLow: Math.min(quantifiedLow, quantifiedHigh),
      quantifiedHigh: Math.max(quantifiedLow, quantifiedHigh),
      openItems: findings.filter(f => f.exposure.open).map(f => `${f.id}: ${f.exposure.open}`),
    },
    checklist: findings.map((f, i) => ({ n: i + 1, action: f.action, ref: f.id })),
    references: uniq(findings.flatMap(f => f.authorities.map(a => a.citation ? `${a.label} (${a.citation})` : a.label))),
  };
}

/** Positive QA: operations that are present and properly formed. */
function correctlyWritten(est: NormalizedEstimate): string[] {
  const has = (re: RegExp) => est.lines.some(l => re.test(l.desc));
  const out: string[] = [];
  if (has(/disconnect|disable power/i)) out.push("Disconnect/disable power written");
  if (has(/pre[- ]?repair scan/i) && has(/post[- ]?repair scan/i)) out.push("Pre- and post-repair scans present");
  if (has(/corrosion/i)) out.push("Corrosion protection with material");
  if (has(/laminated/i)) out.push("Laminated glass identified");
  if (has(/overlap/i)) out.push("Overlap deduction applied to adjacent panel");
  if (has(/clear coat/i)) out.push("Clear coat computed per panel");
  if (has(/car cover|mask jambs|mask for primer|denib/i)) out.push("Customary refinish prep and finish operations present");
  if (est.header.priorDamageNote) out.push("Prior damage noted");
  if (est.header.writer?.license) out.push("Appraiser license on the document");
  return out;
}

const uniq = <T,>(a: T[]) => Array.from(new Set(a));
const r2 = (n: number) => Math.round(n * 100) / 100;
