'use strict';

/**
 * @fileoverview PaymentTransaction model — NEW collection: paymenttransactions.
 * Does NOT replace or modify the existing payments collection.
 */

const mongoose = require('mongoose');

const PAYMENT_STATUSES = Object.freeze(['CREATED', 'PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED']);
const PROVIDERS        = Object.freeze(['setu', 'razorpay', 'stripe', 'manual']);

const webhookEventSchema = new mongoose.Schema({
  event:      { type: String, required: true },
  payload:    { type: mongoose.Schema.Types.Mixed },
  receivedAt: { type: Date, default: Date.now },
}, { _id: false });

const refundSchema = new mongoose.Schema({
  refundId:  { type: String },
  amount:    { type: Number, min: 0 },
  reason:    { type: String },
  status:    { type: String },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const paymentTransactionSchema = new mongoose.Schema({
  provider:           { type: String, enum: PROVIDERS, required: true },
  providerOrderId:    { type: String, default: '' },
  providerPaymentId:  { type: String, default: '' },
  amount:             { type: Number, required: true, min: 0 },
  currency:           { type: String, default: 'INR' },
  status:             { type: String, enum: PAYMENT_STATUSES, default: 'CREATED' },
  description:        { type: String, default: '' },
  initiatedBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'EcosystemUser', default: null },
  metadata:           { type: Map, of: mongoose.Schema.Types.Mixed, default: () => new Map() },
  webhookEvents:      { type: [webhookEventSchema], default: [] },
  refunds:            { type: [refundSchema], default: [] },
}, { timestamps: true });

paymentTransactionSchema.index({ provider: 1, providerOrderId: 1 });

module.exports = mongoose.model('PaymentTransaction', paymentTransactionSchema);
module.exports.PAYMENT_STATUSES = PAYMENT_STATUSES;
