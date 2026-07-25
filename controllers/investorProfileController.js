'use strict';

const InvestorProfile = require('../models/InvestorProfile');
const { createNotification } = require('../utils/notificationHelper');
const { ROLES } = require('../config/roles');

const VERIFY_ROLES = [ROLES.ADMIN, ROLES.HR, ROLES.COORDINATOR];

function sanitize(obj) {
  const out = { ...obj };
  ['fundName','bio','thesis','linkedinUrl','website','contactEmail'].forEach(f => {
    if (typeof out[f] === 'string') out[f] = out[f].trim();
  });
  return out;
}

async function createOrUpdateProfile(req, res) {
  try {
    const userId   = req.user._id || req.user.id;
    const data     = sanitize(req.body);
    const existing = await InvestorProfile.findOne({ userId });
    let profile, statusCode;
    if (existing) {
      Object.assign(existing, data);
      profile    = await existing.save();
      statusCode = 200;
    } else {
      profile    = await InvestorProfile.create({ ...data, userId });
      statusCode = 201;
      await createNotification({
        userId,
        type:    'system_announcement',
        title:   'Profile Under Review',
        message: 'Your investor profile has been submitted for verification.'
      });
    }
    return res.status(statusCode).json({ success: true, data: profile, message: statusCode === 201 ? 'Profile created.' : 'Profile updated.' });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, error: 'Profile already exists.' });
    console.error('[investorProfileController.createOrUpdateProfile]', err.message);
    return res.status(500).json({ success: false, error: 'Could not save profile.' });
  }
}

async function getMyProfile(req, res) {
  try {
    const userId  = req.user._id || req.user.id;
    const profile = await InvestorProfile.findOne({ userId }).populate('userId', 'fullName email');
    if (!profile) return res.status(404).json({ success: false, error: 'Profile not found. Create one first.' });
    return res.status(200).json({ success: true, data: profile });
  } catch (err) {
    console.error('[investorProfileController.getMyProfile]', err.message);
    return res.status(500).json({ success: false, error: 'Could not fetch profile.' });
  }
}

async function getInvestorDirectory(req, res) {
  try {
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, parseInt(req.query.limit, 10) || 12);
    const skip  = (page - 1) * limit;
    const filter = { verificationStatus: 'approved', isVisible: true };

    if (req.query.investorType)      filter.investorType      = req.query.investorType;
    if (req.query.stagePreference)   filter.stagePreference   = { $in: [req.query.stagePreference] };
    if (req.query.sectorFocus)       filter.sectorFocus       = { $in: [req.query.sectorFocus] };
    if (req.query.minPortfolioSize)  filter.portfolioSize     = { $gte: parseInt(req.query.minPortfolioSize, 10) };
    if (req.query.search) {
      filter.$or = [
        { fundName: { $regex: req.query.search.trim(), $options: 'i' } },
        { bio:      { $regex: req.query.search.trim(), $options: 'i' } }
      ];
    }

    const [data, total] = await Promise.all([
      InvestorProfile.find(filter)
        .populate('userId', 'fullName role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      InvestorProfile.countDocuments(filter)
    ]);

    return res.status(200).json({ success: true, data, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[investorProfileController.getInvestorDirectory]', err.message);
    return res.status(500).json({ success: false, error: 'Could not fetch directory.' });
  }
}

async function getInvestorProfile(req, res) {
  try {
    const profile = await InvestorProfile.findOne({
      userId: req.params.userId,
      verificationStatus: 'approved',
      isVisible: true
    }).populate('userId', 'fullName email role');
    if (!profile) return res.status(404).json({ success: false, error: 'Profile not found.' });
    await InvestorProfile.findByIdAndUpdate(profile._id, { $inc: { profileViews: 1 } });
    return res.status(200).json({ success: true, data: profile });
  } catch (err) {
    console.error('[investorProfileController.getInvestorProfile]', err.message);
    return res.status(500).json({ success: false, error: 'Could not fetch profile.' });
  }
}

async function updateVerificationStatus(req, res) {
  try {
    const role = req.user.role;
    if (!VERIFY_ROLES.includes(role)) return res.status(403).json({ success: false, error: 'Access denied.' });
    const { status, rejectionReason } = req.body;
    if (!['approved','rejected'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status.' });

    const profile = await InvestorProfile.findOne({ userId: req.params.userId });
    if (!profile) return res.status(404).json({ success: false, error: 'Profile not found.' });

    profile.verificationStatus = status;
    profile.verifiedBy         = req.user._id || req.user.id;
    profile.verifiedAt         = new Date();
    if (status === 'rejected' && rejectionReason) profile.rejectionReason = rejectionReason;
    await profile.save();

    if (status === 'approved') {
      await createNotification({
        userId:  profile.userId,
        type:    'investor_approved',
        title:   'Profile Approved!',
        message: 'Your investor profile is now live in the directory.'
      });
    } else {
      await createNotification({
        userId:  profile.userId,
        type:    'profile_rejected',
        title:   'Profile Not Approved',
        message: 'Your investor profile was not approved. Reason: ' + (rejectionReason || 'No reason given.')
      });
    }
    return res.status(200).json({ success: true, data: profile, message: 'Status updated.' });
  } catch (err) {
    console.error('[investorProfileController.updateVerificationStatus]', err.message);
    return res.status(500).json({ success: false, error: 'Could not update status.' });
  }
}

module.exports = { createOrUpdateProfile, getMyProfile, getInvestorDirectory, getInvestorProfile, updateVerificationStatus };
