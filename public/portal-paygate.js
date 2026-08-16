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

  /* Every portal costs the same today. Kept in step with PORTAL_ACCESS_PRICE in
     config/payment.js, which is what the shared QR is generated from — change
     one without the other and the scanner asks for a different sum than the
     page quotes. data-amount overrides it per portal, but a portal on its own
     price needs its own QR too. */
  var amount = script.dataset.amount || '200';
  var priceLabel = '₹' + amount;

  var STORE_KEY = 'ten_pay_choice_' + portal;
  var USES_KEY = 'ten_portal_uses_' + portal;   // free runs already taken
  var PAID_KEY = 'ten_portal_paid_' + portal;   // pressed Pay Now on the repeat gate

  /* One run is free so the portal can prove itself; after that it is paid.
     Raise this if a portal should give away more than a single look. */
  var FREE_USES = 1;

  function readInt(key) {
    try { return parseInt(localStorage.getItem(key), 10) || 0; } catch (e) { return 0; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }

  function hasPaid() {
    try { return localStorage.getItem(PAID_KEY) === '1'; } catch (e) { return false; }
  }
  /** True once the free look is spent and nothing has been paid since. */
  function mustPay() {
    return !hasPaid() && readInt(USES_KEY) >= FREE_USES;
  }

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

  /**
   * The scanner, on white. Scanners need the light quiet zone, and a
   * dark-tinted code is the classic reason a camera will not lock on.
   */
  function qrPanel(size) {
    var box = el('div',
      'background:#fff;border-radius:16px;padding:14px;display:inline-block;' +
      'box-shadow:0 12px 40px rgba(0,0,0,.5);');
    var img = el('img', 'width:' + size + 'px;height:' + size + 'px;display:block;border-radius:6px;');
    img.src = qr;
    img.alt = 'UPI payment QR code for ' + PAYEE;
    box.appendChild(img);
    return box;
  }

  /**
   * Going in. The free run is spent here rather than on arrival, so someone
   * who only reads the landing page keeps their look.
   *
   * Once it is spent the paywall opens instead, and — as asked — it offers
   * only Pay Now. "Payment after Completion" is a first-run courtesy; a second
   * run is not a completion, it is more usage.
   */
  function enterPortal() {
    if (mustPay()) { openPaywall(); return; }

    write(USES_KEY, readInt(USES_KEY) + 1);
    document.dispatchEvent(new CustomEvent('ten:portal-start', {
      detail: { portal: portal, uses: readInt(USES_KEY), paid: hasPaid() }
    }));

    if (next) { window.location.href = next; return; }
    /* A single-page portal is already on screen above this card, so entering
       it means going back to it rather than navigating anywhere. */
    var app = document.getElementById('root') || document.body;
    app.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * The blocking scanner. It has no close button on purpose: the free run is
   * over and paying is the way through.
   *
   * Pay Now is trusted here for the same reason it is trusted on the card
   * below — a UPI intent reports nothing back, so pressing it is a claim, not
   * a receipt. Anyone willing to open devtools can clear the key and get
   * another free run. Making this hold properly needs the entitlement checked
   * server-side against a verified payment, not localStorage.
   */
  function openPaywall() {
    if (document.getElementById('ten-paywall')) return;

    var overlay = el('div',
      'position:fixed;inset:0;z-index:99999;background:rgba(4,7,16,.92);' +
      'backdrop-filter:blur(6px);display:flex;align-items:center;' +
      'justify-content:center;padding:24px;overflow:auto;' +
      'font-family:Inter,system-ui,sans-serif;');
    overlay.id = 'ten-paywall';

    var box = el('div',
      'background:#0c1220;border:1px solid rgba(212,175,55,.28);border-radius:20px;' +
      'padding:34px 30px;max-width:420px;width:100%;text-align:center;' +
      'box-shadow:0 30px 90px rgba(0,0,0,.7);');

    box.appendChild(el('div',
      'font-size:11.5px;letter-spacing:.18em;text-transform:uppercase;color:#D4AF37;' +
      'font-weight:800;margin-bottom:10px;', 'Free run used'));
    box.appendChild(el('h3',
      'color:#fff;font-size:23px;font-weight:800;margin:0 0 10px;letter-spacing:-.01em;',
      'Pay to continue using ' + title.replace(/ Access$/, '') + '.'));
    box.appendChild(el('p',
      'color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 18px;',
      'You have had your free run of this portal. Scan to pay ' + priceLabel +
      ' for continued access.'));

    box.appendChild(qrPanel(196));
    box.appendChild(el('div',
      'color:#64748b;font-size:12px;margin:12px 0 2px;', 'Scan with any UPI app'));
    box.appendChild(el('div',
      'color:#94a3b8;font-size:12.5px;margin-bottom:24px;',
      'UPI ID: <span style="color:#D4AF37;font-weight:700;font-family:ui-monospace,monospace;">' +
      UPI_ID + '</span>'));

    /* Pay Now only. No pay-after on a repeat run. */
    var pay = el('a',
      'display:block;padding:15px 24px;border-radius:11px;text-decoration:none;' +
      'background:linear-gradient(135deg,#f5c542,#c9a227);color:#0c1220;' +
      'font-weight:800;font-size:15px;cursor:pointer;', 'Pay ' + priceLabel + ' Now');
    pay.href = upiIntent();

    var done = el('button',
      'display:none;margin-top:14px;width:100%;padding:13px 20px;border:0;border-radius:11px;' +
      'background:#fff;color:#0c1220;font-weight:800;font-size:14px;cursor:pointer;' +
      'font-family:inherit;', "I've paid — continue");
    done.type = 'button';

    pay.addEventListener('click', function () {
      remember('now');
      done.style.display = '';
    });
    done.addEventListener('click', function () {
      write(PAID_KEY, '1');
      closePaywall();
      enterPortal();
    });

    box.appendChild(pay);
    box.appendChild(done);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    /* The overlay covers the portal but does not stop it scrolling underneath,
       which makes a blocking dialog feel like a dismissible banner. */
    priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }

  var priorOverflow = '';

  function closePaywall() {
    var overlay = document.getElementById('ten-paywall');
    if (overlay) overlay.remove();
    document.body.style.overflow = priorOverflow;
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

    card.appendChild(qrPanel(212));

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
      'color:#fff;font-size:34px;font-weight:800;letter-spacing:-.02em;margin-bottom:2px;',
      priceLabel + '<span style="font-size:14px;color:#94a3b8;font-weight:600;">' +
      ' / run</span>'));
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

    /* Get Started sits below the payment, not above it. Reaching it means
       scrolling past the QR, which is the point: the price is the first thing
       seen, so the portal reads as paid rather than free with a donation box
       attached. */
    var start = el('button',
      'margin-top:30px;width:100%;max-width:340px;padding:16px 24px;border:0;' +
      'border-radius:12px;background:#fff;color:#0c1220;font-weight:800;' +
      'font-size:15.5px;cursor:pointer;font-family:inherit;', 'Get Started');
    start.type = 'button';
    start.addEventListener('click', function () { enterPortal(); });
    card.appendChild(start);

    card.appendChild(el('div',
      'color:#64748b;font-size:11.5px;margin-top:12px;line-height:1.6;',
      readInt(USES_KEY) >= FREE_USES && !hasPaid()
        ? 'Your free run is used. Payment is required to continue.'
        : 'Premium portal · one free run included'));

    section.appendChild(card);
    document.body.appendChild(section);
  }

  function init() {
    build();
    /* Someone coming back for another run meets the scanner straight away,
       rather than getting through the portal and being stopped later. */
    if (mustPay()) openPaywall();
  }

  /* Exposed so a portal can gate its own actions on the same rule instead of
     reimplementing it: PortalPaygate.requireAccess() returns false and opens
     the scanner when the free run is spent. */
  window.PortalPaygate = {
    portal: portal,
    mustPay: mustPay,
    hasPaid: hasPaid,
    openPaywall: openPaywall,
    requireAccess: function () {
      if (!mustPay()) return true;
      openPaywall();
      return false;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
