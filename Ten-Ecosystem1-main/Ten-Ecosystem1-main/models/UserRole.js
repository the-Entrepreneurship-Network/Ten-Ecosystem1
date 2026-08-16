// UserRole Extension — Phase 1
// Adds: Founder, Mentor, Investor, Contractor to the existing role enum.
// These roles are additive and do not modify any existing student/HR/coordinator role.

const EXTENDED_ROLES = [
  "student",       // existing
  "hr",            // existing
  "coordinator",   // existing
  "founder",       // new
  "mentor",        // new
  "investor",      // new
  "contractor"     // new
];

module.exports = { EXTENDED_ROLES };

