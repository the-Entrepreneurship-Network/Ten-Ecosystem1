// NEW FEATURE: Sequential Task Unlock Engine
"use strict";

const DomainTask           = require("../../models/new/DomainTask");
const StudentTaskProgress  = require("../../models/new/StudentTaskProgress");
const coinService          = require("./coinService");

// Tenure parsing is shared — see utils/tenure.js. This was one of six
// independent copies of the mapping, and they disagreed with each other.
const { toDurationType } = require("../../utils/tenure");

function tenureToDurationType(tenure) {
    return toDurationType(tenure);
}

/**
 * The duration the STUDENT is enrolled on.
 *
 * `v2DurationType` is what they picked in the Task Journey popup, but it was
 * previously written with no cross-check against Student.tenure — so a student
 * on the paid 1-Month track could select "6months" in the popup and be assigned
 * the full six-month task set. The registered tenure wins when the two disagree.
 */
function resolveStudentDuration(student) {
    if (!student) return toDurationType(null);
    const fromTenure = student.tenure ? toDurationType(student.tenure) : null;
    if (fromTenure) return fromTenure;
    return toDurationType(student.v2DurationType);
}

/**
 * The exact set of tasks a student is entitled to right now.
 *
 * Split out of assignTasksForStudent so resyncTasksForStudent can ask the same
 * question — "what SHOULD this student have?" — without duplicating the domain
 * aliasing and the short-duration remap, which is precisely the kind of second
 * copy that let the five tenure tables drift apart.
 */
async function resolveTaskScope(student) {
    let domain = student.domain;
    if (domain === "HR") domain = "HR Management";
    if (domain === "Business Development") domain = "Business Analyst";
    if (domain === "Space Intern") domain = "Space Research";
    if (domain === "Artificial Intelligence" || domain === "AI") domain = "Data Science";
    if (domain === "Finance" || domain === "Finance and Accounts" || domain === "Finance & Accounts") domain = "Venture Capital";

    const durationType = resolveStudentDuration(student);
    if (!domain || !durationType) return { domain: null, durationType, tasks: [] };

    let queryDurationType = durationType;
    let queryObj = { domain };

    if (durationType === "1week") {
        queryDurationType = "1month";
        queryObj.weekNumber = 1;
    } else if (durationType === "15days") {
        queryDurationType = "1month";
        queryObj.weekNumber = { $in: [1, 2] };
    }

    queryObj.durationType = queryDurationType;

    return { domain, durationType, tasks: await DomainTask.find(queryObj).lean() };
}

/**
 * Assign all tasks for a student's domain + durationType.
 * Week 1 tasks → available, all other weeks → locked.
 * Idempotent — safe to call multiple times.
 */
async function assignTasksForStudent(student) {
    const { domain, durationType, tasks: allTasks } = await resolveTaskScope(student);
    if (!domain || !durationType) return { assigned: 0 };
    if (!allTasks.length) return { assigned: 0 };

    const ops = allTasks.map(task => ({
        updateOne: {
            filter: { studentId: student._id, taskId: task._id },
            update: {
                $setOnInsert: {
                    studentId:  student._id,
                    taskId:     task._id,
                    status:     task.weekNumber === 1 ? "available" : "locked",
                    coinsAwarded: 0,
                    videoWatchedPercent: 0
                }
            },
            upsert: true
        }
    }));

    const result = await StudentTaskProgress.bulkWrite(ops);

    const week1Tasks = allTasks.filter(t => t.weekNumber === 1).map(t => t._id);
    await StudentTaskProgress.updateMany(
        { studentId: student._id, taskId: { $in: week1Tasks }, status: "locked" },
        { $set: { status: "available" } }
    );

    return { assigned: result.upsertedCount, total: allTasks.length };
}

/**
 * Bring an existing student's task journey back in line with their record.
 *
 * assignTasksForStudent is upsert-only ($setOnInsert), which is right when a
 * student is first enrolled but wrong when HR later edits them. Extending a
 * tenure from 1 Month to 3 Months left the extra weeks unassigned, and
 * shortening it — or moving the student to another domain — left the old
 * weeks in place forever. The Task Journey therefore kept showing the tenure
 * the student *used* to be on, which is the mismatch HR reported.
 *
 * Two rules govern removal, because a resync must never destroy real work:
 *   - a row the student has not touched (still locked/available, nothing
 *     submitted, no coins, no quiz attempt) is safe to drop;
 *   - anything else is kept and reported, so a shortened tenure never deletes
 *     an approved submission or the coins that came with it.
 *
 * Returns { added, removed, preserved, inScope } so the caller can tell the
 * person who made the edit what actually happened.
 */
async function resyncTasksForStudent(student) {
    const empty = { added: 0, removed: 0, preserved: 0, inScope: 0 };
    if (!student || !student._id) return empty;

    const { domain, durationType, tasks } = await resolveTaskScope(student);
    if (!domain || !durationType) return empty;

    // No task catalogue for this domain/duration yet. Removing the student's
    // existing rows here would empty their journey on the strength of missing
    // seed data, so leave everything alone.
    if (!tasks.length) return empty;

    const { assigned } = await assignTasksForStudent(student);

    const inScopeIds = tasks.map(t => String(t._id));
    const existing = await StudentTaskProgress.find({ studentId: student._id }).lean();
    const outOfScope = existing.filter(p => !inScopeIds.includes(String(p.taskId)));

    const untouched = outOfScope.filter(p =>
        (p.status === "locked" || p.status === "available") &&
        !p.submissionUrl &&
        !p.coinsAwarded &&
        !p.quiz_attempts
    );

    if (untouched.length) {
        await StudentTaskProgress.deleteMany({ _id: { $in: untouched.map(p => p._id) } });
    }

    return {
        added:     assigned || 0,
        removed:   untouched.length,
        preserved: outOfScope.length - untouched.length,
        inScope:   tasks.length
    };
}

// How many weeks of tasks each duration is entitled to. Short durations borrow
// the 1-month task set (see assignTasksForStudent), so without an explicit cap
// they would keep unlocking weeks they never paid for.
const WEEK_CAPS = {
    "1week":  1,
    "15days": 2
};

/**
 * Unlock the next week's tasks after all of the current week's tasks are approved.
 * Called after a task is marked approved.
 * Returns { unlocked: number }
 */
async function tryUnlockNextWeek(student, approvedTaskId) {
    const approvedTaskDoc = await DomainTask.findById(approvedTaskId).lean();
    if (!approvedTaskDoc) return { unlocked: 0 };

    const { domain, durationType, weekNumber: currentWeek } = approvedTaskDoc;

    // The student's duration comes from the STUDENT. It used to be re-derived
    // from the assigned task's durationType — which is "1month" for a 1week or
    // 15days student, because those values are remapped at assignment time. The
    // two guards below could therefore never fire for exactly the students they
    // exist to cap, and week 3+ unlocked for a 15-days student.
    const studentDuration = resolveStudentDuration(student);
    const weekCap = WEEK_CAPS[studentDuration];
    if (weekCap && currentWeek >= weekCap) return { unlocked: 0 };

    // All tasks in the current week for this student
    const currentWeekTasks = await DomainTask.find({ domain, durationType, weekNumber: currentWeek }).lean();
    const currentWeekIds   = currentWeekTasks.map(t => t._id);

    // Check if all tasks in this week are approved for the student
    const approvedCount = await StudentTaskProgress.countDocuments({
        studentId: student._id,
        taskId:    { $in: currentWeekIds },
        status:    "approved"
    });

    if (approvedCount < currentWeekIds.length) return { unlocked: 0 };

    // Unlock next week
    const nextWeekTasks = await DomainTask.find({ domain, durationType, weekNumber: currentWeek + 1 }).lean();
    if (!nextWeekTasks.length) return { unlocked: 0 };

    const nextWeekIds = nextWeekTasks.map(t => t._id);
    const res = await StudentTaskProgress.updateMany(
        { studentId: student._id, taskId: { $in: nextWeekIds }, status: "locked" },
        { $set: { status: "available" } }
    );

    // Award week-completion bonus
    if (res.modifiedCount > 0) {
        await coinService.awardCoins(student._id, "WEEK_COMPLETE", currentWeek);
    }

    return { unlocked: res.modifiedCount, weekCompleted: currentWeek };
}

/**
 * Approve a task: update StudentTaskProgress → approved, award coins, try unlock next week.
 */
async function approveTask(student, progressId, coordinatorId, feedback) {
    const progress = await StudentTaskProgress.findById(progressId).populate("taskId");
    if (!progress) return { error: "not_found" };
    if (progress.studentId.toString() !== student._id.toString()) return { error: "forbidden" };
    if (progress.status === "approved") return { error: "already_approved" };

    const task       = progress.taskId;
    const coinReward = task ? task.coinReward || 10 : 10;

    // First check if this is the student's first ever approved task
    const priorApprovals = await StudentTaskProgress.countDocuments({ studentId: student._id, status: "approved" });
    const isFirst        = priorApprovals === 0;

    progress.status      = "approved";
    progress.approvedAt  = new Date();
    progress.approvedBy  = coordinatorId || null;
    progress.coordinatorFeedback = feedback || "";
    progress.coinsAwarded = coinReward;
    await progress.save();

    // Award task coins
    await coinService.awardCoins(student._id, "TASK_APPROVED", coinReward);

    // First-task bonus
    if (isFirst) await coinService.awardCoins(student._id, "TASK_FIRST");

    // Try to unlock next week
    const unlock = await tryUnlockNextWeek(student, progress.taskId._id || progress.taskId);

    return { approved: true, coinsAwarded: coinReward, unlock };
}

/**
 * Get all tasks for a student, grouped by week, with their status.
 */
async function getStudentTasks(student) {
    let domain = student.domain;
    if (domain === "HR") domain = "HR Management";
    if (domain === "Business Development") domain = "Business Analyst";
    if (domain === "Space Intern") domain = "Space Research";
    if (domain === "Artificial Intelligence" || domain === "AI") domain = "Data Science";
    if (domain === "Finance" || domain === "Finance and Accounts" || domain === "Finance & Accounts") domain = "Venture Capital";

    const domainTasks = await DomainTask.find({ domain }).select("_id durationType").lean();
    const taskIds = domainTasks.map(t => t._id);
    const progressRecord = await StudentTaskProgress.findOne({ studentId: student._id, taskId: { $in: taskIds } }).lean();

    let durationType = student.v2DurationType || tenureToDurationType(student.tenure);
    if (progressRecord) {
        const matchingTask = domainTasks.find(t => String(t._id) === String(progressRecord.taskId));
        if (matchingTask) {
            durationType = matchingTask.durationType;
        }
    }

    if (!domain || !durationType) return { weeks: [], domain, durationType };

    let queryDurationType = durationType;
    let queryObj = { domain };

    if (durationType === "1week") {
        queryDurationType = "1month";
        queryObj.weekNumber = 1;
    } else if (durationType === "15days") {
        queryDurationType = "1month";
        queryObj.weekNumber = { $in: [1, 2] };
    }

    queryObj.durationType = queryDurationType;

    const [allTasks, progressList] = await Promise.all([
        DomainTask.find(queryObj).sort({ weekNumber: 1, _id: 1 }).lean(),
        StudentTaskProgress.find({ studentId: student._id, taskId: { $in: taskIds } }).lean()
    ]);

    const progressMap = {};
    for (const p of progressList) progressMap[p.taskId.toString()] = p;

    const weekMap = {};
    for (const task of allTasks) {
        const w = task.weekNumber;
        if (!weekMap[w]) weekMap[w] = { week: w, tasks: [], allApproved: false };
        const prog = progressMap[task._id.toString()];
        weekMap[w].tasks.push({
            _id:             task._id,
            taskTitle:       task.taskTitle,
            taskDescription: task.taskDescription,
            videoUrl:        task.videoUrl,
            coinReward:      task.coinReward,
            difficultyLevel: task.difficultyLevel,
            progressId:      prog ? prog._id : null,
            status:          prog ? prog.status : "locked",
            submissionUrl:   prog ? prog.submissionUrl : null,
            submissionNotes: prog ? prog.submissionNotes : null,
            coordinatorFeedback: prog ? prog.coordinatorFeedback : null,
            videoWatchedPercent: prog ? prog.videoWatchedPercent : 0,
            coinsAwarded:    prog ? prog.coinsAwarded : 0,
            submittedAt:     prog ? prog.submittedAt : null,
            approvedAt:      prog ? prog.approvedAt : null
        });
    }

    const weeks = Object.values(weekMap).map(w => {
        w.allApproved = w.tasks.every(t => t.status === "approved");
        w.anyAvailable = w.tasks.some(t => ["available","in_progress"].includes(t.status));
        w.completedCount = w.tasks.filter(t => t.status === "approved").length;
        w.totalCount = w.tasks.length;
        return w;
    });

    // Self-heal a stuck journey.
    //
    // Unlocking used to happen only at the moment a task was approved, and the
    // quiz path — how most students actually finish — did not do it. Students
    // were left looking at "Week 1: APPROVED" above "Complete Week 1 to
    // unlock", with no action available to them and no way to report it except
    // a screenshot.
    //
    // Repairing on read fixes everyone already stuck without a migration, and
    // costs one write only in the rare case where a week is finished and the
    // next is still shut.
    weeks.sort((a, b) => a.week - b.week);
    const stuck = [];
    for (let i = 0; i < weeks.length - 1; i++) {
        const next = weeks[i + 1];
        if (weeks[i].allApproved && next.totalCount && !next.anyAvailable && !next.allApproved) {
            stuck.push(next);
        }
    }
    if (stuck.length) {
        const ids = stuck.flatMap(w => w.tasks.filter(t => t.status === "locked").map(t => t._id));
        if (ids.length) {
            await StudentTaskProgress.updateMany(
                { studentId: student._id, taskId: { $in: ids }, status: "locked" },
                { $set: { status: "available" } }
            );
            for (const w of stuck) {
                w.tasks.forEach(t => { if (t.status === "locked") t.status = "available"; });
                w.anyAvailable = true;
            }
        }
    }

    return { weeks, domain, durationType };
}

module.exports = { assignTasksForStudent, resyncTasksForStudent, resolveTaskScope, tryUnlockNextWeek, approveTask, getStudentTasks, tenureToDurationType, resolveStudentDuration };
