/**
 * SUPERSEDED — DO NOT MOUNT. Safe to delete.
 *
 * This router is not mounted anywhere in server.js and must stay that way:
 * POST /initiate has no auth guard and takes `studentId` straight from the
 * request body, so mounting it would hand anyone on the internet the ability
 * to create payment orders against any student.
 *
 * The two live payment paths are:
 *   - /api/v2/payment      (routes/v2/payment.js) — the UTR flow the UI uses
 *   - /api/payment/setu    (routes/paymentSetuRoutes.js) — gateway + webhook,
 *     every route behind requireRole and the webhook behind an HMAC check
 *
 * Kept only because deleting it needs a permission this session did not have.
 */
const express = require("express");
const router = express.Router();

const rateLimit = require("express-rate-limit");
const paymentLimiter = rateLimit({
    windowMs: process.env.RATE_PAYMENT_WINDOW_MS
      ? parseInt(process.env.RATE_PAYMENT_WINDOW_MS)
      : 60 * 60 * 1000,
    max: process.env.RATE_PAYMENT_MAX
      ? parseInt(process.env.RATE_PAYMENT_MAX)
      : 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many payment requests. Please try again later." }
});
router.use(paymentLimiter);

const ctrl = require("../controllers/paymentController");

router.post("/initiate", ctrl.initiate);
router.post("/webhook", ctrl.webhook);
router.get("/status/:orderId", ctrl.status);

module.exports = router;
