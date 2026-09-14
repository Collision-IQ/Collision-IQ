/**
 * Rule catalog for single-estimate forensic review.
 *
 * Every rule is deterministic and document-shape based: no rule keys on a
 * carrier name, shop name, or RO literal (universality invariant). Rules emit
 * FACTS (what was observed) and expected AUTHORITIES; the narrative layer
 * verifies authorities against RAG and writes prose. Rules never invent
 * dollar figures they cannot compute from the estimate's own rates.
 */
import type { Rule } from "./context";
import { A, f, lineNos, money } from "./context";

const PANEL = /door|quarter|fender|hood|deck lid|liftgate|roof|rocker|bedside|cab corner|pillar/i;
const PULL_WELD = /weld|pull metal|pull.*dent|stud|tab/i;
const SENSOR = /impact sensor|pressure sensor|side sensor|satellite sensor|restraint|rcm|srs|air ?bag/i;
const STRUCT_CHECK = /pillar|rocker|aperture|measure|set ?up|adjust|algn|align|hinge|striker/i;
const GRAPHIC = /decal|graphic|stripe|striping|lettering|wrap|emblem/i;
const FPB = /feather|prime.*block|f\/p\/b|\bfpb\b|block sand/i;
const BLEND = /blend|blnd/i;
const TINT = /tint/i;
const HAZ = /hazard|waste|disposal/i;
const SCAN = /scan|diagnostic/i;
const CAL = /calibrat|aim|target/i;
const ADAS_PART = /camera|radar|lidar|sonar|park(ing)? sensor|windshield|w\/shield|headlamp|distance sensor|blind spot|mirror.*camera/i;
const NON_OEM = /\b(a\/m|aftermarket|lkq|recond|recore|nags|capa|used|rcy|opt oem|alt oem)\b/i;
const SAFETY_PART = /rail|apron|reinf|bracket|absorber|beam|pillar|rocker|rail|airbag|seat belt|sensor|camera|radar|bumper|headlamp/i;
const UPFIT = /partition|window bar|barrier|upfit|console|light ?bar|push bumper|spotlight|antenna|cage|prisoner/i;
const GOV = /township|borough|county|city of|commonwealth|state of|police|sheriff|school district|authority|municipal|dept\.? of|department of/i;
const LABOR_TAX_EXEMPT_STATES = new Set(["PA"]); // separately stated motor-vehicle repair labor not taxed; extend per jurisdiction table.
const TYPOS: Record<string, string> = { wedl: "weld", replce: "replace", refnish: "refinish", panle: "panel" };

export const RULES: Rule[] = [
  /* ---------------- RR-001 repair vs. replace ---------------- */
  {
    id: "RR-001", cls: "REPAIR_REPLACE",
    run(ctx) {
      const hits = ctx.panels.filter(p => p.oper === "RPR" && (p.repairHrs ?? 0) > 0 && PANEL.test(p.section));
      const out = [];
      for (const p of hits) {
        const adds = ctx.inSection(new RegExp(`^${escape(p.section)}$`)).filter(l => l.manual && PULL_WELD.test(l.desc) && (l.laborHrs ?? 0) > 0);
        const addHrs = adds.reduce((s, l) => s + (l.laborHrs ?? 0), 0);
        const total = (p.repairHrs ?? 0) + addHrs;
        if (total < 6) continue;
        const shellLine = ctx.lines.find(l => l.section === p.section && l.oper === "RPR");
        const refs = lineNos([shellLine!, ...adds].filter(Boolean));
        out.push({ p, adds, addHrs, total, refs });
      }
      if (!out.length) return null;
      const worst = out.sort((a, b) => b.total - a.total)[0];
      const make = ctx.est.header.vehicle.make ?? "OEM";
      return f({
        ruleId: "RR-001", cls: "REPAIR_REPLACE", severity: worst.adds.length ? "CRITICAL" : "HIGH",
        title: `${worst.p.section.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}: repair vs. replace not defensible as written`,
        lineRefs: worst.refs,
        facts: [
          `Repair time ${worst.p.repairHrs?.toFixed(1)} hr plus ${worst.addHrs.toFixed(1)} hr manual pull/weld adds = ${worst.total.toFixed(1)} hr body time on one panel.`,
          worst.adds.length ? "Weld-on pulling implies load into the inner structure / intrusion beam; neither is mentioned on the estimate." : "No note documents why repair was chosen over an OEM replacement panel.",
          `Repair at the profile rate = ${money(worst.total * ctx.rates.body)}; no OEM part price captured for comparison.`,
        ],
        authorities: [A.oem(make, "door intrusion beams / high-strength structural components are replace-only"), A.icar("UHSS components are not repairable"), A.motor("repair time is a judgment item; document the basis")],
        action: `Re-inspect with trim removed; photograph inner structure and beam. If deformed, convert to Repl (dealer-quoted OEM shell) and drop the pull/weld add. If skin-only, add a line note stating the beam and inner panel were inspected and undamaged. Add 'Adjust' for the panel in either case.`,
        exposure: { quantified: 0, direction: "MIXED", open: "OEM panel price and MOTOR R&R time required" },
      });
    },
  },

  /* ---------------- RS-001 side-impact restraint sensors ---------------- */
  {
    id: "RS-001", cls: "RESTRAINTS",
    run(ctx) {
      if (!ctx.impact.isSideImpact) return null;
      if (ctx.has(SENSOR)) return null;
      const doorWork = ctx.inSection(/door/i).length > 0;
      const make = ctx.est.header.vehicle.make ?? "OEM";
      const inspect = 0.3 * 2;
      return f({
        ruleId: "RS-001", cls: "RESTRAINTS", severity: "HIGH",
        title: "Side-impact restraint sensors not inspected",
        facts: [
          `Point of impact is ${ctx.impact.label || "side"}; vehicle options list side / curtain airbags: ${ctx.hasOption(/side impact|curtain/i) ? "yes" : "not listed"}.`,
          doorWork ? "Door panels on the impact side are being repaired or replaced; the door-mounted pressure sensor sits inside that structure." : "No sensor R&I, inspect, or replace line exists.",
          "No line addresses the door pressure sensor or B-pillar acceleration sensor; scans alone do not satisfy an inspection requirement.",
        ],
        authorities: [A.oem(make, "restraints control module and impact sensors: inspect after any collision, replace if deformed or heat-exposed"), A.ccc("sensor inspection is a manual (not-included) operation")],
        action: "Add 'Inspect side-impact (pressure) sensor' and 'Inspect B-pillar side-impact sensor' as manual lines with photo reference; convert to R&I/Repl if the panel is replaced or any deformation is found. Note that the post-repair scan must confirm no restraint DTCs.",
        exposure: { quantified: r2(inspect * ctx.rates.body), direction: "INCREASE", open: "Sensor replacement TBD (dealer quote)" },
      });
    },
  },

  /* ---------------- ST-001 impact path / aperture ---------------- */
  {
    id: "ST-001", cls: "STRUCTURE",
    run(ctx) {
      if (!ctx.impact.isSideImpact) return null;
      if (ctx.has(STRUCT_CHECK)) return null;
      const heavy = ctx.panels.some(p => (p.repairHrs ?? 0) >= 4);
      const hrs = 1.0 + 0.8;
      return f({
        ruleId: "ST-001", cls: "STRUCTURE", severity: heavy ? "HIGH" : "MEDIUM",
        title: "Impact path not verified beyond the outer panels",
        facts: [
          `Side impact (${ctx.impact.label || "side"}) scoped to outer panels only; no line for pillar, rocker, aperture, hinge, striker, measure, or adjust.`,
          heavy ? "Repair time on the impact panel is 4.0 hr or more, which is inconsistent with an untouched pillar and rocker." : "No documentation shows the pillar and rocker were checked.",
        ],
        authorities: [A.ccc("'Adjust door' and aperture inspection are not included in panel repair or R&I"), A.icar("side-impact damage analysis: verify pillar and rocker before authorizing door repair")],
        action: "Add 'Inspect / measure pillar, rocker and aperture' (manual, photo-referenced) and 'Adjust' for each door on the impact side. If aperture deviation exists, rewrite as a structural estimate rather than supplementing.",
        exposure: { quantified: r2(hrs * ctx.rates.body), direction: "INCREASE", open: "Structural repair TBD if found" },
      });
    },
  },

  /* ---------------- GR-001 graphics removed but not replaced ---------------- */
  {
    id: "GR-001", cls: "GRAPHICS",
    run(ctx) {
      const removes = ctx.find(GRAPHIC).filter(l => /remov|r&i|strip/i.test(l.desc) || (l.manual && (l.laborHrs ?? 0) > 0 && !/repl|apply|install/i.test(l.desc)));
      if (!removes.length) return null;
      const replaces = ctx.find(GRAPHIC).filter(l => /repl|apply|install|sublet|new/i.test(l.desc) || l.oper === "REPL" || l.oper === "SUBL");
      if (replaces.length) return null;
      const perDoor = 1.0;
      return f({
        ruleId: "GR-001", cls: "GRAPHICS", severity: "HIGH",
        title: "Graphics removed but not replaced",
        lineRefs: lineNos(removes),
        facts: [
          `${removes.length} line(s) pay to remove decals/graphics (${removes.reduce((s, l) => s + (l.laborHrs ?? 0), 0).toFixed(1)} hr); the panels are refinished.`,
          "No line supplies or applies replacement graphics (sublet or in-house).",
        ],
        authorities: [A.ccc("graphics replacement and application are not included in any refinish operation"), A.industry("customary sublet, open to invoice")],
        action: "Add 'Sublet: graphics — open to invoice' and application labor per panel; confirm the graphics source (upfitter / fleet vendor) with the owner.",
        exposure: { quantified: r2(removes.length * perDoor * ctx.rates.body), direction: "INCREASE", open: "Graphics material / vendor invoice TBD" },
      });
    },
  },

  /* ---------------- NI-001 feather, prime & block ---------------- */
  {
    id: "NI-001", cls: "NOT_INCLUDED_OP",
    run(ctx) {
      const repaired = ctx.panels.filter(p => p.oper === "RPR" && (p.repairHrs ?? 0) > 0);
      if (!repaired.length || ctx.has(FPB)) return null;
      const hrs = repaired.reduce((s, p) => s + ((p.repairHrs ?? 0) >= 3 ? 1.0 : 0.5), 0);
      const primerMask = ctx.has(/mask.*prim/i);
      return f({
        ruleId: "NI-001", cls: "NOT_INCLUDED_OP", severity: "MEDIUM",
        title: "Feather, prime and block omitted on repaired panels",
        facts: [
          `${repaired.length} repaired panel(s) refinished: ${repaired.map(p => p.section).join(", ")}.`,
          primerMask ? "'Mask for primer' is written, so priming is anticipated, but no feather/prime/block time appears." : "No feather/prime/block time appears.",
        ],
        authorities: [A.ccc("refinish time assumes a new undamaged panel; feather, prime and block of a repaired area is not included")],
        action: `Add 'Feather, prime & block' as a manual body-labor line (${hrs.toFixed(1)} hr total across panels) plus materials at the paint-supply rate.`,
        exposure: { quantified: r2(hrs * ctx.rates.body + hrs * ctx.rates.supplies), direction: "INCREASE" },
      });
    },
  },

  /* ---------------- RF-001 blend / tint consistency, paint code ---------------- */
  {
    id: "RF-001", cls: "REFINISH",
    run(ctx) {
      const refinished = ctx.panels.length > 0;
      if (!refinished) return null;
      const tint = ctx.find(TINT);
      const blends = ctx.lines.filter(l => l.oper === "BLND" || BLEND.test(l.desc));
      const code = ctx.est.header.vehicle.paintCode;
      const problems: string[] = [];
      if (tint.length && !blends.length) problems.push(`Color tint is written (${tint.reduce((s, l) => s + (l.paintHrs ?? l.laborHrs ?? 0), 0).toFixed(1)} hr) but no adjacent-panel blend is written; the two operations should agree.`);
      if (!code) problems.push("Paint code is not captured in the header; the blend decision depends on it (metallic/pearl vs. solid).");
      if (!problems.length) return null;
      return f({
        ruleId: "RF-001", cls: "REFINISH", severity: "MEDIUM",
        title: "Blend decision unresolved / paint code not captured",
        lineRefs: lineNos(tint),
        facts: problems,
        authorities: [A.ccc("blend adjacent panels is a not-included operation at 50% of panel refinish time"), A.motor("tint is written only when the color cannot be matched without adjustment")],
        action: "Record the paint code from the door/VIN label. If metallic or pearl, add blends for adjacent panels with clear coat; if solid and matchable panel-to-panel, remove or justify the tint line.",
        exposure: { quantified: 0, direction: "INCREASE", open: "Blends at 50% of MOTOR refinish time pending paint code" },
      });
    },
  },

  /* ---------------- TX-001 sales tax basis / exempt purchaser ---------------- */
  {
    id: "TX-001", cls: "TAX",
    run(ctx) {
      const t = ctx.est.totals;
      if (!t.salesTax || t.salesTax.amount === 0) return null;
      const state = ctx.est.header.owner?.state ?? ctx.est.header.repairFacility?.state ?? "";
      const laborDollars = t.labor.reduce((s, l) => s + l.cost, 0);
      const taxableGoods = t.parts + (t.paintSupplies?.cost ?? 0) + t.misc;
      const laborTaxed = t.salesTax.basis > taxableGoods + 0.01;
      const gov = ctx.est.header.owner?.isGovernment || GOV.test(ctx.est.header.owner?.name ?? "");
      const facts: string[] = [];
      let low = 0, high = 0;
      if (laborTaxed && LABOR_TAX_EXEMPT_STATES.has(state)) {
        const goodsOnly = r2(taxableGoods * t.salesTax.ratePct / 100);
        facts.push(`Tax of ${t.salesTax.ratePct}% is applied to ${money(t.salesTax.basis)}, which includes ${money(laborDollars)} of labor; ${state} does not tax separately stated motor-vehicle repair labor. Goods-only basis = ${money(goodsOnly)}.`);
        low = r2(t.salesTax.amount - goodsOnly);
      }
      if (gov) {
        facts.push(`Owner/insured '${ctx.est.header.owner?.name}' appears to be a government entity; sales to political subdivisions are exempt.`);
        high = t.salesTax.amount;
      }
      if (!facts.length) return null;
      const auths = [];
      if (laborTaxed && state === "PA") auths.push(A.tax("PA Dept. of Revenue REV-717 — motor vehicle repair labor separately stated is not taxable", "61 Pa. Code Ch. 31"));
      if (gov && state === "PA") auths.push(A.tax("Sales to the Commonwealth and political subdivisions are exempt", "72 P.S. § 7204(12)"));
      return f({
        ruleId: "TX-001", cls: "TAX", severity: "MEDIUM",
        title: "Sales tax basis and/or exempt purchaser",
        facts,
        authorities: auths,
        action: "Correct the profile tax setting for this file (goods-only basis, or zero with the exemption certificate on file) and add a line note so the repairer does not re-add it.",
        exposure: { quantified: -(high || low), quantifiedAlt: low && high ? -low : undefined, direction: "DECREASE", open: low && high ? `Overstated by ${money(low)} (goods-only) to ${money(high)} (exempt)` : undefined },
      });
    },
  },

  /* ---------------- UF-001 fleet / police upfit ---------------- */
  {
    id: "UF-001", cls: "UPFIT",
    run(ctx) {
      const v = ctx.est.header.vehicle;
      const police = v.isPolice || /police|interceptor|pursuit|ssv|ppv/i.test(`${v.model} ${v.trim}`);
      if (!police) return null;
      if (ctx.has(UPFIT)) return null;
      const doorTrim = ctx.find(/trim panel/i);
      if (!doorTrim.length) return null;
      return f({
        ruleId: "UF-001", cls: "UPFIT", severity: "MEDIUM",
        title: "Police upfit equipment not confirmed or scoped",
        lineRefs: lineNos(doorTrim),
        facts: [
          "Vehicle is a police / pursuit unit; door trim panels are being removed.",
          "No line addresses upfitter equipment (window barriers, partition mounts, door-disable hardware, spotlights, antennas).",
        ],
        authorities: [A.ccc("R&I of non-OEM upfit equipment is not part of any MOTOR operation")],
        action: "Verify with the fleet contact which upfit items are on the affected doors; add R&I lines or a sublet-to-upfitter line.",
        exposure: { quantified: 0, direction: "INCREASE", open: "Typically 0.5–1.5 hr if window barriers are present" },
      });
    },
  },

  /* ---------------- HD-001 header completeness ---------------- */
  {
    id: "HD-001", cls: "HEADER",
    run(ctx) {
      const h = ctx.est.header;
      const missing: string[] = [];
      if (!h.daysToRepair) missing.push("Days to Repair (0 / blank)");
      if (!h.typeOfLoss) missing.push("Type of Loss");
      if (!h.policyNo) missing.push("Policy #");
      if (!h.vehicle.paintCode) missing.push("Paint code");
      if (!h.vehicle.interiorColor) missing.push("Interior color");
      if (!h.repairFacility?.name) missing.push("Repair facility");
      if (missing.length < 2) return null;
      const hrs = ctx.est.totals.labor.reduce((s, l) => s + l.hours, 0);
      return f({
        ruleId: "HD-001", cls: "HEADER", severity: "LOW",
        title: "Header fields incomplete",
        facts: [`Blank or zero: ${missing.join("; ")}.`, `Written labor content is ${hrs.toFixed(1)} hr, which implies a non-zero cycle time.`],
        authorities: [A.reg("Appraisal must be complete and legible", "31 Pa. Code § 62.3")],
        action: "Populate Type of Loss, Days to Repair (from labor content plus parts lead time), paint code, and the repair facility once known.",
        exposure: { quantified: 0, direction: "INCREASE" },
      });
    },
  },

  /* ---------------- DB-001 labor + sublet on the same operation ---------------- */
  {
    id: "DB-001", cls: "DOUBLE_BOOK",
    run(ctx) {
      const dbl = ctx.lines.filter(l => (l.laborHrs ?? 0) > 0 && (l.notes ?? []).some(n => /sublet|invoice/i.test(n)));
      if (!dbl.length) return null;
      return f({
        ruleId: "DB-001", cls: "DOUBLE_BOOK", severity: "LOW",
        title: "Operation written as labor and as sublet",
        lineRefs: lineNos(dbl),
        facts: dbl.map(l => `Line ${l.lineNo}: ${l.laborHrs?.toFixed(1)} hr labor plus note '${(l.notes ?? []).join("; ")}'.`),
        authorities: [A.industry("either in-house labor or sublet at invoice, not both")],
        action: "Choose one method per operation: keep the labor and remove the note, or convert to a sublet line with a $0.00 placeholder and the note.",
        exposure: { quantified: 0, direction: "MIXED", open: "Prevents a duplicate on the supplement" },
      });
    },
  },

  /* ---------------- MC-001 hazardous waste ---------------- */
  {
    id: "MC-001", cls: "MISC_CHARGES",
    run(ctx) {
      const ref = ctx.est.totals.labor.find(l => l.category === "REFINISH")?.hours ?? 0;
      if (ref <= 0 || ctx.has(HAZ)) return null;
      return f({
        ruleId: "MC-001", cls: "MISC_CHARGES", severity: "LOW",
        title: "No hazardous-waste line",
        facts: [`${ref.toFixed(1)} hr of refinish is written with no paint/solvent waste disposal charge.`],
        authorities: [A.industry("customary, separately billed shop charge when refinish is performed")],
        action: "Add 'Hazardous waste removal' as a manual misc line at the profile amount.",
        exposure: { quantified: 0, direction: "INCREASE", open: "Profile amount, typically $5–$10" },
      });
    },
  },

  /* ---------------- HY-001 document hygiene ---------------- */
  {
    id: "HY-001", cls: "HYGIENE",
    run(ctx) {
      const issues: string[] = [];
      const refs: number[] = [];
      for (const l of ctx.lines) {
        for (const [bad, good] of Object.entries(TYPOS)) {
          if (new RegExp(`\\b${bad}\\b`, "i").test(l.desc)) { issues.push(`Line ${l.lineNo}: '${bad}' → '${good}'.`); if (l.lineNo) refs.push(l.lineNo); }
        }
      }
      const cert = ctx.est.header.certificationText ?? "";
      if (/insurance commission/i.test(cert)) issues.push("Certification references a 'State Insurance Commission'; the Pennsylvania regulator is the Insurance Department.");
      if (!issues.length) return null;
      return f({
        ruleId: "HY-001", cls: "HYGIENE", severity: "LOW",
        title: "Document hygiene",
        lineRefs: refs,
        facts: issues,
        authorities: [A.reg("Appraiser certification", "31 Pa. Code § 62.3(e)")],
        action: "Correct the typo(s) and update the certification template.",
        exposure: { quantified: 0, direction: "INCREASE" },
      });
    },
  },

  /* ---------------- AD-001 scans and calibration ---------------- */
  {
    id: "AD-001", cls: "ADAS",
    run(ctx) {
      const facts: string[] = [];
      const pre = ctx.has(/pre[- ]?repair scan|pre[- ]?scan/i);
      const post = ctx.has(/post[- ]?repair scan|post[- ]?scan/i);
      if (!pre) facts.push("No pre-repair diagnostic scan line.");
      if (!post) facts.push("No post-repair diagnostic scan line.");
      const adasLines = ctx.find(ADAS_PART).filter(l => ["R&I", "R&R", "REPL"].includes(l.oper));
      if (adasLines.length && !ctx.has(CAL)) facts.push(`ADAS-related component(s) removed or replaced (${adasLines.map(l => `Ln ${l.lineNo}`).join(", ")}) with no calibration/aim line.`);
      if (!facts.length) return null;
      const make = ctx.est.header.vehicle.make ?? "OEM";
      return f({
        ruleId: "AD-001", cls: "ADAS", severity: "HIGH",
        title: "Diagnostic scan / calibration gap",
        lineRefs: lineNos(adasLines),
        facts,
        authorities: [A.oem(make, "pre- and post-repair scans and calibration after R&I/replacement of ADAS components")],
        action: "Add the missing scan line(s) and a calibration line (static/dynamic per OEM procedure) for each affected component.",
        exposure: { quantified: 0, direction: "INCREASE", open: "Calibration sublet / labor per OEM procedure" },
      });
    },
  },

  /* ---------------- PT-001 non-OEM markers on safety / structural parts ---------------- */
  {
    id: "PT-001", cls: "PARTS",
    run(ctx) {
      const flagged = ctx.lines.filter(l => l.oper === "REPL" && NON_OEM.test(`${l.desc} ${l.partNo ?? ""}`) && SAFETY_PART.test(l.desc));
      if (!flagged.length) return null;
      const make = ctx.est.header.vehicle.make ?? "OEM";
      return f({
        ruleId: "PT-001", cls: "PARTS", severity: "HIGH",
        title: "Non-OEM part specified on a safety or structural component",
        lineRefs: lineNos(flagged),
        facts: flagged.map(l => `Line ${l.lineNo}: ${l.desc}`),
        authorities: [A.oem(make, "new OEM parts for structural / safety components")],
        action: "Replace with OEM part number and dealer price; attach the position statement.",
        exposure: { quantified: 0, direction: "INCREASE", open: "OEM vs. alternate price difference" },
      });
    },
  },
];

function escape(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
const r2 = (n: number) => Math.round(n * 100) / 100;
