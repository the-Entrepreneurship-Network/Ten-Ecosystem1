#!/usr/bin/env node
"use strict";

// Swap a short-lived WhatsApp dashboard token (24 h) for a long-lived one
// (~60 days) using the app id and secret. Reads and, with --write, updates
// .env in the project root. Nothing is printed except the expiry.
//
//   node scripts/whatsapp-exchange-token.js            # check only
//   node scripts/whatsapp-exchange-token.js --write    # replace WHATSAPP_TOKEN in .env

const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env");
require("dotenv").config({ path: envPath });

const { WHATSAPP_APP_ID, WHATSAPP_APP_SECRET, WHATSAPP_TOKEN } = process.env;
const version = process.env.WHATSAPP_API_VERSION || "v20.0";

async function main() {
    for (const k of ["WHATSAPP_APP_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_TOKEN"]) {
        if (!process.env[k]) { console.error(`${k} is not set in ${envPath}`); process.exit(1); }
    }
    const url = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
    url.searchParams.set("grant_type", "fb_exchange_token");
    url.searchParams.set("client_id", WHATSAPP_APP_ID);
    url.searchParams.set("client_secret", WHATSAPP_APP_SECRET);
    url.searchParams.set("fb_exchange_token", WHATSAPP_TOKEN);

    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || !data.access_token) {
        console.error("Exchange failed:", (data.error && data.error.message) || JSON.stringify(data));
        process.exit(1);
    }
    const days = data.expires_in ? Math.round(data.expires_in / 86400) : null;
    console.log(`Long-lived token obtained${days ? `, expires in about ${days} days` : " (no expiry reported)"}.`);

    if (process.argv.includes("--write")) {
        const src = fs.readFileSync(envPath, "utf8");
        const line = `WHATSAPP_TOKEN=${data.access_token}`;
        const out = /^WHATSAPP_TOKEN=.*$/m.test(src) ? src.replace(/^WHATSAPP_TOKEN=.*$/m, line) : `${src.replace(/\s*$/, "")}\n${line}\n`;
        fs.writeFileSync(envPath, out);
        console.log(`WHATSAPP_TOKEN updated in ${envPath}. Restart the server to pick it up.`);
    } else {
        console.log("Run again with --write to store it in .env.");
    }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
