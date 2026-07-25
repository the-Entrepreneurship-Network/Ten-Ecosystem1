'use strict';

describe('config/payment', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  function loadPaymentConfig() {
    return require('../../config/payment');
  }

  it('defaults PAYMENT_ENABLED to false when env var is absent', () => {
    delete process.env.PAYMENT_ENABLED;
    const cfg = loadPaymentConfig();
    expect(cfg.PAYMENT_ENABLED).toBe(false);
  });

  it('sets PAYMENT_ENABLED to true when env var is "true"', () => {
    process.env.PAYMENT_ENABLED = 'true';
    const cfg = loadPaymentConfig();
    expect(cfg.PAYMENT_ENABLED).toBe(true);
  });

  it('sets PAYMENT_ENABLED to false for any non-"true" value', () => {
    process.env.PAYMENT_ENABLED = 'yes';
    const cfg = loadPaymentConfig();
    expect(cfg.PAYMENT_ENABLED).toBe(false);
  });

  it('has correct CERT_PRICES in rupees', () => {
    const cfg = loadPaymentConfig();
    expect(cfg.CERT_PRICES).toEqual({
      expert: 100,
      nano_degree: 1000,
      fellowship: 2500,
    });
  });

  it('has correct CERT_PRICES_PAISE (rupee * 100)', () => {
    const cfg = loadPaymentConfig();
    expect(cfg.CERT_PRICES_PAISE).toEqual({
      expert: 10000,
      nano_degree: 100000,
      fellowship: 250000,
    });
  });

  it('CERT_PRICES_PAISE values equal CERT_PRICES * 100', () => {
    const cfg = loadPaymentConfig();
    for (const key of Object.keys(cfg.CERT_PRICES)) {
      expect(cfg.CERT_PRICES_PAISE[key]).toBe(cfg.CERT_PRICES[key] * 100);
    }
  });

  it('has a valid PAYMENTSETU_BASE_URL', () => {
    const cfg = loadPaymentConfig();
    expect(cfg.PAYMENTSETU_BASE_URL).toBe('https://paymentsetu.com/api');
  });
});
