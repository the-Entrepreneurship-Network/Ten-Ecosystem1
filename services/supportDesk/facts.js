'use strict';

/**
 * What the help desk may tell a student about their own account, and the fixed
 * links every answer can use.
 *
 * agent.js asks only for a sender Gmail verified, and only about the account
 * registered to that address. Every value is a finished sentence, so an answer
 * reads naturally whatever state the account is in. A value that cannot be
 * worked out is left empty; the answer that needs it then falls back to the
 * general text instead of sending half a sentence.
 *
 * Field names and states are those of models/Student.js,
 * models/new/StudentDocument.js and models/Payment.js.
 */
const Student = require('../../models/Student');
const StudentDocument = require('../../models/new/StudentDocument');
const StudentTaskProgress = require('../../models/new/StudentTaskProgress');
const Payment = require('../../models/Payment');
const { PORTAL_URL, COMPLAINTS_EMAIL } = require('../../utils/mailer');
const { getFeeFor, isExempt, allPurposesFor } = require('../../config/tenurePayment');

const STATIC = {
    portalUrl: PORTAL_URL,
    registerUrl: PORTAL_URL + '/register',
    loginUrl: PORTAL_URL + '/student-login',
    verifyUrl: PORTAL_URL + '/verify-document',
    complaintsEmail: COMPLAINTS_EMAIL
};

/** Shown in HR's editor: what an answer can say. */
const PLACEHOLDERS = [
    { key: 'firstName', label: 'their first name' },
    { key: 'employeeId', label: 'their Employee ID' },
    { key: 'domain', label: 'their domain' },
    { key: 'plan', label: 'their plan, e.g. "3 Months (free)"' },
    { key: 'feeStatus', label: 'where their fee payment is' },
    { key: 'documentsStatus', label: 'where their documents are' },
    { key: 'offerLetterStatus', label: 'where their offer letter is' },
    { key: 'tasksStatus', label: 'how many weekly tasks are approved' },
    { key: 'completionStatus', label: 'where their Letter of Completion is' },
    { key: 'registerUrl', label: 'the registration page' },
    { key: 'loginUrl', label: 'the student sign-in page' },
    { key: 'verifyUrl', label: 'the document verification page' }
];

const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN',
    { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');
const on = (d) => (d ? ' on ' + day(d) : '');
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function findStudent(email) {
    const address = String(email || '').trim().toLowerCase();
    if (!address) return null;
    // Registration stores the address lowercased; older rows kept the case typed.
    return (await Student.findOne({ email: address })) ||
        Student.findOne({ email: new RegExp('^' + escapeRegex(address) + '$', 'i') });
}

function firstNameOf(student) {
    const raw = String(student.firstName || student.name || '').trim().split(/\s+/)[0] || '';
    return /^[A-Za-z][A-Za-z'-]{0,29}$/.test(raw) ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : '';
}

async function feeLine(student, fee) {
    if (!fee.required || isExempt(student)) return 'Your plan has no fee to pay.';
    const [payment] = await Payment.find({ studentId: student._id, purpose: { $in: allPurposesFor(fee.durationType) } })
        .sort({ createdAt: -1 }).limit(1);
    const utr = payment && payment.providerPaymentId;
    if (payment && payment.status === 'success') {
        return `Your fee of ₹${fee.amount} has been approved, so your dashboard is fully open.`;
    }
    if (payment && utr && (payment.status === 'pending_verification' || payment.status === 'pending')) {
        return `We received your UPI transaction ID ${utr}${on(payment.createdAt)}. Our team checks each payment by hand, ` +
            'usually within 24 hours, and your dashboard opens as soon as it is approved.';
    }
    if (payment && payment.status === 'failed') {
        return `Your last payment was not approved${payment.rejectionReason ? ', because: ' + payment.rejectionReason : ''}. ` +
            'Please sign in and submit the correct UPI transaction ID (UTR) on the payment screen.';
    }
    if (payment && payment.status === 'refunded') return '';
    return `Your ${fee.label} plan has a fee of ₹${fee.amount}, and we have not received a payment yet. Sign in at ` +
        `${STATIC.loginUrl}, scan the UPI QR code on the payment screen, then enter your UPI transaction ID (UTR) there ` +
        'and press "Submit UTR for HR Approval".';
}

function documentsLine(doc) {
    const status = doc && doc.uploadStatus;
    if (status === 'approved') return 'Your documents have been approved.';
    if (status === 'pending' || status === 'under_review') {
        return `We received your documents${on(doc.uploadedAt)}, and HR is reviewing them.`;
    }
    if (status === 'rejected') {
        return `Your documents were not accepted${doc.rejectionReason ? ', because: ' + doc.rejectionReason : ''}. ` +
            'Please upload the corrected document under My Documents → Upload Documents. If you need to replace both ' +
            'files and the page locks after the first one, reply to this email and our team will help.';
    }
    const have = doc ? [doc.addressProofUrl && 'address proof', doc.marksheetUrl && 'marksheet'].filter(Boolean) : [];
    if (have.length === 1) {
        const missing = have[0] === 'address proof' ? 'marksheet' : 'address proof';
        return `We have your ${have[0]} but not your ${missing} yet. Upload it under My Documents → Upload Documents.`;
    }
    return 'We have not received your documents yet. Upload your address proof and latest college marksheet under ' +
        'My Documents → Upload Documents (PDF only, up to 25 MB each).';
}

function offerLine(doc, student) {
    if ((doc && (doc.offerLetterSentAt || doc.offerLetterUrl)) || student.offerLetterStatus === 'issued') {
        return `Your offer letter was issued${on(doc && doc.offerLetterSentAt)}. It was emailed to you, and you can ` +
            'download it any time in My Documents, under the My Documents tab.';
    }
    const status = doc && doc.uploadStatus;
    if (status === 'pending' || status === 'under_review') {
        return 'Your offer letter will be issued as soon as HR approves your documents. It is emailed to you and also ' +
            'appears in My Documents.';
    }
    if (status === 'approved') {
        return 'Your documents are approved, so your offer letter is on its way. It is emailed to you and also appears ' +
            'in My Documents.';
    }
    return 'Your offer letter is issued after you upload your address proof and latest college marksheet under ' +
        'My Documents → Upload Documents and HR approves them.';
}

function completionLine(doc, student, approved, total) {
    if ((doc && doc.locUrl) || student.locStatus === 'issued') {
        return `Your Letter of Completion has been issued${on(doc && doc.locSentAt)}. You can download it any time in My Documents.`;
    }
    if (!total) return '';
    return `You have ${approved} of ${total} weekly tasks approved. Your Letter of Completion is issued once all of ` +
        'them are approved and your attendance is above 75%.';
}

async function valuesFor(student) {
    const basics = { firstName: firstNameOf(student), employeeId: student.employeeId || '', domain: student.domain || '' };
    try {
        const fee = getFeeFor(student);
        const [doc, total, approved, feeStatus] = await Promise.all([
            StudentDocument.findOne({ studentId: student._id }),
            StudentTaskProgress.countDocuments({ studentId: student._id }),
            StudentTaskProgress.countDocuments({ studentId: student._id, status: 'approved' }),
            feeLine(student, fee)
        ]);
        return Object.assign(basics, {
            plan: fee.label ? `${fee.label} (${fee.required && !isExempt(student) ? 'fast-track, ₹' + fee.amount : 'free'})` : '',
            feeStatus,
            documentsStatus: documentsLine(doc),
            offerLetterStatus: offerLine(doc, student),
            tasksStatus: total ? `So far, ${approved} of your ${total} weekly tasks in the Task Journey are approved.` : '',
            completionStatus: completionLine(doc, student, approved, total)
        });
    } catch (err) {
        // A failed lookup costs the personal touch, not the answer.
        console.error('[help desk] account details:', err.message);
        return basics;
    }
}

module.exports = { STATIC, PLACEHOLDERS, findStudent, valuesFor };
