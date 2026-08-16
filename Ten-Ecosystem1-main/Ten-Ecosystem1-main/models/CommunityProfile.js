const mongoose = require("mongoose");

const CommunityProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "EcosystemUser",
    required: true,
    unique: true,
    index: true
  },
  role: { type: String, required: true },
  activity: [{
    action: { type: String, required: true },
    description: { type: String, default: "" },
    target: { type: String, default: "" },
    timestamp: { type: Date, default: Date.now }
  }],
  postsCount: { type: Number, default: 0 },
  commentsCount: { type: Number, default: 0 },
  events: [{ type: String }],
  badges: [{ type: String }],
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model("CommunityProfile", CommunityProfileSchema);
