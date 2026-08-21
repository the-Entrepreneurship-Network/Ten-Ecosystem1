'use strict';

/**
 * @jest-environment node
 *
 * The paid tracks sell a bundle, not just a shorter calendar.
 *
 * The rules that matter here are commercial ones, and getting them wrong costs
 * real money in both directions: advertising a saving that is not real, or
 * granting a certificate fee to a student on a free track. The sandbox has no
 * MongoDB, so the arithmetic and the shape are tested directly and the wiring
 * is asserted on source — the pattern the rest of this suite uses.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const cfg = require('../../config/tenurePayment');

const adminRoutes = fs.readFileSync(path.join(root, 'routes/adminPortal.js'), 'utf8');
const serverJs    = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const dashboard   = fs.readFileSync(path.join(root, 'public/student-dashboard.html'), 'utf8');
const service     = fs.readFileSync(path.join(root, 'services/tenureBenefits.js'), 'utf8');

describe('every paid track is worth more than it costs', () => {
  it.each(['1week', '15days', '1month'])('%s advertises a real saving', (key) => {
    const b = cfg.getBenefitsFor(key);
    expect(b).toBeTruthy();
    expect(b.price).toBe(cfg.PAID_TENURES[key]);
    // The whole point of the bundle: never sell ₹1,500 of fee for ₹1,000 of value.
    expect(b.valueTotal).toBeGreaterThan(b.price);
    expect(b.saving).toBe(b.valueTotal - b.price);
  });

  it('the headline total is summed from the perks, never written by hand', () => {
    for (const b of cfg.getAllBenefits()) {
      const summed = b.perks.reduce((n, p) => n + (p.worth || 0), 0);
      expect(b.valueTotal).toBe(summed);
    }
  });

  it('paying more always gets you more — the ladder never inverts', () => {
    const byPrice = cfg.getAllBenefits().slice().sort((a, b) => a.price - b.price);
    for (let i = 1; i < byPrice.length; i++) {
      expect(byPrice[i].valueTotal).toBeGreaterThan(byPrice[i - 1].valueTotal);
      expect(byPrice[i].coins).toBeGreaterThan(byPrice[i - 1].coins);
    }
  });

  it('coins are priced at the rate the marketplace actually charges', () => {
    // public/ten-extras.js: 200 coins buys ₹100 off, 600 buys ₹300, 1000 buys
    // ₹500 — and it falls back to `maxCoins * 0.5`. Same number, or the saving
    // we advertise is one the student cannot realise.
    expect(cfg.COIN_RUPEE_VALUE).toBe(0.5);
    const extras = fs.readFileSync(path.join(root, 'public/ten-extras.js'), 'utf8');
    expect(extras).toContain('maxCoins * 0.5');

    for (const b of cfg.getAllBenefits()) {
      const coinPerk = b.perks.find((p) => p.granted === 'coins');
      expect(coinPerk.worth).toBe(Math.round(b.coins * cfg.COIN_RUPEE_VALUE));
    }
  });

  it('a free track gets no bundle at all', () => {
    ['45days', '3months', '6months', null, undefined, 'nonsense']
      .forEach((t) => expect(cfg.getBenefitsFor(t)).toBeNull());
  });

  it('the certificate is sold as a fee waiver, not as an issued certificate', () => {
    for (const b of cfg.getAllBenefits()) {
      const certPerk = b.perks.find((p) => p.granted === 'certificate');
      expect(certPerk.label).toMatch(/fee included$/);
      expect(certPerk.worth).toBe(cfg.CERTIFICATE_VALUES[b.certificate]);
    }
  });
});

describe('what is promised is what is granted', () => {
  it('the grant reads the same definition the screen renders', () => {
    expect(service).toContain("require('../config/tenurePayment')");
    expect(service).toMatch(/getBenefitsFor\(durationType\)/);
    // Only the two automatic perks are actually handed over.
    expect(service).toMatch(/creditCoins\(/);
    expect(service).toMatch(/waiveCertificateFee\(/);
  });

  it('a free-track student can never be granted a bundle', () => {
    expect(service).toMatch(/if \(!bundle\) return \{ granted: false/);
  });

  it('granting twice does not double-credit coins', () => {
    expect(service).toMatch(/tenureBenefits\.grantedAt/);
    expect(service).toMatch(/already granted/);
  });

  it('coins are credited atomically, not read-modify-written', () => {
    expect(service).toMatch(/\$inc: \{ totalCoins: coins \}/);
    expect(service).toMatch(/upsert: true/);
    expect(service).not.toMatch(/totalCoins = .*\+/);
  });

  it('the waiver is a zero-rupee row, so revenue is not overstated', () => {
    expect(service).toMatch(/amount: 0/);
    expect(service).toMatch(/status: 'success'/);
    expect(service).toMatch(/purpose,/);
    // and never issued twice
    expect(service).toMatch(/if \(existing\) return false/);
  });

  it('a student who already bought that certificate is not re-granted it', () => {
    expect(service).toMatch(/status: \{ \$in: \['success', 'pending_verification'\] \}/);
  });

  it('a failed perk never fails the approval it came from', () => {
    expect(service).toMatch(/catch \(err\) \{[\s\S]*?return \{ granted: false, reason: err\.message \}/);
  });

  it('both admin approval routes grant the same bundle', () => {
    const calls = adminRoutes.match(/grantTenureBenefits\(student/g) || [];
    expect(calls.length).toBe(2);
    expect(adminRoutes).toMatch(/sourceOrderId: payment\.orderId/);
    expect(adminRoutes).toMatch(/sourceOrderId: req\.params\.orderId/);
  });
});

describe('the payment screen shows what the fee buys', () => {
  it('the status endpoint sends the bundle, and null for free tracks', () => {
    expect(serverJs).toMatch(/benefits: benefits/);
    expect(serverJs).toMatch(/allPlans: isShortCourse \? tenurePaymentConfig\.getAllBenefits\(\) : \[\]/);
    expect(serverJs).toMatch(/granted: \(stu\.tenureBenefits && stu\.tenureBenefits\.grantedAt\)/);
  });

  it('the screen renders the stack from the server, hardcoding nothing', () => {
    expect(dashboard).toContain('renderTenureValueStack');
    expect(dashboard).toContain('id="tenurePerkList"');
    expect(dashboard).toContain('id="tenureSavingLine"');
    // no invented prices in the markup
    expect(dashboard).not.toMatch(/You save ₹\d/);
  });

  it('a saving is only ever shown when there is one', () => {
    expect(dashboard).toMatch(/if \(benefits\.saving > 0\)/);
  });

  it('the perk labels are escaped before going into innerHTML', () => {
    const block = dashboard.slice(
      dashboard.indexOf('function renderTenureValueStack'),
      dashboard.indexOf('function initiateTenurePaymentTimer')
    );
    expect(block).toMatch(/esc\(p\.label\)/);
  });

  it('the student is told what landed, once', () => {
    expect(dashboard).toContain('showTenureUnlocked');
    expect(dashboard).toMatch(/ten_tenure_unlocked_/);
  });

  it('risk reversal and admin-verified wording are on the screen', () => {
    expect(dashboard).toMatch(/refunded in full/);
  });
});

describe('the payment QR cannot be a broken image', () => {
  it('the corrupt file is no longer the fallback', () => {
    const buf = fs.readFileSync(path.join(root, 'public/paytm-qr.jpeg'));
    expect(buf.slice(0, 3).toString('hex')).not.toBe('ffd8ff');   // not a JPEG
    expect(dashboard).toMatch(/this\.src = '\/api\/upi-qr\?amount=/);
    // Not the fallback and not the initial src either — a page whose JS has not
    // run yet must not paint a broken image where the QR belongs.
    expect(dashboard).toMatch(/id="tenureQrImg" src="\/api\/upi-qr"/);
    // The only mention left is the comment explaining why it is gone.
    const live = dashboard.split('\n').filter((l) => l.includes('paytm-qr.jpeg') && !l.trim().startsWith('//'));
    expect(live).toEqual([]);
  });

  it('the generated QR endpoint clamps the amount it is handed', () => {
    expect(serverJs).toMatch(/app\.get\('\/api\/upi-qr'/);
    expect(serverJs).toMatch(/Math\.min\(100000, Math\.max\(0, Number\(req\.query\.amount\)/);
  });

  it('it really produces a PNG carrying the business UPI id', async () => {
    const QRCode = require('qrcode');
    const { BUSINESS_UPI } = require('../../config/payment');
    const link = 'upi://pay?pa=' + encodeURIComponent(BUSINESS_UPI.upiId) + '&am=1000&cu=INR';
    const png = await QRCode.toBuffer(link, { type: 'png', width: 480, margin: 1 });
    expect(png.slice(0, 4).toString('hex')).toBe('89504e47');
    expect(BUSINESS_UPI.upiId).toBe('paytmqr5k0ods@ptys');
  });
});
