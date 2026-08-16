// NEW FEATURE: Quiz System
require("dotenv").config();

// NEW FEATURE: Quiz System
const fs = require("fs");
const path = require("path");
const https = require("https");
const mongoose = require("mongoose");
const DomainTask = require("../models/new/DomainTask");
const QuizQuestion = require("../models/new/QuizQuestion");

// NEW FEATURE: Quiz System
const MONGODB_URI = process.env.MONGODB_URI;
const QUESTIONS_DIR = path.join(__dirname, "quizQuestions");

// NEW FEATURE: Quiz System
function listJsonFiles(dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) out.push(...listJsonFiles(full));
        else if (stat.isFile() && entry.toLowerCase().endsWith(".json")) out.push(full);
    }
    return out;
}

// NEW FEATURE: Quiz System
function normalizeDurationType(v) {
    const s = String(v || "").trim();
    if (!s) return null;
    if (s === "45days" || s === "1month" || s === "3months" || s === "6months") return s;
    return null;
}

// NEW FEATURE: Quiz System
function extractYouTubeId(url) {
    if (!url) return null;
    const m = String(url).match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
}

// NEW FEATURE: Quiz System
function decodeXmlEntities(s) {
    return String(s || "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, "/")
        .replace(/&#x60;/g, "`")
        .replace(/&#x3D;/g, "=");
}

// NEW FEATURE: Quiz System
function httpGetText(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { "User-Agent": "TEN-QuizSeeder/1.0" } }, (res) => {
            let data = "";
            res.on("data", chunk => { data += chunk; });
            res.on("end", () => resolve(data));
        }).on("error", reject);
    });
}

// NEW FEATURE: Quiz System
async function fetchYouTubeCaptions(videoId) {
    const base = `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}`;
    const attempts = [
        `${base}&lang=en`,
        `${base}&lang=en&kind=asr`,
        `${base}&lang=en-US`,
        `${base}&lang=en-US&kind=asr`
    ];

    for (const url of attempts) {
        try {
            const xml = await httpGetText(url);
            if (!xml || xml.trim().length < 40) continue;
            if (!xml.includes("<text")) continue;

            const texts = [];
            const re = /<text[^>]*>([\s\S]*?)<\/text>/g;
            let match;
            while ((match = re.exec(xml))) {
                const t = decodeXmlEntities(match[1])
                    .replace(/<[^>]+>/g, "")
                    .replace(/\s+/g, " ")
                    .trim();
                if (t) texts.push(t);
            }

            const joined = texts.join(" ").replace(/\s+/g, " ").trim();
            if (joined.length >= 200) return joined;
        } catch (_) {}
    }
    return "";
}

// NEW FEATURE: Quiz System
function generateHardMcqFromTranscript(transcript, count) {
    const stop = new Set([
        "the","and","that","this","with","from","have","will","your","you","are","for","into","then","than","when","what",
        "which","where","while","their","there","about","because","does","doing","done","each","just","like","more","most",
        "some","such","very","also","only","over","under","using","used","use","make","makes","made","want","need","needs",
        "can","cannot","could","should","would","may","might","must","it's","its","we","our","they","them","he","she","it",
        "a","an","to","of","in","on","as","at","is","was","be","by","or","if","so","not","no","yes","do","did"
    ]);

    const text = String(transcript || "").replace(/\s+/g, " ").trim();
    const rawSentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    const sentences = rawSentences.filter(s => s.length >= 60).slice(0, 400);
    if (!sentences.length) return [];

    const freq = {};
    for (const s of sentences) {
        const words = s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
        for (const w of words) {
            if (w.length < 5) continue;
            if (stop.has(w)) continue;
            freq[w] = (freq[w] || 0) + 1;
        }
    }
    const keywords = Object.keys(freq).sort((a, b) => (freq[b] - freq[a])).slice(0, 120);
    if (keywords.length < 10) return [];

    function pickDistractors(correct) {
        const d = [];
        for (const k of keywords) {
            if (k === correct) continue;
            d.push(k);
            if (d.length === 3) break;
        }
        while (d.length < 3) d.push(keywords[(d.length + 3) % keywords.length]);
        return d;
    }

    const out = [];
    for (let i = 0; i < count; i++) {
        const sentence = sentences[i % sentences.length];
        let chosen = null;
        for (const k of keywords) {
            if (sentence.toLowerCase().includes(k)) { chosen = k; break; }
        }
        if (!chosen) chosen = keywords[i % keywords.length];

        const blanked = sentence.replace(new RegExp(`\\b${chosen}\\b`, "i"), "____");
        const distractors = pickDistractors(chosen);
        const opts = [chosen, ...distractors];

        const perm = [0, 1, 2, 3];
        for (let j = perm.length - 1; j > 0; j--) {
            const r = (i + j * 7) % (j + 1);
            const tmp = perm[j]; perm[j] = perm[r]; perm[r] = tmp;
        }

        const letters = ["A", "B", "C", "D"];
        const options = {};
        let correctAnswer = "A";
        for (let j = 0; j < 4; j++) {
            const idx = perm[j];
            const letter = letters[j];
            options[letter] = opts[idx];
            if (idx === 0) correctAnswer = letter;
        }

        out.push({
            question_text: `In the video, which option best completes the statement: "${blanked}"`,
            options,
            correct_answer: correctAnswer,
            explanation: `From the video transcript: "${sentence}"`,
            difficulty: "hard"
        });
    }
    return out;
}

// NEW FEATURE: Quiz System
async function main() {
    if (!MONGODB_URI) {
        console.error("Missing MONGODB_URI in environment.");
        process.exit(1);
    }

    await mongoose.connect(MONGODB_URI);

    const files = listJsonFiles(QUESTIONS_DIR);

    let inserted = 0;
    let processed = 0;

    if (files.length) {
        for (const file of files) {
            const raw = fs.readFileSync(file, "utf8");
            const items = JSON.parse(raw);
            if (!Array.isArray(items)) {
                console.error(`Invalid format in ${file}: expected an array.`);
                process.exit(1);
            }

            for (const q of items) {
                processed += 1;
                const domain = q.domain;
                const weekNumber = parseInt(q.week_number ?? q.weekNumber);
                const durationType = normalizeDurationType(q.duration_type ?? q.durationType);
                if (!domain || !durationType || !weekNumber) {
                    console.error(`Missing domain/duration/week in ${file}`);
                    process.exit(1);
                }

                const task = await DomainTask.findOne({ domain, durationType, weekNumber }).lean();
                if (!task) {
                    console.error(`No DomainTask found for ${domain} ${durationType} week ${weekNumber} (file: ${file})`);
                    process.exit(1);
                }

                const doc = {
                    task_id: task._id,
                    domain,
                    week_number: weekNumber,
                    duration_type: durationType,
                    question_text: q.question_text,
                    options: q.options,
                    correct_answer: q.correct_answer,
                    explanation: q.explanation,
                    difficulty: q.difficulty || "hard"
                };

                if (!doc.question_text || !doc.options || !doc.correct_answer) {
                    console.error(`Missing question_text/options/correct_answer (file: ${file})`);
                    process.exit(1);
                }

                await QuizQuestion.create(doc);
                inserted += 1;
            }
        }
    }

    const tasks = await DomainTask.find({}).select("_id domain durationType weekNumber videoUrl").lean();
    const missingTranscripts = [];

    for (const t of tasks) {
        const existing = await QuizQuestion.countDocuments({ task_id: t._id });
        if (existing >= 30) continue;

        const videoId = extractYouTubeId(t.videoUrl);
        if (!videoId) {
            missingTranscripts.push({ task: t, reason: "invalid_video_url" });
            continue;
        }

        const transcript = await fetchYouTubeCaptions(videoId);
        if (!transcript) {
            missingTranscripts.push({ task: t, reason: "no_captions" });
            continue;
        }

        const generated = generateHardMcqFromTranscript(transcript, 30);
        if (generated.length < 30) {
            missingTranscripts.push({ task: t, reason: "transcript_too_short" });
            continue;
        }

        await QuizQuestion.deleteMany({ task_id: t._id });
        await QuizQuestion.insertMany(generated.map(q => ({
            task_id: t._id,
            domain: t.domain,
            week_number: t.weekNumber,
            duration_type: t.durationType,
            question_text: q.question_text,
            options: q.options,
            correct_answer: q.correct_answer,
            explanation: q.explanation,
            difficulty: q.difficulty
        })));

        inserted += 30;
        processed += 30;
    }

    const missing = [];
    for (const t of tasks) {
        const c = await QuizQuestion.countDocuments({ task_id: t._id });
        if (c < 30) missing.push({ task: t, count: c });
    }

    console.log(`[Quiz Seed] Inserted: ${inserted}, Processed: ${processed}`);
    if (missingTranscripts.length) {
        console.error(`[Quiz Seed] Could not generate questions for ${missingTranscripts.length} tasks due to transcript issues.`);
        for (const m of missingTranscripts.slice(0, 50)) {
            console.error(`- ${m.task.domain} ${m.task.durationType} week ${m.task.weekNumber}: ${m.reason}`);
        }
    }
    if (missing.length) {
        console.error(`[Quiz Seed] Missing banks for ${missing.length} tasks. Each task must have at least 30 questions.`);
        for (const m of missing.slice(0, 50)) {
            console.error(`- ${m.task.domain} ${m.task.durationType} week ${m.task.weekNumber}: ${m.count}/30`);
        }
        process.exit(1);
    }

    console.log("[Quiz Seed] All tasks have at least 30 questions.");
    process.exit(0);
}

main().catch(err => {
    console.error("Quiz seed failed:", err.message);
    process.exit(1);
});
