"use strict";

const attendanceSettings = require("./attendanceSettings");

// Delivery only. Who receives a message is the caller's decision, passed in
// as `to`; nothing here reads a recipient from the environment, so the test
// number the sender is registered on can never become the destination by
// accident.
//
// Two transports, same sender settings as the existing n8n WhatsApp flow:
//   n8n  — POST the message to an n8n webhook; the workflow's WhatsApp node
//          sends it. Set N8N_ATTENDANCE_WEBHOOK_URL.
//   meta — call the Meta Cloud API directly with WHATSAPP_TOKEN and
//          WHATSAPP_PHONE_NUMBER_ID.
// With neither configured the message is printed and reported as a dry run.

function settings() {
    return {
        transport:     String(process.env.ATTENDANCE_TRANSPORT || "auto").toLowerCase(),
        // Environment first, then what HR saved in the portal.
        n8nUrl:        String(process.env.N8N_ATTENDANCE_WEBHOOK_URL || attendanceSettings.fromDb("n8nWebhookUrl") || "").trim(),
        n8nSecret:     String(process.env.N8N_WEBHOOK_SECRET || "").trim(),
        token:         String(process.env.WHATSAPP_TOKEN || attendanceSettings.fromDb("whatsappToken") || "").trim(),
        phoneNumberId: String(process.env.WHATSAPP_PHONE_NUMBER_ID || attendanceSettings.fromDb("phoneNumberId") || "").trim(),
        apiVersion:    String(process.env.WHATSAPP_API_VERSION || "v20.0").trim(),
        templateName:  String(process.env.WHATSAPP_TEMPLATE_NAME || "").trim(),
        templateLang:  String(process.env.WHATSAPP_TEMPLATE_LANG || "en_US").trim(),
    };
}

// Digits only, no plus sign, country code included — what the Cloud API wants.
function normalizeNumber(raw) {
    const digits = String(raw || "").replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return "";
    return digits;
}

function mask(number) {
    const d = normalizeNumber(number);
    if (!d) return "";
    return d.slice(0, 2) + "*".repeat(Math.max(0, d.length - 6)) + d.slice(-4);
}

function resolveTransport(s = settings()) {
    if (s.transport === "n8n")  return s.n8nUrl ? "n8n" : "none";
    if (s.transport === "meta") return s.token && s.phoneNumberId ? "meta" : "none";
    if (s.transport === "log")  return "log";
    if (s.n8nUrl) return "n8n";
    if (s.token && s.phoneNumberId) return "meta";
    return "log";
}

async function postJson(url, body, headers = {}) {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
    });
    const raw = await res.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = { raw }; }
    return { status: res.status, ok: res.ok, data };
}

function describe(data) {
    if (!data) return "no response body";
    if (data.error) return data.error.message || JSON.stringify(data.error);
    return JSON.stringify(data).slice(0, 300);
}

async function sendViaN8n(s, { to, text, payload }) {
    const headers = s.n8nSecret ? { "x-webhook-secret": s.n8nSecret } : {};
    const r = await postJson(s.n8nUrl, { to, text, ...(payload || {}) }, headers);
    if (!r.ok) return { ok: false, transport: "n8n", status: r.status, error: describe(r.data) };
    const id = (r.data && (r.data.id || r.data.messageId)) || "";
    return { ok: true, transport: "n8n", status: r.status, id };
}

// A plain text body only lands inside the 24-hour customer-service window.
// Outside it Meta requires an approved template; set WHATSAPP_TEMPLATE_NAME
// and the body parameters are sent in order.
async function sendViaMeta(s, { to, text, templateParams }) {
    const url = `https://graph.facebook.com/${s.apiVersion}/${s.phoneNumberId}/messages`;
    const body = s.templateName
        ? {
            messaging_product: "whatsapp", to, type: "template",
            template: {
                name: s.templateName,
                language: { code: s.templateLang },
                components: [{
                    type: "body",
                    parameters: (templateParams && templateParams.length ? templateParams : [text])
                        .map((t) => ({ type: "text", text: String(t) })),
                }],
            },
        }
        : { messaging_product: "whatsapp", to, type: "text", text: { preview_url: false, body: text } };
    const r = await postJson(url, body, { Authorization: `Bearer ${s.token}` });
    if (!r.ok) return { ok: false, transport: "meta", status: r.status, error: describe(r.data) };
    const id = (r.data && r.data.messages && r.data.messages[0] && r.data.messages[0].id) || "";
    return { ok: true, transport: "meta", status: r.status, id };
}

async function send({ to, text, payload, templateParams } = {}) {
    const number = normalizeNumber(to);
    if (!number) return { ok: false, transport: "none", error: "recipient number missing or invalid" };
    if (!text) return { ok: false, transport: "none", error: "message text is empty" };

    const s = settings();
    const transport = resolveTransport(s);
    try {
        if (transport === "n8n")  return await sendViaN8n(s, { to: number, text, payload });
        if (transport === "meta") return await sendViaMeta(s, { to: number, text, templateParams });
        if (transport === "log") {
            console.log(`[WHATSAPP] dry run — no transport configured. to=${mask(number)}\n${text}`);
            return { ok: true, transport: "log", dryRun: true };
        }
        return { ok: false, transport: "none", error: `ATTENDANCE_TRANSPORT="${s.transport}" is not configured` };
    } catch (err) {
        return { ok: false, transport, error: err.message };
    }
}

module.exports = { send, normalizeNumber, mask, resolveTransport, settings };
