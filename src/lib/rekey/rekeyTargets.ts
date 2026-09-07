/**
 * WHICH SYSTEM the sheet is keyed into.
 *
 * Every sheet this build produces keys into CCC, whichever platform's estimate
 * was uploaded — so the vocabulary names one answer per entry, and that answer
 * is CCC's word. This module is the first half of giving it more than one: the
 * CCC term stays the canonical value a row carries (everything downstream keys
 * off it — the verification, the EMS codes, the writer), and a TARGET term is
 * the word an estimator keying into that platform actually types.
 *
 * Translation only goes where a document proved it. An operation or part type
 * with no term in evidence for a target comes back null and is reported as
 * untranslated, never guessed.
 *
 * WHAT THIS DOES NOT DO. Sections are absent on purpose. The CCC group mapping
 * is many-to-one — Mitchell's "Front Bumper" and "Grille" are both CCC's
 * "FRONT BUMPER & GRILLE" — so it cannot be inverted, and a target's section
 * taxonomy has to be built from that platform's own documents before a sheet
 * can be said to key into it. `targetGaps` names that rather than papering over
 * it. See `docs/mitchell-target-vocabulary-scope.md`.
 */

import VOCABULARY from "./data/rekeyVocabulary.json";

export type RekeyTarget = "ccc" | "mitchell";

export const REKEY_TARGETS: RekeyTarget[] = ["ccc", "mitchell"];

/** The platform each target names, for a sentence an estimator reads. */
const TARGET_LABEL = new Map(
  (VOCABULARY.estimatingSystems as Array<{ platform: string; label: string }>).map((entry) => [
    entry.platform,
    entry.label,
  ])
);

type TargetTerms = { ccc: string; mitchell?: string | null; mitchellCharge?: string | null };

const OPERATIONS = VOCABULARY.operations as TargetTerms[];
const PART_TYPES = VOCABULARY.partTypes as TargetTerms[];

export function isRekeyTarget(value: unknown): value is RekeyTarget {
  return typeof value === "string" && (REKEY_TARGETS as string[]).includes(value);
}

export function targetLabel(target: RekeyTarget): string {
  return TARGET_LABEL.get(target) ?? target;
}

/** The CIECA `EST_SYSTEM` code the target platform writes in its own exports —
 *  which is how an export is told to be that platform's. */
const TARGET_EMS_CODE = new Map(
  (VOCABULARY.estimatingSystems as Array<{ platform: string; ems: string }>).map((entry) => [
    entry.platform,
    entry.ems,
  ])
);

export function targetEmsCode(target: RekeyTarget): string | null {
  return TARGET_EMS_CODE.get(target) ?? null;
}

/**
 * Whether an export's stated estimating system is the target's.
 *
 * The code is the evidence — one letter, written by the system itself — and
 * the platform's own name is accepted alongside it, because some exports write
 * the name where the code belongs.
 */
export function isTargetEstimatingSystem(estimatingSystem: string | null | undefined, target: RekeyTarget): boolean {
  const stated = (estimatingSystem ?? "").trim();
  if (!stated) return false;
  const code = targetEmsCode(target);
  if (code && stated.toLowerCase() === code.toLowerCase()) return true;
  const label = targetLabel(target);
  return stated.toLowerCase().includes(label.toLowerCase());
}

function term(entry: TargetTerms | undefined, target: RekeyTarget, carriesCharge: boolean): string | null {
  if (!entry) return null;
  if (target === "ccc") return entry.ccc;
  // One CCC operation is two words on the other platform, split by what the
  // line carries rather than by the operation itself.
  if (carriesCharge && entry.mitchellCharge) return entry.mitchellCharge;
  return entry.mitchell ?? null;
}

/**
 * The word for a resolved operation on the target platform.
 *
 * `carriesCharge` is the line's own shape — a charge and no hours — which is
 * the only thing that separates the two words one operation has. Null means no
 * document has shown this build what that target calls it.
 */
export function translateOperation(
  cccTerm: string | null | undefined,
  target: RekeyTarget,
  options?: { carriesCharge?: boolean }
): string | null {
  const canonical = (cccTerm ?? "").trim();
  if (!canonical) return null;
  return term(
    OPERATIONS.find((entry) => entry.ccc === canonical),
    target,
    options?.carriesCharge === true
  );
}

/** The word for a resolved part type on the target platform, or null. */
export function translatePartType(cccTerm: string | null | undefined, target: RekeyTarget): string | null {
  const canonical = (cccTerm ?? "").trim();
  if (!canonical) return null;
  return term(
    PART_TYPES.find((entry) => entry.ccc === canonical),
    target,
    false
  );
}

/**
 * What a sheet aimed at this target cannot yet say — in the estimator's terms,
 * because a half-translated sheet that does not admit it is worse than none.
 */
export function targetGaps(target: RekeyTarget): string[] {
  if (target === "ccc") return [];
  const label = targetLabel(target);
  const gaps: string[] = [
    `Groups are still CCC's. A CCC group cannot be turned back into a ${label} section — its "Front Bumper" and "Grille" are one CCC group — so the section a line belongs in has to come from ${label}'s own documents, and none has been read yet.`,
  ];
  const untranslated = (list: TargetTerms[], what: string) => {
    const missing = list.filter((entry) => term(entry, target, false) === null).map((entry) => entry.ccc);
    if (missing.length > 0) {
      gaps.push(`No ${label} word is in evidence for ${what} ${missing.join(", ")}; those lines are reported untranslated.`);
    }
  };
  untranslated(OPERATIONS, "the operation");
  untranslated(PART_TYPES, "the part type");
  return gaps;
}
