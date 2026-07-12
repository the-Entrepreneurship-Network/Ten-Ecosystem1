'use strict';

/**
 * Factory that produces the five standard profile-CRUD handlers
 * (createOrUpdate, getMyProfile, getDirectory, getPublicProfile, updateVerificationStatus)
 * from a per-role configuration object.
 *
 * Eliminates ~400 lines of near-identical code across
 * founderProfileController, investorProfileController, and mentorProfileController.
 */

const { VERIFY_ROLES }       = require('../config/roles');
const { createNotification } = require('../utils/notificationHelper');
const { trimFields }         = require('../utils/sanitize');
const { parsePagination, paginatedResponse } = require('../utils/pagination');

/**
 * @param {object} cfg
 * @param {import('mongoose').Model}  cfg.Model           - Mongoose model (e.g. FounderProfile)
 * @param {string}                    cfg.roleName        - Human-readable role name ('founder')
 * @param {string[]}                  cfg.sanitizeFields  - Fields to trim
 * @param {Function}                  cfg.buildDirFilter  - (query) => filter object for directory
 * @param {object}                    [cfg.dirSort]       - Sort object for directory (default: { createdAt: -1 })
 * @param {string}                    [cfg.visibleField]  - Field name for public visibility (e.g. 'isActive', 'isVisible')
 * @param {string}                    [cfg.approvedType]  - Notification type on approval
 */
function createProfileController(cfg) {
  const {
    Model,
    roleName,
    sanitizeFields,
    buildDirFilter,
    dirSort = { createdAt: -1 },
    visibleField,
    approvedType,
  } = cfg;

  const controllerTag = `${roleName}ProfileController`;

  async function createOrUpdateProfile(req, res) {
    try {
      const userId   = req.user._id || req.user.id;
      const data     = trimFields(req.body, sanitizeFields);
      const existing = await Model.findOne({ userId });
      let profile, statusCode;
      if (existing) {
        Object.assign(existing, data);
        profile    = await existing.save();
        statusCode = 200;
      } else {
        profile    = await Model.create({ ...data, userId });
        statusCode = 201;
        await createNotification({
          userId,
          type:    'system_announcement',
          title:   'Profile Under Review',
          message: `Your ${roleName} profile has been submitted for verification.`,
        });
      }
      return res.status(statusCode).json({
        success: true,
        data:    profile,
        message: statusCode === 201 ? 'Profile created.' : 'Profile updated.',
      });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ success: false, error: 'Profile already exists.' });
      console.error(`[${controllerTag}.createOrUpdateProfile]`, err.message);
      return res.status(500).json({ success: false, error: 'Could not save profile.' });
    }
  }

  async function getMyProfile(req, res) {
    try {
      const userId  = req.user._id || req.user.id;
      const profile = await Model.findOne({ userId }).populate('userId', 'fullName email');
      if (!profile) return res.status(404).json({ success: false, error: 'Profile not found. Create one first.' });
      return res.status(200).json({ success: true, data: profile });
    } catch (err) {
      console.error(`[${controllerTag}.getMyProfile]`, err.message);
      return res.status(500).json({ success: false, error: 'Could not fetch profile.' });
    }
  }

  async function getDirectory(req, res) {
    try {
      const { page, limit, skip } = parsePagination(req.query);
      const filter = buildDirFilter(req.query);

      const [data, total] = await Promise.all([
        Model.find(filter)
          .populate('userId', 'fullName role')
          .sort(dirSort)
          .skip(skip)
          .limit(limit)
          .lean(),
        Model.countDocuments(filter),
      ]);

      return res.status(200).json(paginatedResponse({ page, limit, total, data }));
    } catch (err) {
      console.error(`[${controllerTag}.getDirectory]`, err.message);
      return res.status(500).json({ success: false, error: 'Could not fetch directory.' });
    }
  }

  async function getPublicProfile(req, res) {
    try {
      const query = { userId: req.params.userId, verificationStatus: 'approved' };
      if (visibleField) query[visibleField] = true;

      const profile = await Model.findOne(query).populate('userId', 'fullName email role');
      if (!profile) return res.status(404).json({ success: false, error: 'Profile not found.' });

      await Model.findByIdAndUpdate(profile._id, { $inc: { profileViews: 1 } });
      return res.status(200).json({ success: true, data: profile });
    } catch (err) {
      console.error(`[${controllerTag}.getPublicProfile]`, err.message);
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
      if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Invalid status.' });
      }
      const profile = await Model.findOne({ userId: req.params.userId });
      if (!profile) return res.status(404).json({ success: false, error: 'Profile not found.' });

      profile.verificationStatus = status;
      profile.verifiedBy         = req.user._id || req.user.id;
      profile.verifiedAt         = new Date();
      if (status === 'rejected' && rejectionReason) profile.rejectionReason = rejectionReason;
      await profile.save();

      if (status === 'approved') {
        await createNotification({
          userId:  profile.userId,
          type:    approvedType || `${roleName}_approved`,
          title:   'Profile Approved!',
          message: `Your ${roleName} profile is now live in the directory.`,
        });
      } else {
        await createNotification({
          userId:  profile.userId,
          type:    'profile_rejected',
          title:   'Profile Not Approved',
          message: `Your ${roleName} profile was not approved. Reason: ${rejectionReason || 'No reason given.'}`,
        });
      }
      return res.status(200).json({ success: true, data: profile, message: 'Status updated.' });
    } catch (err) {
      console.error(`[${controllerTag}.updateVerificationStatus]`, err.message);
      return res.status(500).json({ success: false, error: 'Could not update status.' });
    }
  }

  return {
    createOrUpdateProfile,
    getMyProfile,
    getDirectory,
    getPublicProfile,
    updateVerificationStatus,
  };
}

module.exports = { createProfileController };
