const mongoose = require('mongoose');
const SystemKnowledgeSchema = new mongoose.Schema({
  topic:     { type: String, unique: true, required: true },
  content:   { type: String, required: true },
  updatedAt: { type: Date, default: Date.now },
});
module.exports = mongoose.model('SystemKnowledge', SystemKnowledgeSchema);
