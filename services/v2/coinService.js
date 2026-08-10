// NEW FEATURE: Coin Award Service
"use strict";

const StudentCoin  = require("../../models/new/StudentCoin");
const StudentCoinModel = StudentCoin;

// FEATURE 8 — Updated coin structure: 100 Coins = ₹50 (1 Coin = ₹0.50)
const COIN_ACTIONS = {
    // Task rewards by difficulty
    TASK_APPROVED_EASY:    ()      => ({ label: "Easy task approved",           coins: 20  }),
    TASK_APPROVED_MEDIUM:  ()      => ({ label: "Medium task approved",         coins: 30  }),
    TASK_APPROVED_HARD:    ()      => ({ label: "Hard task approved",           coins: 40  }),
    TASK_APPROVED_EXPERT:  ()      => ({ label: "Expert task approved",         coins: 100 }),
    TASK_APPROVED:         (coins) => ({ label: "Task approved",                coins      }),

    // Quiz rewards
    QUIZ_PASSED_FIRST:     ()      => ({ label: "Quiz passed (first attempt)",  coins: 50  }),
    QUIZ_PASSED_RETRY:     ()      => ({ label: "Quiz passed (retry)",          coins: 25  }),

    // Daily job posting
    DJP_1_2_PLATFORMS:     ()      => ({ label: "Job post: 1-2 platforms",      coins: 5   }),
    DJP_3_5_PLATFORMS:     ()      => ({ label: "Job post: 3-5 platforms",      coins: 10  }),
    DJP_6_PLUS_PLATFORMS:  ()      => ({ label: "Job post: 6+ platforms",       coins: 15  }),
    DJP_FORM_BONUS:        ()      => ({ label: "Job post: tracking form bonus", coins: 3   }),

    // Attendance
    ATTENDANCE_DAILY:      ()      => ({ label: "Daily attendance",             coins: 5   }),
    ATTENDANCE_7D_STREAK:  ()      => ({ label: "7-day attendance streak",      coins: 50  }),
    ATTENDANCE_30D_STREAK: ()      => ({ label: "30-day attendance streak",     coins: 200 }),

    // Milestones
    ONBOARD_BONUS:         ()      => ({ label: "Onboarding completed",         coins: 20  }),
    TASK_FIRST:            ()      => ({ label: "First task submitted bonus",   coins: 10  }),
    WEEK_COMPLETE:         (week)  => ({ label: `Week ${week} all tasks done`,  coins: 30  }),
    COURSE_COMPLETE:       ()      => ({ label: "Course completed!",            coins: 500 }),

    // Streaks
    LOGIN_STREAK_7D:       ()      => ({ label: "7-day login streak",           coins: 25  }),
    LOGIN_STREAK_30D:      ()      => ({ label: "30-day login streak",          coins: 100 }),

    // Legacy
    VIDEO_WATCHED:         ()      => ({ label: "Video watched",                coins: 5   }),
    STREAK_BONUS:          (days)  => ({ label: `${days}-day streak bonus`,     coins: days >= 7 ? 30 : 10 }),
};

/**
 * Award coins to a student.
 */
async function awardCoins(studentId, action, actionArg) {
    const entry = COIN_ACTIONS[action] ? COIN_ACTIONS[action](actionArg) : { label: action, coins: actionArg || 0 };
    if (!entry.coins || entry.coins <= 0) return { totalCoins: 0, awarded: 0 };

    let coinDoc = await StudentCoinModel.findOne({ studentId });
    if (!coinDoc) {
        coinDoc = new StudentCoinModel({
            studentId,
            totalCoins: 250,
            coinsHistory: [{ action: "Welcome Bonus Coins", coins: 250, timestamp: new Date() }]
        });
    }

    coinDoc.totalCoins += entry.coins;
    coinDoc.coinsHistory.push({
        action: entry.label,
        coins: entry.coins,
        timestamp: new Date()
    });
    coinDoc.lastUpdated = new Date();
    await coinDoc.save();

    return { totalCoins: coinDoc.totalCoins, awarded: entry.coins };
}

/**
 * Get coin balance and rupee value. Rate: 100 coins = ₹50 (1 coin = ₹0.50)
 */
async function getBalance(studentId) {
    const doc = await StudentCoinModel.findOne({ studentId }).lean();
    if (!doc) return { totalCoins: 0, coinsHistory: [], rupeeValue: "0.00" };
    const history = [...(doc.coinsHistory || [])].reverse().slice(0, 50);
    const rupeeValue = (doc.totalCoins * 0.5).toFixed(2);
    return { totalCoins: doc.totalCoins, coinsHistory: history, rupeeValue };
}

/**
 * Convert coin count to rupee value string.
 */
function coinsToRupees(coins) {
    return (coins * 0.5).toFixed(2);
}

module.exports = { awardCoins, getBalance, COIN_ACTIONS, coinsToRupees };
