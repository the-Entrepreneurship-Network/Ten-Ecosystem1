const mongoose = require('mongoose');
const BotQuerySchema = new mongoose.Schema({
  userId:         { type: String, required: true },
  userType:       { type: String, enum: ['student', 'coordinator'], required: true },
  userName:       { type: String, default: '' },
  domain:         { type: String, default: '' },
  coordinatorId:  { type: String, default: '' },
  botType:        { type: String, enum: ['task', 'voice', 'query'], required: true },
  question:       { type: String, required: true },
  answer:         { type: String, default: null },
  escalatedToHR:  { type: Boolean, default: false },
  hrAnswer:       { type: String, default: null },
  hrAnsweredBy:   { type: String, default: null },
  hrAnsweredAt:   { type: Date,   default: null },
  status:         { type: String, enum: ['open', 'answered'], default: 'open' },
  createdAt:      { type: Date, default: Date.now },
});
module.exports = mongoose.model('BotQuery', BotQuerySchema);
