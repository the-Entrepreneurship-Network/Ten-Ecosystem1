'use strict';

/**
 * The help desk's matcher against the real starter answers, with emails the
 * way students write them: the first three are from the HR portal's intern
 * chat, word for word. A change to the matcher or to the starter answers that
 * sends any of these to the wrong place fails here.
 */
const { match, tokens } = require('../../services/supportDesk/matcher');
const starters = require('../../services/supportDesk/starterAnswers');

const answerFor = (text) => {
    const r = match(text, starters);
    if (r.sensitive) return 'PERSON';
    return r.answers.length ? r.answers[0].entry.key : 'PERSON';
};

describe('emails get the answer they ask for', () => {
    test.each([
        ['i am new here can anyone tell me how the attendence system work here', 'attendance'],
        ['what are the steps i have to follow daily i am an AI intern', 'daily-routine'],
        ['Sir, I would like to know whether I need to pay any fee to receive the internship completion certificate after successfully completing the internship. Is the certificate completely free of charge?', 'certificate-free'],
        ['sir my emp id is not showing', 'employee-id'],
        ['password bhool gaya hu', 'password-reset'],
        ['offer letter kab milega sir', 'offer-letter'],
        ['I uploaded my documents but the status is still under review', 'documents'],
        ['My quiz is locked, what to do', 'tasks'],
        ['how do i pay the fees', 'pay-fee'],
        ['I paid via UPI but my dashboard is still locked', 'pay-fee'],
        ['is the internship free?', 'plans-fees'],
        ['unable to login to portal', 'login'],
        ["I didn't get any email from you", 'emails-not-received'],
        ['Sir please provide me the whatsapp group link of web development', 'whatsapp-group'],
        ['Respected Sir/Madam, I have completed all my tasks but have not received my internship certificate yet. Kindly look into it.', 'completion-certificate'],
        ['I am not able to upload my aadhaar card, it says invalid file format', 'documents'],
        // complaints@ on 25 Nov 2026, word for word apart from names: formal letters
        // and odd phrasings that went to a person before.
        ['Respected Sir/Madam, I am writing to kindly request you to provide me with my Employee ID. I would be extremely grateful if you could share this information at your earliest convenience.', 'employee-id'],
        ["I didn't got employee email id", 'employee-id'],
        ['Please provide my employee id , feel free to contact me if any further details are required.', 'employee-id'],
        ['I am unable to join the domain group using the invitation link provided. Could you please check the issue and help me get access to the group? If necessary, kindly share a new invitation link or guide me through the joining process.', 'whatsapp-link-reset'],
        ['when i open the whatsapp group link it says the link was reset', 'whatsapp-link-reset']
    ])('%s', (text, key) => {
        expect(answerFor(text)).toBe(key);
    });
});

describe('a person answers', () => {
    test.each([
        // Where the portal contradicts itself today: any fixed answer is wrong for someone.
        'is this internship paid? do we get stipend?',
        'what is the criteria for LOR',
        'my name is wrong on the certificate',
        'I want to change my domain from web development to data science',
        'What is the end date of my internship?',
        // Never a robot's call.
        'I want a refund',
        'Is this internship fake?',
        // Nothing saved fits.
        'my laptop broke during the hackathon',
        'hello',
        // Job seekers asking for a referral, 25 Nov 2026: not an intern's Employee ID.
        'I am currently looking for internship opportunities. I kindly request you to share your Employee ID or referral details so that I can apply through the appropriate referral process.',
        // A question about which document to send instead: HR decides.
        'I do not have my latest semester marksheet available. Could you please advise me on what alternative document I can submit in its place, or if I can submit it at a later date?'
    ])('%s', (text) => {
        expect(answerFor(text)).toBe('PERSON');
    });

    test('"working fine" is not about a fine', () => {
        expect(answerFor('my login was working fine yesterday but now unable to login')).toBe('login');
    });
});

describe('the matcher itself', () => {
    test('folds the ways students write one thing into one token', () => {
        for (const s of ['emp id', 'empid', 'employee no.', 'Employee ID', 'intern id']) {
            expect(tokens(s)).toEqual(['employeeid']);
        }
        expect(tokens('please sir kindly help')).toEqual([]);
    });

    test('two questions in one email get both answers', () => {
        const r = match('When will I get my offer letter? Also how do I mark attendance?', starters);
        expect(r.answers.map((a) => a.entry.key).sort()).toEqual(['attendance', 'offer-letter']);
    });

    test('a stricter threshold sends the borderline email to a person', () => {
        const text = 'Sir please provide me the whatsapp group link of web development';
        expect(match(text, starters, { threshold: 0.5 }).answers).toHaveLength(1);
        expect(match(text, starters, { threshold: 0.9 }).answers).toHaveLength(0);
    });

    test('every starter answer is found by its own question', () => {
        for (const s of starters) expect([s.key, answerFor(s.question)]).toEqual([s.key, s.key]);
    });
});
