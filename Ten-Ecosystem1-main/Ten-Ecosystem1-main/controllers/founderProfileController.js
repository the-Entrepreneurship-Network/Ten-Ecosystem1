'use strict';

const FounderProfile = require('../models/FounderProfile');
const { createNotification } = require('../utils/notificationHelper');
const { ROLES } = require('../config/roles');

const VERIFY_ROLES = [ROLES.ADMIN, ROLES.HR, ROLES.COORDINATOR];

function sanitize(obj) {
  const out = { ...obj };
  ['startupName','tagline','description','website','pitchDeckUrl','logoUrl','location','rejectionReason'].forEach(f => {
    if (typeof out[f] === 'string') out[f] = out[f].trim();
  });
  return out;
}

async function createOrUpdateProfile(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const data   = sanitize(req.body);
    const existing = await FounderProfile.findOne({ userId });
    let profile, statusCode;
    if (existing) {
      Object.assign(existing, data);
      profile    = await existing.save();
      statusCode = 200;
    } else {
      profile    = await FounderProfile.create({ ...data, userId });
      statusCode = 201;
      await createNotification({
        userId,
        type:    'system_announcement',
        title:   'Profile Under Review',
        message: 'Your founder profile has been submitted for verification.'
      });
    }
    return res.status(statusCode).json({ success: true, data: profile, message: statusCode === 201 ? 'Profile created.' : 'Profile updated.' });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, error: 'Profile already exists.' });
    console.error('[founderProfileController.createOrUpdateProfile]', err.message);
    return res.status(500).json({ success: false, error: 'Could not save profile.' });
  }
}

async function getMyProfile(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const profile = await FounderProfile.findOne({ userId }).populate('userId', 'fullName email');
    if (!profile) return res.status(404).json({ success: false, error: 'Profile not found. Create one first.' });
    return res.status(200).json({ success: true, data: profile });
  } catch (err) {
    console.error('[founderProfileController.getMyProfile]', err.message);
    return res.status(500).json({ success: false, error: 'Could not fetch profile.' });
  }
}

async function getFounderDirectory(req, res) {
  try {
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, parseInt(req.query.limit, 10) || 12);
    const skip  = (page - 1) * limit;
    const filter = { verificationStatus: 'approved', isActive: true };

    if (req.query.industry)      filter.industry      = req.query.industry;
    if (req.query.stage)         filter.stage         = req.query.stage;
    if (req.query.fundingStatus) filter.fundingStatus = req.query.fundingStatus;
    if (req.query.lookingFor)    filter.lookingFor     = { $in: [req.query.lookingFor] };
    if (req.query.search) {
      filter.startupName = { $regex: req.query.search.trim(), $options: 'i' };
    }

    const [data, total] = await Promise.all([
      FounderProfile.find(filter)
        .populate('userId', 'fullName role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      FounderProfile.countDocuments(filter)
    ]);

    return res.status(200).json({ success: true, data, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[founderProfileController.getFounderDirectory]', err.message);
    return res.status(500).json({ success: false, error: 'Could not fetch directory.' });
  }
}

async function getFounderProfile(req, res) {
  try {
    const profile = await FounderProfile.findOne({
      userId: req.params.userId,
      verificationStatus: 'approved'
    }).populate('userId', 'fullName email role');
    if (!profile) return res.status(404).json({ success: false, error: 'Profile not found.' });
    profile.profileViews = (profile.profileViews || 0) + 1;
    await FounderProfile.findByIdAndUpdate(profile._id, { $inc: { profileViews: 1 } });
    return res.status(200).json({ success: true, data: profile });
  } catch (err) {
    console.error('[founderProfileController.getFounderProfile]', err.message);
    return res.status(500).json({ success: false, error: 'Could not fetch profile.' });
  }
}

async function updateVerificationStatus(req, res) {
  try {
    const role = req.user.role;
    if (!VERIFY_ROLES.includes(role)) {
      return res.status(403).json({ success: false, error: 'Access denied.' });
    }
    const { status, rejectionReason } = req.body;
    if (!['approved','rejected'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status.' });
    }
    const profile = await FounderProfile.findOne({ userId: req.params.userId });
    if (!profile) return res.status(404).json({ success: false, error: 'Profile not found.' });

    profile.verificationStatus = status;
    profile.verifiedBy         = req.user._id || req.user.id;
    profile.verifiedAt         = new Date();
    if (status === 'rejected' && rejectionReason) profile.rejectionReason = rejectionReason;
    await profile.save();

    if (status === 'approved') {
      await createNotification({
        userId:  profile.userId,
        type:    'founder_approved',
        title:   'Profile Approved!',
        message: 'Your founder profile is now live in the directory.'
      });
    } else {
      await createNotification({
        userId:  profile.userId,
        type:    'profile_rejected',
        title:   'Profile Not Approved',
        message: 'Your founder profile was not approved. Reason: ' + (rejectionReason || 'No reason given.')
      });
    }
    return res.status(200).json({ success: true, data: profile, message: 'Status updated.' });
  } catch (err) {
    console.error('[founderProfileController.updateVerificationStatus]', err.message);
    return res.status(500).json({ success: false, error: 'Could not update status.' });
  }
}

module.exports = { createOrUpdateProfile, getMyProfile, getFounderDirectory, getFounderProfile, updateVerificationStatus };
