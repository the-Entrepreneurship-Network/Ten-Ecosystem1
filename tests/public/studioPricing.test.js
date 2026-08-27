'use strict';

const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const pricing = require('../../config/studioPricing');
const SCREEN = read('public/studio.html');
const ROUTE  = strip(read('routes/v2/studio.js'));
const SERVER = strip(read('server.js'));
const ADMIN  = read('routes/adminPortal.js');
const CERTS  = read('public/my-certificates.html');
const CERT_ROUTE = strip(read('routes/v2/certificates.js'));
const REGISTER = strip(read('public/academic-register.html'));
const HRPAGE   = read('public/hr-deferrals.html');
const PRICING  = pricing;

describe('the price list', () => {
  it('is what was asked for', () => {
    expect(pricing.PRODUCTS.combo.price).toBe(500);
    expect(pricing.PRODUCTS.course.price).toBe(300);
    expect(pricing.PRODUCTS.resume.price).toBe(150);
    expect(pricing.PRODUCTS.job.price).toBe(200);
  });

  // A price written twice is a price that will one day disagree with itself.
  it('is written once — the screen prints no figure of its own', () => {
    Object.values(pricing.PRODUCTS).forEach((p) => {
      expect(SCREEN).not.toContain('₹' + p.price);
    });
    expect(SCREEN).toContain("money(p.price)");
  });

  it('is read by the order route from the config, never from the request', () => {
    expect(ROUTE).toContain('const product = studioPricing.getProduct(productKey);');
    expect(ROUTE).toContain('deferring ? studioPricing.deferredPriceFor(productKey) : product.price');
    // A client that could name its own amount could buy the combo for ₹1.
    expect(ROUTE).not.toMatch(/amount:\s*(req\.body|Number\(req)/);
  });

  it('reaches the admin approval queue without being typed out again', () => {
    expect(ADMIN).toContain("require('../config/studioPricing')");
    expect(ADMIN).toContain('studio.purposeFor(p.key)');
  });
});

describe('the pay screen', () => {
  it('offers both ways to pay on every plan', () => {
    expect(SCREEN).toContain("data-mode=\"now\">Pay now");
    expect(SCREEN).toContain("data-mode=\"after\">Pay after completion");
  });

  it('uses the same QR and UPI identity as the internship fee', () => {
    expect(SCREEN).toContain("'/api/upi-qr?amount='");
    expect(SCREEN).toContain('paytmqr5k0ods@ptys');
  });

  it('checks the transaction id before bothering the server', () => {
    expect(SCREEN).toMatch(/\/\^\[A-Za-z0-9\]\{6,25\}\$\/\.test\(utr\)/);
  });

  // A debt the student is told about but cannot pay is a dead end, and this
  // one stands between them and their certificate.
  it('gives a pay-later student a way to settle up', () => {
    expect(SCREEN).toContain('data-settle=');
    expect(SCREEN).toContain('async function payDeferred(product, btn)');
  });
});

describe('the paywall is in front of the files', () => {
  /*
   * express.static("public") serves /job-portal and /resume-portal to anybody
   * who types the URL. Registered after it, the gate would never run.
   */
  it('is registered before express.static, or it does nothing', () => {
    const gate = SERVER.indexOf("require('./middleware/studioGate').studioGate");
    const stat = SERVER.indexOf('app.use(express.static("public"');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(stat);
  });

  it('mounts the buying routes', () => {
    expect(SERVER).toContain('app.use("/api/v2/studio", require("./routes/v2/studio"))');
  });
});

describe('pay after completion', () => {
  /*
   * "pending" is exactly right for a deferral: no money has arrived, and the
   * row is the record of the promise. HR approving it is what later tells the
   * access check to open the portals.
   */
  it('records the promise rather than inventing a new payment state', () => {
    expect(ROUTE).toContain("status: 'pending',");
    expect(ROUTE).toContain('deferRequestedAt');
  });

  it('never quotes a QR on this path — it asks HR, and says so', () => {
    expect(ROUTE).toContain('requested: deferring');
    expect(ROUTE).toContain('awaitingHR: deferring');
    expect(ROUTE).not.toContain('opensNow');
    expect(REGISTER).toContain("if (pick.dataset.mode === 'after') { deferAsk(pick.value); return; }");
    // The request screen, and no QR anywhere on it.
    const ask = REGISTER.slice(REGISTER.indexOf('function deferAsk'), REGISTER.indexOf('function requested'));
    expect(ask).not.toContain('/api/upi-qr');
  });

  it('will not send an empty request — HR has to have something to read', () => {
    expect(ROUTE).toContain('reason.length < 15');
  });

  it('charges the surcharge for waiting, and shows both numbers', () => {
    expect(PRICING.DEFER_SURCHARGE).toBe(100);
    expect(PRICING.deferredPriceFor('course')).toBe(PRICING.getProduct('course').price + 100);
    // Only where a deferral is possible at all.
    expect(PRICING.deferredPriceFor('job')).toBeNull();
    expect(ROUTE).toContain('const amount = deferring ? studioPricing.deferredPriceFor(productKey) : product.price;');
    expect(REGISTER).toContain('is the better deal');
  });

  /*
   * A request HR has not decided is a promise, not a debt. Changing your mind
   * before it is granted costs the up-front price — reusing the row as it stood
   * would quote the ₹100 surcharge to somebody who had just chosen not to wait.
   */
  it('charges the up-front price to somebody who withdraws the request', () => {
    expect(ROUTE).toContain('withdrewRequestAt');
    expect(ROUTE).toContain("'metadata.payMode': studioPricing.PAY_MODES.NOW");
    const block = ROUTE.slice(ROUTE.indexOf('if (open && !deferring'));
    expect(block.slice(0, 900)).toContain('amount: product.price, amountRupees: product.price');
  });

  it('goes to HR, and the decision reaches the student either way', () => {
    expect(ROUTE).toContain("link: '/hr-deferrals.html'");
    expect(ROUTE).toContain("router.post('/hr/deferrals/:id/decide'");
    expect(ROUTE).toContain('deferApprovedAt: new Date()');
    expect(ROUTE).toContain('You can continue without paying now');
    expect(HRPAGE).toContain('/api/v2/studio/hr/deferrals');
  });

  // The certificate is what waits for the money, not the learning.
  it('holds the certificate until it is settled', () => {
    expect(CERT_ROUTE).toContain('if (studio.feeDue) {');
    expect(CERT_ROUTE).toContain('studioFeeDue: studio.feeDue');
  });

  it('checks eligibility first — a bill for something you cannot have yet is the wrong answer', () => {
    const claim = CERT_ROUTE.slice(CERT_ROUTE.indexOf('/certificates/claim/:type'));
    expect(claim.indexOf('You have not yet unlocked this certificate'))
      .toBeLessThan(claim.indexOf('studio.feeDue'));
  });

  it('says so on the certificate card, not only at the download button', () => {
    expect(CERTS).toContain('const studioDue = d.studioFeeDue || null;');
    expect(CERTS).toContain('Settle ₹${studioDue.amount} to release this');
  });
});

describe('one open order per product', () => {
  // Pressing the button twice must not leave two rows for an admin to approve
  // and a student to wonder about.
  it('hands back the existing order instead of making a second', () => {
    expect(ROUTE).toContain("status: { $in: ['pending', 'pending_verification'] }");
    expect(ROUTE).toContain('reused: true');
  });

  it('refuses to settle somebody else’s order', () => {
    expect(ROUTE).toContain("if (String(order.studentId) !== String(student._id))");
  });
});
