"use strict";

const cron        = require("node-cron");
const path        = require("path");
const fs          = require("fs");
const nodemailer  = require("nodemailer");
const PDFDocument = require("pdfkit");

const Student            = require("../models/Student");
const StudentDocument    = require("../models/new/StudentDocument");
const CertificateRequest = require("../models/CertificateRequest");
const DocumentHistory    = require("../models/DocumentHistory");
const MailHistory        = require("../models/MailHistory");
const Notification       = require("../models/Notification");
const { generateDocumentNumber } = require("../utils/documentNumber");
const Attendance          = require("../models/Attendance");
const StudentTaskProgress = require("../models/new/StudentTaskProgress");

// ── Ensure output directories exist ──
const offerLetterDir  = path.join(__dirname, "../uploads/offer-letters");
const certificatesDir = path.join(__dirname, "../uploads/certificates");
try { fs.mkdirSync(offerLetterDir,  { recursive: true }); } catch (_) {}
try { fs.mkdirSync(certificatesDir, { recursive: true }); } catch (_) {}

// ── Mail helper ──
const { createEmailTransporter, EMAIL_FROM } = require("../utils/mailer");
function createTransporter() {
    return createEmailTransporter();
}

// ════════════════════════════════════════════════════
// DOMAIN CONTENT HELPER
// ════════════════════════════════════════════════════
function getDomainContent(domain) {
    const d = (domain || "").toLowerCase().trim();
    const map = [
        { keys: ["web development", "web dev"],                 title: "Web Development Engineer Intern",        accentColor: "#3B82F6", roleDescription: "You will be working on building responsive websites, HTML/CSS/JavaScript front-ends, REST APIs integration, and modern web frameworks.",  responsibilities: ["Build responsive UI components", "Integrate REST APIs", "Write clean semantic HTML/CSS", "Debug cross-browser issues"] },
        { keys: ["app development", "flutter development"],    title: "Mobile App Development Intern",          accentColor: "#8B5CF6", roleDescription: "You will be working on mobile app development using Flutter/Dart, UI/UX implementation, API integration, and app deployment workflows.", responsibilities: ["Develop cross-platform mobile apps", "Implement state management", "Integrate third-party SDKs", "Publish to app stores"] },
        { keys: ["devops", "devops with aws"],                  title: "DevOps Engineer Intern",                 accentColor: "#F59E0B", roleDescription: "You will be working on CI/CD pipelines, containerization using Docker and Kubernetes, infrastructure automation, and cloud deployment strategies.", responsibilities: ["Set up CI/CD pipelines", "Work with Docker and Kubernetes", "Automate infrastructure provisioning", "Monitor cloud resources"] },
        { keys: ["data science"],                               title: "Data Science Intern",                    accentColor: "#10B981", roleDescription: "You will be working on data analysis, visualization, statistical modeling, and deriving insights from large datasets.", responsibilities: ["Perform exploratory data analysis", "Build predictive models", "Create data visualizations", "Apply statistical methods"] },
        { keys: ["machine learning", "artificial intelligence", "ai"], title: "AI/ML Engineer Intern",           accentColor: "#EC4899", roleDescription: "You will be working on machine learning models, neural networks, NLP, computer vision, and deploying AI solutions.", responsibilities: ["Train and evaluate ML models", "Process and clean datasets", "Implement deep learning architectures", "Deploy models to production"] },
        { keys: ["ui/ux", "ui ux design"],                     title: "UI/UX Design Intern",                   accentColor: "#F97316", roleDescription: "You will be working on user research, wireframing, prototyping, design systems, and creating intuitive user interfaces.", responsibilities: ["Conduct user research", "Create wireframes and prototypes", "Design UI components", "Conduct usability testing"] },
        { keys: ["cyber security", "cybersecurity"],            title: "Cybersecurity Intern",                   accentColor: "#EF4444", roleDescription: "You will be working on network security, vulnerability assessment, penetration testing, and implementing security best practices.", responsibilities: ["Perform vulnerability scans", "Analyze security threats", "Implement security controls", "Document security findings"] },
        { keys: ["cloud computing"],                            title: "Cloud Computing Intern",                 accentColor: "#06B6D4", roleDescription: "You will be working on cloud infrastructure, serverless architecture, storage solutions, and cost optimization across cloud platforms.", responsibilities: ["Provision cloud resources", "Configure cloud services", "Implement serverless functions", "Optimize cloud costs"] },
        { keys: ["digital marketing"],                          title: "Digital Marketing Intern",               accentColor: "#84CC16", roleDescription: "You will be working on SEO, social media campaigns, content strategy, analytics, and driving digital growth.", responsibilities: ["Create content strategies", "Run social media campaigns", "Analyze marketing metrics", "Optimize SEO performance"] },
        { keys: ["business development", "business analyst", "business"], title: "Business Development Intern",  accentColor: "#A78BFA", roleDescription: "You will be working on market research, client outreach, partnership development, and business strategy analysis.", responsibilities: ["Conduct market research", "Develop business proposals", "Analyze competitive landscape", "Support partnership development"] },
        { keys: ["python development", "python"],               title: "Python Developer Intern",                accentColor: "#FBBF24", roleDescription: "You will be working on Python scripting, backend API development, automation scripts, and data processing pipelines.", responsibilities: ["Write Python scripts and modules", "Build REST APIs with Flask/Django", "Automate workflows", "Process data with pandas/numpy"] },
        { keys: ["java development", "java"],                   title: "Java Developer Intern",                  accentColor: "#F87171", roleDescription: "You will be working on Java backend development, Spring Boot APIs, OOP design patterns, and enterprise software architecture.", responsibilities: ["Develop Java backend services", "Build Spring Boot APIs", "Write unit tests", "Apply design patterns"] },
        { keys: ["mern stack", "mern stack development"],       title: "MERN Stack Developer Intern",            accentColor: "#34D399", roleDescription: "You will be working on full-stack JavaScript development using MongoDB, Express.js, React, and Node.js.", responsibilities: ["Build React front-end components", "Develop Node.js/Express APIs", "Work with MongoDB databases", "Deploy full-stack apps"] },
        { keys: ["software engineering", "software"],           title: "Software Engineering Intern",            accentColor: "#60A5FA", roleDescription: "You will be working on software design, development, testing, and maintenance across the full software development lifecycle.", responsibilities: ["Design software architecture", "Write and review code", "Create and run test cases", "Document technical specs"] },
        { keys: ["hr management", "hr"],                        title: "HR Management Intern",                   accentColor: "#C084FC", roleDescription: "You will be working on talent acquisition, employee engagement, HR analytics, and organizational development initiatives.", responsibilities: ["Support recruitment processes", "Assist with onboarding", "Analyze HR data", "Coordinate employee programs"] },
        { keys: ["venture capital"],                            title: "Venture Capital Intern",                 accentColor: "#FCD34D", roleDescription: "You will be working on startup evaluations, market research, due diligence processes, and investment portfolio analysis.", responsibilities: ["Evaluate startup pitches", "Conduct due diligence", "Research market trends", "Prepare investment memos"] },
        { keys: ["vibe coding"],                                title: "Vibe Coding Intern",                     accentColor: "#F9A8D4", roleDescription: "You will be working on creative software projects, modern development tools, AI-assisted coding, and innovative tech experiments.", responsibilities: ["Build creative tech projects", "Use AI coding tools", "Experiment with new frameworks", "Document learnings"] },
        { keys: ["space research"],                             title: "Space Research Intern",                  accentColor: "#7DD3FC", roleDescription: "You will be working on space technology research, data analysis, satellite systems, and STEM outreach projects.", responsibilities: ["Research space technologies", "Analyze satellite data", "Contribute to STEM projects", "Write research reports"] },
    ];

    for (const entry of map) {
        if (entry.keys.some(k => d.includes(k))) return entry;
    }
    return {
        title:           "Internship Intern",
        accentColor:     "#C9A84C",
        roleDescription: "You will be working on domain-specific tasks, professional projects, and developing skills relevant to your chosen field.",
        responsibilities: ["Complete assigned tasks", "Attend regular sessions", "Submit work on time", "Participate in team activities"]
    };
}

// ════════════════════════════════════════════════════
// DOMAIN-SPECIFIC OFFER LETTER PDF GENERATOR
// ════════════════════════════════════════════════════
async function generateDomainOfferLetterPDF(studentData, outputPath) {
    return new Promise((resolve, reject) => {
        try {
            const doc    = new PDFDocument({ size: "A4", margin: 0, info: { Title: "Internship Offer Letter — TEN" } });
            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);

            const W = 595.28;
            const domainContent = getDomainContent(studentData.domain || "");
            const accentColor   = domainContent.accentColor || "#C9A84C";
            const navy   = "#0A1628";
            const white  = "#FFFFFF";
            const cream  = "#F8F5ED";
            const textDark = "#1A1A2E";
            const gold   = "#C9A84C";

            // Header band
            doc.rect(0, 0, W, 90).fill(navy);
            doc.rect(0, 90, W, 4).fill(accentColor);

            doc.fillColor(gold).font("Helvetica-Bold").fontSize(18)
                .text("THE ENTREPRENEURSHIP NETWORK", 50, 28, { width: W - 100, align: "center" });
            doc.fillColor(white).font("Helvetica").fontSize(10)
                .text("TEN — Shaping Tomorrow's Entrepreneurs", 50, 52, { width: W - 100, align: "center" });
            doc.fillColor(gold).font("Helvetica").fontSize(9)
                .text("hr@entrepreneurshipnetwork.net  |  www.entrepreneurshipnetwork.net", 50, 70, { width: W - 100, align: "center" });

            // Domain banner
            doc.rect(0, 94, W, 28).fill(accentColor + "22");
            doc.fillColor(accentColor).font("Helvetica-Bold").fontSize(10)
                .text((studentData.domain || "Internship").toUpperCase() + " INTERNSHIP OFFER LETTER", 0, 102, { width: W, align: "center" });

            // Title
            doc.fillColor(textDark).font("Helvetica-Bold").fontSize(14)
                .text("INTERNSHIP OFFER LETTER", 50, 138, { width: W - 100, align: "center" });
            doc.moveTo(100, 158).lineTo(W - 100, 158).lineWidth(0.8).strokeColor(accentColor).stroke();

            const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
            doc.fillColor("#555").font("Helvetica").fontSize(9)
                .text(`Date: ${studentData.dateIssued || today}`, 50, 168);
            doc.text(`Ref: ${studentData.documentNumber || "TEN/OL/" + Date.now().toString().slice(-6)}`, 50, 182);

            // Addressee
            doc.rect(50, 200, W - 100, 72).fillAndStroke(cream, accentColor);
            doc.fillColor(textDark).font("Helvetica-Bold").fontSize(11).text("To,", 66, 210);
            doc.font("Helvetica").fontSize(11)
                .text(studentData.name || "Student Name", 66, 224)
                .text(studentData.collegeName || studentData.college || "College Name", 66, 239)
                .text(`Employee ID: ${studentData.employeeId || "N/A"}`, 66, 254);

            doc.fillColor(textDark).font("Helvetica-Bold").fontSize(10)
                .text(`Subject: ${domainContent.title} — Virtual Internship Offer`, 50, 286);
            doc.moveTo(50, 300).lineTo(W - 50, 300).lineWidth(0.5).strokeColor("#ccc").stroke();

            const name   = studentData.name || "Candidate";
            const domain = studentData.domain || "the assigned domain";
            const dur    = studentData.duration || studentData.tenure || "the internship period";
            const start  = studentData.startDate || "the joining date";
            const end    = studentData.endDate || "the completion date";

            const bodyOpts = { width: W - 100, align: "justify", lineGap: 4 };
            doc.fillColor(textDark).font("Helvetica").fontSize(10.5)
                .text(`Dear ${name},`, 50, 312);
            doc.moveDown(0.5);
            doc.text(
                `We are pleased to offer you an internship position at The Entrepreneurship Network (TEN) as a ${domainContent.title}. After reviewing your application, we believe you will be a valuable addition to our program.`,
                50, doc.y, bodyOpts
            );
            doc.moveDown(0.5);
            doc.text(domainContent.roleDescription, 50, doc.y, bodyOpts);
            doc.moveDown(0.5);
            doc.text(
                `This internship is for a duration of ${dur}, commencing from ${start} to ${end}. You will work under the mentorship of our domain experts and coordinators.`,
                50, doc.y, bodyOpts
            );
            doc.moveDown(0.5);

            // Responsibilities box
            const respY = doc.y + 6;
            if (respY < 600) {
                doc.rect(50, respY, W - 100, 16 + (domainContent.responsibilities.length * 14)).fillAndStroke(accentColor + "11", accentColor + "44");
                doc.fillColor(accentColor).font("Helvetica-Bold").fontSize(8.5).text("KEY RESPONSIBILITIES", 62, respY + 6);
                let ry = respY + 19;
                domainContent.responsibilities.forEach(r => {
                    doc.fillColor(textDark).font("Helvetica").fontSize(8.5).text(`• ${r}`, 66, ry, { width: W - 120 });
                    ry += 13;
                });
                doc.y = ry + 4;
            }

            doc.moveDown(0.5);
            doc.fillColor(textDark).font("Helvetica").fontSize(10.5).text(
                `Please report to the TEN Student Portal on the first day. Your Employee ID is ${studentData.employeeId || "as shared separately"}.`,
                50, doc.y, bodyOpts
            );
            doc.moveDown(0.4);
            doc.text("We wish you a rewarding and enriching internship experience.", 50, doc.y, bodyOpts);

            // Signature
            const sigY = Math.min(doc.y + 20, 720);
            doc.moveTo(50, sigY).lineTo(200, sigY).lineWidth(0.8).strokeColor("#333").stroke();
            doc.fillColor(textDark).font("Helvetica-Bold").fontSize(9.5).text("Kamlesh Gupta", 50, sigY + 5);
            doc.font("Helvetica").fontSize(8.5).fillColor("#555")
                .text("Director", 50, sigY + 18)
                .text("The Entrepreneurship Network", 50, sigY + 30);

            doc.moveTo(W - 200, sigY).lineTo(W - 50, sigY).lineWidth(0.8).strokeColor("#333").stroke();
            doc.fillColor(textDark).font("Helvetica-Bold").fontSize(9.5).text("HR Department", W - 200, sigY + 5);
            doc.font("Helvetica").fontSize(8.5).fillColor("#555")
                .text("Human Resources", W - 200, sigY + 18)
                .text("The Entrepreneurship Network", W - 200, sigY + 30);

            // Footer
            doc.rect(0, 800, W, 42).fill(navy);
            doc.fillColor(gold).font("Helvetica").fontSize(8)
                .text("The Entrepreneurship Network  ·  hr@entrepreneurshipnetwork.net  ·  www.entrepreneurshipnetwork.net", 0, 816, { width: W, align: "center" });
            doc.fillColor(white).font("Helvetica").fontSize(7)
                .text("This is a digitally generated offer letter. For verification contact hr@entrepreneurshipnetwork.net", 0, 828, { width: W, align: "center" });

            doc.end();
            stream.on("finish", () => resolve(outputPath));
            stream.on("error",  reject);
        } catch (err) {
            reject(err);
        }
    });
}

// ════════════════════════════════════════════════════
// STAR GRADE CALCULATOR
// ════════════════════════════════════════════════════
function getStarGrade(stats) {
    const score = (stats.attendance * 0.3) + (stats.performance * 0.3)
                + (stats.taskSubmission * 0.25) + Math.min(stats.streak, 100) * 0.15;
    if (score >= 90) return { grade: "⭐⭐⭐⭐⭐", label: "Outstanding Performer" };
    if (score >= 75) return { grade: "⭐⭐⭐⭐",  label: "Excellent Performer" };
    if (score >= 60) return { grade: "⭐⭐⭐",    label: "Good Performer" };
    if (score >= 45) return { grade: "⭐⭐",      label: "Satisfactory Performer" };
    return           { grade: "⭐",              label: "Performer" };
}

// ════════════════════════════════════════════════════
// LOC PDF GENERATOR
// ════════════════════════════════════════════════════
async function generateLOCPDF(student, stats, outputPath) {
    return new Promise((resolve, reject) => {
        try {
            const doc    = new PDFDocument({ size: "A4", margin: 0 });
            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);

            const W = 595.28;
            const gold  = "#C9A84C";
            const navy  = "#0A1628";
            const white = "#FFFFFF";
            const dark  = "#1A1A2E";

            doc.rect(0, 0, W, 90).fill(navy);
            doc.rect(0, 90, W, 4).fill(gold);
            doc.fillColor(gold).font("Helvetica-Bold").fontSize(18).text("THE ENTREPRENEURSHIP NETWORK", 50, 28, { width: W - 100, align: "center" });
            doc.fillColor(white).font("Helvetica").fontSize(9).text("hr@entrepreneurshipnetwork.net  |  www.entrepreneurshipnetwork.net", 50, 68, { width: W - 100, align: "center" });

            doc.fillColor(dark).font("Helvetica-Bold").fontSize(16).text("LETTER OF COMPLETION", 0, 115, { width: W, align: "center" });
            doc.moveTo(80, 138).lineTo(W - 80, 138).lineWidth(1).strokeColor(gold).stroke();

            const fmt = d => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
            const joining = student.joiningDate ? new Date(student.joiningDate) : new Date();
            const tenureDays = student.tenure === "45 Days" ? 45 : student.tenure === "1 Month" ? 30 : student.tenure === "3 Months" ? 90 : 180;
            const endDate = student.internshipEndDate || new Date(joining.getTime() + tenureDays * 24 * 3600 * 1000);

            doc.fillColor(dark).font("Helvetica").fontSize(11).text(
                `This is to certify that ${student.name || "the student"} (Employee ID: ${student.employeeId || "N/A"}) from ${student.collegeName || student.college || "their institution"} has successfully completed the Virtual Internship Program in ${student.domain || "the assigned domain"} at The Entrepreneurship Network.`,
                60, 156, { width: W - 120, align: "justify", lineGap: 5 }
            );
            doc.moveDown(0.8);
            doc.text(`Duration: ${student.tenure || "As per enrollment"} (${fmt(joining)} to ${fmt(endDate)})`, 60, doc.y, { width: W - 120 });
            doc.moveDown(0.6);
            doc.text(`Attendance: ${stats.attendance}%`, 60, doc.y, { width: W - 120 });
            doc.moveDown(0.6);
            doc.text(`Domain: ${student.domain || "N/A"}`, 60, doc.y, { width: W - 120 });
            doc.moveDown(1);
            doc.text(
                "The intern has fulfilled all the requirements of the internship program and has demonstrated commitment and dedication throughout the engagement period.",
                60, doc.y, { width: W - 120, align: "justify", lineGap: 5 }
            );
            doc.moveDown(1.5);

            const sigY = doc.y + 10;
            doc.moveTo(60, sigY).lineTo(200, sigY).lineWidth(0.8).strokeColor("#333").stroke();
            doc.fillColor(dark).font("Helvetica-Bold").fontSize(9.5).text("Kamlesh Gupta", 60, sigY + 5);
            doc.font("Helvetica").fontSize(8.5).fillColor("#555").text("Director, TEN", 60, sigY + 18);

            doc.rect(0, 790, W, 52).fill(navy);
            doc.fillColor(gold).font("Helvetica").fontSize(8).text("The Entrepreneurship Network  ·  Certificate of Completion", 0, 808, { width: W, align: "center" });
            doc.fillColor(white).font("Helvetica").fontSize(7).text("This document is digitally generated and is valid without a physical signature.", 0, 822, { width: W, align: "center" });

            doc.end();
            stream.on("finish", () => resolve(outputPath));
            stream.on("error",  reject);
        } catch (err) { reject(err); }
    });
}

// ════════════════════════════════════════════════════
// LOR PDF GENERATOR
// ════════════════════════════════════════════════════
async function generateLORPDF(student, stats, outputPath) {
    return new Promise((resolve, reject) => {
        try {
            const doc    = new PDFDocument({ size: "A4", margin: 0 });
            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);

            const W = 595.28;
            const gold  = "#C9A84C";
            const navy  = "#0A1628";
            const white = "#FFFFFF";
            const dark  = "#1A1A2E";
            const domainContent = getDomainContent(student.domain || "");

            doc.rect(0, 0, W, 90).fill(navy);
            doc.rect(0, 90, W, 4).fill(gold);
            doc.fillColor(gold).font("Helvetica-Bold").fontSize(18).text("THE ENTREPRENEURSHIP NETWORK", 50, 28, { width: W - 100, align: "center" });
            doc.fillColor(white).font("Helvetica").fontSize(9).text("hr@entrepreneurshipnetwork.net  |  www.entrepreneurshipnetwork.net", 50, 68, { width: W - 100, align: "center" });

            doc.fillColor(dark).font("Helvetica-Bold").fontSize(16).text("LETTER OF RECOMMENDATION", 0, 115, { width: W, align: "center" });
            doc.moveTo(80, 138).lineTo(W - 80, 138).lineWidth(1).strokeColor(gold).stroke();

            const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
            doc.fillColor("#555").font("Helvetica").fontSize(9).text(`Date: ${today}`, 60, 152);

            doc.fillColor(dark).font("Helvetica").fontSize(11).text(
                `To Whom It May Concern,`,
                60, 172, { width: W - 120 }
            );
            doc.moveDown(0.8);
            doc.text(
                `It is with great pleasure that I recommend ${student.name || "this intern"} (Employee ID: ${student.employeeId || "N/A"}) from ${student.collegeName || student.college || "their institution"} who completed a ${student.tenure || ""} Virtual Internship in ${student.domain || "the assigned domain"} at The Entrepreneurship Network.`,
                60, doc.y, { width: W - 120, align: "justify", lineGap: 5 }
            );
            doc.moveDown(0.7);
            doc.text(
                `During the internship, ${student.name ? student.name.split(" ")[0] : "the intern"} demonstrated outstanding proficiency in ${domainContent.title.replace(" Intern", "").replace(" Engineer", "")} with an attendance rate of ${stats.attendance}% and a performance score of ${stats.performance}/100. Their task submission rate of ${stats.taskSubmission}% reflects their commitment to timely delivery.`,
                60, doc.y, { width: W - 120, align: "justify", lineGap: 5 }
            );
            doc.moveDown(0.7);
            doc.text(
                `The skills demonstrated include: ${domainContent.responsibilities.join(", ")}. I am confident that ${student.name ? student.name.split(" ")[0] : "this intern"} will bring the same level of dedication and technical acumen to any future role.`,
                60, doc.y, { width: W - 120, align: "justify", lineGap: 5 }
            );
            doc.moveDown(0.7);
            doc.text(
                "I highly recommend this intern for any position requiring strong technical skills, professional ethics, and a growth mindset.",
                60, doc.y, { width: W - 120, align: "justify", lineGap: 5 }
            );
            doc.moveDown(1.5);

            const sigY = doc.y + 10;
            doc.moveTo(60, sigY).lineTo(200, sigY).lineWidth(0.8).strokeColor("#333").stroke();
            doc.fillColor(dark).font("Helvetica-Bold").fontSize(9.5).text("Kamlesh Gupta", 60, sigY + 5);
            doc.font("Helvetica").fontSize(8.5).fillColor("#555").text("Director, TEN", 60, sigY + 18);

            doc.rect(0, 790, W, 52).fill(navy);
            doc.fillColor(gold).font("Helvetica").fontSize(8).text("The Entrepreneurship Network  ·  Letter of Recommendation", 0, 808, { width: W, align: "center" });
            doc.fillColor(white).font("Helvetica").fontSize(7).text("This document is digitally generated. For verification contact hr@entrepreneurshipnetwork.net", 0, 822, { width: W, align: "center" });

            doc.end();
            stream.on("finish", () => resolve(outputPath));
            stream.on("error",  reject);
        } catch (err) { reject(err); }
    });
}

// ════════════════════════════════════════════════════
// STAR PERFORMANCE CERTIFICATE PDF GENERATOR
// ════════════════════════════════════════════════════
async function generateStarPDF(student, stats, starInfo, outputPath) {
    return new Promise((resolve, reject) => {
        try {
            const doc    = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);

            const W = 841.89, H = 595.28;
            const gold  = "#D4AF37";
            const dark  = "#0A1628";
            const white = "#FFFFFF";

            doc.rect(0, 0, W, H).fill(dark);
            doc.rect(15, 15, W - 30, H - 30).lineWidth(2).strokeColor(gold).stroke();
            doc.rect(22, 22, W - 44, H - 44).lineWidth(0.5).strokeColor(gold).opacity(0.3).stroke();
            doc.opacity(1);

            doc.fillColor(gold).font("Helvetica-Bold").fontSize(11).text("THE ENTREPRENEURSHIP NETWORK", 0, 42, { width: W, align: "center", characterSpacing: 4 });
            doc.fillColor(white).font("Helvetica").fontSize(8).text("Shaping Tomorrow's Entrepreneurs", 0, 60, { width: W, align: "center" });

            doc.fillColor(gold).font("Helvetica-Bold").fontSize(10).text("STAR PERFORMANCE CERTIFICATE", 0, 82, { width: W, align: "center", characterSpacing: 5 });
            doc.moveTo(150, 100).lineTo(W - 150, 100).lineWidth(1).strokeColor(gold).stroke();

            doc.fillColor(gold).font("Helvetica-Bold").fontSize(42).text(starInfo.grade, 0, 115, { width: W, align: "center" });
            doc.fillColor(white).font("Helvetica-Bold").fontSize(18).text(starInfo.label.toUpperCase(), 0, 168, { width: W, align: "center", characterSpacing: 3 });

            doc.moveTo(150, 196).lineTo(W - 150, 196).lineWidth(0.5).strokeColor(gold).opacity(0.4).stroke();
            doc.opacity(1);

            doc.fillColor("#aaa").font("Helvetica-Oblique").fontSize(11).text("This certifies that", 0, 208, { width: W, align: "center" });
            doc.fillColor(gold).font("Helvetica-Bold").fontSize(36).text(student.name || "Student Name", 0, 228, { width: W, align: "center" });

            doc.fillColor(white).font("Helvetica").fontSize(11).text(`has demonstrated ${starInfo.label} performance during the ${student.domain || "Technology"} Internship`, 0, 276, { width: W, align: "center" });

            // Stats row
            const stats_items = [
                { label: "Attendance", value: `${stats.attendance}%` },
                { label: "Performance", value: `${stats.performance}/100` },
                { label: "Task Rate", value: `${stats.taskSubmission}%` },
                { label: "Streak", value: `${stats.streak} days` }
            ];
            const rowY  = 310;
            const colW  = (W - 200) / stats_items.length;
            stats_items.forEach((s, i) => {
                const cx = 100 + i * colW + colW / 2;
                doc.fillColor(gold).font("Helvetica-Bold").fontSize(20).text(s.value, cx - 60, rowY, { width: 120, align: "center" });
                doc.fillColor("#888").font("Helvetica").fontSize(8).text(s.label.toUpperCase(), cx - 60, rowY + 24, { width: 120, align: "center", characterSpacing: 1 });
            });

            doc.moveTo(150, 360).lineTo(W - 150, 360).lineWidth(0.5).strokeColor(gold).opacity(0.4).stroke();
            doc.opacity(1);

            // Signature
            doc.moveTo(100, 400).lineTo(250, 400).lineWidth(0.8).strokeColor("#555").stroke();
            doc.fillColor(white).font("Helvetica-Bold").fontSize(9).text("Kamlesh Gupta", 100, 406);
            doc.fillColor("#888").font("Helvetica").fontSize(8).text("Director, TEN", 100, 418);

            doc.fillColor("#555").font("Helvetica").fontSize(8).text(`Issued: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}  ·  Employee ID: ${student.employeeId || "N/A"}`, 0, H - 36, { width: W, align: "center" });

            doc.end();
            stream.on("finish", () => resolve(outputPath));
            stream.on("error",  reject);
        } catch (err) { reject(err); }
    });
}

// ════════════════════════════════════════════════════
// PHASE 1 — OFFER LETTER AUTO-SEND (24-HOUR FALLBACK)
// ════════════════════════════════════════════════════
async function autoGenerateOfferLetter(doc) {
    try {
        const student = await Student.findById(doc.studentId);
        if (!student) return;

        // Idempotency: skip if already has offer letter
        if (doc.offerLetterUrl) return;

        const joining = student.joiningDate ? new Date(student.joiningDate) : new Date();
        const tenureDays = student.tenure === "45 Days" ? 45 : student.tenure === "1 Month" ? 30 : student.tenure === "3 Months" ? 90 : 180;
        const endDate = new Date(joining.getTime() + tenureDays * 24 * 3600 * 1000);
        const fmt = d => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });

        let docNum = student.documentNumber;
        if (!docNum) {
            docNum = await generateDocumentNumber("OL");
            await Student.findByIdAndUpdate(student._id, { documentNumber: docNum });
        }

        const safeEmpId  = String(student.employeeId || student._id).replace(/\//g, "-");
        const filename   = `${safeEmpId}_offer_letter.pdf`;
        const outputPath = path.join(offerLetterDir, filename);

        await generateDomainOfferLetterPDF({
            name:           student.name || `${student.firstName || ""} ${student.lastName || ""}`.trim(),
            collegeName:    student.collegeName || student.college || "",
            employeeId:     student.employeeId || "",
            domain:         student.domain || "",
            duration:       student.tenure || "",
            tenure:         student.tenure || "",
            startDate:      fmt(joining),
            endDate:        fmt(endDate),
            documentNumber: docNum,
            dateIssued:     fmt(new Date())
        }, outputPath);

        const fileUrl = `/uploads/offer-letters/${filename}`;
        doc.uploadStatus    = "approved";
        doc.offerLetterUrl  = fileUrl;
        doc.offerLetterSentAt = new Date();
        doc.autoGenerated   = true;
        await doc.save();

        // Send email
        let offerMailStatus = "sent";
        try {
            const transporter = createTransporter();
            await transporter.sendMail({
                from:    EMAIL_FROM,
                to:      student.email,
                subject: "Your Internship Offer Letter is Ready — TEN",
                html:    `<p>Dear ${student.name || "Intern"},</p><p>Congratulations! Your offer letter for the <strong>${student.domain || ""}</strong> internship at The Entrepreneurship Network is ready. Please find it attached to this email.</p><p>Your Employee ID: <strong>${student.employeeId || "N/A"}</strong></p><p>You can also download it from the <a href="${process.env.BASE_URL || "https://virtualinternships.entrepreneurshipnetwork.net"}">TEN Student Portal</a>.</p><p>Best regards,<br/>HR Team, TEN</p>`,
                attachments: [{ filename: "Offer_Letter_TEN.pdf", path: outputPath }]
            });
        } catch (mailErr) {
            offerMailStatus = "failed";
            console.log("[AUTO-CRON] Offer letter email simulated.");
        }

        await DocumentHistory.logSend({
            studentId:      student._id,
            studentName:    student.name || "",
            studentEmail:   student.email || "",
            employeeId:     student.employeeId || "",
            college:        student.collegeName || student.college || "",
            domain:         student.domain || "",
            documentType:   "Offer Letter",
            documentKey:    "offer_letter",
            documentNumber: docNum,
            sentToEmail:    student.email || "",
            emailStatus:    offerMailStatus
        }, "automation");

        await Notification.notifyStudent(student, {
            title: "📄 Offer Letter Ready",
            message: `Congratulations ${student.name || "Intern"}! Your internship offer letter (${docNum}) is ready and has been emailed to ${student.email || "your registered email"}. You can also download it from the Student Portal.`,
            type: "success"
        });

        console.log(`[AUTO-CRON] Offer letter auto-generated for ${student.employeeId}`);
    } catch (err) {
        console.error("[AUTO-CRON] autoGenerateOfferLetter error:", err.message);
    }
}

async function checkOverdueOfferLetters() {
    try {
        const deadline = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const overdue  = await StudentDocument.find({
            uploadStatus:   "pending",
            uploadedAt:     { $lte: deadline },
            offerLetterUrl: { $in: [null, undefined, ""] }
        });
        for (const doc of overdue) {
            await autoGenerateOfferLetter(doc);
        }
    } catch (err) {
        console.error("[AUTO-CRON] checkOverdueOfferLetters error:", err.message);
    }
}

// ════════════════════════════════════════════════════
// PHASE 2 — INTERNSHIP COMPLETION DETECTION
// ════════════════════════════════════════════════════
async function initiateCertificateApproval(student) {
    try {
        // Idempotency: skip if already has a request
        const existing = await CertificateRequest.findOne({ studentId: student._id, status: { $ne: "failed" } });
        if (existing) return;

        const req = await CertificateRequest.create({
            studentId:           student._id,
            domain:              student.domain || "",
            requestedAt:         new Date(),
            coordinatorDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
            status:              "awaiting_coordinator"
        });

        await Student.findByIdAndUpdate(student._id, { certificateStatus: "awaiting_coordinator" });

        // Notify coordinator by email (best effort)
        try {
            const transporter = createTransporter();
            await transporter.sendMail({
                from:    EMAIL_FROM,
                to:      process.env.EMAIL_US,
                subject: `[TEN] Certificate Approval Required — ${student.name} (${student.domain})`,
                html:    `<p>The internship for <strong>${student.name}</strong> (Employee ID: ${student.employeeId}, Domain: ${student.domain}) has ended.</p><p>Please review and approve the certificate request via the TEN HR Portal or the coordinator portal.</p><p>Request ID: ${req._id}</p><p>Deadline: 24 hours from now.</p>`
            });
        } catch (_) {}

        console.log(`[AUTO-CRON] Certificate approval initiated for ${student.employeeId}`);
    } catch (err) {
        console.error("[AUTO-CRON] initiateCertificateApproval error:", err.message);
    }
}

async function detectCompletedInternships() {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Find students whose internship ended and haven't started certificate flow
        const students = await Student.find({
            $or: [
                { certificateStatus: { $in: [null, undefined, "not_initiated"] } },
                { certificateStatus: { $exists: false } }
            ]
        });

        const { isInternshipComplete } = require('../utils/internshipStatus');
        for (const student of students) {
            if (isInternshipComplete(student)) {
                await initiateCertificateApproval(student);
            }
        }
    } catch (err) {
        console.error("[AUTO-CRON] detectCompletedInternships error:", err.message);
    }
}

// ════════════════════════════════════════════════════
// PHASE 2 — COORDINATOR AUTO-APPROVAL FALLBACK
// ════════════════════════════════════════════════════
async function checkOverdueCoordinatorApprovals() {
    try {
        const overdue = await CertificateRequest.find({
            status:              "awaiting_coordinator",
            coordinatorDeadline: { $lte: new Date() },
            coordinatorApproved: false
        });

        for (const req of overdue) {
            req.coordinatorApproved    = true;
            req.coordinatorApprovedAt  = new Date();
            req.coordinatorAutoApproved = true;
            req.hrDeadline             = new Date(Date.now() + 24 * 60 * 60 * 1000);
            req.status                 = "awaiting_hr";
            await req.save();
            await Student.findByIdAndUpdate(req.studentId, { certificateStatus: "awaiting_hr" });
            console.log(`[AUTO-CRON] Coordinator auto-approved for student ${req.studentId}`);
        }
    } catch (err) {
        console.error("[AUTO-CRON] checkOverdueCoordinatorApprovals error:", err.message);
    }
}

// ════════════════════════════════════════════════════
// PHASE 3 — AUTO CERTIFICATE GENERATION
// ════════════════════════════════════════════════════
async function autoGenerateCertificates(certReq) {
    try {
        if (certReq.processed) return;

        const student = await Student.findById(certReq.studentId);
        if (!student) return;

        const stats = {
            attendance:     student.attendancePercentage   || 0,
            performance:    student.performanceScore       || 0,
            taskSubmission: student.taskSubmissionRate     || 0,
            streak:         student.currentStreak          || 0
        };

        const eligibility = {
            loc:             stats.attendance >= 75,
            lor:             stats.attendance >= 75 && stats.performance >= 70,
            starPerformance: true
        };

        const starInfo = getStarGrade(stats);
        const attachments = [];
        const earnedList  = [];
        const missedList  = [];
        const sentDocuments = [];

        // Generate LOC
        if (eligibility.loc) {
            const locPath = path.join(certificatesDir, `${student.employeeId || student._id}_loc.pdf`);
            await generateLOCPDF(student, stats, locPath);
            attachments.push({ filename: "Letter_of_Completion.pdf", path: locPath });
            earnedList.push("Letter of Completion (LOC) — for maintaining 75%+ attendance");
            sentDocuments.push({ documentType: "Letter of Completion", documentKey: "loc", documentNumber: generateDocumentNumber("loc") });
        } else {
            missedList.push(`Letter of Completion — requires 75% attendance (you have ${stats.attendance}%)`);
        }

        // Generate LOR
        if (eligibility.lor) {
            const lorPath = path.join(certificatesDir, `${student.employeeId || student._id}_lor.pdf`);
            await generateLORPDF(student, stats, lorPath);
            attachments.push({ filename: "Letter_of_Recommendation.pdf", path: lorPath });
            earnedList.push("Letter of Recommendation (LOR) — for 75%+ attendance and 70%+ performance");
            sentDocuments.push({ documentType: "Letter of Recommendation", documentKey: "lor", documentNumber: generateDocumentNumber("lor") });
        } else {
            missedList.push(`Letter of Recommendation — requires 75% attendance and 70% performance`);
        }

        // Generate Star Performance
        const starPath = path.join(certificatesDir, `${student.employeeId || student._id}_star.pdf`);
        await generateStarPDF(student, stats, starInfo, starPath);
        attachments.push({ filename: "Star_Performance_Certificate.pdf", path: starPath });
        earnedList.push(`Star Performance Certificate — ${starInfo.grade} ${starInfo.label}`);
        sentDocuments.push({ documentType: "Star Performer Certificate", documentKey: "star", documentNumber: generateDocumentNumber("star") });

        // Send consolidated email
        let certMailStatus = "sent";
        try {
            const transporter = createTransporter();
            const earnedHtml  = earnedList.map(e => `<li>✅ ${e}</li>`).join("");
            const missedHtml  = missedList.map(m => `<li>❌ ${m}</li>`).join("");
            await transporter.sendMail({
                from:    EMAIL_FROM,
                to:      student.email,
                subject: "🏅 Your TEN Internship Certificates Are Ready!",
                html:    `<p>Dear ${student.name || "Intern"},</p><p>Congratulations on completing your <strong>${student.domain || ""}</strong> internship at The Entrepreneurship Network!</p><h3>Certificates Earned:</h3><ul>${earnedHtml}</ul>${missedHtml ? `<h3>Not Earned:</h3><ul>${missedHtml}</ul>` : ""}<p>Please find your certificates attached. You can also view them in the <a href="${process.env.BASE_URL || "https://virtualinternships.entrepreneurshipnetwork.net"}/my-certificates.html">TEN Student Portal</a>.</p><p>Best regards,<br/>TEN Team</p>`,
                attachments
            });
        } catch (mailErr) {
            certMailStatus = "failed";
            console.log("[AUTO-CRON] Certificate email simulated.");
        }

        // Log each automation-sent document into Document Send History
        for (const sentDoc of sentDocuments) {
            await DocumentHistory.logSend({
                studentId:      student._id,
                studentName:    (student.name || student.email || "").trim(),
                studentEmail:   student.email || "",
                employeeId:     student.employeeId || "",
                college:        student.collegeName || student.college || "Not provided",
                domain:         student.domain || "",
                documentType:   sentDoc.documentType,
                documentKey:    sentDoc.documentKey,
                documentNumber: sentDoc.documentNumber,
                sentToEmail:    student.email || "",
                emailStatus:    certMailStatus
            }, "automation");
        }

        await Notification.notifyStudent(student, {
            title: "🏅 Your Internship Certificates Are Ready!",
            message: `Congratulations ${student.name || "Intern"} on completing your ${student.domain || ""} internship! Earned: ${earnedList.join("; ")}.${missedList.length ? ` Not earned: ${missedList.join("; ")}.` : ""} The certificates have been emailed to you and are available in the Student Portal.`,
            type: "success"
        });

        certReq.hrApproved         = true;
        certReq.hrApprovedAt       = new Date();
        certReq.hrAutoApproved     = true;
        certReq.status             = "completed";
        certReq.processed          = true;
        certReq.locEligible        = eligibility.loc;
        certReq.lorEligible        = eligibility.lor;
        certReq.starPerformanceGrade = starInfo.grade;
        certReq.starPerformanceLabel = starInfo.label;
        await certReq.save();

        await Student.findByIdAndUpdate(student._id, { certificateStatus: "completed" });
        console.log(`[AUTO-CRON] Certificates auto-generated for ${student.employeeId}`);
    } catch (err) {
        console.error("[AUTO-CRON] autoGenerateCertificates error:", err.message);
    }
}

async function checkOverdueHRApprovals() {
    try {
        const overdue = await CertificateRequest.find({
            status:     "awaiting_hr",
            hrDeadline: { $lte: new Date() },
            hrApproved: false
        });

        for (const req of overdue) {
            await autoGenerateCertificates(req);
        }
    } catch (err) {
        console.error("[AUTO-CRON] checkOverdueHRApprovals error:", err.message);
    }
}

// ════════════════════════════════════════════════════
// COORDINATOR AUTO-ATTENDANCE
// If coordinator hasn't marked attendance for a student today,
// check if the student was active (submitted task or watched video today)
// and auto-mark them present from coordinator side.
// ════════════════════════════════════════════════════
async function autoMarkCoordinatorAttendance() {
    try {
        const today = new Date();
        const dateKey = today.toISOString().slice(0, 10); // YYYY-MM-DD
        const dayStart = new Date(dateKey + "T00:00:00.000Z");
        const dayEnd   = new Date(dateKey + "T23:59:59.999Z");

        // Get all active students
        const students = await Student.find({
            internshipEnd: { $gte: today },
            isBlocked: { $ne: true }
        }).lean();

        for (const student of students) {
            try {
                // Skip if coordinator already marked this student today
                const existing = await Attendance.findOne({
                    employeeId: student.employeeId,
                    dateKey:    dateKey,
                    markedBy:   "coordinator"
                });
                if (existing) continue;

                // Check if student was active today (task submitted or video watched)
                const wasActive = await StudentTaskProgress.findOne({
                    studentId: student._id,
                    $or: [
                        { submittedAt: { $gte: dayStart, $lte: dayEnd } },
                        { updatedAt:   { $gte: dayStart, $lte: dayEnd }, videoWatchedPercent: { $gt: 0 } }
                    ]
                });

                if (wasActive) {
                    // Auto-mark coordinator attendance for active student
                    await Attendance.create({
                        studentId:     student._id,
                        employeeId:    student.employeeId,
                        domain:        student.domain || "",
                        date:          today,
                        dateKey:       dateKey,
                        status:        "Present",
                        markedBy:      "coordinator",
                        coordinatorId: "AUTO_SYSTEM"
                    });
                    console.log(`[AUTO-ATTEND] Auto-marked coordinator attendance for ${student.employeeId} (${dateKey})`);
                }
            } catch (studentErr) {
                // Duplicate key = already marked, skip silently
                if (studentErr.code !== 11000) {
                    console.error(`[AUTO-ATTEND] Error for ${student.employeeId}:`, studentErr.message);
                }
            }
        }
    } catch (err) {
        console.error("[AUTO-ATTEND] autoMarkCoordinatorAttendance error:", err.message);
    }
}

// ════════════════════════════════════════════════════
// INIT — Register all cron jobs
// ════════════════════════════════════════════════════
function initAutomation() {
    // Offer Letter Auto-Send — every 30 min
    cron.schedule("*/30 * * * *", checkOverdueOfferLetters);

    // Internship Completion Detection — daily 9 AM
    cron.schedule("0 9 * * *", detectCompletedInternships);

    // Coordinator Auto-Approval — every 30 min
    cron.schedule("*/30 * * * *", checkOverdueCoordinatorApprovals);

    // HR Certificate Auto-Generation — every 30 min
    cron.schedule("*/30 * * * *", checkOverdueHRApprovals);

    // Coordinator Auto-Attendance — runs at 11:55 PM daily
    // Auto-marks students as present if they were active and coordinator didn't mark
    cron.schedule("55 23 * * *", autoMarkCoordinatorAttendance);

    console.log("[AUTO-CRON] Automation cron jobs initialized");
}

module.exports = {
    initAutomation,
    getDomainContent,
    getStarGrade,
    generateDomainOfferLetterPDF,
    generateLOCPDF,
    generateLORPDF,
    generateStarPDF,
    autoGenerateOfferLetter,
    autoGenerateCertificates,
    initiateCertificateApproval
};
