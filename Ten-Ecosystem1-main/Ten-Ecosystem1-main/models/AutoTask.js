const mongoose = require("mongoose");

const autoTaskSchema = new mongoose.Schema({
  domain: { type: String, required: true },
  tenure: { type: String, required: true },
  dayNumber: { type: Number, required: true },
  taskNumber: { type: Number, required: true },
  title: { type: String, required: true },
  description: { type: String },
  difficulty: { type: String },
  taskType: { type: String },
  isActive: { type: Boolean, default: true }
});

module.exports = mongoose.models.AutoTask || mongoose.model("AutoTask", autoTaskSchema);
