'use strict';

/**
 * @fileoverview Multi-role registration hub controller.
 * Routes new signups to appropriate existing flows.
 * Does NOT break or bypass the existing /register endpoint.
 */

const path          = require('path');
const bcrypt        = require('bcryptjs');
const EcosystemUser = require('../models/EcosystemUser');
const Student       = require('../models/Student');
const HR            = require('../models/HR');
const Coordinator   = require('../models/Coordinator');
const TalentProfile = require('../models/TalentProfile');

// New profile models
const StudentProfile     = require('../models/StudentProfile');
const FounderProfile     = require('../models/FounderProfile');
const MentorProfile      = require('../models/MentorProfile');
const InvestorProfile     = require('../models/InvestorProfile');
const ContractorProfile   = require('../models/ContractorProfile');
const StartupProfile      = require('../models/StartupProfile');
const CommunityProfile    = require('../models/CommunityProfile');

const { ALL_ROLES, ROLES } = require('../config/roles');

const SALT_ROUNDS     = 10;
const ECOSYSTEM_ROLES = [ROLES.FOUNDER, ROLES.MENTOR, ROLES.INVESTOR, ROLES.CONTRACTOR, ROLES.STUDENT];

const ROLE_CONFIG = [
  {
    id: ROLES.STUDENT, label: 'Student',
    description: 'Join as an intern and kickstart your career', icon: '🎓',
    fields: [
      { name: 'mobile', type: 'text', label: 'Mobile', placeholder: 'Your mobile number', required: true },
      { name: 'country', type: 'text', label: 'Country', placeholder: 'Your country', required: true },
      { name: 'state', type: 'text', label: 'State', placeholder: 'Your state', required: true },
      { name: 'city', type: 'text', label: 'City', placeholder: 'Your city', required: true },
      { name: 'university', type: 'text', label: 'University / College', placeholder: 'Your university', required: true },
      { name: 'degree', type: 'text', label: 'Degree', placeholder: 'e.g. B.Tech Computer Science', required: true },
      { name: 'graduationYear', type: 'number', label: 'Graduation Year', placeholder: 'e.g. 2026', required: true },
      { name: 'skills', type: 'text', label: 'Skills (comma-separated)', placeholder: 'e.g. HTML, CSS, React', required: true },
      { name: 'resume', type: 'text', label: 'Resume Link', placeholder: 'Link to your resume', required: false },
      { name: 'linkedin', type: 'url', label: 'LinkedIn URL', placeholder: 'https://linkedin.com/in/...', required: false },
      { name: 'portfolio', type: 'url', label: 'Portfolio URL', placeholder: 'https://...', required: false },
    ],
  },
  {
    id: ROLES.FOUNDER, label: 'Founder',
    description: 'Run your venture and hire top talent', icon: '🚀',
    fields: [
      { name: 'mobile', type: 'text', label: 'Mobile', placeholder: 'Your mobile number', required: true },
      { name: 'startupName', type: 'text', label: 'Startup Name', placeholder: 'Your startup name', required: true },
      { name: 'industry', type: 'text', label: 'Industry', placeholder: 'e.g. FinTech, EdTech', required: true },
      { name: 'stage', type: 'select', label: 'Startup Stage', options: ['Idea', 'Validation', 'MVP', 'Early Revenue', 'Growth', 'Scaling'], required: true },
      { name: 'teamSize', type: 'number', label: 'Team Size', placeholder: 'e.g. 5', required: true },
      { name: 'website', type: 'url', label: 'Website', placeholder: 'https://...', required: false },
      { name: 'linkedin', type: 'url', label: 'LinkedIn', placeholder: 'Startup LinkedIn URL', required: false },
      { name: 'revenue', type: 'text', label: 'Monthly Revenue (₹)', placeholder: 'e.g. ₹50,000 or N/A', required: false },
      { name: 'fundingStage', type: 'select', label: 'Funding Stage', options: ['Bootstrapped', 'Pre-seed', 'Seed', 'Series A', 'Series B', 'Profitable'], required: true },
      { name: 'description', type: 'text', label: 'Startup Description', placeholder: 'Brief description of your startup', required: true },
      { name: 'goals', type: 'text', label: 'Founder Goals (comma-separated)', placeholder: 'e.g. Hire Talent, Build MVP, Raise Funding', required: true }
    ],
  },
  {
    id: ROLES.MENTOR, label: 'Mentor',
    description: 'Guide founders and students with your expertise', icon: '🧑‍🏫',
    fields: [
      { name: 'mobile', type: 'text', label: 'Mobile', placeholder: 'Your mobile number', required: true },
      { name: 'company', type: 'text', label: 'Company', placeholder: 'Your active company', required: true },
      { name: 'designation', type: 'text', label: 'Designation', placeholder: 'Your title / role', required: true },
      { name: 'experience', type: 'number', label: 'Years of Experience', placeholder: 'e.g. 8', required: true },
      { name: 'linkedin', type: 'url', label: 'LinkedIn URL', placeholder: 'https://linkedin.com/in/...', required: true },
      { name: 'expertiseAreas', type: 'text', label: 'Expertise Areas (comma-separated)', placeholder: 'e.g. Sales, Product Management, Coding', required: true }
    ],
  },
  {
    id: ROLES.INVESTOR, label: 'Investor',
    description: 'Discover and invest in promising startups', icon: '💰',
    fields: [
      { name: 'mobile', type: 'text', label: 'Mobile', placeholder: 'Your mobile number', required: true },
      { name: 'firmName', type: 'text', label: 'Firm Name / Individual', placeholder: 'Your firm name', required: true },
      { name: 'fundSize', type: 'text', label: 'Fund Size (₹)', placeholder: 'e.g. ₹5 Crore or N/A', required: true },
      { name: 'investmentStage', type: 'select', label: 'Investment Stage Preference', options: ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Growth'], required: true },
      { name: 'industryFocus', type: 'text', label: 'Industry Focus (comma-separated)', placeholder: 'e.g. SaaS, FinTech, AI', required: true },
      { name: 'website', type: 'url', label: 'Website', placeholder: 'https://...', required: false }
    ],
  },
  {
    id: ROLES.CONTRACTOR, label: 'Contractor',
    description: 'Offer your skills as a freelance contractor', icon: '🔧',
    fields: [
      { name: 'mobile', type: 'text', label: 'Mobile', placeholder: 'Your mobile number', required: true },
      { name: 'skills', type: 'text', label: 'Skills (comma-separated)', placeholder: 'e.g. React, Node, Web3', required: true },
      { name: 'experience', type: 'text', label: 'Experience Details', placeholder: 'e.g. 4 years freelancing', required: true },
      { name: 'portfolio', type: 'url', label: 'Portfolio URL', placeholder: 'https://...', required: false },
      { name: 'hourlyRate', type: 'number', label: 'Hourly Rate (₹)', placeholder: 'e.g. 1200', required: true },
      { name: 'availability', type: 'select', label: 'Availability', options: ['Immediately', 'In 2 weeks', 'In 1 month'], required: true }
    ],
  },
  {
    id: ROLES.HR, label: 'HR',
    description: 'Manage internship programs for your company', icon: '💼',
    fields: [
      { name: 'company',     type: 'text', label: 'Company Name', placeholder: 'Your company',                 required: true },
      { name: 'designation', type: 'text', label: 'Designation',  placeholder: 'Job title',                   required: false },
      { name: 'linkedinUrl', type: 'url',  label: 'LinkedIn URL', placeholder: 'https://linkedin.com/in/...', required: false },
    ],
  },
  {
    id: ROLES.COORDINATOR, label: 'Coordinator',
    description: 'Coordinate interns across your department', icon: '🗂️',
    fields: [
      { name: 'department',  type: 'text', label: 'Department',  placeholder: 'Your department', required: true },
      { name: 'institution', type: 'text', label: 'Institution', placeholder: 'Your institution', required: false },
    ],
  },
];

function getHub(req, res) {
  return res.sendFile(path.join(__dirname, '..', 'public', 'register-hub.html'));
}

function getRoleConfig(req, res) {
  return res.status(200).json({ success: true, roles: ROLE_CONFIG });
}

// Helper to generate legacy Employee ID
async function generateEmployeeId(domain) {
  const domainShortCodes = {
    "DevOps with AWS":          "DEVOPS",
    "Python Development":       "PY",
    "Java Development":         "JAVA",
    "Web Development":          "WEB",
    "MERN Stack Development":   "MERN",
    "MERN Stack Dev":           "MERN",
    "Artificial Intelligence":  "AI",
    "Data Science":             "DS",
    "Cyber Security":           "CYBER",
    "Software Engineering":     "SDE",
    "Flutter Development":      "FLUTTER",
    "HR Management":            "HRMGMT",
    "Venture Capital":           "VC",
    "Vibe Coding":               "VIBE",
    "Space Research":            "SPACE",
    "Business Analyst":          "BA",
    "HR":                        "HR",
    "Business Development":      "BD",
    "Space Intern":              "SPACE",
    "Finance":                   "FIN",
    "Machine Learning":          "ML",
    "Android":                   "AND",
    "UI/UX":                     "UIUX",
    "Digital Marketing":         "MKTG",
    "General":                   "GEN"
  };
  const shortCode = domainShortCodes[domain] || "GEN";
  const totalStudents = await Student.countDocuments();
  const sequenceNumber = 1001 + totalStudents;
  return `TEN/${shortCode}/${sequenceNumber}`;
}

async function registerUser(req, res) {
  try {
    const { fullName, email, password, role, roleSpecificData = {} } = req.body;
    const name = fullName || req.body.name;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'Full name must be at least 2 characters.' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Valid email is required.' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
    }
    if (req.body.confirmPassword && req.body.confirmPassword !== password) {
      return res.status(400).json({ success: false, error: 'Password and Confirm Password do not match.' });
    }
    if (!role || !ALL_ROLES.includes(role)) {
      return res.status(400).json({ success: false, error: `role must be one of: ${ALL_ROLES.join(', ')}` });
    }

    // Role specific mandatory field validations for Student
    if (role === ROLES.STUDENT) {
      const mobile = roleSpecificData.mobile || req.body.mobile;
      if (!mobile || !/^\+?[0-9]{10,15}$/.test(mobile.replace(/[\s-]/g, ''))) {
        return res.status(400).json({ success: false, error: 'Valid 10+ digit mobile number is required.' });
      }
      if (!roleSpecificData.country || !roleSpecificData.state || !roleSpecificData.city) {
        return res.status(400).json({ success: false, error: 'Country, State, and City selection are mandatory.' });
      }
      if (!roleSpecificData.university || !roleSpecificData.degree || !roleSpecificData.academicYear) {
        return res.status(400).json({ success: false, error: 'College/University, Degree, and Academic Year are mandatory.' });
      }
      if (!roleSpecificData.skills || (typeof roleSpecificData.skills === 'string' && !roleSpecificData.skills.trim())) {
        return res.status(400).json({ success: false, error: 'At least one skill is required.' });
      }
      if (!roleSpecificData.portfolio || !/^https?:\/\/.+\..+/.test(roleSpecificData.portfolio.trim())) {
        return res.status(400).json({ success: false, error: 'Valid Portfolio URL is mandatory (e.g. https://myportfolio.com).' });
      }
      if (!roleSpecificData.linkedin || !/^https?:\/\/(www\.)?linkedin\.com\/.+/.test(roleSpecificData.linkedin.trim())) {
        return res.status(400).json({ success: false, error: 'Valid LinkedIn profile URL is mandatory.' });
      }
      if (roleSpecificData.resume && typeof roleSpecificData.resume === 'string') {
        const resumePath = roleSpecificData.resume.toLowerCase();
        if (!resumePath.endsWith('.pdf') && !resumePath.includes('pdf')) {
          return res.status(400).json({ success: false, error: 'Resume must strictly be a PDF file.' });
        }
      }
    }

    const trimmedEmail = email.toLowerCase().trim();

    const [existingEco, existingStudent, existingHR, existingCoord] = await Promise.all([
      EcosystemUser.findOne({ email: trimmedEmail }),
      Student.findOne({ email: trimmedEmail }),
      HR.findOne({ email: trimmedEmail }),
      Coordinator.findOne({ email: trimmedEmail }),
    ]);

    if (existingEco || existingStudent || existingHR || existingCoord) {
      return res.status(409).json({ 
        success: false, 
        message: 'Email already registered. Please login.',
        error: 'Email already registered. Please login.' 
      });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // 1. Create central user account in users (EcosystemUser)
    const user = await EcosystemUser.create({
      fullName: name.trim(),
      email:    trimmedEmail,
      password: hashedPassword,
      role:     role,
      phone:    roleSpecificData.mobile || "",
      isVerified: role === ROLES.MENTOR ? false : true
    });

    let genMemberId = '';
    // Generate sequential Member IDs for Ecosystem Profiles
    if (role === ROLES.STUDENT) {
      const studentCount = await StudentProfile.countDocuments();
      genMemberId = `TEN-STU-${String(studentCount + 1).padStart(6, '0')}`;
    } else if (role === ROLES.FOUNDER) {
      const founderCount = await FounderProfile.countDocuments();
      genMemberId = `TEN-FDR-${String(founderCount + 1).padStart(6, '0')}`;
    } else if (role === ROLES.MENTOR) {
      const mentorCount = await MentorProfile.countDocuments();
      genMemberId = `TEN-MTR-${String(mentorCount + 1).padStart(6, '0')}`;
    } else if (role === ROLES.INVESTOR) {
      const investorCount = await InvestorProfile.countDocuments();
      genMemberId = `TEN-INV-${String(investorCount + 1).padStart(6, '0')}`;
    } else if (role === ROLES.CONTRACTOR) {
      const contractorCount = await ContractorProfile.countDocuments();
      genMemberId = `TEN-CON-${String(contractorCount + 1).padStart(6, '0')}`;
    }

    // 2. Create Role-Specific Profiles in Separate collections/tables with Foreign Keys
    if (role === ROLES.STUDENT) {
      // Create student_profiles
      await StudentProfile.create({
        userId: user._id,
        memberId: genMemberId,
        fullName: name.trim(),
        email: trimmedEmail,
        mobile: roleSpecificData.mobile || "",
        country: roleSpecificData.country || "",
        state: roleSpecificData.state || "",
        city: roleSpecificData.city || "",
        university: roleSpecificData.university || "",
        degree: roleSpecificData.degree || "",
        graduationYear: String(roleSpecificData.graduationYear || ""),
        skills: roleSpecificData.skills ? roleSpecificData.skills.split(',').map(s => s.trim()).filter(Boolean) : [],
        resume: roleSpecificData.resume || "",
        linkedin: roleSpecificData.linkedin || "",
        portfolio: roleSpecificData.portfolio || "",
        verificationStatus: 'approved'
      });

      // BACKWARD COMPATIBILITY: also create legacy Student document in students collection
      let parsedDomains = [];
      if (roleSpecificData.domains && typeof roleSpecificData.domains === 'string') {
        parsedDomains = roleSpecificData.domains.split(',').map(d => d.trim()).filter(Boolean);
      }
      if (parsedDomains.length === 0) {
        parsedDomains = ['Web Development'];
      }
      const domain = parsedDomains[0];
      const employeeId = await generateEmployeeId(domain);
      const tenureValue = roleSpecificData.tenure || "1 Month";
      await Student.create({
        firstName: name.trim().split(' ')[0] || name.trim(),
        lastName: name.trim().split(' ').slice(1).join(' ') || "",
        name: name.trim(),
        email: trimmedEmail,
        whatsapp: roleSpecificData.mobile || "",
        password: hashedPassword,
        plainPassword: password,
        employeeId: employeeId,
        domain: domain,
        domains: parsedDomains,
        collegeName: roleSpecificData.university || "",
        college: roleSpecificData.university || "",
        tenure: tenureValue,
        joiningDate: new Date().toISOString().split('T')[0]
      });

      // Automatically create Talent Profile for students
      await TalentProfile.create({
        userId: user._id,
        headline: `${roleSpecificData.degree} Student at ${roleSpecificData.university}`,
        skills: roleSpecificData.skills ? roleSpecificData.skills.split(',').map(s => ({ name: s.trim(), level: 'intermediate' })).filter(x => x.name) : [],
        socialLinks: {
          linkedin: roleSpecificData.linkedin || "",
          github: "",
          twitter: "",
          website: roleSpecificData.portfolio || ""
        },
        visibility: 'public',
        isVerified: true
      });
    }

    else if (role === ROLES.FOUNDER) {
      // Normalize values to avoid Mongoose enum validation errors
      const industryEnumList = ['EdTech','FinTech','HealthTech','AgriTech','CleanTech','Logistics','E-Commerce','SaaS','Gaming','Media','Other'];
      let chosenIndustry = roleSpecificData.industry || "Other";
      const matchedInd = industryEnumList.find(i => i.toLowerCase() === chosenIndustry.toLowerCase().trim());
      chosenIndustry = matchedInd || "Other";

      const stageEnumList = ['idea','validation','mvp','early_revenue','growth','scaling'];
      let chosenStage = (roleSpecificData.stage || "idea").toLowerCase().trim().replace(/[-\s]+/g, '_');
      if (!stageEnumList.includes(chosenStage)) {
        chosenStage = "idea";
      }

      const fundingEnumList = ['bootstrapped','pre_seed','seed','series_a','series_b','profitable'];
      let chosenFunding = (roleSpecificData.fundingStage || "bootstrapped").toLowerCase().trim().replace(/[-\s]+/g, '_');
      if (!fundingEnumList.includes(chosenFunding)) {
        chosenFunding = "bootstrapped";
      }

      const allowedGoals = ['co_founder','developers','designers','marketers','investors','mentors','interns'];
      const rawGoals = roleSpecificData.goals ? roleSpecificData.goals.split(',') : [];
      const chosenLookingFor = [];
      rawGoals.forEach(g => {
        let clean = g.trim().toLowerCase().replace(/[-\s]+/g, '_');
        if (clean === 'hire_talent' || clean === 'interns') clean = 'interns';
        if (clean === 'build_mvp' || clean === 'developers') clean = 'developers';
        if (clean === 'raise_funding' || clean === 'investors') clean = 'investors';
        if (allowedGoals.includes(clean)) {
          if (!chosenLookingFor.includes(clean)) {
            chosenLookingFor.push(clean);
          }
        }
      });
      if (chosenLookingFor.length === 0) {
        chosenLookingFor.push('developers');
      }

      // Create founder_profiles
      await FounderProfile.create({
        userId: user._id,
        memberId: genMemberId,
        startupName: roleSpecificData.startupName || "My Startup",
        industry: chosenIndustry,
        stage: chosenStage,
        teamSize: roleSpecificData.teamSize || 1,
        fundingStatus: chosenFunding,
        website: roleSpecificData.website || "",
        description: roleSpecificData.description || "",
        location: "",
        lookingFor: chosenLookingFor,
        verificationStatus: 'approved'
      });

      // Create startup_profiles
      await StartupProfile.create({
        founderId: user._id,
        startupName: roleSpecificData.startupName || "My Startup",
        industry: chosenIndustry,
        stage: roleSpecificData.stage || "",
        teamSize: roleSpecificData.teamSize || 1,
        website: roleSpecificData.website || "",
        linkedin: roleSpecificData.linkedin || "",
        revenue: roleSpecificData.revenue || "",
        fundingStage: roleSpecificData.fundingStage || "",
        description: roleSpecificData.description || "",
        goals: roleSpecificData.goals ? roleSpecificData.goals.split(',').map(g => g.trim()).filter(Boolean) : []
      });
    }

    else if (role === ROLES.MENTOR) {
      // Create mentor_profiles
      await MentorProfile.create({
        userId: user._id,
        memberId: genMemberId,
        headline: `${roleSpecificData.designation} at ${roleSpecificData.company}`,
        linkedinUrl: roleSpecificData.linkedin || "",
        verificationStatus: 'pending'
      });

      // Automatically create Talent Profile for mentors
      await TalentProfile.create({
        userId: user._id,
        headline: `${roleSpecificData.designation} at ${roleSpecificData.company}`,
        skills: roleSpecificData.expertiseAreas ? roleSpecificData.expertiseAreas.split(',').map(s => ({ name: s.trim(), level: 'expert' })).filter(x => x.name) : [],
        socialLinks: {
          linkedin: roleSpecificData.linkedin || "",
          github: "",
          twitter: "",
          website: ""
        },
        visibility: 'public',
        isVerified: true
      });
    }

    else if (role === ROLES.INVESTOR) {
      // Create investor_profiles
      await InvestorProfile.create({
        userId: user._id,
        memberId: genMemberId,
        fundName: roleSpecificData.firmName || "",
        investorType: 'vc',
        thesis: `Investing in ${roleSpecificData.industryFocus || "tech startups"} at ${roleSpecificData.investmentStage || "seed"} stage.`,
        verificationStatus: 'approved',
        website: roleSpecificData.website || ""
      });
    }

    else if (role === ROLES.CONTRACTOR) {
      // Create contractor_profiles
      await ContractorProfile.create({
        userId: user._id,
        memberId: genMemberId,
        name: name.trim(),
        email: trimmedEmail,
        mobile: roleSpecificData.mobile || "",
        skills: roleSpecificData.skills ? roleSpecificData.skills.split(',').map(s => s.trim()).filter(Boolean) : [],
        experience: roleSpecificData.experience || "",
        portfolio: roleSpecificData.portfolio || "",
        hourlyRate: roleSpecificData.hourlyRate || 0,
        availability: roleSpecificData.availability || "Immediately",
        verificationStatus: 'approved'
      });

      // Automatically create Talent Profile for contractors
      await TalentProfile.create({
        userId: user._id,
        headline: `Independent Contractor - ${roleSpecificData.skills ? roleSpecificData.skills.split(',')[0] : 'Freelancer'}`,
        skills: roleSpecificData.skills ? roleSpecificData.skills.split(',').map(s => ({ name: s.trim(), level: 'advanced' })).filter(x => x.name) : [],
        socialLinks: {
          linkedin: "",
          github: "",
          twitter: "",
          website: roleSpecificData.portfolio || ""
        },
        visibility: 'public',
        isVerified: true
      });
    }

    else if (role === ROLES.HR) {
      await HR.create({ name: name.trim(), email: trimmedEmail, password: hashedPassword, username: trimmedEmail, role: ROLES.HR });
    }

    else if (role === ROLES.COORDINATOR) {
      await Coordinator.create({ name: name.trim(), email: trimmedEmail, password: hashedPassword, username: trimmedEmail, department: roleSpecificData.department || '' });
    }

    // Auto-create Community Profile for every single newcomer
    await CommunityProfile.create({
      userId: user._id,
      role: role,
      joinedAt: new Date(),
      postsCount: 0,
      commentsCount: 0,
      activity: [{
        action: "joined_ecosystem",
        description: "Registered on the TEN Ecosystem platform.",
        timestamp: new Date()
      }]
    });

    return res.status(201).json({ 
      success: true, 
      message: `${role.charAt(0).toUpperCase() + role.slice(1)} account created successfully.`, 
      userId: user._id, 
      role,
      email: trimmedEmail,
      memberId: genMemberId
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ 
        success: false, 
        message: 'Email already registered. Please login.',
        error: 'Email already registered. Please login.' 
      });
    }
    console.error("Registration error:", err);
    return res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
  }
}

module.exports = { getHub, getRoleConfig, registerUser };

