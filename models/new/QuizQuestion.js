// NEW FEATURE: Quiz System
const mongoose = require("mongoose");

// NEW FEATURE: QuizQuestion model (per-task question bank)
const QuizQuestionSchema = new mongoose.Schema({
    task_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "DomainTask",
        required: true
    },
    domain: {
        type: String,
        required: true
    },
    week_number: {
        type: Number,
        required: true
    },
    duration_type: {
        type: String,
        enum: ["45days", "1month", "3months", "6months"]
    },
    question_text: {
        type: String,
        required: true
    },
    options: {
        A: String,
        B: String,
        C: String,
        D: String
    },
    correct_answer: {
        type: String,
        enum: ["A", "B", "C", "D"],
        required: true
    },
    explanation: {
        type: String
    },
    difficulty: {
        type: String,
        default: "hard"
    },
    created_at: {
        type: Date,
        default: Date.now
    }
});

QuizQuestionSchema.index({ task_id: 1, created_at: -1 });
QuizQuestionSchema.index({ domain: 1, week_number: 1 });

module.exports = mongoose.model("QuizQuestion", QuizQuestionSchema);

