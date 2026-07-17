// NEW FEATURE: Quiz System
"use strict";

const mongoose = require("mongoose");
const DomainTask = require("../../models/new/DomainTask");
const StudentTaskProgress = require("../../models/new/StudentTaskProgress");
const QuizQuestion = require("../../models/new/QuizQuestion");
const coinService = require("./coinService");

// NEW FEATURE: Quiz System
async function tryUnlockNextWeekNoCoins(student, approvedTaskDoc) {
    const { domain, durationType, weekNumber: currentWeek } = approvedTaskDoc;

    const currentWeekTasks = await DomainTask.find({ domain, durationType, weekNumber: currentWeek }).lean();
    const currentWeekIds = currentWeekTasks.map(t => t._id);
    if (!currentWeekIds.length) return { unlocked: 0 };

    const approvedCount = await StudentTaskProgress.countDocuments({
        studentId: student._id,
        taskId: { $in: currentWeekIds },
        status: "approved"
    });

    if (approvedCount < currentWeekIds.length) return { unlocked: 0 };

    const nextWeekTasks = await DomainTask.find({ domain, durationType, weekNumber: currentWeek + 1 }).lean();
    if (!nextWeekTasks.length) return { unlocked: 0 };

    const nextWeekIds = nextWeekTasks.map(t => t._id);
    const res = await StudentTaskProgress.updateMany(
        { studentId: student._id, taskId: { $in: nextWeekIds }, status: "locked" },
        { $set: { status: "available" } }
    );

    return { unlocked: res.modifiedCount, weekCompleted: currentWeek };
}

// NEW FEATURE: Quiz System
async function getBankCountForTask(taskId) {
    return QuizQuestion.countDocuments({ task_id: taskId });
}

// NEW FEATURE: Quiz System
function getQuizSettingsForWeek(weekNumber) {
    const w = parseInt(weekNumber) || 1;
    if (w <= 3)  return { questionCount: 10, durationMinutes: 15, passPercent: 0.60 };
    if (w <= 6)  return { questionCount: 15, durationMinutes: 20, passPercent: 0.65 };
    if (w <= 9)  return { questionCount: 20, durationMinutes: 25, passPercent: 0.70 };
    if (w <= 12) return { questionCount: 25, durationMinutes: 30, passPercent: 0.75 };
    return { questionCount: 30, durationMinutes: 40, passPercent: 0.80 };
}

// NEW FEATURE: Quiz System
function getPassingScore(questionCount, passPercent) {
    return Math.ceil((questionCount || 0) * (passPercent || 0));
}

// NEW FEATURE: Quiz System
async function getProgressForTask(studentId, taskId) {
    return StudentTaskProgress.findOne({ studentId, taskId });
}

// NEW FEATURE: Quiz System
function resetLockIfExpired(progress) {
    if (!progress) return;
    if (!progress.quiz_locked_until) return;
    const now = Date.now();
    if (new Date(progress.quiz_locked_until).getTime() <= now) {
        progress.quiz_locked_until = null;
        progress.quiz_attempts = 0;
    }
}

// NEW FEATURE: Quiz System
async function getQuizStatus(studentId, taskId) {
    const [task, progress] = await Promise.all([
        DomainTask.findById(taskId).lean(),
        getProgressForTask(studentId, taskId)
    ]);
    if (!task) return { error: "Task not found" };
    if (!progress) return { error: "Task not assigned" };

    resetLockIfExpired(progress);
    if (progress.isModified()) await progress.save();

    const bank_count = await getBankCountForTask(task._id);
    const bank_ready = bank_count >= 30;

    return {
        attempts_used: progress.quiz_attempts || 0,
        locked_until: progress.quiz_locked_until || null,
        quiz_passed: !!progress.quiz_passed,
        best_score: progress.quiz_best_score || 0,
        bank_ready,
        bank_count
    };
}

// NEW FEATURE: Quiz System
async function completeTaskViaFallback(student, taskId) {
    const task = await DomainTask.findById(taskId).lean();
    if (!task) return { error: "Task not found" };

    const progress = await getProgressForTask(student._id, taskId);
    if (!progress) return { error: "Task not assigned" };

    if (progress.status === "locked") return { error: "Task locked" };

    const bankCount = await getBankCountForTask(task._id);
    if (bankCount >= 30) return { quiz_ready: true };

    if ((progress.videoWatchedPercent || 0) < 80) return { error: "Video progress below 80%" };

    if (progress.quiz_passed || progress.status === "approved") {
        return { completed: true, coins_awarded: 0, next_week_unlocked: false, already_completed: true };
    }

    let coinsAwarded = 0;
    let nextWeekUnlocked = false;

    progress.quiz_passed = true;
    progress.quiz_pass_score = 0;
    progress.status = "approved";
    progress.approvedAt = new Date();
    progress.approvedBy = null;

    progress.quiz_current_question_ids = [];
    progress.quiz_current_expires_at = null;

    const coinReward = task.coinReward || 0;
    if (coinReward > 0 && !progress.coinsAwarded) {
        progress.coinsAwarded = coinReward;
        const coinRes = await coinService.awardCoins(student._id, "TASK_APPROVED", coinReward);
        coinsAwarded = coinRes.awarded;
    }

    const unlock = await tryUnlockNextWeekNoCoins(student, task);
    nextWeekUnlocked = !!unlock.unlocked;

    await progress.save();

    return { completed: true, coins_awarded: coinsAwarded, next_week_unlocked: nextWeekUnlocked, already_completed: false };
}

// NEW FEATURE: Quiz System
async function getQuestionsForTask(student, taskId) {
    const task = await DomainTask.findById(taskId).lean();
    if (!task) return { error: "Task not found" };

    const progress = await getProgressForTask(student._id, taskId);
    if (!progress) return { error: "Task not assigned" };

    if (progress.status === "locked") return { error: "Task locked" };
    if (progress.quiz_passed || progress.status === "approved") return { error: "already_passed" };

    if ((progress.videoWatchedPercent || 0) < 80) {
        return { 
            error: `Video progress is currently at ${progress.videoWatchedPercent || 0}%. You must watch at least 80% of the associated video lessons before unlocking the quiz.` 
        };
    }

    resetLockIfExpired(progress);
    if (progress.quiz_locked_until) {
        await progress.save();
        return {
            locked: true,
            locked_until: progress.quiz_locked_until,
            attempts_used: progress.quiz_attempts || 0
        };
    }

    const settings = getQuizSettingsForWeek(task.weekNumber);
    const passingScore = getPassingScore(settings.questionCount, settings.passPercent);

    const now = Date.now();
    const hasActiveAttempt = progress.quiz_current_question_ids?.length
        && progress.quiz_current_expires_at
        && new Date(progress.quiz_current_expires_at).getTime() > now;

    if (hasActiveAttempt) {
        const qs = await QuizQuestion.find({ _id: { $in: progress.quiz_current_question_ids } })
            .select("question_text options")
            .lean();

        const map = {};
        for (const q of qs) map[q._id.toString()] = q;
        const ordered = progress.quiz_current_question_ids
            .map(id => map[id.toString()])
            .filter(Boolean);

        return {
            locked: false,
            task: { _id: task._id, weekNumber: task.weekNumber, domain: task.domain, durationType: task.durationType, taskTitle: task.taskTitle },
            quiz: { questionCount: settings.questionCount, durationMinutes: settings.durationMinutes, passPercent: settings.passPercent, passingScore },
            questions: ordered,
            attempt: { resumes: true, expires_at: progress.quiz_current_expires_at }
        };
    }

    const bankCount = await getBankCountForTask(task._id);
    if (bankCount < 30) {
        return { fallback: true, bank_count: bankCount };
    }

    const match = { task_id: task._id };
    const excludeLast = progress.quiz_last_question_ids?.length && bankCount > settings.questionCount;
    if (excludeLast) {
        match._id = { $nin: progress.quiz_last_question_ids.map(x => new mongoose.Types.ObjectId(x)) };
    }

    const sampled = await QuizQuestion.aggregate([
        { $match: match },
        { $sample: { size: settings.questionCount } },
        { $project: { question_text: 1, options: 1 } }
    ]);

    if (!sampled?.length || sampled.length < settings.questionCount) {
        const fallback = await QuizQuestion.aggregate([
            { $match: { task_id: task._id } },
            { $sample: { size: settings.questionCount } },
            { $project: { question_text: 1, options: 1 } }
        ]);
        sampled.splice(0, sampled.length, ...(fallback || []));
    }

    const questionIds = (sampled || []).map(q => q._id);
    const expiresAt = new Date(Date.now() + settings.durationMinutes * 60 * 1000);

    progress.quiz_current_question_ids = questionIds;
    progress.quiz_current_expires_at = expiresAt;
    await progress.save();

    return {
        locked: false,
        task: { _id: task._id, weekNumber: task.weekNumber, domain: task.domain, durationType: task.durationType, taskTitle: task.taskTitle },
        quiz: { questionCount: settings.questionCount, durationMinutes: settings.durationMinutes, passPercent: settings.passPercent, passingScore },
        questions: sampled,
        attempt: { resumes: false, expires_at: expiresAt }
    };
}

// NEW FEATURE: Quiz System
async function submitQuiz(student, taskId, answers, meta) {
    const task = await DomainTask.findById(taskId).lean();
    if (!task) return { error: "Task not found" };

    const progress = await getProgressForTask(student._id, taskId);
    if (!progress) return { error: "Task not assigned" };

    if (progress.status === "locked") return { error: "Task locked" };
    if (progress.quiz_passed || progress.status === "approved") {
        return {
            passed: true,
            score: progress.quiz_pass_score || 0,
            total: progress.quiz_current_question_ids?.length || 0,
            coins_awarded: 0,
            next_week_unlocked: false,
            attempt_number: progress.quiz_attempts || 0,
            locked_until: progress.quiz_locked_until || null
        };
    }

    resetLockIfExpired(progress);
    if (progress.quiz_locked_until) {
        await progress.save();
        return { locked: true, locked_until: progress.quiz_locked_until };
    }

    const settings = getQuizSettingsForWeek(task.weekNumber);
    const passingScore = getPassingScore(settings.questionCount, settings.passPercent);

    const currentIds = (progress.quiz_current_question_ids || []).map(x => x.toString());
    if (!currentIds.length) return { error: "No active quiz attempt. Start the quiz again." };

    const answerMap = answers && typeof answers === "object" ? answers : {};
    const cleanedAnswers = {};
    for (const qId of currentIds) {
        const v = (answerMap[qId] || "").toString().toUpperCase();
        if (["A", "B", "C", "D"].includes(v)) cleanedAnswers[qId] = v;
    }

    const questions = await QuizQuestion.find({ _id: { $in: currentIds } })
        .select("question_text options correct_answer explanation")
        .lean();

    const qById = {};
    for (const q of questions) qById[q._id.toString()] = q;

    let score = 0;
    const review = [];
    for (const qId of currentIds) {
        const q = qById[qId];
        if (!q) continue;
        const selected = cleanedAnswers[qId] || null;
        const correct = q.correct_answer;
        if (selected && selected === correct) score += 1;
        review.push({
            _id: q._id,
            question_text: q.question_text,
            options: q.options,
            selected,
            correct_answer: correct,
            explanation: q.explanation || ""
        });
    }

    const passed = score >= passingScore;

    progress.quiz_last_attempt_at = new Date();
    progress.quiz_best_score = Math.max(progress.quiz_best_score || 0, score);

    let coinsAwarded = 0;
    let nextWeekUnlocked = false;

    if (passed) {
        progress.quiz_passed = true;
        progress.quiz_pass_score = score;
        progress.status = "approved";
        progress.approvedAt = new Date();
        progress.approvedBy = null;

        const coinReward = task.coinReward || 0;
        progress.coinsAwarded = coinReward;
        if (coinReward > 0) {
            const coinRes = await coinService.awardCoins(student._id, "TASK_APPROVED", coinReward);
            coinsAwarded = coinRes.awarded;
        }

        const unlock = await tryUnlockNextWeekNoCoins(student, task);
        nextWeekUnlocked = !!unlock.unlocked;
    } else {
        progress.quiz_attempts = (progress.quiz_attempts || 0) + 1;
        progress.quiz_last_question_ids = progress.quiz_current_question_ids || [];
        if (progress.quiz_attempts >= 3) {
            progress.quiz_locked_until = new Date(Date.now() + 24 * 60 * 60 * 1000);
        }
    }

    progress.quiz_current_question_ids = [];
    progress.quiz_current_expires_at = null;
    await progress.save();

    return {
        passed,
        score,
        total: currentIds.length,
        passing_score: passingScore,
        coins_awarded: coinsAwarded,
        next_week_unlocked: nextWeekUnlocked,
        attempt_number: progress.quiz_attempts || 0,
        locked_until: progress.quiz_locked_until || null,
        review: passed ? [] : review,
        meta: meta && typeof meta === "object" ? meta : null
    };
}

module.exports = {
    getQuizSettingsForWeek,
    getPassingScore,
    getQuizStatus,
    getQuestionsForTask,
    submitQuiz,
    completeTaskViaFallback
};
