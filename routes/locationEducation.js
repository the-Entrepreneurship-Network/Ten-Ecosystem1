'use strict';

const express = require('express');
const router = express.Router();
const {
  getCountries,
  getStates,
  getCities,
  getColleges,
  getDegrees,
  searchSkills
} = require('../services/locationEducationService');

router.get('/countries', (req, res) => {
  return res.json({ success: true, countries: getCountries() });
});

router.get('/states', (req, res) => {
  const { country } = req.query;
  return res.json({ success: true, states: getStates(country) });
});

router.get('/cities', (req, res) => {
  const { country, state } = req.query;
  return res.json({ success: true, cities: getCities(country, state) });
});

router.get('/colleges', (req, res) => {
  const { state } = req.query;
  return res.json({ success: true, colleges: getColleges(state) });
});

router.get('/degrees', (req, res) => {
  const { college } = req.query;
  return res.json({ success: true, degrees: getDegrees(college) });
});

router.get('/skills', (req, res) => {
  const { q } = req.query;
  return res.json({ success: true, skills: searchSkills(q) });
});

module.exports = router;
