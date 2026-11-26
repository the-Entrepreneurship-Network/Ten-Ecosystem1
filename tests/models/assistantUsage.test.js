'use strict';

/**
 * A student's first question to the TEN Assistant creates their usage row.
 * That save failed for everyone: pendingPayment.status defaults to null, and
 * Mongoose's enum check rejects null unless it is listed. The route then
 * served the free Starter tier, so a paying student lost what they paid for
 * (26 Nov log: "AssistantUsage validation failed: pendingPayment.status:
 * `null` is not a valid enum value").
 */
const mongoose = require('mongoose');
const AssistantUsage = require('../../models/new/AssistantUsage');

describe('AssistantUsage', () => {
    test('a new row, with no payment claimed, is valid', () => {
        const row = new AssistantUsage({ userId: new mongoose.Types.ObjectId() });
        expect(row.validateSync()).toBeUndefined();
        expect(row.pendingPayment.status).toBeNull();
    });

    test('a real payment status still has to be one of the three', () => {
        const row = new AssistantUsage({ userId: new mongoose.Types.ObjectId(), pendingPayment: { status: 'paid-maybe' } });
        expect(row.validateSync().errors['pendingPayment.status']).toBeDefined();
        for (const status of ['pending', 'verified', 'rejected']) {
            expect(new AssistantUsage({ userId: new mongoose.Types.ObjectId(), pendingPayment: { status } }).validateSync()).toBeUndefined();
        }
    });
});
