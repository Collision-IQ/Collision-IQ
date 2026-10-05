/**
 * BUMPER OVERHAUL — one operation written at two scopes.
 *
 * An overhaul (O/H) of a bumper is its R&I plus the dismantle and reassembly
 * of what is mounted to it (moldings, fog lamps, upper grilles and covers).
 * R&I of the same bumper is an included operation when O/H is present; R&I
 * runs roughly half the O/H time, and varies. So one sheet's O/H and the
 * other's R&I of the same end's bumper are one operation, and the difference
 * between them is the dismantle and reassembly, never an O/H "missing" from
 * one sheet beside an R&I "only on" the other (RO 22120: our rear O/H bumper
 * assy 3.7 against their rear R&I bumper cover 1.7, upper cover 0.8 and air
 * deflector 0.3).
 *
 * The premise is general estimating-guide guidance (the P-page for the
 * estimate's platform states what an overhaul includes); nothing here quotes
 * a guide. Used by the delta engine's pairing (deltaPair pass 6) and the
 * dispute report's equivalence groups (operationEquivalence).
 */
import { positionsOf } from "./integrityChecks";
import type { EstimateLine } from "./types";

const BUMPER_UNIT = /\b(bumper|bpr|fascia)\b/i;
/** A part mounted on the bumper, or a word that makes the line one. */
const BUMPER_COMPONENT =
  /\b(brkts?|brackets?|absorbers?|reinf\w*|rebar|beam|bar|guards?|step|pads?|supports?|retainers?|clips?|bolts?|energy|isolators?|guides?|sensors?|wiring|harness|mldgs?|moldings?|mouldings?|grilles?|lamps?|reflectors?|caps?|inserts?|trim|valance|spoiler|deflectors?|skid|tow|hooks?|garnish|plates?|emblems?|upper|lower|side|end|seal|stay|shield|splash|liner)\b/i;
const LEADING_OPERATION = /^(?:o\/h|r&i|repl|rpr|refn|blnd|subl)\s+/i;

/** A description that names a bumper as one unit (bumper assy, bumper cover,
 *  fascia), never a part mounted on it (bracket, absorber, upper cover). */
export function isBumperUnitText(desc: string): boolean {
  const body = desc.trim().replace(LEADING_OPERATION, "");
  return BUMPER_UNIT.test(body) && !BUMPER_COMPONENT.test(body);
}

/** The end of the vehicle a line prints, from its section and description. */
export function endOfLine(line: Pick<EstimateLine, "line" | "desc" | "section">): "front" | "rear" | null {
  const end = positionsOf({ line: line.line, desc: line.desc, section: line.section });
  return end[0] === "front" || end[0] === "rear" ? end[0] : null;
}

/** One O/H and one R&I (or two O/H) of a bumper at one end of the vehicle. */
export function isBumperScopePair(
  a: { op: string; desc: string; end: "front" | "rear" | null },
  b: { op: string; desc: string; end: "front" | "rear" | null }
): boolean {
  const ops = [a.op.toLowerCase(), b.op.toLowerCase()];
  if (!ops.includes("o/h") || !ops.every((op) => op === "o/h" || op === "r&i")) return false;
  if (!isBumperUnitText(a.desc) || !isBumperUnitText(b.desc)) return false;
  return a.end !== null && a.end === b.end;
}

/** A line's own note says its time is included with an overhaul. */
export const INCLUDED_WITH_OVERHAUL = /\bincluded\s+(?:with|in)\s+(?:the\s+)?(?:o\/h|overhaul)\b/i;

/** The sentence every report uses for the premise. */
export const OVERHAUL_PREMISE =
  "An overhaul includes the bumper's R&I and the dismantle and reassembly of the parts mounted to it, so the difference is that dismantle and reassembly.";
