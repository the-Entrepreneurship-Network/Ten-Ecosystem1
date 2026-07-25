// NEW FEATURE: Psychology Trigger Log
const mongoose = require("mongoose");

const psychologyTriggerSchema = new mongoose.Schema({
    studentId:   { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    triggerName: {
        type: String,
        enum: [
            "DAY1_BLUR_SHOWN",
            "FIRST_TASK_COIN_POPUP",
            "SOCIAL_PROOF_NOTIFICATION",
            "EXPERT_CERT_UNLOCKED",
            "NANO_CERT_UNLOCKED",
            "FELLOWSHIP_WHISPER_SHOWN",
            "GENTLE_NUDGE"
        ],
        required: true
    },
    shownAt:   { type: Date, default: Date.now },
    clicked:   { type: Boolean, default: false },
    converted: { type: Boolean, default: false }
}, { timestamps: true });

psychologyTriggerSchema.index({ studentId: 1, triggerName: 1 });
psychologyTriggerSchema.index({ studentId: 1, shownAt: -1 });

module.exports = mongoose.model("PsychologyTrigger", psychologyTriggerSchema);
