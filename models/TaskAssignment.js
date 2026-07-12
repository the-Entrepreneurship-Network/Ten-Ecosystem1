const mongoose = require("mongoose");

const taskAssignmentSchema = new mongoose.Schema({
  employeeId: { type: String, required: true, index: true },
  domain: { type: String, required: true },
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: "AutoTask" },
  title: { type: String, required: true },
  description: { type: String },
  difficulty: { type: String },
  dayNumber: { type: Number },
  taskNumber: { type: Number },
  unlockedAt: { type: Date, default: Date.now },
  deadline: { type: Date },
  status: { type: String, default: "Pending" },
  feedback: { type: String },
  autoApprovedAt: { type: Date },
  submittedAt: { type: Date },
  githubLink: { type: String },
  note: { type: String },
  image: { type: String },
  pdf: { type: String },
  coordinatorRating: { type: Number, default: 0 }
});

module.exports = mongoose.models.TaskAssignment || mongoose.model("TaskAssignment", taskAssignmentSchema);
