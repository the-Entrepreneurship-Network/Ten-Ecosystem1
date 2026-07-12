# Payment — Current Flow

> This documents the **existing** payment system. Do NOT modify any of these files.

---

## Payment Provider
**Razorpay** — `razorpay` npm package (declared in `package.json`)

## Entry Route
`POST /api/v2/payment/create-order`  
File: `routes/v2/payment.js`

## Flow

```
Client
  │
  ├─▶ POST /api/v2/payment/create-order
  │     requireStudent middleware (validates session)
  │     Body: { amount (paise), currency, receipt }
  │
  ├─▶ routes/v2/payment.js → handler
  │     - Validates amount > 0
  │     - Calls razorpay.orders.create({ amount, currency, receipt })
  │     - Saves Payment record with status: 'CREATED'
  │     - Returns: { orderId, amount, currency, razorpayOrderId }
  │
  └─▶ Client renders Razorpay checkout SDK
        └─▶ POST /api/v2/payment/webhook  (Razorpay sends this)
              - Verifies HMAC signature
              - Updates Payment.status → 'PAID' / 'FAILED'
              - Returns 200 immediately

GET /api/v2/payment/status/:orderId
  - Auth: requireStudent
  - Returns current Payment record for the order
```

## Payment Model Fields
| Field | Notes |
|-------|-------|
| orderId | Internal UUID |
| invoiceRef | Human-readable invoice reference |
| studentId | String (employee ID) — NOT ObjectId |
| amountRupees | Amount in ₹ |
| status | CREATED / PAID / FAILED |
| txnUtr | Bank UTR number (for UPI) |
| customerEmail | Email at time of payment |

## Collection Name
`payments` — **PROTECTED, do not touch**

---

## Phase 1 — Parallel Payment Layer (PaymentSetu)

A completely separate, isolated layer has been added:

| Layer | File |
|-------|------|
| Abstract service | `services/payment/PaymentService.js` |
| Setu provider | `services/payment/PaymentSetuProvider.js` |
| Webhook service | `services/payment/PaymentWebhookService.js` |
| Controller | `controllers/paymentSetuController.js` |
| Routes | `routes/paymentSetuRoutes.js` |
| Model | `models/PaymentTransaction.js` (collection: `paymenttransactions`) |

**The existing `payments` collection and Razorpay flow are completely untouched.**
