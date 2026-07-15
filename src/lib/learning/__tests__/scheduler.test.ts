import { describe, expect, it } from "vitest";
import {
  SAFETY_CRITICAL_MAX_INTERVAL_DAYS,
  scheduleNextReview,
  type ReviewState,
} from "../scheduler";

const base: ReviewState = {
  intervalDays: 0,
  ease: 2.3,
  repetitions: 0,
  lapses: 0,
  safetyCritical: false,
};

const NOW = new Date("2026-07-15T00:00:00.000Z");

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

describe("scheduleNextReview", () => {
  it("walks the Day 1 → 3 → 7 → 14 → 30 → 60 ladder on grade-5 answers", () => {
    let state: ReviewState = { ...base };
    const expected = [1, 3, 7, 14, 30, 60];
    for (const interval of expected) {
      const next = scheduleNextReview(state, 5, NOW);
      expect(next.intervalDays).toBe(interval);
      expect(daysBetween(NOW, next.dueAt)).toBe(interval);
      state = next;
    }
  });

  it("reschedules failures within one day and resets repetitions", () => {
    const seasoned: ReviewState = { ...base, intervalDays: 30, repetitions: 5, ease: 2.5 };
    for (const grade of [0, 1]) {
      const next = scheduleNextReview(seasoned, grade, NOW);
      expect(next.intervalDays).toBe(1);
      expect(next.repetitions).toBe(0);
      expect(next.lapses).toBe(seasoned.lapses + 1);
      expect(next.ease).toBeLessThan(seasoned.ease);
    }
  });

  it("reschedules materially incomplete answers within three days", () => {
    const next = scheduleNextReview({ ...base, intervalDays: 14, repetitions: 4 }, 2, NOW);
    expect(next.intervalDays).toBe(3);
    expect(next.repetitions).toBe(0);
  });

  it("caps correct-but-weakly-supported answers at seven days", () => {
    const seasoned: ReviewState = { ...base, intervalDays: 30, repetitions: 4 };
    const next = scheduleNextReview(seasoned, 3, NOW);
    expect(next.intervalDays).toBeLessThanOrEqual(7);
  });

  it("never lets safety-critical items leave frequent circulation", () => {
    let state: ReviewState = { ...base, safetyCritical: true };
    for (let review = 0; review < 10; review += 1) {
      state = scheduleNextReview(state, 5, NOW);
      expect(state.intervalDays).toBeLessThanOrEqual(SAFETY_CRITICAL_MAX_INTERVAL_DAYS);
    }
  });

  it("grows past the ladder using ease for non-safety items", () => {
    const seasoned: ReviewState = { ...base, intervalDays: 30, repetitions: 6, ease: 2.0 };
    const next = scheduleNextReview(seasoned, 5, NOW);
    expect(next.intervalDays).toBe(60); // 30 * 2.1 capped at the 60-day maximum
  });

  it("rejects out-of-range grades", () => {
    expect(() => scheduleNextReview(base, 6, NOW)).toThrow(RangeError);
    expect(() => scheduleNextReview(base, -1, NOW)).toThrow(RangeError);
    expect(() => scheduleNextReview(base, 2.5, NOW)).toThrow(RangeError);
  });
});
