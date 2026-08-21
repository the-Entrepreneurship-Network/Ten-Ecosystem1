'use strict';

/**
 * The targets have to fit the person.
 *
 * Every search ended with the same ten names — Google, Meta, Amazon and the
 * rest — which is the right list if you are a backend engineer and noise if
 * you are an actuary, a supply-chain analyst or a process engineer. Those
 * students were shown a wall of employers that do not hire their title and
 * told these were the ones worth aiming at.
 */

const A = require('../../services/v2/aspirationalCompanies');

describe('the list follows the role', () => {
  it('leads with banks and insurers for a risk analyst', () => {
    const names = A.aspirationalFor('Risk Analyst', 10).map((c) => c.name);
    expect(names.some((n) => /JPMorgan|Goldman|HDFC Bank|ICICI|Morgan Stanley/.test(n))).toBe(true);
  });

  it('leads with pharma and hospitals for a clinical data manager', () => {
    const names = A.aspirationalFor('Clinical Data Manager', 10).map((c) => c.name);
    expect(names.some((n) => /Pfizer|Merck|Eli Lilly|Sun Pharma|Apollo Hospitals|Johnson/.test(n))).toBe(true);
  });

  it('leads with the aerospace names for an avionics engineer', () => {
    const names = A.aspirationalFor('Avionics Engineer', 10).map((c) => c.name);
    expect(names.some((n) => /Boeing|Lockheed|Northrop|SpaceX|Hindustan Aeronautics|Bharat Electronics/.test(n))).toBe(true);
  });

  it('still leads with the big names for a backend engineer', () => {
    const names = A.aspirationalFor('Backend Engineer', 10).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['Google', 'Microsoft', 'Amazon']));
  });
});

describe('the rest of the market stays reachable', () => {
  it('carries both indices and many domains, never one sector', () => {
    const rows = A.aspirationalFor('Software Engineer', 30);
    expect(new Set(rows.map((r) => r.domain)).size).toBeGreaterThan(2);
    /* An Indian student applying at home should see employers who hire here. */
    const all = A.COMPANIES.map(([n]) => n);
    expect(all).toEqual(expect.arrayContaining([
      'Reliance Industries', 'Tata Consultancy Services', 'Infosys', 'HDFC Bank',
    ]));
    expect(all).toEqual(expect.arrayContaining([
      'JPMorgan Chase', 'Johnson & Johnson', 'ExxonMobil', 'Walmart',
    ]));
  });

  it('never repeats a company and never runs empty', () => {
    ['Poet', '', 'Quantum Computing Researcher', 'HR Generalist'].forEach((role) => {
      const names = A.aspirationalFor(role, 20).map((c) => c.name);
      expect(names.length).toBeGreaterThan(0);
      expect(new Set(names).size).toBe(names.length);
    });
  });
});
