'use strict';

const EcosystemUser         = require('../models/EcosystemUser');
const TalentProfile         = require('../models/TalentProfile');
const FounderProfile        = require('../models/FounderProfile');
const MentorProfile         = require('../models/MentorProfile');
const InvestorProfile       = require('../models/InvestorProfile');
const EcosystemNotification = require('../models/EcosystemNotification');
const PaymentTransaction    = require('../models/PaymentTransaction');
const { ROLES }             = require('../config/roles');

const ALLOWED_ROLES = [ROLES.ADMIN, ROLES.HR, ROLES.COORDINATOR];

async function getEcosystemOverview(req, res) {
  try {
    if (!ALLOWED_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    const now          = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const [
      totalUsers, newUsersThisMonth,
      pendingTalent, approvedTalent,
      pendingFounders, approvedFounders,
      pendingMentors, approvedMentors,
      pendingInvestors, approvedInvestors,
      unreadNotifications,
      recentPayments
    ] = await Promise.all([
      EcosystemUser.countDocuments(),
      EcosystemUser.countDocuments({ createdAt: { $gte: startOfMonth } }),
      TalentProfile.countDocuments({ verificationStatus: 'pending' }),
      TalentProfile.countDocuments({ verificationStatus: 'approved' }),
      FounderProfile.countDocuments({ verificationStatus: 'pending' }),
      FounderProfile.countDocuments({ verificationStatus: 'approved' }),
      MentorProfile.countDocuments({ verificationStatus: 'pending' }),
      MentorProfile.countDocuments({ verificationStatus: 'approved' }),
      InvestorProfile.countDocuments({ verificationStatus: 'pending' }),
      InvestorProfile.countDocuments({ verificationStatus: 'approved' }),
      EcosystemNotification.countDocuments({ isRead: false }),
      PaymentTransaction.find({}).sort({ createdAt: -1 }).limit(5).lean()
    ]);

    const userGrowthData = await EcosystemUser.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      { $group: {
        _id:   { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
        count: { $sum: 1 }
      }},
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    return res.status(200).json({
      success: true,
      stats: {
        users:     { total: totalUsers, newThisMonth: newUsersThisMonth },
        talent:    { pending: pendingTalent,    approved: approvedTalent },
        founders:  { pending: pendingFounders,  approved: approvedFounders },
        mentors:   { pending: pendingMentors,   approved: approvedMentors },
        investors: { pending: pendingInvestors, approved: approvedInvestors },
        notifications: { unread: unreadNotifications }
      },
      recentActivity: { applications: [], payments: recentPayments },
      charts: { userGrowth: userGrowthData }
    });
  } catch (err) {
    console.error('[hrDashboardController.getEcosystemOverview]', err.message);
    return res.status(500).json({ success: false, error: 'Could not fetch overview.' });
  }
}

module.exports = { getEcosystemOverview };
