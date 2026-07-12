const TENURE_DAYS = {
  '1week': 7,
  '15days': 15,
  '1month': 30,
  '45days': 45,
  '3months': 90,
  '6months': 180
};

function getTenureDays(tenure) {
  return TENURE_DAYS[tenure] || 30;
}

function calculateAttendancePercentage(student, presentCount) {
  if (!student || !student.joiningDate) return 0;
  const totalTenureDays = getTenureDays(student.tenure || student.v2DurationType);
  const joiningDate = new Date(student.joiningDate);
  const today = new Date();
  const daysElapsed = Math.min(
    Math.floor((today - joiningDate) / (1000 * 60 * 60 * 24)) + 1,
    totalTenureDays
  );
  const expectedDays = Math.max(daysElapsed, 1);
  return Math.min(Math.round((presentCount / expectedDays) * 100), 100);
}

function has75PercentAttendance(student, presentCount) {
  if (!student || !student.joiningDate) return false;
  const totalTenureDays = getTenureDays(student.tenure || student.v2DurationType);
  const joiningDate = new Date(student.joiningDate);
  const today = new Date();
  const daysElapsed = Math.min(
    Math.floor((today - joiningDate) / (1000 * 60 * 60 * 24)) + 1,
    totalTenureDays
  );
  return presentCount >= Math.ceil(daysElapsed * 0.75);
}

module.exports = { TENURE_DAYS, getTenureDays, calculateAttendancePercentage, has75PercentAttendance };
