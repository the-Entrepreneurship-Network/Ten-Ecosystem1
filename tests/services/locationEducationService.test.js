'use strict';

const {
  getCountries,
  getStates,
  getCities,
  getColleges,
  getDegrees,
  searchSkills
} = require('../../services/locationEducationService');

describe('locationEducationService', () => {
  it('returns list of countries including India and USA', () => {
    const countries = getCountries();
    expect(countries).toContain('India');
    expect(countries).toContain('USA');
  });

  it('returns states for India', () => {
    const states = getStates('India');
    expect(states).toContain('Maharashtra');
    expect(states).toContain('Karnataka');
  });

  it('returns cities for India and Maharashtra', () => {
    const cities = getCities('India', 'Maharashtra');
    expect(cities).toContain('Mumbai');
    expect(cities).toContain('Pune');
  });

  it('returns colleges for Maharashtra', () => {
    const colleges = getColleges('Maharashtra');
    expect(colleges.some(c => c.includes('COEP') || c.includes('College of Engineering'))).toBe(true);
  });

  it('returns degrees for a known college', () => {
    const degrees = getDegrees('College of Engineering Pune (COEP)');
    expect(degrees.some(d => d.includes('B.Tech'))).toBe(true);
  });

  it('filters skills based on search query', () => {
    const pythonSkills = searchSkills('python');
    expect(pythonSkills).toContain('Python');

    const reactSkills = searchSkills('react');
    expect(reactSkills).toContain('React');
  });
});
