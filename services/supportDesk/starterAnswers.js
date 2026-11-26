'use strict';

/**
 * The help desk's first answers, written from what the portal actually does
 * (checked against the code on 23 Nov 2026). HR edits them on the Help Desk
 * page; an edited one is never overwritten by a later release.
 *
 * Deliberately NOT answered here, so they reach a person: the Letter of
 * Recommendation (its rules differ between pages), paid course certificates
 * (their downloads fail today), fines, stipend (the pages disagree), name
 * corrections, changing domain or plan, and refunds.
 *
 * `answer` goes to anyone. `personal`, when present, goes instead to a
 * registered student Gmail verified, filled in from their account
 * (services/supportDesk/facts.js lists the {{placeholders}}).
 */
module.exports = [
    {
        key: 'employee-id',
        question: 'How do I get or find my Employee ID?',
        examples: [
            'what is my employee id', 'i did not get my employee id', 'emp id not received', 'where can i find my emp id',
            'i forgot my employee id', 'how to get employee id', 'employee id kaise milega', 'mera employee id kya hai',
            'intern id not showing', 'lost my ten id', 'seeking employee id', 'i didn\'t got employee id',
            'please share my employee id', 'kindly provide my employee id', 'not yet received my employee id',
            'i didn\'t get employee id till now', 'still no employee id', 'did not receive employee id yet',
            'please generate my employee id', 'assign me a new employee id', 'kindly generate employee id for my internship',
            'request for employee id', 'could you please share my employee id to complete my onboarding', 'i joined as an intern please share my employee id'
        ],
        answer: 'You get your Employee ID the moment you register. It looks like TEN/WEB/1005, and you will find it in ' +
            'your welcome email and at the top of your dashboard.\n\n' +
            'Not registered yet? Register here: {{registerUrl}}\n\n' +
            "Already registered but can't find it? Sign in with your email address at {{loginUrl}}, and it is at the top of your dashboard.",
        personal: 'Your Employee ID is {{employeeId}}. You can also see it at the top of your dashboard after signing in at {{loginUrl}}.'
    },
    {
        key: 'dashboard',
        question: 'Where is my dashboard and how do I open it?',
        examples: [
            'where is my dashboard', 'how can i find my dashboard', 'how to open student dashboard', 'dashboard not found',
            'where is the intern dashboard', 'dashboard kaha hai', 'how to go to my dashboard', 'dashboard link',
            'how can i access my dashboard', 'where can i access my dashboard', 'how do i log in to my dashboard',
            'how to access student portal', 'where do i sign in'
        ],
        answer: 'Your dashboard opens as soon as you sign in. Go to {{loginUrl}} and sign in with your email address or ' +
            'your Employee ID and the password you chose when you registered.\n\n' +
            'On the dashboard you will find your Employee ID at the top, "Mark Today\'s Attendance", your coordinator, ' +
            'the Task Journey and My Documents. On a phone, open the menu at the top to see all the pages.'
    },
    {
        key: 'register',
        question: 'How do I register for the internship?',
        examples: [
            'how to register', 'how can i join the internship', 'how to apply for the internship', 'registration process',
            'i want to join', 'how to enroll', 'registration kaise kare', 'where is the registration form',
            'i am interested', 'interested in the internship', 'i am interested in joining'
        ],
        answer: 'You can register here: {{registerUrl}}\n\n' +
            'Choose "Student", pick your domain and your plan, and submit the form. Your Employee ID is created straight ' +
            'away and sent to you in your welcome email.\n\n' +
            'The 45 Days, 3 Months and 6 Months plans are free. The fast-track plans have a fee: 1 Week ₹2000, ' +
            '15 Days ₹1500 and 1 Month ₹1000.'
    },
    {
        key: 'login',
        question: "I can't log in to the portal",
        examples: [
            "i can't login", 'unable to login', 'login not working', 'how to login to the student portal',
            'invalid employee id error', 'login nahi ho raha', 'which id should i use to login', 'my account is locked', 'login page link'
        ],
        answer: 'Sign in at {{loginUrl}} with your email address or your Employee ID (for example TEN/WEB/1005), and the ' +
            'password you chose when you registered. Your Member ID (TEN-STU-…) does not work for signing in.\n\n' +
            'After 5 wrong passwords the account locks for 15 minutes, so wait a little and try again. If you have ' +
            'forgotten your password, use "Forgot password?" on the sign-in page.',
        personal: 'Sign in at {{loginUrl}} with this email address or your Employee ID, {{employeeId}}, and the password ' +
            'you chose when you registered.\n\n' +
            'After 5 wrong passwords the account locks for 15 minutes, so wait a little and try again. If you have ' +
            'forgotten your password, use "Forgot password?" on the sign-in page.'
    },
    {
        key: 'password-reset',
        question: 'I forgot my password',
        examples: [
            'forgot password', 'reset my password', 'password bhool gaya', 'how to change my password',
            'password reset link not received', 'i lost my password', 'change my portal password'
        ],
        answer: 'On the sign-in page ({{loginUrl}}), click "Forgot password?" under the password box and enter the email ' +
            'address you registered with. You will get an email with a link to set a new password. The link works for ' +
            '1 hour, and the new password needs at least 8 characters.\n\n' +
            "If the email doesn't arrive, check your Spam and Promotions folders. We send at most 2 reset emails to an " +
            'address in 24 hours, so please don\'t request it many times.'
    },
    {
        key: 'plans-fees',
        question: 'What are the plans and fees?',
        examples: [
            'what is the fee', 'is the internship free', 'how much does the internship cost', 'fees for 1 month internship',
            'which plans are free', 'kitna fee hai', 'is there any registration fee', 'price of the internship plans', 'fast track fee'
        ],
        answer: 'The 45 Days, 3 Months and 6 Months plans are free.\n\n' +
            'The fast-track plans have a one-time fee: 1 Week ₹2000, 15 Days ₹1500 and 1 Month ₹1000. They come with ' +
            'extras such as coins and the Career Studio.\n\n' +
            'You choose your plan when you register: {{registerUrl}}',
        personal: 'You are on the {{plan}} plan. {{feeStatus}}\n\n' +
            'For reference: the 45 Days, 3 Months and 6 Months plans are free, and the fast-track plans cost ₹2000 ' +
            '(1 Week), ₹1500 (15 Days) and ₹1000 (1 Month).'
    },
    {
        key: 'pay-fee',
        question: 'How do I pay the fee, and when is my payment approved?',
        examples: [
            'how to pay the fee', 'i paid but my dashboard is still locked', 'payment done but not approved', 'utr submitted',
            'where do i pay', 'how to make the payment', 'how long does payment approval take', 'i have paid the fees',
            'upi payment not updated'
        ],
        answer: 'When you sign in on a fast-track plan, a payment screen opens with a UPI QR code for your exact fee. Pay ' +
            'with any UPI app, then type the UPI transaction ID (UTR) into that screen and press "Submit UTR for HR Approval".\n\n' +
            'Our team checks each payment by hand, usually within 24 hours, and your dashboard opens as soon as it is ' +
            'approved. If a payment is not approved, the screen shows the reason and you can submit again.',
        personal: '{{feeStatus}}'
    },
    {
        key: 'certificate-free',
        question: 'Is the internship certificate free?',
        examples: [
            'is the certificate free', 'do i need to pay for the certificate', 'is the completion certificate free of charge',
            'certificate fee', 'do we have to pay any fee to receive the internship completion certificate',
            'certificate ke liye paisa dena hoga', 'is there any charge for the certificate'
        ],
        answer: 'Yes. Your Letter of Completion (your internship certificate) and your offer letter are free on every ' +
            "plan, including the free ones. You don't pay anything to receive them.\n\n" +
            'The only certificates with a price are the optional course certificates (Expert, Nano Degree and ' +
            'Fellowship), which you choose to claim separately.'
    },
    {
        key: 'completion-certificate',
        question: 'When will I get my internship certificate (Letter of Completion)?',
        examples: [
            'when will i get my certificate', 'how to get the completion certificate', 'letter of completion',
            'certificate not received', 'internship certificate kab milega', 'i completed my internship where is my certificate',
            'how to download my certificate', 'when will my certificate come',
            'i have completed all my tasks but not received my certificate'
        ],
        answer: 'Your Letter of Completion is issued once all your weekly tasks in the Task Journey are approved and your ' +
            'attendance is above 75%. It is emailed to you as a PDF and also appears in My Documents, under the My ' +
            'Documents tab, where you can download it any time.\n\n' +
            'If you have finished everything, open My Documents and use "Apply Now" next to the Letter of Completion.',
        personal: '{{completionStatus}}\n\n' +
            'The letter is emailed to you as a PDF and also appears in My Documents, under the My Documents tab.'
    },
    {
        key: 'offer-letter',
        question: 'When will I get my offer letter?',
        examples: [
            'when will i get my offer letter', 'offer letter not received', 'how to get the offer letter', 'offer letter kab milega',
            'i uploaded my documents but got no offer letter', 'joining letter', 'where can i download my offer letter'
        ],
        answer: 'Your offer letter is issued after you upload your address proof and latest college marksheet under ' +
            'My Documents → Upload Documents, and HR approves them. It is then emailed to you as a PDF, and you can ' +
            'download it any time in My Documents, under the My Documents tab.',
        personal: '{{offerLetterStatus}}'
    },
    {
        key: 'documents',
        question: 'How do I upload my documents?',
        examples: [
            'how to upload documents', 'which documents are required', 'document upload failed', 'invalid file format',
            'aadhaar upload', 'marksheet upload', 'my documents are under review', 'my documents were rejected',
            'document kaise upload kare'
        ],
        answer: 'Open My Documents on your dashboard and go to the Upload Documents tab. Upload two files:\n' +
            '1. Address proof: Aadhaar, passport, voter ID or any government ID.\n' +
            '2. Your latest college marksheet.\n\n' +
            'Each must be a PDF of up to 25 MB. Once both are uploaded they go to HR for review automatically, and your ' +
            'offer letter follows once they are approved.\n\n' +
            'If your phone says "Invalid File Format" for a real PDF, please try uploading from a computer.',
        personal: '{{documentsStatus}}\n\n' +
            'Documents go under My Documents → Upload Documents: your address proof (Aadhaar, passport, voter ID or any ' +
            'government ID) and your latest college marksheet, each a PDF of up to 25 MB.'
    },
    {
        key: 'attendance',
        question: 'How does attendance work?',
        examples: [
            'how does attendance work', 'how to mark attendance', 'my attendance is not marked', 'attendance system',
            'attendance kaise lagaye', 'what is the attendance rule', 'is attendance compulsory', 'attendance percentage'
        ],
        answer: "Attendance is marked every day from Monday to Saturday (Sundays don't count). On your dashboard, open " +
            '🪪 Attendance:\n' +
            '1. Click "Open Official Google Form", fill it in and submit it, then click "✓ Confirm Form Submitted".\n' +
            '2. Click "Mark Today\'s Attendance".\n\n' +
            'Keep your attendance above 75%, because your Letter of Completion needs it. The attendance panel shows your ' +
            'percentage and how many more days you need.'
    },
    {
        key: 'daily-routine',
        question: 'What do I have to do every day as an intern?',
        examples: [
            'what are the steps i have to follow daily', 'what should i do daily', 'i am new here what do i do',
            'daily work of an intern', 'roz kya karna hai', 'what is my daily task', 'how does the internship work',
            'i am new here can anyone tell me the process'
        ],
        answer: "Here's what to do as an intern:\n" +
            '1. Mark your attendance every day from Monday to Saturday: first the official Google Form, then ' +
            '"Mark Today\'s Attendance" on your dashboard.\n' +
            '2. Each week, in the Task Journey: watch the video and pass the quiz. The next week opens once this ' +
            "week's tasks are approved.\n" +
            '3. Do the Daily Job Posting Task on the Task Journey page: share the TEN hiring post and tick the platforms.\n' +
            '4. Keep your attendance above 75%.\n' +
            '5. Upload your address proof and marksheet under My Documents, so your offer letter can be issued.\n' +
            '6. Check My Tasks for anything your coordinator posts, and ask questions in your Domain Chat on the dashboard.'
    },
    {
        key: 'tasks',
        question: 'How do I do and submit my tasks?',
        examples: [
            'how to submit a task', 'where are my tasks', 'task not unlocked', 'next week is not opening', 'quiz is locked',
            'how to submit the assignment', 'task kaise submit kare', 'my task is not approved', 'coordinator task submission'
        ],
        answer: 'Your weekly tasks are in 🪙 Task Journey on the dashboard. For each task, watch at least 80% of the video ' +
            'and then take the quiz. Passing the quiz approves the task automatically, and the next week opens once every ' +
            'task of the current week is approved. If you fail a quiz three times, it locks for 24 hours.\n\n' +
            'Tasks your coordinator posts are under My Tasks. Submit them with your GitHub or Google Drive link, a short ' +
            'description and a screenshot, and your coordinator reviews them.',
        personal: '{{tasksStatus}}\n\n' +
            'For each task in 🪙 Task Journey, watch at least 80% of the video and then take the quiz. Passing the quiz ' +
            'approves the task automatically, and the next week opens once every task of the current week is approved. ' +
            'If you fail a quiz three times, it locks for 24 hours.\n\n' +
            'Tasks your coordinator posts are under My Tasks. Submit them with your GitHub or Google Drive link, a short ' +
            'description and a screenshot, and your coordinator reviews them.'
    },
    {
        key: 'verify-certificate',
        question: 'How can an employer verify my certificate or offer letter?',
        examples: [
            'how to verify my certificate', 'certificate verification', 'company wants to verify my offer letter',
            'verify document number', 'is my certificate genuine', 'verification link'
        ],
        answer: 'Anyone can check a TEN document here, without signing in: {{verifyUrl}}\n\n' +
            'Enter the document number printed on it, for example TEN-OL-2026-A1B2C3 for an offer letter or TEN-LOC-… ' +
            'for a Letter of Completion. The page shows whether it is genuine.'
    },
    {
        key: 'contact-coordinator',
        question: 'How do I contact my coordinator or HR?',
        examples: [
            'how to contact my coordinator', 'who is my coordinator', 'coordinator phone number', 'how to talk to hr',
            'contact hr', 'coordinator se baat kaise kare'
        ],
        answer: 'On your dashboard:\n' +
            '• The "My Coordinator" card shows your coordinator\'s name, email and WhatsApp number, with a "Message ' +
            'Coordinator" button.\n' +
            '• The chat buttons at the bottom right open your Domain Chat (your coordinator and domain) and General Chat (HR).\n' +
            '• Messages, in the sidebar, lets you write privately to a coordinator or to HR.'
    },
    {
        key: 'whatsapp-group',
        question: 'How do I join the WhatsApp group?',
        examples: [
            'whatsapp group link', 'how to join the whatsapp group', 'domain group link', 'whatsapp group kaise join kare',
            'i was removed from the whatsapp group', 'community group link'
        ],
        answer: 'The group links are on your dashboard: open Guidelines, then Communication & Support. You will find the ' +
            "Support Group, the Employee ID Group and your domain's group there. After the joining steps, the " +
            '"WhatsApp Community Groups" box on the dashboard also lists all the groups.'
    },
    {
        key: 'emails-not-received',
        question: "I didn't receive the portal's emails",
        examples: [
            'i did not receive any email', 'welcome email not received', 'no mail from ten', 'emails are not coming',
            'mail nahi aaya', "didn't get the confirmation email"
        ],
        answer: 'Our emails come from growth@entrepreneurshipnetwork.net. Please check your Spam and Promotions folders, ' +
            'and search your mailbox for that address. Marking one of our emails as "Not spam" helps the rest reach ' +
            'your inbox.\n\n' +
            'Everything we email is also on your dashboard: your Employee ID is at the top, and your letters are in ' +
            'My Documents. Sign in at {{loginUrl}}.'
    },
    {
        key: 'whatsapp-link-reset',
        question: "The WhatsApp group link doesn't work, or says it was reset",
        examples: [
            'unable to join the domain group', 'not able to join the whatsapp group', 'the whatsapp link is reset',
            'the invite link was reset', 'the group invitation link is not working', 'whatsapp group link expired',
            'the group link is invalid', 'please share a new invitation link', 'cannot join the group with the link',
            'group link reset ho gaya'
        ],
        answer: "That happens when a WhatsApp group's admin resets its invite link: the old link stops working for " +
            'everyone. It is a WhatsApp setting, not a problem with your account or with the portal.\n\n' +
            'Please ask your coordinator or the group admin for the new link, and join with that.'
    },
    {
        key: 'internship-mode',
        question: 'Is the internship online or offline?',
        examples: [
            'is this internship online', 'is it work from home', 'is it a remote internship', 'do i need to come to the office',
            'is it offline', 'where is the internship location'
        ],
        answer: "It's a virtual internship: everything happens online through the portal, and you work from home."
    }
];
