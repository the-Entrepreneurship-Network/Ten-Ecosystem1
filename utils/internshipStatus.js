const { TENURE_DAYS } = require('./attendanceUtils');

function isInternshipComplete(student) {
  if (!student || !student.joiningDate) return false;
  
  const joiningDate = new Date(student.joiningDate);
  if (isNaN(joiningDate.getTime())) return false;
  
  const tenure = student.tenure || student.v2DurationType;
  const tenureDays = TENURE_DAYS[tenure] || 30;
  
  const completionDate = new Date(joiningDate.getTime());
  completionDate.setDate(completionDate.getDate() + tenureDays);
  
  const today = new Date();
  // Truncate to midnight to compare date part
  today.setHours(0, 0, 0, 0);
  completionDate.setHours(0, 0, 0, 0);
  
  return today >= completionDate;
}

module.exports = {
  isInternshipComplete
};
