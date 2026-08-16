/**
 * The payment gate that closes every portal's preview page.
 *
 * Each portal landing page ends the same way: the visitor has seen what the
 * portal offers and now has to choose before going in. student-portal.html
 * already had that section hand-written; this is the same card, shared, so the
 * other portals get it without five copies of the same markup drifting apart.
 *
 * Mount it with one line at the end of a page:
 *
 *   <script src="/portal-paygate.js"
 *           data-portal="job"
 *           data-title="Job Portal Access"
 *           data-continue="/job-portal/#start"></script>
 *
 * data-continue is where both buttons lead. Leave it off and the card records
 * the choice and confirms in place rather than guessing a route that may not
 * exist -- a dead link is worse than no link.
 *
 * The choice is kept in localStorage as ten_pay_choice_<portal> ("now" or
 * "after") so whatever runs next can read it.
 *
 * PAY NOW IS A REAL PAYMENT. It is a upi://pay intent addressed to the
 * business VPA in config/payment.js, so on a phone it opens GPay, PhonePe or
 * Paytm with the payee — and the amount, when data-amount is set — already
 * filled in, and the transfer actually happens. On desktop the intent has
 * nowhere to open, so the QR is the path there; both encode the same payee.
 *
 * What this deliberately does NOT do is confirm the payment. UPI intents give
 * the page no callback: a visitor can press Pay Now, never complete it, and
 * the page cannot tell. The choice stored here is a claim, not a receipt.
 * Verifying it needs a gateway that signs a server-side callback — Razorpay is
 * already stubbed behind PAYMENT_ENABLED in config/payment.js — or manual
 * reconciliation against the merchant statement.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;

  var portal = script.dataset.portal || 'portal';
  var title = script.dataset.title || 'Portal Access';
  var blurb = script.dataset.blurb ||
    'Full access to this portal — everything shown above.';
  var next = script.dataset.continue || '';
  var qr = script.dataset.qr || '/assets/upi-qr.png';

  /* The UPI id is shown as text as well as encoded in the QR: people paying
     from a desktop cannot scan their own screen. */
  var UPI_ID = 'paytmqr5k0ods@ptys';
  var PAYEE = 'Limitless Technologies';

  /* Set data-amount to prefill the sum. Left off, the UPI app asks for it,
     which is still a real payment — just one the payer types the figure into. */
  var amount = script.dataset.amount || '';

  var STORE_KEY = 'ten_pay_choice_' + portal;

  /** The intent a UPI app opens. Same payee the QR encodes. */
  function upiIntent() {
    var q = 'pa=' + encodeURIComponent(UPI_ID) +
            '&pn=' + encodeURIComponent(PAYEE) +
            '&cu=INR' +
            '&tn=' + encodeURIComponent('TEN ' + title);
    if (amount) q += '&am=' + encodeURIComponent(amount);
    return 'upi://pay?' + q;
  }

  function el(tag, css, html) {
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function remember(choice) {
    try { localStorage.setItem(STORE_KEY, choice); } catch (e) { /* private mode */ }
    document.dispatchEvent(new CustomEvent('ten:pay-choice', {
      detail: { portal: portal, choice: choice }
    }));
  }

  function build() {
    var section = el('section',
      'background:#080c16;padding:72px 20px 84px;font-family:Inter,system-ui,sans-serif;' +
      'border-top:1px solid rgba(212,175,55,.16);');
    section.id = 'ten-paygate';

    var card = el('div',
      'max-width:520px;margin:0 auto;text-align:center;');

    card.appendChild(el('div',
      'font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#D4AF37;' +
      'font-weight:700;margin-bottom:10px;', 'One step left'));

    card.appendChild(el('h2',
      'font-size:clamp(26px,4vw,38px);line-height:1.15;color:#fff;margin:0 0 12px;' +
      'font-weight:800;letter-spacing:-.02em;', 'Unlock your access.'));

    card.appendChild(el('p',
      'color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 32px;',
      'Scan to pay, or start now and pay after completion.'));

    /* The QR sits on white deliberately: scanners need the light quiet zone,
       and a dark-tinted code is the classic reason a camera will not lock on. */
    var qrBox = el('div',
      'background:#fff;border-radius:16px;padding:16px;display:inline-block;' +
      'box-shadow:0 12px 40px rgba(0,0,0,.5);');
    var img = el('img',
      'width:212px;height:212px;display:block;border-radius:6px;');
    img.src = qr;
    img.alt = 'UPI payment QR code for ' + PAYEE;
    img.loading = 'lazy';
    qrBox.appendChild(img);
    card.appendChild(qrBox);

    card.appendChild(el('div',
      'color:#64748b;font-size:12px;margin:14px 0 4px;', 'Scan with any UPI app'));

    var idRow = el('div',
      'color:#94a3b8;font-size:12.5px;margin-bottom:26px;',
      'UPI ID: <span style="color:#D4AF37;font-weight:700;font-family:ui-monospace,monospace;">' +
      UPI_ID + '</span>');
    var copy = el('button',
      'margin-left:8px;background:none;border:1px solid rgba(212,175,55,.35);color:#D4AF37;' +
      'font-size:10px;padding:3px 9px;border-radius:5px;cursor:pointer;font-weight:700;', 'Copy');
    copy.type = 'button';
    copy.addEventListener('click', function () {
      var done = function () { copy.textContent = 'Copied'; };
      if (navigator.clipboard) navigator.clipboard.writeText(UPI_ID).then(done, function () {});
      else done();
    });
    idRow.appendChild(copy);
    card.appendChild(idRow);

    card.appendChild(el('div',
      'color:#fff;font-size:17px;font-weight:800;margin-bottom:6px;', title));
    card.appendChild(el('div',
      'color:#94a3b8;font-size:13.5px;line-height:1.6;margin-bottom:26px;', blurb));

    var btns = el('div',
      'display:flex;gap:12px;flex-wrap:wrap;justify-content:center;');

    var payNow = el('a',
      'flex:1 1 200px;text-align:center;padding:14px 22px;border-radius:10px;' +
      'background:linear-gradient(135deg,#f5c542,#c9a227);color:#0c1220;font-weight:800;' +
      'font-size:14.5px;text-decoration:none;cursor:pointer;', 'Pay Now');

    var payLater = el('a',
      'flex:1 1 200px;text-align:center;padding:14px 22px;border-radius:10px;' +
      'background:transparent;border:1px solid rgba(255,255,255,.22);color:#e2e8f0;' +
      'font-weight:700;font-size:14.5px;text-decoration:none;cursor:pointer;',
      'Payment after Completion');

    /* Pay Now opens the real UPI intent. Continuing into the portal is a
       separate step afterwards, because the intent hands the visitor to
       another app and never tells this page how it ended. */
    payNow.href = upiIntent();
    payNow.addEventListener('click', function () {
      remember('now');
      if (next) {
        proceed.style.display = '';
        proceed.href = next;
      }
    });

    payLater.addEventListener('click', function () {
      remember('after');
      if (!next) {
        btns.replaceChildren(el('div',
          'color:#4ade80;font-weight:700;font-size:14px;padding:12px;',
          'Noted — you can pay after completion.'));
      }
    });
    if (next) payLater.href = next;

    btns.appendChild(payNow);
    btns.appendChild(payLater);
    card.appendChild(btns);

    /* Appears once Pay Now has handed off to the UPI app, so the visitor has a
       way back in. Hidden until then rather than offering a way past the
       payment nobody pressed. */
    var proceed = el('a',
      'display:none;margin-top:16px;color:#D4AF37;font-size:13.5px;font-weight:700;' +
      'text-decoration:underline;cursor:pointer;',
      'Payment done — continue to the portal →');
    card.appendChild(proceed);

    section.appendChild(card);
    document.body.appendChild(section);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
