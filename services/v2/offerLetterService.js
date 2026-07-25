"use strict";

const DocumentHistory = require("../../models/DocumentHistory");
const PDFDocument = require("pdfkit");
const fs          = require("fs");
const path        = require("path");
const {
    ensureFonts,
    registerFonts,
    drawLogo,
    drawCircularSeal,
    todayFormatted
} = require("./pdfHelpers");
const { buildSalutation } = require("./documentTextHelpers");

/**
 * Generates an Internship Offer Letter PDF for a student.
 * @param {Object} data - Student data for the offer letter
 * @param {string} outputPath - Full path where PDF should be saved
 * @returns {Promise<string>} resolves with outputPath on success
 */
async function generateOfferLetterPDF(data, outputPath) {
    await ensureFonts();
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: "Internship Offer Letter — TEN" } });
            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);

            registerFonts(doc);

            const W = 595.28; // A4 width
            const H = 841.89; // A4 height

            // ── Background watermark ──
            drawLogo(doc, W / 2, H / 2, 260, 0.06, "#C9A84C");

            // ── Outer double-ruled border ──
            doc.rect(15, 15, W - 30, H - 30).lineWidth(3).strokeColor("#C9A84C").stroke();
            doc.rect(20, 20, W - 40, H - 40).lineWidth(1).strokeColor("#C9A84C").stroke();

            // ── Top Header Section ──
            drawLogo(doc, 75, 60, 24, 1, "#C9A84C");
            doc.fillColor("#C9A84C").font("Helvetica-Bold").fontSize(16)
                .text("THE ENTREPRENEURSHIP NETWORK", 110, 50, { width: 300 });
            doc.fillColor("#666666").font("Helvetica").fontSize(8)
                .text("Empowering the next generation of professionals", 110, 68, { width: 300 });

            // Right: Date & Ref
            const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
            const dateStr = data.dateIssued || today;
            const yearStr = new Date().getFullYear();
            const studentIdShort = data.employeeId ? data.employeeId.slice(-5) : "STUDENT";
            const refStr = `Ref: TEN/OL/${yearStr}/${studentIdShort}`;

            doc.fillColor("#666666").font("Helvetica").fontSize(9)
                .text(`Date: ${dateStr}`, W - 200, 52, { width: 150, align: "right" })
                .text(refStr, W - 200, 66, { width: 150, align: "right" });

            // Gold divider line
            doc.moveTo(40, 95).lineTo(W - 40, 95).lineWidth(1.5).strokeColor("#C9A84C").stroke();

            // ── Title ──
            doc.fillColor("#1a1a1a").font("Times-Bold").fontSize(18)
                .text("INTERNSHIP OFFER LETTER", 0, 115, { width: W, align: "center", characterSpacing: 1 });
            doc.moveTo(W / 2 - 120, 134).lineTo(W / 2 + 120, 134).lineWidth(1).strokeColor("#1a1a1a").stroke();

            // ── Salutation (single-line, built via shared helper) ──
            const studentName = data.studentName || "Candidate Name";
            doc.fillColor("#1a1a1a").font("Times-Bold").fontSize(11)
                .text(buildSalutation(studentName), 50, 155, { width: W - 100, lineBreak: false });

            // ── Body 1 ──
            const bodyOpts = { width: W - 100, align: "justify", lineGap: 4 };
            doc.y = 175;
            doc.font("Times-Roman").fontSize(11);
            doc.text("We are pleased to offer you a position as an intern at ", 50, doc.y, { ...bodyOpts, continued: true });
            doc.font("Times-Bold").text("The Entrepreneurship Network (TEN)", { continued: true });
            doc.font("Times-Roman").text(". After reviewing your application and profile, we are confident that you will make a meaningful contribution to our network. This letter formally confirms the details of your internship engagement.", { continued: false });

            // ── HIGHLIGHT BOX (Gold border, beige background, with data table) ──
            const boxY = doc.y + 15;
            const boxH = 145;
            const boxW = W - 100;
            const boxX = 50;

            // Draw box background
            doc.rect(boxX, boxY, boxW, boxH).fill("#FDFAF4");
            // Draw box border
            doc.rect(boxX, boxY, boxW, boxH).lineWidth(1).strokeColor("#C9A84C").stroke();
            doc.rect(boxX, boxY, 4, boxH).fill("#C9A84C");

            // Draw Table Rows inside the Highlight Box
            doc.fillColor("#1a1a1a").font("Times-Roman").fontSize(10);
            const rowData = [
                { label: "Intern Name", value: studentName },
                { label: "Domain", value: data.domain || "Intern" },
                { label: "Duration", value: data.durationText || "45 Days" },
                { label: "Start Date", value: data.startDate || today },
                { label: "End Date", value: data.endDate || "N/A" },
                { label: "Mode", value: "Remote" },
                { label: "Cohort", value: data.cohort || "Active Cohort" }
            ];

            let curY = boxY + 12;
            for (const row of rowData) {
                doc.font("Times-Bold").fillColor("#555555").text(row.label, boxX + 25, curY, { width: 150 });
                doc.font("Times-Roman").fillColor("#1a1a1a").text(row.value, boxX + 180, curY, { width: boxW - 200 });
                curY += 17;
            }

            // ── Body 2 ──
            doc.y = boxY + boxH + 15;
            doc.font("Times-Roman").fontSize(11).fillColor("#1a1a1a");
            doc.text("During your internship, you will be expected to complete weekly tasks, engage with your assigned coordinator, and maintain a professional standard of work. Upon successful completion of all requirements and a minimum attendance of 80%, you will be eligible for a Certificate of Completion.", 50, doc.y, bodyOpts);

            doc.moveDown(0.8);
            doc.text("We look forward to working with you and wish you a productive and enriching experience at TEN.", 50, doc.y, bodyOpts);

            // ── Signature block (flow-based — not hardcoded Y) ──
            // The sig block needs ~100px; footer starts at 775. If the body left
            // less than 130px of clear space, spill onto a new page so nothing
            // is cramped against the footer.
            const SIG_HEIGHT   = 100; // "Yours sincerely" → seal bottom
            const FOOTER_START = 775;
            const sigBlockTop  = doc.y + 35; // breathing room below body

            // ── Shared footer helper (called on every page) ──
            const drawOfferFooter = () => {
                doc.rect(20, 775, W - 40, 0.5).fillColor("#ccc").fill();
                doc.fillColor("#888888").font("Times-Roman").fontSize(8)
                    .text("The Entrepreneurship Network  ·  hr@entrepreneurshipnetwork.net  ·  www.entrepreneurshipnetwork.net", 0, 785, {
                        width: W,
                        align: "center",
                        link: "https://www.entrepreneurshipnetwork.net",
                        underline: true
                    });
                doc.fillColor("#aaaaaa").font("Times-Roman").fontSize(7)
                    .text("This is a digitally generated offer letter. For verification contact hr@entrepreneurshipnetwork.net", 0, 797, {
                        width: W,
                        align: "center",
                        link: "mailto:hr@entrepreneurshipnetwork.net",
                        underline: true
                    });
            };

            let sigY;
            if (sigBlockTop + SIG_HEIGHT <= FOOTER_START - 20) {
                sigY = sigBlockTop;
            } else {
                // Not enough room — flush footer on current page, then start continuation
                drawOfferFooter();
                doc.addPage({ size: "A4", margin: 0 });
                drawLogo(doc, W / 2, H / 2, 260, 0.06, "#C9A84C");
                doc.rect(15, 15, W - 30, H - 30).lineWidth(3).strokeColor("#C9A84C").stroke();
                doc.rect(20, 20, W - 40, H - 40).lineWidth(1).strokeColor("#C9A84C").stroke();
                // Compact continuation header
                drawLogo(doc, 60, 42, 18, 1, "#C9A84C");
                doc.fillColor("#C9A84C").font("Helvetica-Bold").fontSize(11)
                    .text("THE ENTREPRENEURSHIP NETWORK", 85, 36, { width: 290 });
                doc.fillColor("#666666").font("Helvetica").fontSize(7.5)
                    .text("Internship Offer Letter — continued", 85, 51, { width: 290 });
                doc.moveTo(40, 64).lineTo(W - 40, 64).lineWidth(1).strokeColor("#C9A84C").stroke();
                sigY = 88;
            }

            doc.font("Times-Roman").fontSize(11).fillColor("#1a1a1a")
                .text("Yours sincerely,", 50, sigY);

            // Cursive signature
            doc.font("DancingScript-Regular").fontSize(18).fillColor("#000000")
                .text("Kamlesh Gupta", 50, sigY + 18);
            // Printed details
            doc.font("Times-Bold").fontSize(9.5).text("Kamlesh Gupta", 50, sigY + 38);
            doc.font("Times-Roman").fontSize(8.5).fillColor("#555555")
                .text("Director", 50, sigY + 51)
                .text("The Entrepreneurship Network", 50, sigY + 63);

            // Circular Seal on the right (vertically centred with the sig block)
            drawCircularSeal(doc, W - 100, sigY + 38, 33);

            // ── Standard Footer on this page ──
            drawOfferFooter();

            // ── Append Company Policy & Procedure Manual (27 Pages) ──
            const manualPages = [
                {
                    title: "Company Policy & Procedure Manual",
                    isCover: true,
                    paragraphs: [
                        "CONGRATULATIONS & WELCOME ON BOARD!",
                        "Please read through this manual thoroughly to understand the guidelines, policies, and culture here at The Entrepreneurship Network.",
                        "This document acts as an essential guide during your internship tenure and must be signed and returned as acknowledgment of acceptance."
                    ],
                    pageNum: "Cover"
                },
                {
                    title: "Contents",
                    isContents: true,
                    paragraphs: [
                        "1. Welcome ............................................................................................ Page 1",
                        "2. What we do? ...................................................................................... Page 2",
                        "3. Our Mission, Vision & Values .......................................................... Page 3",
                        "4. Your Internship ................................................................................. Page 4",
                        "5. Business Environment ........................................................................ Page 5",
                        "6. Code of Conduct Policy ..................................................................... Page 6",
                        "7. IT, Email and Social Media Policies .................................................. Page 8",
                        "8. Recruitment ....................................................................................... Page 11",
                        "9. Induction ........................................................................................... Page 12",
                        "10. Equal Employment Opportunity & Anti Bullying ............................. Page 13",
                        "11. Leave ................................................................................................ Page 18",
                        "12. Performance Management ............................................................... Page 19",
                        "13. Performance Improvement ................................................................ Page 20",
                        "14. Grievance Complaints ...................................................................... Page 22",
                        "15. Conflict of Interest ........................................................................... Page 23",
                        "16. Intellectual Property & Security ....................................................... Page 24",
                        "17. Policies & Declaration ..................................................................... Page 26"
                    ],
                    pageNum: "Contents"
                },
                {
                    title: "Welcome!",
                    paragraphs: [
                        "Congratulations on your appointment and welcome to the team at The Entrepreneurship Network! We are excited that you have decided to join us and look forward to a long, happy and successful partnership together.",
                        "The Entrepreneurship Network is a community-based Edu-Tech group whose objective is to provide quality learning and expertise. You have been hired because we believe you can help us to deliver these high levels of customer satisfaction. We want to ensure that your interactions with other The Entrepreneurship Network interns and our customers will reflect the value that The Entrepreneurship Network places on bottom-up management.",
                        "The purpose of this Manual is to introduce you to the The Entrepreneurship Network, give you some information about our history, our clients and what we do. You will also find information about your terms and conditions and internship, our expectations around your behavior and our policies and procedures.",
                        "This Manual is by no means an exhaustive guide to your internship with us. It has been developed to act as a resource and reference for you. The policies within this Manual are easily listed and easily accessed via the contents page. This Manual will be updated as required as our business evolves and grows. You will be notified of any changes as they occur."
                    ],
                    pageNum: "Page 1"
                },
                {
                    title: "What we do?",
                    paragraphs: [
                        "The Entrepreneurship Network (TEN) is a community-based EduTech group whose objective is to provide quality learning and to expertise individual’s aspirations by providing them an opportunity to master their most desired skill sets in today's market with richly experienced faculty.",
                        "Their current customer segment, at present, stands at 1,500+ colleges and 35,000+ students, with new institutions coming in all the time. TEN came into existence in the month of March 2020 as an Edutech startup, imparting technical knowledge to budding and hopeful entrepreneurs and slowly moved into consultancy line of services.",
                        "For more information, you can visit us on our official website: www.entrepreneurshipnetwork.net"
                    ],
                    pageNum: "Page 2"
                },
                {
                    title: "Our Mission, Vision & Values",
                    paragraphs: [
                        "**Mission Statement:**",
                        "TEN aims to enrich the country with future entrepreneurs, by providing them the desired skill sets of today’s market.",
                        "**Vision Statement:**",
                        "Our aim is to be:\n~ Known for high quality outcomes\n~ Known for growth strategies\n~ Feel like home, with a \"family of invisible friends\".",
                        "**Core Values:**",
                        "1. Ethical: We act with honor and honesty in everything we do.\n2. Respect: We respect all individuals, perspectives, and contributions.\n3. Flexible: We embrace flexibility in learning, hours, and work styles.\n4. Experts: We connect students with industry experts for practical skills.\n5. Integrity: We stand firm on our moral principles and quality.\n6. Teamwork: We work collaboratively to achieve monumental success."
                    ],
                    pageNum: "Page 3"
                },
                {
                    title: "Your Internship",
                    paragraphs: [
                        "Your internship with The Entrepreneurship Network is essentially governed by The Entrepreneurship Network Policies, in conjunction with this Manual. The following section provides general information regarding your perks, conditions and our expectations of you.",
                        "**Perks**",
                        "After successful completion of your internship with TEN, you’ll be entitled to receive your requisites (i.e., Letter of Completion and Letter of Recommendation) based on the criteria and performance guidelines mentioned while joining.",
                        "**Hours of Work**",
                        "We have flexible working hours. Your hours of work will depend on business needs and the requirements of the work you are assigned. Your Manager will work with you to establish your standard hours of work and break times. The Entrepreneurship Network adopts a common-sense approach to managing work hours.",
                        "**Lateness for work**",
                        "Any absence or late work due to illness, injury or any other reason, and the expected duration of leave must be personally reported to your supervisor as soon as practicable (and prior to your normal starting time wherever possible). If you are unable to do this personally, you are requested to ask someone to telephone on your behalf. Subsequent to this, you must keep your Manager informed of your progress. It is essential that you are ready to commence work at your normal commencement time as other interns and the business depend upon you and your contribution.",
                        "**Resignation Policy**",
                        "While we hope to have a long and prosperous Internship relationship, should you decide to accept our offer, you will be an at-will Intern of the Company, which means the Internship relationship can be terminated by either of us with or without cause, at any time, with or without notice. Even though your job duties, title, compensation, and benefits, as well as the company’s personnel policies and procedures, may change from time to time during your tenure with the Company, the “at-will” nature of your internship will not change unless the Director of the Company signs a written contract that explicitly changes your at-will status."
                    ],
                    pageNum: "Page 4"
                },
                {
                    title: "Business Environment",
                    paragraphs: [
                        "**Work from Home**",
                        "All the internships provided are work from home. From the ease of your home, you can learn and gain experience with TEN.",
                        "**The Noise Factor**",
                        "Try to avoid arguments with co-workers and respect people’s busy periods or meeting times. Or if someone is engrossed in something at their work or there are more than two people meeting with someone, it usually means they are busy. Try to talk politely when you are on the call and respect others working with you."
                    ],
                    pageNum: "Page 5"
                },
                {
                    title: "Code of Conduct Policy",
                    paragraphs: [
                        "**Purpose**",
                        "This policy affirms TEN’s belief in responsible social and ethical behaviour from all interns. This policy clarifies the standards of behaviour that TEN expects of all interns.",
                        "**Principles**",
                        "Our interns contribute to the success of our organisation. TEN fully endorse that all interns are not deprived of their basic human rights.",
                        "Furthermore, our interns have an obligation to the Business and themselves to observe high standards of integrity and fair dealing. Unlawful and unethical business practices undermine intern and Client trust."
                    ],
                    pageNum: "Page 6"
                },
                {
                    title: "Code of Conduct Policy (Contd.)",
                    paragraphs: [
                        "**Policy Guidelines**",
                        "Our Code of Conduct policy applies to all interns and provides the framework of principles for conducting business, dealing with other interns. This policy is based on the following:\n\n● Act and maintain a high standard of integrity and professionalism.\n● Be responsible and scrupulous in the proper use of Company information, funds, equipment and facilities.\n● Be considerate and respectful of the environment and others.\n● Exercise fairness, equality, courtesy, consideration and sensitivity in dealing with other interns, clients and suppliers.\n● Avoid apparent conflict of interests, promptly disclosing to a TEN senior manager, any interest which may constitute a conflict of interest.\n● Promote the interests of TEN at all times.\n● Perform duties with skill, honesty, care and diligence.\n● Abide by policies, procedures and lawful directions that relate to your internship with TEN.\n● Under no circumstances may interns offer or accept money.",
                        "Any intern, who in good faith, raises a complaint or discloses an alleged breach of the Code, whilst following correct reporting procedures, will not be disadvantaged or prejudiced. All reports will be dealt with in a timely and confidential manner.",
                        "TEN expects cooperation from all interns in conducting themselves in a professional, ethical and socially acceptable manner of the highest standards. Any intern in breach of this policy may be subject to disciplinary action, including termination."
                    ],
                    pageNum: "Page 7"
                },
                {
                    title: "IT, Email and Social Media Policies",
                    paragraphs: [
                        "**Email Use**",
                        "1. Email facilities are provided for formal business correspondence.\n2. Take care to maintain the confidentiality of sensitive information. If emails need to be preserved, they should be backed up and stored safely.\n3. Limited private use of email is allowed if it doesn’t interfere with or distract from an intern’s work. However, management has the right to access incoming and outgoing email messages to check if usage is excessive or inappropriate.\n4. Non-essential email, including personal messages, should be deleted regularly from the folders to avoid congestion.\n5. All emails sent must include the approved business disclaimer.",
                        "To protect TEN from the potential effects of the misuse and abuse of email, the following instructions are for all users:\n\n1. No material is to be sent as email that is defamatory, in breach of copyright or business confidentiality, or prejudicial to the good standing of TEN in the community.\n2. Email must not contain material that amounts to gossip about colleagues or that could be offensive, demeaning, persistently irritating, threatening, and discriminatory.\n3. The email records of other persons are not to be accessed except by management ensuring compliance with this policy.\n4. Excessive private use, including mass mailing, \"reply to all\" etc. that are not part of the person’s duties, is not permitted."
                    ],
                    pageNum: "Page 8"
                },
                {
                    title: "IT, Email and Social Media Policies (Contd.)",
                    paragraphs: [
                        "**Professional Use of Social Media**",
                        "TEN expects its interns to maintain a certain standard of behaviour when using Social Media for work or personal purposes.",
                        "This policy applies to all interns of TEN who contribute to or perform duties such as:\n● maintaining a profile page for TEN on any social or business networking site;\n● making comments on such networking sites for and on behalf of TEN;\n● writing or contributing to a blog and/or commenting on other people’s or business’ blog posts for and on behalf of TEN; and/or\n● posting comments for and on behalf of TEN on any public and/or private web-based forums.",
                        "**Procedure**",
                        "No intern of TEN is to engage in Social Media as a representative or on behalf of TEN unless they first obtain TEN’s written approval.",
                        "If any intern of TEN is directed to contribute to or participate in any form of Social Media related work, they are to act in a professional manner at all times and in the best interests of TEN.",
                        "All interns of TEN must ensure they do not communicate any Confidential Information relating to TEN or its clients, business partners or suppliers, or material that violates the privacy or publicity rights of another party."
                    ],
                    pageNum: "Page 9"
                },
                {
                    title: "IT, Email and Social Media Policies (Contd.)",
                    paragraphs: [
                        "**Private / Personal Use of Social Media**",
                        "TEN acknowledges its interns have the right to contribute content to public communications on websites, blogs and business or social networking sites not operated by TEN. However, inappropriate behaviour on such sites has the potential to cause damage to TEN, as well as its interns, clients, business partners and/or suppliers.",
                        "All interns of TEN must also refrain from posting, sending, forwarding or using, in any way, any inappropriate material including but not limited to material which:\n● is intended to (or could possibly) cause insult, offence, intimidation or humiliation to TEN or its clients, business partners or suppliers;\n● is defamatory or could adversely affect the image, reputation, viability or profitability of TEN; and/or\n● contains any form of Confidential Information relating to TEN.",
                        "All interns of TEN must comply with this policy. Any breach of this policy will be treated as a serious matter and may result in disciplinary action including termination of internship.",
                        "**Social Media Definition**",
                        "**Social Media** includes all internet-based publishing technologies. Forms of Social Media include, but are not limited to, social or business networking sites (e.g. Facebook, LinkedIn), video/photo sharing websites (e.g. YouTube, Instagram), blogs, forums, and chat rooms."
                    ],
                    pageNum: "Page 10"
                },
                {
                    title: "Recruitment",
                    paragraphs: [
                        "**Policy**",
                        "TEN recognises a robust and professional approach to recruitment and selection helps us to attract and appoint individuals with the necessary skills and attributes to fulfil our aims and support our business goals.",
                        "All appointments should be made on the Principle of Merit, compliance with all relevant Legislation and adherence to this policy and related processes.",
                        "**Procedure**",
                        "1. Create a simple position description for the job covering key activities, tasks, skills required, expectations, deliverables and safety considerations.\n2. The recruitment process may include some or all of these: an application form, interviews, practical testing, and reference checks.\n3. Give the successful candidate an Offer letter. This includes the nature of employment, a welcome note and start details.\n4. Once the candidate has accepted, contact the unsuccessful candidates as a matter of courtesy."
                    ],
                    pageNum: "Page 11"
                },
                {
                    title: "Induction",
                    paragraphs: [
                        "**Policy**",
                        "TEN will make sure all new interns feel welcome and are ready to start work safely and competently through the use of a proper formal Induction process which this manual forms part of.",
                        "**Procedure**",
                        "Complete an induction plan for each new starter with details of:\n● introductions to other team members and coordinators\n● business overview and expectations during tenure\n● team engagement sessions\n● a working safely and productively plan\n● policy and procedural requirements, e.g. equal internship opportunity guidelines"
                    ],
                    pageNum: "Page 12"
                },
                {
                    title: "Equal Employment Opportunity & Anti Bullying",
                    paragraphs: [
                        "**Policy Overview**",
                        "This policy applies to all staff including contractors and covers all work-related functions and activities including external training courses sponsored by The Entrepreneurship Network.",
                        "It also applies for all recruitment, selection and promotion decisions.",
                        "The objective of The Entrepreneurship Network’s Equal Opportunity Policy is to improve business success by:\n● attracting and retaining the best possible interns\n● providing a safe, respectful and flexible work environment\n● delivering our services in a safe, respectful and reasonably flexible way",
                        "**Discrimination, Sexual Harassment and Bullying**",
                        "The Entrepreneurship Network is committed to providing a workplace free from discrimination, sexual harassment and bullying. Behaviour that constitutes discrimination, sexual harassment or bullying will not be tolerated and will lead to action being taken, which may include dismissal."
                    ],
                    pageNum: "Page 13"
                },
                {
                    title: "Equal Opportunity & Anti Bullying (Contd.)",
                    paragraphs: [
                        "**Definitions**",
                        "**Direct discrimination** occurs when someone is treated unfavourably because of a personal characteristic.",
                        "**Indirect Discrimination** occurs when a rule seems neutral, but has a discriminatory impact on certain people. For example, a minimum height requirement for a particular job might be applied equally to men and women, but would indirectly discriminate on the basis of sex, as women tend to be shorter than men.",
                        "**Sexual harassment** includes unwelcome conduct of a sexual nature in circumstances in which it could reasonably be expected to make a person feel offended, humiliated or intimidated.",
                        "**Workplace bullying** may include behaviour that is directed toward an intern, or group of interns, that creates a risk to health and safety e.g. physical and/or verbal abuse, excluding or isolating individuals, or giving impossible tasks.",
                        "The Entrepreneurship Network provides equal opportunity in internship to people without discrimination based on a personal characteristic."
                    ],
                    pageNum: "Page 14"
                },
                {
                    title: "Equal Opportunity & Anti Bullying (Contd.)",
                    paragraphs: [
                        "**Reasonable Adjustments**",
                        "Reasonable adjustments are changes that allow people with a disability to work safely and productively.",
                        "The Entrepreneurship Network will make reasonable adjustments for a person with a disability who:\n● applies for a job, is offered internship, or is an intern, and\n● requires the adjustments in order to participate in the recruitment process or perform the genuine and reasonable requirements of the job.",
                        "Examples of reasonable adjustments can include:\n● reviewing and, if necessary, adjusting the performance requirements of the job\n● arranging flexibility in work hours (see ‘flexible work arrangements’)\n● approving more regular breaks for people with chronic pain or fatigue",
                        "When thinking about reasonable adjustments The Entrepreneurship Network will weigh up the need for change with the expense or effort involved in making it. If making the adjustment means a very high cost or great disruption to the workplace, it is not likely to be reasonable."
                    ],
                    pageNum: "Page 15"
                },
                {
                    title: "Equal Opportunity & Anti Bullying (Contd.)",
                    paragraphs: [
                        "**Procedure: To make a complaint**",
                        "If you believe you are being, or have been, discriminated against, sexually harassed or bullied, you should follow this procedure:",
                        "1. Tell the offender the behaviour is offensive, unwelcome, and against business policy and should stop (only if you feel comfortable enough to approach them directly, otherwise speak to your manager). Keep a written record of the incident(s).",
                        "2. If the unwelcome behaviour continues, contact your supervisor or manager for support.",
                        "3. If this is inappropriate, you feel uncomfortable, or the behaviour persists, contact another relevant senior manager.",
                        "Interns should feel confident that any complaint they make is to be treated as confidential as far as possible."
                    ],
                    pageNum: "Page 16"
                },
                {
                    title: "Equal Opportunity & Anti Bullying (Contd.)",
                    paragraphs: [
                        "**Procedure: To receive a complaint**",
                        "When a manager receives a complaint or becomes aware of an incident that may contravene The Entrepreneurship Network EEO Policies, they should follow this procedure:\n\n1. Listen to the complaint seriously and treat the complaint confidentially.\n2. Ask the complainant for the full story, including what happened, step by step.\n3. Take notes, using the complainant’s own words.\n4. Ask the complainant to check your notes to ensure your record of the conversation is accurate.\n5. Explain and agree on the next action with the complainant.\n6. If investigation is not requested, file the notes confidentially.",
                        "**Possible Outcomes**",
                        "If after investigation management finds the complaint is justified, management will discuss with the complainant the appropriate outcomes which may include:\n● disciplinary action to be taken against the perpetrator (counselling, warning or dismissal)\n● staff training\n● counselling for the complainant\n● an apology"
                    ],
                    pageNum: "Page 17"
                },
                {
                    title: "Leave",
                    paragraphs: [
                        "**Policy Overview**",
                        "As interns on a flexible work-from-home model, standard annual leave policies do not apply directly. However, TEN understands that exams, health issues, or other personal priorities may require you to take short breaks.",
                        "**Taking Short Leave**",
                        "1. If you require a leave of absence for exams, health issues, or emergencies, you must notify your coordinator at least 3 days in advance (except in case of emergencies).\n2. Your coordinator will adjust your deadline or deliverables accordingly.\n3. Extended unexcused absences of more than 5 consecutive days without notification may result in automatic termination of the internship."
                    ],
                    pageNum: "Page 18"
                },
                {
                    title: "Performance Management",
                    paragraphs: [
                        "**Policy**",
                        "TEN believes in encouraging growth and skill mastery. We use a transparent, performance-oriented evaluation system to track your progress and award certificates.",
                        "**Performance Indicators**",
                        "Our performance tracking is based on:\n● Attendance & Task Completion (75% or higher attendance required for completion certificate).\n● Quality of Deliverables & Creativity.\n● Timely communication with your coordinator and team members.",
                        "**Grading & Recognition**",
                        "Outstanding performers who consistently exceed their goals will be nominated for the **Star Performer Certificate** and receive highly detailed Letters of Recommendation (LOR) from the Director."
                    ],
                    pageNum: "Page 19"
                },
                {
                    title: "Performance Improvement",
                    paragraphs: [
                        "**Policy**",
                        "If an intern's performance falls below expectations, we believe in providing support and opportunity for improvement before taking disciplinary action.",
                        "**Procedure**",
                        "1. **Informal Discussion:** Your coordinator will have a brief conversation with you to highlight areas of improvement and offer guidance.\n2. **Performance Improvement Plan (PIP):** If the performance does not improve, a written plan will be issued outlining specific milestones to be achieved within a set period (usually 1-2 weeks).\n3. **Review:** If the intern achieves the milestones, the PIP ends successfully. If not, the internship may be terminated."
                    ],
                    pageNum: "Page 20"
                },
                {
                    title: "Performance Improvement (Contd.)",
                    paragraphs: [
                        "**Disciplinary Action**",
                        "For repeated minor performance issues or failure to meet the PIP goals, formal disciplinary action may occur. This can include:\n● A formal written warning.\n● Suspension from the active project group.\n● Termination of the internship with no certificates issued.",
                        "TEN reserves the right to skip these steps in serious cases of gross misconduct."
                    ],
                    pageNum: "Page 21"
                },
                {
                    title: "Gross or Serious Misconduct",
                    paragraphs: [
                        "**Policy**",
                        "Certain actions are considered so severe that they damage the core relationship between the intern and the organization. These are classified as Gross Misconduct and can lead to immediate termination without warnings.",
                        "**Examples of Gross Misconduct:**",
                        "● Theft or fraud of company materials, credentials, or client info.\n● Physical or verbal harassment, abuse, or discrimination.\n● Deliberately damaging company systems, files, or records.\n● Severe breach of confidentiality or intellectual property policies.\n● Plagiarism or passing off copied work as your original creation.",
                        "If an intern is suspected of gross misconduct, they will be suspended immediately pending a swift investigation."
                    ],
                    pageNum: "Page 22"
                },
                {
                    title: "Grievance Complaints",
                    paragraphs: [
                        "**Policy**",
                        "TEN aims to resolve any internal issues, disagreements, or complaints in a fair, transparent, and prompt manner.",
                        "**Procedure**",
                        "1. **Informal Resolution:** Try to speak politely with the person involved to resolve the issue directly.\n2. **Formal Escalation:** If the issue is unresolved or you feel uncomfortable approaching them, email your formal complaint to **ten.hr.contact@gmail.com**.\n3. **Investigation:** HR will investigate the complaint within 5 working days, interviewing both parties if necessary.\n4. **Resolution:** A final decision or action plan will be shared with you."
                    ],
                    pageNum: "Page 23"
                },
                {
                    title: "Conflict of Interest",
                    paragraphs: [
                        "**Policy**",
                        "All interns must avoid situations where their personal interests or external activities conflict with the interests and objectives of The Entrepreneurship Network.",
                        "**What constitutes a Conflict of Interest?**",
                        "● Engaging in freelance work or other internships that directly compete with TEN’s projects.\n● Using TEN's data, client details, or resources for external commercial benefit.\n● Failing to disclose a personal relationship with a vendor, supplier, or candidate."
                    ],
                    pageNum: "Page 24"
                },
                {
                    title: "Conflict of Interest (Contd.)",
                    paragraphs: [
                        "**Disclosing a Conflict**",
                        "If you are unsure whether a situation constitutes a conflict of interest, you must proactively disclose it to your HR coordinator or Manager.",
                        "**Breach of Policy**",
                        "Failure to disclose known conflicts or engaging in activities that cause detriment to the organization will result in cancellation of the internship and forfeiture of all rewards and certificates."
                    ],
                    pageNum: "Page 25"
                },
                {
                    title: "Intellectual Property & Security",
                    paragraphs: [
                        "**Policy Overview**",
                        "All intellectual property, code, designs, content, ideas, databases, or training materials created by you during your internship with TEN remain the sole and exclusive property of **The Entrepreneurship Network (Limitless Technologies LLP)**.",
                        "**Data Security Guidelines**",
                        "1. Do not share, copy, or distribute any internal documents, student databases, curriculum files, or credentials to anyone outside the company.\n2. Keep your login passwords secure and never share them.\n3. Upon completion or resignation, you must return/delete all company files stored on your local machine."
                    ],
                    pageNum: "Page 26"
                },
                {
                    title: "The Entrepreneurship Network Policies & Declaration",
                    paragraphs: [
                        "**Acknowledgment and Agreement**",
                        "By signing below, you declare that you have read, understood, and agree to abide by all the policies, guidelines, and procedures outlined in this Company Policy & Procedure Manual.",
                        "You understand that any breach of these policies can lead to disciplinary action, including the immediate termination of your internship with no certificates or benefits issued.",
                        "**Candidate Signature of Acceptance:**",
                        "Signature: ____________________________________",
                        "Date: ________________________________________",
                        "Full Name: ____________________________________"
                    ],
                    pageNum: "Page 27"
                }
            ];

            for (const page of manualPages) {
                doc.addPage({ size: "A4", margin: 0 });

                // ── Background watermark ──
                drawLogo(doc, W / 2, H / 2, 260, 0.06, "#000000");

                // ── Outer double-ruled border ──
                doc.rect(15, 15, W - 30, H - 30).lineWidth(3).strokeColor("#000000").stroke();
                doc.rect(20, 20, W - 40, H - 40).lineWidth(1).strokeColor("#000000").stroke();

                // ── Top Centered Logo + Wordmark ──
                drawLogo(doc, W / 2, 45, 30, 0.8, "#000000");
                doc.fillColor("#000000").font("Caveat-Bold").fontSize(13)
                    .text("The Entrepreneurship Network", 0, 65, { width: W, align: "center" });

                // ── A line under the header ──
                doc.moveTo(40, 80).lineTo(W - 40, 80).lineWidth(1).strokeColor("#000000").stroke();

                if (page.isCover) {
                    // Big title for cover page
                    doc.font("Times-Bold").fontSize(28)
                        .text(page.title, 50, 250, { width: W - 100, align: "center", lineGap: 10 });
                    
                    doc.moveDown(2);
                    doc.font("Times-Bold").fontSize(13).fillColor("#000000")
                        .text(page.paragraphs[0], 50, doc.y, { width: W - 100, align: "center" });

                    doc.moveDown(1.5);
                    doc.font("Times-Roman").fontSize(11).fillColor("#222222")
                        .text(page.paragraphs[1], 50, doc.y, { width: W - 100, align: "center", lineGap: 4 });
                    
                    doc.moveDown(1.5);
                    doc.font("Times-Roman").fontSize(11).fillColor("#222222")
                        .text(page.paragraphs[2], 50, doc.y, { width: W - 100, align: "center", lineGap: 4 });
                } else {
                    // Title
                    doc.font("Times-Bold").fontSize(16).fillColor("#000000")
                        .text(page.title, 50, 95, { width: W - 100, align: "center" });
                    
                    doc.moveDown(1.2);
                    
                    const bodyOpts = { width: W - 100, align: "justify", lineGap: 4 };
                    for (const para of page.paragraphs) {
                        if (para.startsWith("**") && para.endsWith("**")) {
                            doc.moveDown(0.5);
                            doc.font("Times-Bold").fontSize(11).fillColor("#000000")
                                .text(para.replace(/\*\*/g, ""), 50, doc.y, { width: W - 100 });
                        } else if (para.startsWith("**")) {
                            doc.moveDown(0.5);
                            const lines = para.split("\n\n");
                            const boldPart = lines[0].replace(/\*\*/g, "");
                            doc.font("Times-Bold").fontSize(11).fillColor("#000000")
                                .text(boldPart, 50, doc.y, { width: W - 100 });
                            
                            if (lines.length > 1) {
                                const restPart = lines.slice(1).join("\n\n");
                                doc.font("Times-Roman").fontSize(10).fillColor("#222222")
                                    .text(restPart, 50, doc.y, bodyOpts);
                            }
                        } else {
                            const currentOpts = { ...bodyOpts };
                            if (para.includes("www.entrepreneurshipnetwork.net")) {
                                currentOpts.link = "https://www.entrepreneurshipnetwork.net";
                                currentOpts.underline = true;
                                doc.fillColor("#0066cc");
                            } else {
                                doc.fillColor("#222222");
                            }
                            doc.font("Times-Roman").fontSize(10)
                                .text(para, 50, doc.y, currentOpts);
                        }
                        doc.moveDown(0.8);
                    }
                }

                // Standard Footer for Manual Pages
                doc.rect(20, 775, W - 40, 0.5).fillColor("#ccc").fill();
                doc.fillColor("#666666").font("Times-Roman").fontSize(8)
                    .text("The Entrepreneurship Network  ·  Company Policy & Procedure Manual", 50, 785);
                doc.fillColor("#333333").font("Times-Bold").fontSize(8)
                    .text(page.pageNum, W - 110, 785, { width: 60, align: "right" });
            }

            doc.end();
            stream.on("finish", () => resolve(outputPath));
            stream.on("error",  reject);
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Logs an offer-letter send into the Document Send History.
 */
function logOfferLetterSend(entry = {}, method = "manual") {
    return DocumentHistory.logSend({ ...entry, documentType: "Offer Letter", documentKey: "offer_letter" }, method);
}

module.exports = { generateOfferLetterPDF, logOfferLetterSend };
