/**
 * The release gate — the thing that makes a fix stick.
 *
 * Runs on EVERY comparison, before any artifact is released. It knows nothing
 * about any particular claim; it enforces only the document-independent policy
 * in data/deltaRules.json.
 *
 * WHY THIS EXISTS. Across four graded runs the same defects kept returning, and
 * the pattern was exact: everything fixed UPSTREAM (identity, carrier
 * resolution, totals extraction) stayed fixed, because it is document
 * independent by construction. Everything fixed AT THE ANNOTATION LAYER came
 * back, because "on this line, stamp this value" cannot survive to the next
 * document — the next document has different lines.
 *
 * A fix expressed as data the pipeline reads, plus an assertion that fails the
 * build, survives. That is this file plus deltaRules.json.
 *
 * Three rules delegate rather than reimplement:
 *   R01 -> claimIdentityGate.ts   (shape-based; the spec's own regex is the bug)
 *   R11 -> ai/numericIntegrity.ts (already implements it)
 *   op vocabulary -> data/operationAliases.json
 */
import RULES from "./data/deltaRules.json";
import { compareClaimIdentity, type ClaimIdentity } from "./claimIdentityGate";
import { findFabricatedCurrency } from "../ai/numericIntegrity";

export type Severity = "FAIL" | "WARN";

export interface Violation {
  severity: Severity;
  rule: string;
  message: string;
}

/** One object per comparison. Every section is optional, so the contract can be
 *  adopted incrementally — absent sections are skipped, not failed. */
export interface DeltaBundle {
  run_key?: string;
  manifest?: Array<{ id?: string; name: string; sha256?: string; identity?: Record<string, unknown> }>;
  target?: BundleDocument;
  source?: BundleDocument;
  rows?: BundleRow[];
  findings?: BundleFinding[];
  annotations?: BundleAnnotation[];
  page_boxes?: Array<{ page: number; body?: number[][]; footer?: number[]; height?: number }>;
  prose?: Record<string, string>;
  counters?: Record<string, number>;
  confidence?: { evidence?: string; pipeline_integrity?: string; reported?: string };
  legend?: { report_type?: string; entries?: string[] };
}

interface BundleDocument {
  file?: string;
  grand_total?: number;
  subtotal?: number;
  net?: number;
  insurer?: string;
  identity?: Record<string, unknown>;
}

interface BundleRow {
  id: string;
  doc?: "target" | "source";
  role?: string;
  canonical_op?: string | null;
  side?: string;
}

interface BundleFinding {
  id: string;
  type?: string;
  label?: string;
  anchors?: string[];
  totals_anchor?: unknown;
  scope?: string;
  canonical_op?: string | null;
  finding_class?: string;
  amount?: number;
  delta?: number;
  text?: string;
  shown?: number;
  total?: number;
  total_available?: number;
  /** R20 — how a description-based pairing was justified, so it can be audited. */
  pairing_basis?: string;
  similarity?: number;
  target_desc?: string;
  source_desc?: string;
  /** R21 — group coherence on both sides. */
  target_qty?: number;
  source_qty?: number;
  target_amount?: number;
  source_amount?: number;
  target_labor?: number;
  source_labor?: number;
  member_ops?: string[];
  authority?: { title?: string; retrieved?: boolean; domain?: string } | null;
}

interface BundleAnnotation {
  finding_id?: string;
  page?: number;
  bbox?: number[];
  x?: number;
  top?: number;
  size?: number;
  kind?: string;
  text?: string;
  badge_namespace?: string;
}

const CURRENCY = /\$\s?-?\d[\d,]*(?:\.\d{2})?/g;

function moneyIn(text: string | undefined): number[] {
  return Array.from(text?.matchAll(CURRENCY) ?? []).map((m) =>
    Number(m[0].replace(/[$,\s]/g, ""))
  );
}

function boxesOverlap(a: number[], b: number[], pad = 0.5): boolean {
  const [ax0, at, ax1, ab] = a;
  const [bx0, bt, bx1, bb] = b;
  return !(ax1 <= bx0 + pad || bx1 <= ax0 + pad || ab <= bt + pad || bb <= at + pad);
}

/** Canonical op codes arrive in whichever vocabulary the emitting pipeline uses.
 *  The rename map is DATA so an external bundle still validates against this
 *  repo's single operation table. */
function normalizeOpCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const aliases = RULES.opCodeAliases as Record<string, string>;
  return aliases[code] ?? code;
}

function serialize(bundle: DeltaBundle): string {
  return JSON.stringify([bundle.annotations ?? [], bundle.findings ?? [], bundle.prose ?? {}]);
}

/**
 * Run every rule. Returns violations; the caller decides, but any FAIL means
 * the artifacts must not ship.
 */
export function runDeltaReleaseGate(bundle: DeltaBundle): Violation[] {
  const out: Violation[] = [];
  const fail = (rule: string, message: string) => out.push({ severity: "FAIL", rule, message });
  const warn = (rule: string, message: string) => out.push({ severity: "WARN", rule, message });

  const findings = bundle.findings ?? [];
  const annotations = bundle.annotations ?? [];
  const rows = bundle.rows ?? [];

  // R01 — every document compared belongs to the active claim.
  if (bundle.target?.identity && bundle.source?.identity) {
    const asIdentity = (raw: Record<string, unknown>): ClaimIdentity => ({
      vin: (raw.vin as string) ?? null,
      claimNumber: (raw.claim_no as string) ?? (raw.claimNumber as string) ?? null,
      roNumber: (raw.ro as string) ?? null,
      ownerTokens: Array.isArray(raw.owner_tokens) ? (raw.owner_tokens as string[]) : [],
      vehicle: (raw.vehicle as string) ?? null,
    });
    const verdict = compareClaimIdentity(
      asIdentity(bundle.target.identity),
      asIdentity(bundle.source.identity)
    );
    if (verdict.blocked) {
      fail(
        "R01",
        `identity mismatch on ${verdict.conflicting.join(", ")} — the comparison must be blocked, not rendered`
      );
    } else if (verdict.unverified) {
      warn("R01", "no strong identity key (vin / claim number) could be compared");
    }
  }

  // R02 — no output may name a document outside the run manifest.
  const manifestNames = new Set((bundle.manifest ?? []).map((doc) => doc.name));
  if (manifestNames.size > 0) {
    const referenced = new Set(serialize(bundle).match(/[\w ()\-]+\.pdf/g) ?? []);
    for (const ref of referenced) {
      if (!manifestNames.has(ref.trim())) {
        fail("R02", `references ${JSON.stringify(ref.trim())}, which is not in this run's manifest — cross-claim contamination`);
      }
    }
  }

  // R03 — annotations are emitted FROM findings, both directions asserted.
  if (annotations.length > 0) {
    const findingIds = new Set(findings.map((f) => f.id));
    const orphans = annotations.filter((a) => !a.finding_id || !findingIds.has(a.finding_id));
    if (orphans.length > 0) {
      fail("R03", `${orphans.length} annotation(s) have no parent finding — annotations must be emitted FROM findings, not by a parallel path`);
    }
    const drawn = new Set(annotations.map((a) => a.finding_id));
    const never = findings.filter((f) => (f.anchors?.length ?? 0) > 0 && !drawn.has(f.id));
    if (never.length > 0) {
      fail("R03", `${never.length} anchored finding(s) never rendered: ${never.slice(0, 6).map((f) => f.id).join(", ")}`);
    }
  }

  // R04 — one badge namespace on every page.
  const namespaces = new Set(annotations.map((a) => a.badge_namespace).filter(Boolean));
  if (namespaces.size > 1) {
    fail("R04", `badges mix namespaces ${JSON.stringify(Array.from(namespaces).sort())} — pick one (${RULES.marks.badgeNamespace}) for all pages`);
  }

  // R05 — closed enum for type and label.
  const types = RULES.findings.types as Record<string, { label: string }>;
  const labels = new Set(Object.values(types).map((t) => t.label));
  for (const finding of findings) {
    if (finding.type && !(finding.type in types)) {
      fail("R05", `finding ${finding.id}: unknown type ${JSON.stringify(finding.type)}`);
    }
    if (finding.label && !labels.has(finding.label)) {
      fail("R05", `finding ${finding.id}: label ${JSON.stringify(finding.label)} is not in the closed enum — a title leaked into the label field`);
    }
  }

  // R06 — deductions, section headers and noise never yield findings.
  const roleOf = new Map(rows.map((row) => [row.id, row.role]));
  const bannedRoles = new Set(RULES.findings.neverEmitForRoles);
  for (const finding of findings) {
    for (const anchor of finding.anchors ?? []) {
      const role = roleOf.get(anchor);
      if (role && bannedRoles.has(role)) {
        fail("R06", `finding ${finding.id} (${finding.type}) anchors row ${anchor} of role ${JSON.stringify(role)} — negative/structural rows must never be flagged`);
      }
    }
  }

  // R07 — missing_operation only when no counterpart exists under any tier.
  const sourceOps = new Set(
    rows.filter((r) => r.doc === "source").map((r) => normalizeOpCode(r.canonical_op)).filter(Boolean)
  );
  const pairs = RULES.findings.substitutionPairs as string[][];
  for (const finding of findings) {
    if (finding.type !== "missing_operation") continue;
    const op = normalizeOpCode(finding.canonical_op);
    if (!op) continue;
    if (sourceOps.has(op)) {
      fail("R07", `finding ${finding.id}: ${op} is present on the counterpart — classify as value_delta, not missing_operation`);
    }
    for (const [from, to] of pairs) {
      if (op === from && sourceOps.has(to)) {
        fail("R07", `finding ${finding.id}: ${from} is substituted by ${to} on the counterpart — emit operation_substituted, not missing_operation`);
      }
    }
  }

  // R08 — every finding anchors to a real row.
  if (RULES.findings.requireSourceLineIds) {
    const exempt = new Set(RULES.findings.anchorExemptTypes);
    for (const finding of findings) {
      if ((finding.anchors?.length ?? 0) > 0 || finding.totals_anchor || finding.scope === "category") continue;
      if (finding.type && exempt.has(finding.type)) continue;
      fail("R08", `finding ${finding.id} (${finding.type}) has no anchor rows — fabricated findings enter here`);
    }
  }

  // R09 — banned wording: accusatory, internal, or cost-based.
  const corpus = serialize(bundle);
  for (const phrase of RULES.wording.bannedPhrases) {
    const hits = corpus.match(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"));
    if (hits) fail("R09", `banned phrase ${JSON.stringify(phrase)} appears ${hits.length}x — see wording.bannedPhrases`);
  }

  // R10 — an absent basis is not a zero basis.
  if (RULES.wording.nullIsNotZero) {
    const zeroBasis = JSON.stringify(annotations).match(/[\w ]{0,12}\b0(?:\.0)? @ \$ ?0(?:\.00)?/g);
    for (const hit of zeroBasis ?? []) {
      fail("R10", `renders ${JSON.stringify(hit.trim())} — an absent basis is not a zero basis; say 'flat $X, no hrs/rate shown'`);
    }
  }

  // R11 — no dollar figure in prose absent from the structured findings.
  const structured = {
    findings: findings.map((f) => ({
      amount: f.amount,
      delta: f.delta,
      text: f.text,
    })),
    totals: {
      targetGrand: bundle.target?.grand_total,
      targetSub: bundle.target?.subtotal,
      sourceGrand: bundle.source?.grand_total,
      sourceSub: bundle.source?.subtotal,
    },
  };
  for (const [name, text] of Object.entries(bundle.prose ?? {})) {
    const fabricated = findFabricatedCurrency(text, structured);
    if (fabricated.length > 0) {
      fail("R11", `${name}: ${fabricated.slice(0, 6).map((f) => f.text).join(", ")} appear in prose but not in structured findings — parser or narrative fabrication`);
    }
  }

  // R12 — category deltas sum to the subtotal gap.
  if (typeof bundle.target?.subtotal === "number" && typeof bundle.source?.subtotal === "number") {
    const categoryDeltas = findings
      .filter((f) => f.scope === "category" && typeof f.delta === "number")
      .map((f) => f.delta as number);
    if (categoryDeltas.length === 0) {
      const categoryTypes = new Set(["rate_delta", "hours_delta", "category_absent", "materials_capped"]);
      if (findings.some((f) => f.type && categoryTypes.has(f.type))) {
        warn("R12", "category-level findings carry no scope=category tag; totals reconciliation cannot be checked");
      }
    } else {
      const want = bundle.source.subtotal - bundle.target.subtotal;
      const got = categoryDeltas.reduce((total, value) => total + value, 0);
      if (Math.abs(got - want) > RULES.totals.reconcileEpsilon) {
        fail("R12", `category deltas sum to ${got.toFixed(2)} but the subtotal gap is ${want.toFixed(2)}`);
      }
    }
  }

  // R13 — nothing overprints body text or crosses the footer.
  if (RULES.layout.measureBeforePlace) {
    const pages = new Map((bundle.page_boxes ?? []).map((p) => [p.page, p]));
    for (const annotation of annotations) {
      const page = pages.get(annotation.page ?? -1);
      if (!page) continue;
      let box = annotation.bbox;
      if (!box && typeof annotation.top === "number") {
        const size = annotation.size ?? RULES.layout.band.size;
        const x = annotation.x ?? 0;
        box = [x, annotation.top, x + 1, annotation.top + size];
      }
      if (!box) continue;
      if (page.footer && boxesOverlap(box, page.footer)) {
        fail("R13", `annotation for ${annotation.finding_id} on p${annotation.page} crosses the footer`);
      }
      if (typeof page.height === "number" && box[3] > page.height) {
        fail("R13", `annotation for ${annotation.finding_id} on p${annotation.page} draws off the page`);
      }
      if (annotation.kind === "note" || annotation.kind === "section_tag") {
        if ((page.body ?? []).some((bx) => boxesOverlap(box!, bx))) {
          fail("R13", `note for ${annotation.finding_id} on p${annotation.page} overprints body text`);
        }
      }
    }
  }

  // R14 — the legend is generated from the mark map, per report type.
  if (bundle.legend) {
    const entries = bundle.legend.entries ?? [];
    if (RULES.marks.legendPerReportType && bundle.legend.report_type === "oem") {
      const deltaLegend = new RegExp(RULES.marks.deltaLegendPattern, "i");
      for (const entry of entries) {
        if (deltaLegend.test(entry)) {
          fail("R14", `OEM report renders a delta-pass legend entry: ${JSON.stringify(entry.slice(0, 60))}`);
        }
      }
    }
    if (RULES.marks.legendGeneratedFromStyles) {
      const described = new Set(entries.map((e) => e.split(":")[0].trim().toLowerCase()));
      for (const kind of new Set(annotations.map((a) => a.kind).filter(Boolean))) {
        if (!described.has(String(kind).toLowerCase())) {
          warn("R14", `mark kind ${JSON.stringify(kind)} is drawn but not described in the legend`);
        }
      }
    }
  }

  // R15 — never name an unretrieved authority; keep domains separated.
  const allowedDomains = RULES.authority.allowedDomains as Record<string, string[]>;
  for (const finding of findings) {
    const authority = finding.authority;
    if (!authority) continue;
    if (authority.retrieved === false) {
      fail("R15", `finding ${finding.id} names authority ${JSON.stringify(authority.title)} that was not retrieved — emit authority: null + NEEDS_OEM`);
    }
    const allowed = finding.finding_class ? allowedDomains[finding.finding_class] : undefined;
    if (allowed && authority.domain && !allowed.includes(authority.domain)) {
      fail("R15", `finding ${finding.id} (${finding.finding_class}) cites domain ${JSON.stringify(authority.domain)}, which is not allowed for that class`);
    }
    for (const pattern of RULES.authority.rejectTitlesMatching) {
      if (authority.title && new RegExp(pattern, "i").test(authority.title)) {
        fail("R15", `finding ${finding.id} cites an off-topic authority: ${JSON.stringify(authority.title)}`);
      }
    }
  }

  // R16 — all file counters derive from one ledger.
  //
  // Unequal counters are only a defect when there is NO ledger to reconcile
  // them against: "vision: 0" beside "indexed: 2" is coherent when no document
  // needed OCR. What is not coherent is 149 / 142 / 147 with nothing to
  // explain the spread, or any counter exceeding the ledger itself.
  const counters = bundle.counters ?? {};
  const ledgerTotal = counters.ledger_total;
  const derived = (["indexed", "vision", "reviewed"] as const)
    .map((key) => counters[key])
    .filter((value): value is number => typeof value === "number");
  if (ledgerTotal === undefined) {
    if (derived.length > 1 && new Set(derived).size > 1) {
      fail("R16", `file counters disagree ${JSON.stringify(counters)} with no ledger to reconcile them — all must derive from ${RULES.counters.singleSource}`);
    }
  } else {
    for (const key of ["indexed", "vision", "reviewed"] as const) {
      const value = counters[key];
      if (typeof value === "number" && value > ledgerTotal) {
        fail("R16", `counter ${key}=${value} exceeds ledger_total=${ledgerTotal}`);
      }
    }
  }

  // R17 — confidence = min(evidence, pipeline integrity); any failure forces low.
  if (bundle.confidence?.reported) {
    const anyFailure = out.some((v) => v.severity === "FAIL");
    const forced = RULES.confidence.anyFailedInvariantForces;
    if (anyFailure && bundle.confidence.reported.toLowerCase() !== forced) {
      fail("R17", `invariants failed but confidence is reported as ${JSON.stringify(bundle.confidence.reported)} — must be ${JSON.stringify(forced)}`);
    }
    const rank: Record<string, number> = { low: 0, medium: 1, high: 2 };
    const evidence = rank[bundle.confidence.evidence?.toLowerCase() ?? ""] ?? 2;
    const integrity = rank[bundle.confidence.pipeline_integrity?.toLowerCase() ?? ""] ?? 2;
    const reported = rank[bundle.confidence.reported.toLowerCase()] ?? 2;
    if (reported > Math.min(evidence, integrity)) {
      fail("R17", `confidence ${JSON.stringify(bundle.confidence.reported)} exceeds min(evidence, pipeline_integrity)`);
    }
  }

  // R18 — a capped list says it was capped, IN THE TEXT THE READER SEES.
  // A boolean flag on the finding is not disclosure; the sentence is.
  if (RULES.layout.discloseTruncation) {
    const discloses = /showing .*\d+ of \d+|top \d+ of \d+|\d+ of \d+ shown/i;
    for (const finding of findings) {
      const shown = finding.shown;
      const available = finding.total_available ?? finding.total;
      if (typeof shown !== "number" || typeof available !== "number") continue;
      if (shown < available && !discloses.test(finding.text ?? "")) {
        fail("R18", `finding ${finding.id} shows ${shown} of ${available} without disclosing the cap`);
      }
    }
  }

  // R20 — a description-based pairing must be auditable and must clear the
  // floor. RO 22116 paired "Cover to protect interior during repair" with
  // "Color Tint": two descriptions with no word in common, joined because a
  // canonical stem was read out of the middle of "protec-TINT-erior".
  const floor = RULES.matching.descriptionSimilarityFloor;
  for (const finding of findings) {
    if ((finding.pairing_basis ?? "").toLowerCase() !== "description") continue;
    if (typeof finding.similarity !== "number") {
      fail("R20", `finding ${finding.id}: paired on description with no similarity score — an unscored fuzzy match cannot be audited`);
    } else if (finding.similarity < floor) {
      fail("R20", `finding ${finding.id}: description similarity ${finding.similarity.toFixed(2)} is below the ${floor} floor — ${JSON.stringify(finding.target_desc)} vs ${JSON.stringify(finding.source_desc)}`);
    }
    if (RULES.matching.requireSharedToken && finding.target_desc && finding.source_desc) {
      const words = (text: string) => new Set(text.toLowerCase().split(/\s+/).filter(Boolean));
      const left = words(finding.target_desc);
      const shared = [...words(finding.source_desc)].some((token) => left.has(token));
      if (!shared) {
        fail("R20", `finding ${finding.id}: paired rows share no token — ${JSON.stringify(finding.target_desc)} vs ${JSON.stringify(finding.source_desc)}`);
      }
    }
  }

  // R21 — a group finding must be internally consistent on both sides.
  for (const finding of findings) {
    if (finding.scope !== "group") continue;
    for (const side of ["target", "source"] as const) {
      const qty = finding[`${side}_qty`];
      const amount = finding[`${side}_amount`];
      if (typeof qty !== "number" || typeof amount !== "number") continue;
      if (qty > 0 && amount === 0 && (finding[`${side}_labor`] ?? 0) === 0) {
        fail("R21", `finding ${finding.id}: ${side}_qty=${qty} but ${side}_amount=0 and no labor — a counted row cannot contribute nothing`);
      }
    }
    const members = finding.member_ops;
    if (members && new Set(members).size > 1) {
      fail("R21", `finding ${finding.id}: group mixes canonical ops ${JSON.stringify([...new Set(members)].sort())} — a group is one operation, aggregated`);
    }
  }

  return out;
}

/** True when the artifacts may be released. */
export function mayRelease(violations: Violation[]): boolean {
  return !violations.some((v) => v.severity === "FAIL");
}

/** Operator-facing notice. Emitted INSTEAD of artifacts when the gate fails. */
export function buildBlockedNotice(violations: Violation[]): string {
  const failures = violations.filter((v) => v.severity === "FAIL");
  return [
    `RELEASE BLOCKED — ${failures.length} rule violation(s). Artifacts were not produced.`,
    ...failures.map((v) => `  FAIL ${v.rule}  ${v.message}`),
  ].join("\n");
}
