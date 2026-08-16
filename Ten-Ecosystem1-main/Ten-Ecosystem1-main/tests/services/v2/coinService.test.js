'use strict';

const { COIN_ACTIONS, coinsToRupees } = require('../../../services/v2/coinService');

describe('services/v2/coinService', () => {
  describe('COIN_ACTIONS', () => {
    it('defines all expected action keys', () => {
      const expectedKeys = [
        'TASK_APPROVED_EASY', 'TASK_APPROVED_MEDIUM', 'TASK_APPROVED_HARD', 'TASK_APPROVED_EXPERT',
        'TASK_APPROVED',
        'QUIZ_PASSED_FIRST', 'QUIZ_PASSED_RETRY',
        'DJP_1_2_PLATFORMS', 'DJP_3_5_PLATFORMS', 'DJP_6_PLUS_PLATFORMS', 'DJP_FORM_BONUS',
        'ATTENDANCE_DAILY', 'ATTENDANCE_7D_STREAK', 'ATTENDANCE_30D_STREAK',
        'ONBOARD_BONUS', 'TASK_FIRST', 'WEEK_COMPLETE', 'COURSE_COMPLETE',
        'LOGIN_STREAK_7D', 'LOGIN_STREAK_30D',
        'VIDEO_WATCHED', 'STREAK_BONUS',
      ];
      for (const key of expectedKeys) {
        expect(COIN_ACTIONS).toHaveProperty(key);
        expect(typeof COIN_ACTIONS[key]).toBe('function');
      }
    });

    it('returns correct coins for task difficulty tiers', () => {
      expect(COIN_ACTIONS.TASK_APPROVED_EASY().coins).toBe(20);
      expect(COIN_ACTIONS.TASK_APPROVED_MEDIUM().coins).toBe(30);
      expect(COIN_ACTIONS.TASK_APPROVED_HARD().coins).toBe(40);
      expect(COIN_ACTIONS.TASK_APPROVED_EXPERT().coins).toBe(100);
    });

    it('TASK_APPROVED passes through the coin amount', () => {
      expect(COIN_ACTIONS.TASK_APPROVED(50).coins).toBe(50);
      expect(COIN_ACTIONS.TASK_APPROVED(0).coins).toBe(0);
    });

    it('returns correct quiz rewards', () => {
      expect(COIN_ACTIONS.QUIZ_PASSED_FIRST().coins).toBe(50);
      expect(COIN_ACTIONS.QUIZ_PASSED_RETRY().coins).toBe(25);
    });

    it('returns correct daily job posting rewards', () => {
      expect(COIN_ACTIONS.DJP_1_2_PLATFORMS().coins).toBe(5);
      expect(COIN_ACTIONS.DJP_3_5_PLATFORMS().coins).toBe(10);
      expect(COIN_ACTIONS.DJP_6_PLUS_PLATFORMS().coins).toBe(15);
      expect(COIN_ACTIONS.DJP_FORM_BONUS().coins).toBe(3);
    });

    it('returns correct attendance rewards', () => {
      expect(COIN_ACTIONS.ATTENDANCE_DAILY().coins).toBe(5);
      expect(COIN_ACTIONS.ATTENDANCE_7D_STREAK().coins).toBe(50);
      expect(COIN_ACTIONS.ATTENDANCE_30D_STREAK().coins).toBe(200);
    });

    it('returns correct milestone rewards', () => {
      expect(COIN_ACTIONS.ONBOARD_BONUS().coins).toBe(20);
      expect(COIN_ACTIONS.TASK_FIRST().coins).toBe(10);
      expect(COIN_ACTIONS.COURSE_COMPLETE().coins).toBe(500);
    });

    it('WEEK_COMPLETE includes week number in label', () => {
      const result = COIN_ACTIONS.WEEK_COMPLETE(3);
      expect(result.coins).toBe(30);
      expect(result.label).toContain('3');
    });

    it('STREAK_BONUS returns 30 for >= 7 days, 10 otherwise', () => {
      expect(COIN_ACTIONS.STREAK_BONUS(7).coins).toBe(30);
      expect(COIN_ACTIONS.STREAK_BONUS(10).coins).toBe(30);
      expect(COIN_ACTIONS.STREAK_BONUS(6).coins).toBe(10);
      expect(COIN_ACTIONS.STREAK_BONUS(1).coins).toBe(10);
    });

    it('LOGIN_STREAK returns correct values', () => {
      expect(COIN_ACTIONS.LOGIN_STREAK_7D().coins).toBe(25);
      expect(COIN_ACTIONS.LOGIN_STREAK_30D().coins).toBe(100);
    });

    it('all actions return objects with label and coins', () => {
      for (const [key, fn] of Object.entries(COIN_ACTIONS)) {
        const result = fn(10);
        expect(result).toHaveProperty('label');
        expect(result).toHaveProperty('coins');
        expect(typeof result.label).toBe('string');
        expect(typeof result.coins).toBe('number');
      }
    });
  });

  describe('coinsToRupees', () => {
    it('converts coins to rupees at 0.50 rate', () => {
      expect(coinsToRupees(100)).toBe('50.00');
      expect(coinsToRupees(1)).toBe('0.50');
      expect(coinsToRupees(0)).toBe('0.00');
      expect(coinsToRupees(250)).toBe('125.00');
    });

    it('returns a string with exactly 2 decimal places', () => {
      const result = coinsToRupees(3);
      expect(result).toBe('1.50');
      expect(result).toMatch(/^\d+\.\d{2}$/);
    });
  });
});
