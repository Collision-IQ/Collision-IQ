/**
 * Collision Learning Engine — adaptive spaced-repetition scheduler.
 *
 * Review ladder: Day 1 → 3 → 7 → 14 → 30 → 60 (→ ease-scaled thereafter).
 * Failure resets repetitions; safety-critical items never leave frequent
 * circulation (interval is capped so they stay in the review cycle).
 */

export type ReviewState = {
  intervalDays: number;
  ease: number;
  repetitions: number;
  lapses: number;
  safetyCritical: boolean;
};

export type ReviewResult = ReviewState & {
  dueAt: Date;
};

const INITIAL_INTERVALS = [1, 3, 7, 14, 30, 60];

export const SAFETY_CRITICAL_MAX_INTERVAL_DAYS = 14;
export const STANDARD_MAX_INTERVAL_DAYS = 60;

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Grade scale:
 * 0 = unsafe or entirely incorrect
 * 1 = incorrect
 * 2 = materially incomplete
 * 3 = correct after difficulty
 * 4 = correct and supported
 * 5 = correct, supported and transferable
 */
export function scheduleNextReview(
  state: ReviewState,
  grade: number,
  now = new Date()
): ReviewResult {
  if (!Number.isInteger(grade) || grade < 0 || grade > 5) {
    throw new RangeError("Review grade must be an integer from 0 through 5.");
  }

  if (grade < 3) {
    // Failed or unsafe: repeat within one day. Materially incomplete: three days.
    const intervalDays = grade === 2 ? 3 : 1;
    return {
      intervalDays,
      ease: Math.max(1.3, state.ease - 0.2),
      repetitions: 0,
      lapses: state.lapses + 1,
      safetyCritical: state.safetyCritical,
      dueAt: addDays(now, intervalDays),
    };
  }

  const easeAdjustment = 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02);
  const ease = Math.max(1.3, state.ease + easeAdjustment);
  const repetitions = state.repetitions + 1;

  let intervalDays =
    repetitions <= INITIAL_INTERVALS.length
      ? INITIAL_INTERVALS[repetitions - 1]
      : Math.round(Math.max(1, state.intervalDays) * ease);

  // Correct-but-weakly-supported answers repeat within seven days.
  if (grade === 3) {
    intervalDays = Math.min(intervalDays, 7);
  }

  // Safety-critical knowledge stays in frequent circulation.
  const maximumInterval = state.safetyCritical
    ? SAFETY_CRITICAL_MAX_INTERVAL_DAYS
    : STANDARD_MAX_INTERVAL_DAYS;
  intervalDays = Math.min(intervalDays, maximumInterval);

  return {
    intervalDays,
    ease,
    repetitions,
    lapses: state.lapses,
    safetyCritical: state.safetyCritical,
    dueAt: addDays(now, intervalDays),
  };
}
