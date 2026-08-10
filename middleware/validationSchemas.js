'use strict';

/**
 * @fileoverview Reusable custom schema validation middleware factory.
 * Consistent with patterns in middleware/validateTalentProfile.js
 */

// Domains come from config/domains.js — the single list shared with the
// registration form and with employee-ID generation. This array used to be a
// third, independent copy that was missing "Business Development", "Space
// Intern" and "Finance" (all offered on the registration form), so switching
// validation on would have rejected valid student choices.
const { DOMAIN_NAMES } = require('../config/domains');
const DOMAINS_ENUM = DOMAIN_NAMES;

// Helper to check for valid Mongo ObjectId format
const MONGO_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

// Define schemas
const studentRegisterSchema = {
  fields: {
    name: {
      required: true,
      type: 'string',
      min: 2,
      max: 100
    },
    email: {
      required: true,
      type: 'string',
      max: 255,
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      message: "Invalid email format"
    },
    password: {
      required: true,
      type: 'string',
      min: 8,
      max: 128,
      custom: (val) => {
        const hasUpper = /[A-Z]/.test(val);
        const hasLower = /[a-z]/.test(val);
        const hasNumber = /[0-9]/.test(val);
        const hasSpecial = /[^A-Za-z0-9]/.test(val);
        if (!hasUpper || !hasLower || !hasNumber || !hasSpecial) {
          return "Password must contain at least one uppercase, one lowercase, one number, and one special character";
        }
        return null;
      }
    },
    phone: {
      required: false,
      type: 'string',
      pattern: /^[6-9]\d{9}$/,
      message: "Phone number must match Indian mobile format (10 digits starting with 6-9)"
    },
    domain: {
      required: true,
      type: 'string',
      enum: DOMAINS_ENUM
    },
    cohort: {
      required: false,
      type: 'string',
      max: 50
    }
  }
};

const studentLoginSchema = {
  fields: {
    email: {
      required: true,
      type: 'string',
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      message: "Invalid email format"
    },
    password: {
      required: true,
      type: 'string',
      min: 1
    }
  }
};

const studentProfileUpdateSchema = {
  fields: {
    name: {
      required: false,
      type: 'string',
      min: 2,
      max: 100
    },
    phone: {
      required: false,
      type: 'string',
      pattern: /^[6-9]\d{9}$/,
      message: "Phone number must match Indian mobile format (10 digits starting with 6-9)"
    },
    bio: {
      required: false,
      type: 'string',
      max: 500
    },
    linkedinUrl: {
      required: false,
      type: 'string',
      custom: (val) => {
        if (!val) return null;
        if (!/^https?:\/\/.{3,}/.test(val) || !val.includes('linkedin.com')) {
          return "Linkedin URL must be a valid URL and contain linkedin.com";
        }
        return null;
      }
    },
    githubUrl: {
      required: false,
      type: 'string',
      custom: (val) => {
        if (!val) return null;
        if (!/^https?:\/\/.{3,}/.test(val) || !val.includes('github.com')) {
          return "Github URL must be a valid URL and contain github.com";
        }
        return null;
      }
    },
    email: {
      required: false,
      custom: (val) => {
        if (val !== undefined) {
          return "Email change is not allowed";
        }
        return null;
      }
    }
  }
};

const hrActionSchema = {
  isStrict: true,
  fields: {
    studentId: {
      required: true,
      type: 'string',
      pattern: MONGO_ID_PATTERN,
      message: "studentId must be a valid 24-character hex MongoDB ObjectId"
    },
    action: {
      required: true,
      type: 'string',
      enum: ['approve', 'reject', 'pending', 'complete']
    },
    reason: {
      required: false,
      type: 'string',
      max: 500
    }
  }
};

const coordinatorActionSchema = {
  fields: {
    cohortId: {
      required: true,
      type: 'string',
      pattern: MONGO_ID_PATTERN,
      message: "cohortId must be a valid 24-character hex MongoDB ObjectId"
    },
    studentId: {
      required: true,
      type: 'string',
      pattern: MONGO_ID_PATTERN,
      message: "studentId must be a valid 24-character hex MongoDB ObjectId"
    },
    action: {
      required: true,
      type: 'string',
      enum: ['approve', 'reject', 'pending', 'complete']
    },
    notes: {
      required: false,
      type: 'string',
      max: 1000
    }
  }
};

const paymentInitSchema = {
  fields: {
    amount: {
      required: true,
      type: 'number',
      min: 1,
      max: 100000,
      custom: (val) => {
        if (typeof val !== 'number') return "Amount must be a number";
        const parts = val.toString().split('.');
        if (parts.length > 1 && parts[1].length > 2) {
          return "Amount can have at most 2 decimal places";
        }
        return null;
      }
    },
    currency: {
      required: true,
      type: 'string',
      enum: ['INR']
    },
    studentId: {
      required: true,
      type: 'string',
      pattern: MONGO_ID_PATTERN,
      message: "studentId must be a valid 24-character hex MongoDB ObjectId"
    },
    programId: {
      required: false,
      type: 'string',
      pattern: MONGO_ID_PATTERN,
      message: "programId must be a valid 24-character hex MongoDB ObjectId"
    },
    description: {
      required: false,
      type: 'string',
      max: 255
    }
  }
};

const coordinatorApproveCertificatesSchema = {
  fields: {
    studentId: {
      required: true,
      type: 'string',
      pattern: MONGO_ID_PATTERN,
      message: "studentId must be a valid 24-character hex MongoDB ObjectId"
    },
    approved: {
      required: true,
      type: 'boolean'
    },
    notes: {
      required: false,
      type: 'string',
      max: 1000
    }
  }
};

const hrApproveCertificatesSchema = {
  fields: {
    studentId: {
      required: true,
      type: 'string',
      pattern: MONGO_ID_PATTERN,
      message: "studentId must be a valid 24-character hex MongoDB ObjectId"
    },
    approveLoC: {
      required: false,
      type: 'boolean'
    },
    approveLor: {
      required: false,
      type: 'boolean'
    },
    approveStarPerformance: {
      required: false,
      type: 'boolean'
    },
    notes: {
      required: false,
      type: 'string',
      max: 1000
    }
  }
};

const mongoIdParamSchema = {
  fields: {
    id: {
      required: false,
      type: 'string',
      pattern: MONGO_ID_PATTERN,
      message: "id must be a valid 24-character hex MongoDB ObjectId"
    },
    studentId: {
      required: false,
      type: 'string',
      pattern: MONGO_ID_PATTERN,
      message: "studentId must be a valid 24-character hex MongoDB ObjectId"
    },
    cohortId: {
      required: false,
      type: 'string',
      pattern: MONGO_ID_PATTERN,
      message: "cohortId must be a valid 24-character hex MongoDB ObjectId"
    },
    progressId: {
      required: false,
      type: 'string',
      pattern: MONGO_ID_PATTERN,
      message: "progressId must be a valid 24-character hex MongoDB ObjectId"
    },
    orderId: {
      required: false,
      type: 'string',
      pattern: MONGO_ID_PATTERN,
      message: "orderId must be a valid 24-character hex MongoDB ObjectId"
    }
  }
};

/**
 * Validator factory middleware.
 * @param {object} schema The validation schema object
 * @returns {import('express').RequestHandler}
 */
function validate(schema) {
  return (req, res, next) => {
    const errors = [];
    const params = req.params || {};
    const body = req.body || {};
    const method = req.method || 'POST';
    const isParamValidation = (method === 'GET' || method === 'DELETE' || Object.keys(params).length > 0) && !Object.keys(body).length;
    const inputData = isParamValidation ? params : body;

    const fields = schema.fields || {};

    // 1. Strict Mode check (reject unrecognized fields)
    if (schema.isStrict) {
      for (const key of Object.keys(inputData)) {
        if (!fields[key]) {
          errors.push({ field: key, message: `Field '${key}' is not allowed.` });
        }
      }
    }

    // 2. Validate declared fields
    const sanitizedBody = {};
    for (const [fieldName, rule] of Object.entries(fields)) {
      const val = inputData[fieldName];

      // Handle missing/required values
      if (val === undefined || val === null || val === '') {
        if (rule.required) {
          errors.push({ field: fieldName, message: `${fieldName} is required.` });
        }
        continue;
      }

      // Check type
      if (rule.type && typeof val !== rule.type) {
        errors.push({ field: fieldName, message: `${fieldName} must be of type ${rule.type}.` });
        continue;
      }

      // Check min/max values for strings/numbers
      if (typeof val === 'string') {
        if (rule.min !== undefined && val.length < rule.min) {
          errors.push({ field: fieldName, message: `${fieldName} must be at least ${rule.min} characters.` });
        }
        if (rule.max !== undefined && val.length > rule.max) {
          errors.push({ field: fieldName, message: `${fieldName} must be ${rule.max} characters or fewer.` });
        }
      } else if (typeof val === 'number') {
        if (rule.min !== undefined && val < rule.min) {
          errors.push({ field: fieldName, message: `${fieldName} must be at least ${rule.min}.` });
        }
        if (rule.max !== undefined && val > rule.max) {
          errors.push({ field: fieldName, message: `${fieldName} must be ${rule.max} or less.` });
        }
      }

      // Check regex pattern
      if (rule.pattern && !rule.pattern.test(val)) {
        errors.push({ field: fieldName, message: rule.message || `${fieldName} is in an invalid format.` });
      }

      // Check enum
      if (rule.enum && !rule.enum.includes(val)) {
        errors.push({ field: fieldName, message: `${fieldName} must be one of: ${rule.enum.join(', ')}` });
      }

      // Custom validation function
      if (typeof rule.custom === 'function') {
        const customErr = rule.custom(val);
        if (customErr) {
          errors.push({ field: fieldName, message: customErr });
        }
      }

      // Keep only validated fields for body requests
      if (!isParamValidation) {
        sanitizedBody[fieldName] = val;
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        details: errors
      });
    }

    // Prevents mass assignment by swapping body with the sanitized version
    if (!isParamValidation && !schema.isStrict) {
      req.body = sanitizedBody;
    }

    return next();
  };
}

module.exports = {
  validate,
  studentRegisterSchema,
  studentLoginSchema,
  studentProfileUpdateSchema,
  hrActionSchema,
  coordinatorActionSchema,
  coordinatorApproveCertificatesSchema,
  hrApproveCertificatesSchema,
  paymentInitSchema,
  mongoIdParamSchema
};
