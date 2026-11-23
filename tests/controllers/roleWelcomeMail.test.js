'use strict';

/**
 * Each role's welcome mail lists that role's responsibilities and no one
 * else's; a student's names their plan and whether a fee stands before week
 * one; coordinators finally get one; and founders, investors, mentors and
 * contractors get the decision mail the welcome promises them.
 */
const fs = require('fs');
const path = require('path');

function load({ sendMail = jest.fn().mockResolvedValue({}) } = {}) {
  jest.resetModules();
  const actual = jest.requireActual('../../utils/mailer');
  jest.doMock('../../utils/mailer', () => ({
    ...actual,
    mailerReady: () => true,
    createEmailTransporter: () => ({ sendMail })
  }));
  const history = { create: jest.fn().mockResolvedValue({}) };
  jest.doMock('../../models/MailHistory', () => history);
  const controller = require('../../controllers/registerHubController');
  return { ...controller, sendMail, history };
}

const STUDENT_ITEM = 'fill in the TEN attendance form';
const COORDINATOR_ITEM = 'Set your domain test';
const FOUNDER_ITEM = 'Post your roles';

describe('welcome mail', () => {
  test('a free student gets their plan and only student responsibilities', async () => {
    const { sendRegistrationWelcome, sendMail } = load();
    await sendRegistrationWelcome({ name: 'Asha', email: 'asha@student-mail.in', role: 'student',
      employeeId: 'TEN-WEB-1001', domain: 'Web Development', tenure: '3 Months' });
    const { html, text } = sendMail.mock.calls[0][0];
    expect(html).toContain('Your plan is 3 Months, free of charge');
    expect(html).toContain('3 Months (free)');
    expect(html).toContain(STUDENT_ITEM);
    expect(html).not.toContain(COORDINATOR_ITEM);
    expect(html).not.toContain(FOUNDER_ITEM);
    expect(html).toContain('/student-login');
    expect(text).toContain('Your responsibilities:');
  });

  test('a fast-track student is told the fee that starts week one', async () => {
    const { sendRegistrationWelcome, sendMail } = load();
    await sendRegistrationWelcome({ name: 'Ravi', email: 'ravi@student-mail.in', role: 'student', tenure: '1 Week' });
    const { html } = sendMail.mock.calls[0][0];
    expect(html).toContain('1 Week (fast-track)');
    expect(html).toContain('Pay the ₹2,000 fee by UPI');
  });

  test('a coordinator gets coordinator duties and a sign-in link that exists', async () => {
    const { sendRegistrationWelcome, sendMail } = load();
    await sendRegistrationWelcome({ name: 'Meera', email: 'meera@student-mail.in', role: 'coordinator', domain: 'Data Science' });
    const { html } = sendMail.mock.calls[0][0];
    expect(html).toContain(COORDINATOR_ITEM);
    expect(html).not.toContain(STUDENT_ITEM);
    expect(html).toContain('/coordinator-login.html');
    expect(html).not.toContain('Plan:');
    expect(html).not.toContain('member ID');
  });

  test('every role that signs up is told its responsibilities', async () => {
    for (const role of ['student', 'coordinator', 'founder', 'investor', 'mentor', 'contractor']) {
      const { sendRegistrationWelcome, sendMail } = load();
      await sendRegistrationWelcome({ name: 'N', email: `${role}@student-mail.in`, role });
      expect([role, sendMail.mock.calls[0][0].html.includes('Your responsibilities')]).toEqual([role, true]);
    }
  });

  test('a founder is told a second email will follow, and gets founder duties only', async () => {
    const { sendRegistrationWelcome, sendMail } = load();
    await sendRegistrationWelcome({ name: 'Kabir', email: 'kabir@student-mail.in', role: 'founder', memberId: 'TEN-F-7' });
    const { html } = sendMail.mock.calls[0][0];
    expect(html).toContain('You will get a second email');
    expect(html).toContain(FOUNDER_ITEM);
    expect(html).not.toContain(STUDENT_ITEM);
    expect(html).toContain('/founder-login');
  });
});

describe('decision mail', () => {
  test('approval opens the right door and lists that role’s duties', async () => {
    const { sendPartnerDecision, sendMail, history } = load();
    await sendPartnerDecision({ name: 'Ira', email: 'ira@student-mail.in', role: 'investor', approved: true });
    const mail = sendMail.mock.calls[0][0];
    expect(mail.subject).toBe('Your TEN account is approved');
    expect(mail.html).toContain('/investor-login');
    expect(mail.html).toContain('register your interest');
    expect(history.create).toHaveBeenCalledWith(expect.objectContaining({ mailType: 'partner_approved', status: 'sent' }));
  });

  test('rejection offers the complaints address and no sign-in button', async () => {
    const { sendPartnerDecision, sendMail, history } = load();
    await sendPartnerDecision({ name: 'Dev', email: 'dev@student-mail.in', role: 'mentor', approved: false });
    const mail = sendMail.mock.calls[0][0];
    expect(mail.html).toContain('could not approve it this time');
    expect(mail.html).toContain('mailto:complaints@entrepreneurshipnetwork.net');
    expect(mail.html).not.toContain('login.html?role=mentor');
    expect(history.create).toHaveBeenCalledWith(expect.objectContaining({ mailType: 'partner_rejected' }));
  });

  test('a failed send never throws, and is recorded as failed', async () => {
    const { sendPartnerDecision, history } = load({ sendMail: jest.fn().mockRejectedValue(new Error('smtp down')) });
    await expect(sendPartnerDecision({ name: 'X', email: 'x@student-mail.in', role: 'contractor', approved: true }))
      .resolves.toBeUndefined();
    expect(history.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', errorMessage: 'smtp down' }));
  });
});

describe('server.js wiring', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');

  test('a self-registered coordinator is sent the welcome mail', () => {
    expect(server).toMatch(/await newCoord\.save\(\);\s*await sendRegistrationWelcome\(\{[^}]*role: "coordinator"/);
  });

  test('HR approve and reject mail partners only, and only when the decision changes', () => {
    for (const [decision, approved] of [['approved', 'true'], ['rejected', 'false']]) {
      expect(server).toContain(
        `if (before && before.verificationStatus !== '${decision}' && user.role !== 'student') {\n`
        + `      await sendPartnerDecision({ name: user.fullName, email: user.email, role: user.role, approved: ${approved} });`);
    }
  });
});
