#!/usr/bin/env node
'use strict';

/**
 * Generate the VAPID key pair that signs push notifications.
 *
 * Run this ONCE on the server, then paste the two lines it prints into `.env`.
 * The keys are not printed to any log and nothing is written to disk here — the
 * private key is a credential, and this repository must never contain one.
 *
 *   node scripts/generate-vapid-keys.js
 *
 * Regenerating the pair invalidates every existing subscription: browsers bind
 * a subscription to the public key it was created with, so after a rotation
 * every device has to subscribe again. Do it once and keep the keys.
 */

const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();

console.log('');
console.log('Add these three lines to your .env file, then restart the app:');
console.log('');
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('VAPID_CONTACT=mailto:ten.hr.contact@gmail.com');
console.log('');
console.log('Notes:');
console.log('  · VAPID_PUBLIC_KEY is handed to every browser — it is not a secret.');
console.log('  · VAPID_PRIVATE_KEY is. Never commit it, never paste it into a chat,');
console.log('    and never put it in the repository.');
console.log('  · VAPID_CONTACT is a mailto: address the push services use to reach');
console.log('    you if this server starts misbehaving. Any real inbox is fine.');
console.log('  · Keep these keys. Regenerating them unsubscribes every device.');
console.log('');
console.log('Until they are set, push notifications stay switched off and the rest');
console.log('of the portal runs exactly as before.');
console.log('');
