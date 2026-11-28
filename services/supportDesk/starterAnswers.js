'use strict';

/**
 * The help desk's first answers, written from what the portal actually does
 * (checked against the code on 23 Nov 2026; the course certificates on 27 Nov,
 * when they got a working checkout). HR edits them on the Help Desk page; an
 * edited one is never overwritten by a later release.
 *
 * Deliberately NOT answered here, so they reach a person: the Letter of
 * Recommendation (its rules differ between pages), fines, stipend (the pages
 * disagree), name corrections, changing domain or plan, and refunds.
 *
 * `answer` goes to anyone. `personal`, when present, goes instead to a
 * registered student Gmail verified, filled in from their account
 * (services/supportDesk/facts.js lists the {{placeholders}}).
 */

// The course certificate prices, from the one setting the checkout uses.
const { CERT_PRICES } = require('../../config/payment');

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
            'i filled the google form but did not get employee id', 'request for employee id', 'could you please share my employee id to complete my onboarding', 'i joined as an intern please share my employee id',
            'i am shortlisted please provide my employee id', 'got shortlisted mail need my employee id',
            'i joined the group and filled the google form when will i get my employee id', 'when will i get my employee id',
            'employee id is not in the shared documents', 'employee id not mentioned in my documents', 'i have recently joined please provide my employee id', 'need employee id to get my offer letter and documents', 'i was selected on unstop but did not get employee id', 'selected for internship on unstop where is my employee id', 'applied on unstop got selected no employee id or offer letter', 'shortlisted on unstop what to do next', 'selected through internshala but no employee id', 'i do not know what my employee id is', 'i didn\'t get my employee i\'d', 'did not get employee i\'d', 'my employee i\'d not received',
            'i didn\'t get employe id', 'didnt get employe id', 'employe id not received', 'i dont have my employe id', 'no employe id yet', 'i didnt get any employee id so far', 'have not received any employee id so far',
            'my name is not in the employee id spreadsheet', 'filled the employee id generation form but no id', 'name not appearing in employee id sheet',
            'employee id form response recorded but no id', 'please verify my employee id form submission',
            'i am new here please provide my employee id', 'got your email from the group please give me employee id', 'there was a list of employee ids but my name was not there', 'my name is not on the employee id list', 'following up on my onboarding i have not received my employee id', 'update on when i will get my employee id', 'still waiting for my employee id after onboarding',
            'i am a student of internship i don\'t get employe i\'d', 'i don\'t get employe i\'d please provide', 'please provide employe i\'d as soon as possible', 'intern student no employe i\'d'
        ],
        answer: 'You get your Employee ID the moment you register. It looks like TEN/WEB/1005, and you will find it in ' +
            'your welcome email and at the top of your dashboard.\n\n' +
            'Not registered yet? Register here: {{registerUrl}}\n\n' +
            'Selected on Unstop, Internshala or another job site? That does not register you here, so you still need to ' +
            'register at the link above with the same email address to get your Employee ID.\n\n' +
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
        key: 'resume-upload',
        question: 'My resume will not upload when I register',
        examples: [
            'getting error while uploading the resume', 'resume upload not working', 'when i am trying to upload the resume it is not responding',
            'resume is not uploading', 'unable to upload my resume', 'resume upload failed', 'cv upload error during registration',
            'stuck on uploading resume', 'resume upload nahi ho raha'
        ],
        // 26 Nov: the upload gave up after a flat minute, which cut off a few-MB
        // file on mobile data; it now waits in proportion to the file. Deploys
        // also no longer reinstall packages under the running site.
        answer: 'Please try the upload once more at {{registerUrl}}. It now waits longer on a slow connection, so ' +
            'keep the page open while it says "Uploading resume PDF...".\n\n' +
            'The resume must be a PDF file (its name ends in .pdf) and under 5MB. A Word file or a photo will not ' +
            'upload: open it in Word, Google Docs or Canva and save or download it as PDF first.\n\n' +
            'If it still fails, reply with the exact message you see under the upload box (a screenshot is best) ' +
            'and the size of the file.'
    },
    {
        key: 'login',
        question: "I can't log in to the portal",
        examples: [
            "i can't login", 'unable to login', 'login not working', 'how to login to the student portal',
            'invalid employee id error', 'login nahi ho raha', 'which id should i use to login', 'my account is locked', 'login page link',
            'access denied invalid employee id', 'sign in says invalid employee id', 'my employee id shows invalid',
            'dashboard login says access denied', 'employee id not accepted at sign in', 'getting access denied when i sign in'
        ],
        answer: 'Sign in at {{loginUrl}} with your email address or your Employee ID (for example TEN/WEB/1005), and the ' +
            'password you chose when you registered. Your Member ID (TEN-STU-…) does not work for signing in.\n\n' +
            'If it says "Invalid Employee ID", no account has the ID you typed: check it against your welcome email, ' +
            'or sign in with the email address you registered with instead. If you have more than one email address, ' +
            'try each one.\n\n' +
            'After 5 wrong passwords the account locks for 15 minutes, so wait a little and try again. If you have ' +
            'forgotten your password, use "Forgot password?" on the sign-in page.',
        personal: 'Sign in at {{loginUrl}} with this email address or your Employee ID, {{employeeId}}, and the password ' +
            'you chose when you registered.\n\n' +
            'After 5 wrong passwords the account locks for 15 minutes, so wait a little and try again. If you have ' +
            'forgotten your password, use "Forgot password?" on the sign-in page.'
    },
    {
        key: 'login-loop',
        question: 'It says login successful, then sends me back to the login page',
        examples: [
            'login successful then back to login page', 'it shows login successfully then again i come back to the login page',
            'after login it goes back to the login page', 'logged in but redirected to login again', 'access granted then login page again',
            'dashboard does not open after login it goes back', 'login loop', 'keeps sending me back to the sign in page',
            'sign in works but the dashboard does not open', 'login hone ke baad phir se login page aa jata hai'
        ],
        // Fixed on 26 Nov: an account whose internship registration never
        // finished is now told so at sign-in, and can register again with the
        // same email and password (see /login and registerUser).
        answer: 'That happens when an account was created but its internship registration did not finish, so there ' +
            'is no dashboard to open yet. Please sign in once more at {{loginUrl}}: the page now tells you what to do.\n\n' +
            'If you registered for the internship with a different email, sign in with your Employee ID instead. If ' +
            'not, register again at {{registerUrl}} with the same email and the same password. Your registration will ' +
            'finish and you will get your Employee ID straight away.\n\n' +
            'If it still sends you back, open the portal in Chrome (not inside Gmail or WhatsApp, and not in an ' +
            'incognito window) and reply to this email with a screenshot.',
        personal: 'Please sign in with your Employee ID, {{employeeId}}, at {{loginUrl}} instead of your email address. ' +
            'If it still sends you back, open the portal in Chrome (not inside Gmail or WhatsApp, and not in an ' +
            'incognito window) and reply to this email with a screenshot of what you see.'
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
            'which plans are free', 'kitna fee hai', 'is there any registration fee', 'price of the internship plans', 'fast track fee',
            'are there any registration or training charges', 'is there any hidden charge for this internship', 'do i have to pay anything to join'
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
            'The only certificates with a price are the optional course certificates (Expert ₹' + CERT_PRICES.expert +
            ', Nano Degree ₹' + CERT_PRICES.nano_degree + ' and Fellowship ₹' + CERT_PRICES.fellowship + '), which you ' +
            'choose to get separately on My Certificates.'
    },
    {
        key: 'course-certificate',
        question: 'How do I get my Expert, Nano Degree or Fellowship certificate?',
        examples: [
            'how to get the expert certificate', 'how do i get the nano degree certificate', 'fellowship certificate kaise milega',
            'how to claim my course certificate',
            'i am eligible for all three certificates but could not get any of them',
            'expert certificate unlocked but i cannot download it', 'nano degree shows claim it payment coming soon',
            'i paid for the expert certificate when can i download it', 'i paid for the nano degree but it is not approved yet',
            'i paid for the fellowship certificate when will it be approved', 'i paid for the expert certificate but it still says verifying',
            'what is the price of the expert certificate', 'how much is the nano degree certificate',
            'how to become eligible for the fellowship certificate'
        ],
        answer: 'These are the optional course certificates. You earn them from your progress in the Task Journey:\n' +
            '- Expert: 30% of your tasks approved. ₹' + CERT_PRICES.expert + '.\n' +
            '- Nano Degree: 70% of your tasks approved. ₹' + CERT_PRICES.nano_degree + '.\n' +
            '- Fellowship: 70% of your tasks approved and a place in the top 10% of interns in your domain. ₹' +
            CERT_PRICES.fellowship + '.\n\n' +
            'Open My Certificates from your dashboard. An earned certificate has a "Get your certificate" button. It ' +
            'shows what the certificate gives you, then a UPI QR code for the exact amount. Pay with any UPI app and type ' +
            'the 12-digit UPI reference number (UTR) into the box.\n\n' +
            'We check every payment within 24 hours and email you when it is approved. The Download button then opens on ' +
            'My Certificates. If you have already paid, do not pay again: the card says "Payment submitted — verifying" ' +
            'until it is approved.'
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
        key: 'offer-letter-download-fails',
        question: 'The Download Offer Letter button is not working, the download fails.',
        examples: [
            'not able to download offer letter', 'offer letter download not working', 'download offer letter button not working',
            'offer letter download fails', 'offer letter shows 404', 'offer letter not opening', 'cannot download my offer letter',
            'offer letter download nahi ho raha', 'download fails to initiate offer letter'
        ],
        answer: 'The Download Offer Letter button in My Documents had a fault that stopped the file from opening. It is ' +
            'fixed now. Sign in, open My Documents and press Download Offer Letter again; you can also download it from the ' +
            'Offer Letter row under the My Documents tab. If your documents are still under review, the button appears ' +
            'once HR approves them.'
    },
    {
        key: 'documents',
        question: 'How do I upload my documents?',
        examples: [
            'how to upload documents', 'which documents are required', 'document upload failed', 'invalid file format',
            'aadhaar upload', 'marksheet upload', 'my documents are under review', 'my documents were rejected',
            'document kaise upload kare', 'why are address proof and marksheet required',
            'should i submit documents through the portal or by email', 'where should i submit my address proof and marksheet'
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
            'attendance kaise lagaye', 'what is the attendance rule', 'is attendance compulsory', 'attendance percentage',
            'how to fill the attendance form', 'where is the attendance form', 'i want to fill the attendance form',
            'who fills the attendance form details', 'attendance google form',
            'i attended the class but portal shows absent', 'attended today but marked absent',
            'my attendance shows absent', 'present in class but absent on portal',
            'why is coordinator attendance absent'
        ],
        answer: "Attendance is marked every day from Monday to Saturday (Sundays don't count). On your dashboard, open " +
            '🪪 Attendance:\n' +
            '1. Click "Open Official Google Form", fill it in and submit it, then click "✓ Confirm Form Submitted".\n' +
            '2. Click "Mark Today\'s Attendance".\n\n' +
            'Joining a class does not mark your attendance by itself: you need to do both steps every day. In your ' +
            'attendance history, the Self column turns Present as soon as you click "Mark Today\'s Attendance". The ' +
            'Coordinator column is filled in by your coordinator after they check the day, so it can show Absent ' +
            'for a while.\n\n' +
            'Keep your attendance above 75%, because your Letter of Completion needs it. The attendance panel shows your ' +
            'percentage and how many more days you need.'
    },
    {
        key: 'daily-routine',
        question: 'What do I have to do every day as an intern?',
        examples: [
            'what are the steps i have to follow daily', 'what should i do daily', 'i am new here what do i do',
            'daily work of an intern', 'roz kya karna hai', 'what is my daily task', 'how does the internship work',
            'i am new here can anyone tell me the process',
            'i am shortlisted what is my work', 'please explain what is my work', 'selected for internship what do i have to do',
            'what are the next steps in the internship', 'what do i have to do in the 3 months internship',
            'next steps after joining the group', 'what is the process for the whole internship'
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
        key: 'learn-exam',
        question: "The course exam will not start, or stays on \"Setting your paper\"",
        examples: [
            'exam section is not working', 'i could not give the test after the video', 'setting your paper is stuck',
            'the exam is not starting', 'topic exam not opening', 'start the exam button does nothing',
            'examiner is busy', 'test is not loading in the course', 'exam page stuck', 'exam nahi khul raha'
        ],
        // Fixed on 26 Nov: the paper is now written while the topic page is
        // open, a backup model takes over when the main one is overloaded, and
        // the page offers "Try again" instead of waiting for ever.
        answer: 'Please open the topic again and press "Start the exam". The paper is now prepared while you are on ' +
            'the topic page, so it should open within a few seconds.\n\n' +
            'The exam opens after you mark the topic\'s video as watched, and it needs your camera on, so allow camera ' +
            'access when the browser asks. If the page says "The examiner is busy", press "Try again": nothing is ' +
            'counted against you.\n\n' +
            'If it still does not start, reply with a screenshot of what you see.'
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
            'contact hr', 'coordinator se baat kaise kare',
            'i cannot find the my coordinator card', 'my coordinator card is not visible on my dashboard',
            'where is the my coordinator section', 'coordinator details not showing on dashboard',
            'cannot find coordinator contact details', 'please provide my coordinator contact details',
            'no reply in domain chat how else can i contact my coordinator'
        ],
        answer: 'On your dashboard:\n' +
            '• Open 🏆 Extras & Badges (Leaderboard & Badges in the menu). The "My Coordinator" card there shows your ' +
            'coordinator\'s name, email and WhatsApp number, with a "Message Coordinator" button. If it says your ' +
            'coordinator is not yet assigned, write to HR in General Chat or Messages.\n' +
            '• The chat buttons at the bottom right open your Domain Chat (your coordinator and domain) and General Chat (HR).\n' +
            '• Messages, in the sidebar, lets you write privately to a coordinator or to HR.'
    },
    {
        key: 'internship-role',
        question: 'What is my official designation, who is my mentor, and which team do I join?',
        examples: [
            'what is my designation', 'what is my official role', 'what title should i put on linkedin',
            'designation not mentioned in offer letter', 'who is my mentor', 'who is my assigned mentor',
            'which team should i join', 'team allocation', 'where will i get my tasks and instructions',
            'clarification regarding internship role mentor and team'
        ],
        answer: 'Your offer letter confirms a position as an intern at The Entrepreneurship Network (TEN), in the ' +
            'Domain shown in the box on the letter. On your resume and LinkedIn, use "<your Domain> Intern" at The ' +
            'Entrepreneurship Network (TEN), with the Domain written exactly as on your letter.\n\n' +
            'Your mentor and point of contact is your domain coordinator: the "My Coordinator" card, under 🏆 Extras & Badges on your ' +
            'dashboard, shows their name, email and WhatsApp number.\n\n' +
            'Your team is your domain group. Open Guidelines, then Communication & Support, on the dashboard to join ' +
            "your domain's WhatsApp group. Your weekly tasks are in 🪙 Task Journey, and tasks your coordinator posts " +
            'are under My Tasks.'
    },
    {
        key: 'whatsapp-group',
        question: 'How do I join the WhatsApp group?',
        examples: [
            'whatsapp group link', 'how to join the whatsapp group', 'domain group link', 'whatsapp group kaise join kare',
            'i was removed from the whatsapp group', 'community group link',
            'how can i join my domain whatsapp group', 'how to join the software engineer whatsapp group',
            'i registered how do i join the interns group', 'whatsapp group to connect with other interns',
            'not able to join my domain group in the whatsapp community', 'cannot find the aiml group in whatsapp community',
            'i am not able to join the tech group', 'how to join the web development group'
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
        key: 'whatsapp-community-full',
        question: 'The WhatsApp group or community link says it is full',
        examples: [
            'the community is full', 'whatsapp says the group is full', 'cannot join the domain group it is full',
            'the link says community is full', 'group is full unable to join', 'whatsapp group full ho gaya',
            'domain group has reached its limit', 'the community has reached its member limit'
        ],
        answer: 'WhatsApp limits how many people a group or community can hold, and that one has reached the limit. ' +
            'It is a WhatsApp limit, not a problem with your account or with the portal.\n\n' +
            'Please ask your coordinator for the link to the new group for your domain, and join with that. ' +
            'Until then you can reach your coordinator from the "My Coordinator" card, under 🏆 Extras & Badges on your dashboard.'
    },
    {
        key: 'course-videos',
        question: 'Are the course videos from YouTube? Why pay if videos are free online?',
        examples: [
            'are these videos from youtube', 'the same video is on youtube', 'is this video copied from youtube',
            'why should i pay when the videos are free on youtube', 'where do the course videos come from',
            'i can watch these videos for free online', 'youtube pe free me hai', 'why take the course if videos are on youtube',
            'are the videos made by ten', 'who made the course videos'
        ],
        // Truthful on purpose: the videos are free ones made by others, so this
        // says what the course adds instead of claiming them as ours or paid.
        answer: 'The course videos are not taken from YouTube. For each topic we choose a good video from open learning ' +
            'libraries and other video platforms, and it plays inside the portal.\n\n' +
            'The video is one part of the course. What the course gives you is the written lesson for every topic (a ' +
            'technical explanation and a simple one), a proctored exam after each topic with AI marking and feedback on ' +
            'your written answers, a final exam, and a certificate that anyone can verify.'
    },
    {
        key: 'internship-mode',
        question: 'Is the internship online or offline?',
        examples: [
            'is this internship online', 'is it work from home', 'is it a remote internship', 'do i need to come to the office',
            'is it offline', 'where is the internship location'
        ],
        answer: "It's a virtual internship: everything happens online through the portal, and you work from home."
    },
    {
        key: 'qr-attendance',
        question: 'How do I mark attendance with the meeting QR code?',
        examples: [
            'how to mark attendance with qr code', 'qr code attendance not working', 'scanned the qr code but it says invalid employee id or password',
            'qr attendance says invalid employee id', 'attendance qr code login failed', 'qr code shared in the meeting is not accepting my password',
            'i cannot mark my attendance through the qr code', 'qr scan attendance error', 'meeting qr code attendance issue',
            'the qr code page says invalid employee id or password'
        ],
        answer: 'Scanning the meeting QR code opens a page that marks the day on your side and your coordinator\'s in one go. ' +
            'Choose your domain, then sign in with the same details you use for your dashboard: your Employee ID ' +
            '(like TEN/WEB/1005) or your email address, and your portal password. Then "Open today\'s attendance form" ' +
            'appears: fill it in as usual.\n\n' +
            'If it says "Invalid Employee ID or Password", the password is not the one your dashboard accepts. Sign in to ' +
            'your dashboard once to check it, and use "Forgot password" on the sign-in page if you need a new one. Your ' +
            'Member ID is not a sign-in: use your Employee ID or email.\n\n' +
            'You can always mark the day from your dashboard instead: open Attendance, fill in the Google Form, click ' +
            '"Confirm Form Submitted" and then "Mark Today\'s Attendance".'
    },
    {
        key: 'upload-could-not-reach-server',
        question: 'My document upload says "Could not reach the server". What do I do?',
        examples: [
            'upload failed could not reach the server', 'could not reach the server check your connection and try again',
            'repeated server issues when uploading my documents', 'server error while uploading address proof and marksheet',
            'document upload shows upload failed', 'marksheet upload failed server issue', 'address proof upload not working server problem',
            'facing server issue while uploading documents in my profile', 'upload keeps failing on my phone',
            'same problem again and my pdf is under 10 mb', 'could not open the file'
        ],
        answer: '"Could not reach the server" is shown by your browser when the connection dropped while the file was being ' +
            'sent, before the portal could answer. It usually means the upload did not get through on that connection, ' +
            'not that the portal is down.\n\n' +
            'Please try again like this:\n' +
            '1. On a phone, save the PDF to your phone first (for example in Downloads) and choose it from there, not ' +
            'straight from Google Drive or WhatsApp.\n' +
            '2. Connect to Wi-Fi, or a different network from the one you used. Mobile data sometimes drops a longer upload.\n' +
            '3. Stay on the My Documents page until the green tick appears, without switching apps.\n' +
            '4. Check that each PDF is under 25 MB. A scanned marksheet can be large; a smaller scan uploads far more reliably.\n' +
            '5. If you have a laptop, try from there.\n\n' +
            'If it still fails, tell us the size of each file in MB, the network you used, and the exact message you see.'
    },
    {
        key: 'task-rejected-repo-empty',
        question: 'My task was rejected saying my GitHub repository is empty, but my code is there. What do I do?',
        examples: [
            'task rejected github repository is empty', 'feedback says my repo is empty but i uploaded the code',
            'submission rejected repository does not contain source code', 'rejected saying no source code in github',
            'my repo has all files but task got rejected', 'github repo empty error on task submission',
            'task rejected missing configuration files but i uploaded them', 'why is my github submission rejected as empty'
        ],
        answer: 'Sometimes GitHub took a while to show a freshly pushed repository to our check, and a few submissions were ' +
            'wrongly marked as empty. That has been fixed: a repository is now only called empty when it really has no ' +
            'files, and if its files cannot be read at that moment, a coordinator looks at it instead.\n\n' +
            'Please open the repository on GitHub while signed out (or in a private window) and check that it is public and ' +
            'that your files are on its main branch, then submit the task again from My Tasks. If it is rejected again for ' +
            'the same reason, reply to this email and a member of the team will look at it.'
    }
];
