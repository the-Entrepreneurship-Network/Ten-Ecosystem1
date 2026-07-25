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
