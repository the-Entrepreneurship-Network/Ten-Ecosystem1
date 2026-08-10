const mongoose = require('mongoose');

const CoinRedemptionSchema = new mongoose.Schema({
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true,
        index: true
    },
    employeeId: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    itemType: {
        type: String,
        enum: ['mentorship', 'certificate'],
        required: true
    },
    itemKey: {
        type: String,
        required: true // 'mentor_250', 'mentor_500', 'mentor_1000', 'cert_expert', 'cert_nano', 'cert_fellowship'
    },
    title: {
        type: String,
        required: true
    },
    retailPrice: {
        type: Number,
        required: true,
        min: 0
    },
    discountAmount: {
        type: Number,
        required: true,
        min: 0
    },
    coinsRedeemed: {
        type: Number,
        required: true,
        min: 0
    },
    netPaidAmount: {
        type: Number,
        required: true,
        min: 0
    },
    paymentGateway: {
        type: String,
        enum: ['razorpay', 'paymentsetu', 'upi_qr', 'test_dev'],
        default: 'upi_qr'
    },
    paymentId: {
        type: String,
        trim: true,
        default: ''
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'expired', 'assigned', 'live', 'finished'],
        default: 'pending',
        index: true
    },
    escrowExpiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 15 * 60 * 1000) // 15-minute escrow hold
    },
    completedAt: {
        type: Date,
        default: null
    },
    studentName: {
        type: String,
        default: 'Student Intern'
    },
    studentEmail: {
        type: String,
        default: ''
    },
    domain: {
        type: String,
        default: 'Web Development'
    },
    mentorName: {
        type: String,
        default: ''
    },
    mentorEmail: {
        type: String,
        default: ''
    },
    slotTime: {
        type: String,
        default: ''
    },
    meetUrl: {
        type: String,
        default: 'https://meet.google.com/new'
    }
}, {
    timestamps: true
});

module.exports = mongoose.models.CoinRedemption || mongoose.model('CoinRedemption', CoinRedemptionSchema);
