const PaymentService = require("../services/payment/PaymentService");
const PaymentSetuProvider = require("../services/payment/PaymentSetuProvider");
const PaymentWebhookService = require("../services/payment/PaymentWebhookService");

exports.initiate = async (req, res) => {
  try {
    const { studentId, amount, purpose } = req.body;
    if (!studentId || !amount || !purpose) return res.status(400).json({ success: false, error: "Missing required fields" });
    const payment = await PaymentService.createOrder({ studentId, amount, purpose });
    const initiated = await PaymentSetuProvider.initiatePayment({
      orderId: payment.orderId,
      amount: payment.amount,
      currency: payment.currency,
      redirectUrl: `${process.env.BASE_URL}/payment-success`,
      webhookUrl: `${process.env.BASE_URL}/api/payment/webhook`
    });
    res.json({ success: true, paymentUrl: initiated.paymentUrl, orderId: payment.orderId });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.webhook = async (req, res) => {
  try {
    const result = await PaymentWebhookService.handlePaymentSetu(req.body, req.headers["x-paymentsetu-signature"]);
    res.json({ success: true, ...result });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
};

exports.status = async (req, res) => {
  try {
    const payment = await PaymentService.getByOrderId(req.params.orderId);
    if (!payment) return res.status(404).json({ success: false, error: "Order not found" });
    res.json({ success: true, data: payment });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};
