'use strict';

/**
 * The role intro screen on public/register.html.
 *
 * The grid asked people to choose one of six identities from a single line of
 * text each, and then dropped them straight into a form. Two things went wrong
 * there:
 *
 *   1. "Contractor" and "Investor" mean nothing to somebody who has not worked
 *      with TEN before, so the choice was a guess.
 *   2. The programme fee only appeared on step 3 of the wizard. A student who
 *      picked "1 Week" because it sounded like the smallest commitment found a
 *      2000 rupee fee after registering, while 6 Months — the longest track —
 *      is free.
 *
 * A role is now explained before it is chosen, and the fee table is on that
 * screen. These tests pin the parts that are easy to break later: the fee
 * figures coming from ONE list, the two roles whose portals exist but whose
 * registration does not, and the /domains fast path that must NOT be slowed
 * down by any of it.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
/** Assert against live markup, never a comment quoting the old markup. */
const strip = (src) => src.replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const page = read('public/register.html');
const live = strip(page);

describe('a role is explained before it is chosen', () => {
  it('the intro screen exists and starts hidden', () => {
    expect(live).toContain('id="roleIntroScreen" class="hidden"');
  });

  it('picking a role opens the intro, not the form', () => {
    // selectRole() used to jump straight into the wizard.
    const at = live.indexOf('function selectRole(role)');
    expect(at).toBeGreaterThan(-1);
    const body = live.slice(at, at + 900);
    expect(body).toContain('renderRoleIntro(role)');
    expect(body).toContain("document.getElementById(\"roleIntroScreen\").classList.remove('hidden')");
  });

  it('and Continue is what opens the form', () => {
    expect(live).toContain('function continueFromIntro()');
    expect(live).toContain('function openRoleForm(role)');
    expect(live).toContain('function backToRolesFromIntro()');
  });

  it('every role on the grid has copy to show', () => {
    ['student', 'mentor', 'founder', 'investor', 'contractor', 'coordinator'].forEach((role) => {
      expect(live).toContain(`selectRole('${role}')`);
      expect(new RegExp(`\\b${role}:\\s*\\{`).test(live)).toBe(true);
    });
  });

  it('the copy is written into the DOM as text, never as HTML', () => {
    /*
     * Everything on this screen is authored by us, so there is no injection
     * today. Using textContent keeps it that way if a line is ever fed from a
     * CMS or a query string.
     */
    const at = live.indexOf('function introBullets');
    const body = live.slice(at, at + 700);
    expect(body).toContain('span.textContent = text');
    expect(body).not.toContain('innerHTML +=');
  });
});

describe('the fee is shown before registering, not after', () => {
  it('the fee grid is built from the tenure select, not typed again', () => {
    /*
     * Two hardcoded price lists is one too many: the intro would eventually
     * promise a figure the form contradicts. The panel reads the same
     * <option> list the wizard uses.
     */
    const at = live.indexOf('function renderIntroFees');
    expect(at).toBeGreaterThan(-1);
    const body = live.slice(at, at + 1200);
    expect(body).toContain("getElementById('stu_tenure')");
    expect(body).toContain('select.options');
  });

  it('that select really is the id the panel reads', () => {
    // The first version of this read getElementById('tenure') and silently
    // rendered an empty "What it costs" box. The id is stu_tenure.
    expect(live).toMatch(/<select id="stu_tenure"/);
  });

  it('an empty grid hides the panel rather than promising nothing', () => {
    expect(live).toContain('return grid.children.length > 0;');
    expect(live).toContain('var showFees = !!(info.fees && renderIntroFees());');
    expect(live).toContain("fees.classList.toggle('hidden', !showFees)");
  });

  it('the paid and free tracks are both still described in that one list', () => {
    // If these ever move, the test above stops meaning anything.
    ['1 Week', '15 Days', '1 Month'].forEach((t) => {
      expect(live).toMatch(new RegExp(`<option value="${t}">[^<]*₹`));
    });
    ['45 Days', '3 Months', '6 Months'].forEach((t) => {
      expect(live).toMatch(new RegExp(`<option value="${t}">[^<]*free`, 'i'));
    });
  });

  it('only the student sees a fee panel', () => {
    const student = live.slice(live.indexOf('student: {'), live.indexOf('mentor: {'));
    expect(student).toContain('fees: true');
    ['mentor', 'founder', 'investor', 'contractor', 'coordinator'].forEach((role) => {
      const at = live.indexOf(`${role}: {`);
      expect(live.slice(at, at + 1600)).not.toContain('fees: true');
    });
  });
});

describe('investor and contractor are open, and say so', () => {
  /*
   * An earlier version of this file asserted `closed: true` on both, because
   * at the time the wizard had no steps for them and the grid showed a
   * "Coming Soon" badge over two finished dashboards.
   *
   * main has since given both their own wizard steps, payloads and step pills,
   * and opened the cards. So they are ordinary self-serve roles now, and the
   * intro describes them rather than apologising for them.
   */
  it('the portals they describe really exist', () => {
    ['public/investor-dashboard.html', 'public/contractor-dashboard.html',
      'models/InvestorProfile.js', 'models/ContractorProject.js']
      .forEach((f) => expect(fs.existsSync(path.join(root, f))).toBe(true));
  });

  it('the wizard really has steps for them, so Continue is not a dead end', () => {
    ['investorStep2', 'investorStep3', 'contractorStep2', 'contractorStep3']
      .forEach((id) => expect(live).toContain('id="' + id + '"'));
    expect(live).toContain("if (activeRole === 'investor') {");
    expect(live).toContain("if (activeRole === 'contractor') {");
  });

  it('neither is marked closed, and neither is sold as invitation-only', () => {
    ['investor', 'contractor'].forEach((role) => {
      const at = live.indexOf(`${role}: {`);
      const body = live.slice(at, at + 1600);
      expect(body).not.toContain('closed: true');
      expect(body).not.toContain('mailto:');
      expect(body).toContain(`loginHref: '${role}-login.html'`);
    });
  });

  it('nothing anywhere still calls them closed', () => {
    expect(live).not.toContain('closed: true');
    expect(live).not.toContain('Portal Under Construction');
    expect(live).not.toContain('Coming Soon');
    expect(live).not.toContain('cursor: not-allowed');
  });
});

describe('nothing that already worked got slower', () => {
  it('arriving from /domains still goes straight to the form', () => {
    /*
     * ?role=student means the person has already chosen a domain and a route
     * on /domains. Explaining the role back to them there is exactly the
     * friction this flow exists to remove.
     */
    const at = live.indexOf('function prefillFromQuery');
    const body = live.slice(at, at + 1400);
    // main widened this from student-only to every self-serve role, so the
    // skip has to cover all of them, not just the one.
    expect(body).toContain('openRoleForm(role)');
    expect(body).not.toContain('selectRole(role)');
  });

  it('the wizard still knows which role it is filling in', () => {
    const at = live.indexOf('function openRoleForm');
    const body = live.slice(at, at + 600);
    expect(body).toContain('document.getElementById("selectedRoleInput").value = role');
    expect(body).toContain('renderWizardStep()');
  });

  it('coordinator still reaches its own registration page', () => {
    // It used to be a direct link. It now goes via the intro, which says the
    // role is staff-only before the form opens — but it must still arrive.
    const at = live.indexOf('coordinator: {');
    expect(live.slice(at, at + 1400)).toContain("href: 'coordinator-register.html'");
    expect(live).toContain('if (info && info.href) { window.location.href = info.href; return; }');
  });

  it('the existing back-out of the form is untouched', () => {
    expect(live).toContain('function goBackToSelection()');
  });
});

describe('the Career Studio is offered where it is not already included', () => {
  /*
   * services/studioAccess.js grants the Studio to anyone on a PAID internship
   * track — the 1-week, 15-day and 1-month fees already carry it. The free
   * tracks do not. So the fee grid marks the paid ones "Studio included" and
   * offers it on the free ones, which is the true difference rather than an
   * invented one.
   */
  const pricing = require('../../config/studioPricing');

  it('a paid track really does include the Studio, so the label is true', () => {
    const src = fs.readFileSync(path.join(root, 'services/studioAccess.js'), 'utf8');
    expect(src).toMatch(/paid internship track/i);
  });

  it('the price is fetched, never written into the page', () => {
    // config/studioPricing.js is the one price list. A number typed here would
    // be a second one, and the checkout would eventually contradict it.
    expect(live).toContain("fetch('/api/v2/studio/pricing'");
    expect(live).not.toMatch(/₹\s*500/);
    expect(live).toContain('STUDIO_COMBO.price');
  });

  it('that endpoint is public, so a signed-out visitor sees the price', () => {
    const studio = fs.readFileSync(path.join(root, 'routes/v2/studio.js'), 'utf8');
    const at = studio.indexOf("router.get('/pricing'");
    expect(at).toBeGreaterThan(-1);
    expect(studio.slice(at, at + 120)).not.toContain('requireStudent');
  });

  it('the saving it claims is arithmetic from that same table', () => {
    const t = pricing.getPricingTable();
    const full = t.singles.reduce((a, p) => a + p.price, 0);
    expect(full).toBeGreaterThan(t.combo.price);
    expect(live).toContain('full - STUDIO_COMBO.price');
  });

  it('a failed price lookup hides the offer instead of breaking registration', () => {
    expect(live).toContain('if (!box || !STUDIO_COMBO) return;');
    expect(live).toContain('.catch(function () {');   // fetch failure is swallowed
    expect(live).toContain("studio.classList.add('hidden')");
  });

  it('it is described as optional, because it is', () => {
    // The internship and its certificate never require it — studioAccess gates
    // the Studio portals only.
    expect(live).toContain('never needed to finish your internship');
  });
});
