'use strict';

const quizEngine = require('../../../services/v2/quizEngine');

describe('services/v2/quizEngine', () => {
  describe('getQuizSettingsForWeek', () => {
    it('returns easy settings for weeks 1-3', () => {
      for (const w of [1, 2, 3]) {
        const s = quizEngine.getQuizSettingsForWeek(w);
        expect(s).toEqual({ questionCount: 10, durationMinutes: 15, passPercent: 0.60 });
      }
    });

    it('returns medium settings for weeks 4-6', () => {
      for (const w of [4, 5, 6]) {
        const s = quizEngine.getQuizSettingsForWeek(w);
        expect(s).toEqual({ questionCount: 15, durationMinutes: 20, passPercent: 0.65 });
      }
    });

    it('returns hard settings for weeks 7-9', () => {
      for (const w of [7, 8, 9]) {
        const s = quizEngine.getQuizSettingsForWeek(w);
        expect(s).toEqual({ questionCount: 20, durationMinutes: 25, passPercent: 0.70 });
      }
    });

    it('returns advanced settings for weeks 10-12', () => {
      for (const w of [10, 11, 12]) {
        const s = quizEngine.getQuizSettingsForWeek(w);
        expect(s).toEqual({ questionCount: 25, durationMinutes: 30, passPercent: 0.75 });
      }
    });

    it('returns expert settings for weeks > 12', () => {
      const s = quizEngine.getQuizSettingsForWeek(13);
      expect(s).toEqual({ questionCount: 30, durationMinutes: 40, passPercent: 0.80 });
    });

    it('defaults to week 1 for non-numeric input', () => {
      expect(quizEngine.getQuizSettingsForWeek(null)).toEqual(
        quizEngine.getQuizSettingsForWeek(1)
      );
      expect(quizEngine.getQuizSettingsForWeek(undefined)).toEqual(
        quizEngine.getQuizSettingsForWeek(1)
      );
      expect(quizEngine.getQuizSettingsForWeek('abc')).toEqual(
        quizEngine.getQuizSettingsForWeek(1)
      );
    });

    it('handles string week numbers', () => {
      expect(quizEngine.getQuizSettingsForWeek('5')).toEqual(
        quizEngine.getQuizSettingsForWeek(5)
      );
    });

    it('difficulty increases monotonically with week number', () => {
      let prev = quizEngine.getQuizSettingsForWeek(1);
      for (let w = 2; w <= 15; w++) {
        const curr = quizEngine.getQuizSettingsForWeek(w);
        expect(curr.questionCount).toBeGreaterThanOrEqual(prev.questionCount);
        expect(curr.durationMinutes).toBeGreaterThanOrEqual(prev.durationMinutes);
        expect(curr.passPercent).toBeGreaterThanOrEqual(prev.passPercent);
        prev = curr;
      }
    });
  });

  describe('getPassingScore', () => {
    it('computes ceil of questionCount * passPercent', () => {
      expect(quizEngine.getPassingScore(10, 0.60)).toBe(6);
      expect(quizEngine.getPassingScore(15, 0.65)).toBe(10);
      expect(quizEngine.getPassingScore(20, 0.70)).toBe(14);
      expect(quizEngine.getPassingScore(25, 0.75)).toBe(19);
      expect(quizEngine.getPassingScore(30, 0.80)).toBe(24);
    });

    it('returns 0 for zero inputs', () => {
      expect(quizEngine.getPassingScore(0, 0.5)).toBe(0);
      expect(quizEngine.getPassingScore(10, 0)).toBe(0);
      expect(quizEngine.getPassingScore(0, 0)).toBe(0);
    });

    it('handles null/undefined gracefully', () => {
      expect(quizEngine.getPassingScore(null, null)).toBe(0);
      expect(quizEngine.getPassingScore(undefined, undefined)).toBe(0);
    });

    it('always returns an integer', () => {
      for (let q = 1; q <= 30; q++) {
        for (const p of [0.60, 0.65, 0.70, 0.75, 0.80]) {
          const result = quizEngine.getPassingScore(q, p);
          expect(Number.isInteger(result)).toBe(true);
        }
      }
    });
  });
});
