const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/paymentController");

router.post("/initiate", ctrl.initiate);
router.post("/webhook", ctrl.webhook);
router.get("/status/:orderId", ctrl.status);

module.exports = router;
