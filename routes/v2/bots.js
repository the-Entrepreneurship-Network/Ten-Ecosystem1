const router            = require('express').Router();
const mongoose          = require('mongoose');
const BotQuery          = require('../../models/BotQuery');
const SystemKnowledge   = require('../../models/SystemKnowledge');

// ─── Seed default knowledge if DB empty ──────────────────────────
const DEFAULT_KNOWLEDGE = [
  { topic: 'task_submission',     content: 'Submit daily tasks via the v2-tasks page. Earn coins for Daily Job Posting every day.' },
  { topic: 'attendance',          content: 'Mark attendance in your student dashboard. WhatsApp Re-Joiners must fill Google Form twice daily.' },
  { topic: 'certificates',        content: '2-step approval: Coordinator approves first, then HR. LOC at 100% completion, LOR at 50%+, Star Performance for top scorers.' },
  { topic: 'documents',           content: 'Upload Address Proof and Marksheet at my-documents page. Accepted: PDF/JPG/PNG under 5MB.' },
  { topic: 'offer_letter',        content: 'Offer letter generated after HR approves your uploaded documents. Auto-generated after 24hr delay.' },
  { topic: 'profile',             content: 'View your registration details including your password (masked) in the Profile modal on your dashboard.' },
  { topic: 'discord',             content: 'Join TEN alumni Discord: https://discord.gg/GYnZFbDE7. Find the QR code in the attendance section.' },
  { topic: 'login',               content: 'Login with your Employee ID and the password you registered with at the login page.' },
  { topic: 'joiner_type',         content: 'Select New Joiner or WhatsApp Re-Joiner on first login. This cannot be changed later.' },
  { topic: 'domains',             content: 'Available domains: Web Dev, Python, AI, Data Science, MERN, HR Management, Java, Flutter, Cyber Security, DevOps, Software Engineering.' },
  { topic: 'coins',               content: 'Earn coins by completing daily tasks. Coins are tracked on your dashboard.' },
  { topic: 'coordinator',         content: 'Your coordinator manages your tasks and approvals. Contact them via the Domain Chat feature.' },
  { topic: 'internship_duration', content: 'Standard internship is 45 days. Certificate issued after completion and HR approval.' },
  { topic: 'payment',             content: 'If you have payment queries, check the Payment section in your dashboard or contact HR.' },
];

async function seedKnowledge() {
  try {
    if (mongoose.connection.readyState !== 1) {
      return;
    }
    const count = await SystemKnowledge.countDocuments();
    if (count === 0) {
      await SystemKnowledge.insertMany(DEFAULT_KNOWLEDGE);
      console.log('[Bots] Default knowledge seeded.');
    }
  } catch (error) {
    console.warn('[Bots] Knowledge seeding skipped:', error.message);
  }
}
seedKnowledge().catch(console.error);

// ─── Gemini API helper ────────────────────────────────────────────
async function askGemini(systemPrompt, userMessage) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.includes('your_key')) {
    throw new Error('GEMINI_API_KEY not set in environment');
  }
  const url  = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents:          [{ parts: [{ text: userMessage }] }],
    generationConfig:  { temperature: 0.7, maxOutputTokens: 500 },
  };
  const res  = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.candidates || !data.candidates[0]) {
    throw new Error(data.error ? data.error.message : 'Gemini returned no response');
  }
  return data.candidates[0].content.parts[0].text.trim();
}

// ─── Get all knowledge as context string ─────────────────────────
async function getKnowledgeContext() {
  const items = await SystemKnowledge.find({}).lean();
  return items.map(i => `[${i.topic}]: ${i.content}`).join('\n');
}

// ─── POST /api/v2/bots/task-bot ──────────────────────────────────
router.post('/task-bot', async (req, res) => {
  try {
    const { question, userId, userType, userName, domain } = req.body;
    if (!question || !userId) {
      return res.status(400).json({ error: 'question and userId required' });
    }

    const knowledge    = await getKnowledgeContext();
    const systemPrompt = `You are TEN Task Assistant, an AI embedded in the TEN Internship Portal.
Your job: answer ONLY questions about portal tasks, deadlines, attendance, documents, coins, certificates, and portal features.
Use the knowledge base below to answer accurately and specifically.
If the question is completely unrelated to the internship portal, respond: "Please ask me about your internship tasks or portal features."
Be concise (2-4 sentences max), friendly, and specific. Never make up information not in the knowledge base.

KNOWLEDGE BASE:
${knowledge}`;

    const answer = await askGemini(systemPrompt, question);
    await BotQuery.create({ userId, userType, userName, domain, botType: 'task', question, answer });
    return res.json({ answer });
  } catch (e) {
    console.error('[task-bot]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/v2/bots/voice-bot ─────────────────────────────────
router.post('/voice-bot', async (req, res) => {
  try {
    const { question, userId, userType, userName, domain } = req.body;
    if (!question || !userId) {
      return res.status(400).json({ error: 'question and userId required' });
    }

    const systemPrompt = `You are TEN Voice Assistant, a helpful and smart AI for TEN Internship Portal students.
Answer any internship-related question clearly and concisely (voice-friendly: 1-3 short sentences).
Domain context: ${domain || 'General'}.
Be warm, professional, and helpful. Never say you cannot help — always give your best answer.`;

    const answer = await askGemini(systemPrompt, question);
    await BotQuery.create({ userId, userType, userName, domain, botType: 'voice', question, answer });
    return res.json({ answer });
  } catch (e) {
    console.error('[voice-bot]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/v2/bots/query-bot ─────────────────────────────────
router.post('/query-bot', async (req, res) => {
  try {
    const { question, userId, userType, userName, domain, coordinatorId } = req.body;
    if (!question || !userId) {
      return res.status(400).json({ error: 'question and userId required' });
    }

    const knowledge    = await getKnowledgeContext();
    const systemPrompt = `You are TEN Support Bot for the TEN Internship Portal.
Answer student questions about their internship confidently using the knowledge base below.
If you TRULY cannot answer with confidence (question requires checking their specific account, HR approval status, or payment records), respond with ONLY this exact text: ESCALATE_TO_HR
Otherwise give a helpful, accurate answer in 2-4 sentences.

KNOWLEDGE BASE:
${knowledge}`;

    const answer          = await askGemini(systemPrompt, question);
    const needsEscalation = answer.trim() === 'ESCALATE_TO_HR';

    const record = await BotQuery.create({
      userId,
      userType,
      userName,
      domain,
      coordinatorId: coordinatorId || '',
      botType:       'query',
      question,
      answer:        needsEscalation ? null : answer,
      escalatedToHR: needsEscalation,
      status:        needsEscalation ? 'open' : 'answered',
    });

    return res.json({ answer: needsEscalation ? null : answer, needsEscalation, queryId: record._id });
  } catch (e) {
    console.error('[query-bot]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/v2/bots/escalate ──────────────────────────────────
router.post('/escalate', async (req, res) => {
  try {
    const { queryId, details, userId, userType, userName, domain, coordinatorId } = req.body;
    if (queryId) {
      await BotQuery.findByIdAndUpdate(queryId, {
        question:      details,
        escalatedToHR: true,
        coordinatorId: coordinatorId || '',
      });
    } else {
      await BotQuery.create({
        userId,
        userType,
        userName,
        domain,
        coordinatorId: coordinatorId || '',
        botType:       'query',
        question:      details,
        escalatedToHR: true,
        status:        'open',
      });
    }
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/v2/bots/hr/queries ─────────────────────────────────
router.get('/hr/queries', async (req, res) => {
  try {
    const filter = { escalatedToHR: true };
    if (req.query.domain) { filter.domain = req.query.domain; }
    if (req.query.status) { filter.status = req.query.status; }
    const queries = await BotQuery.find(filter).sort({ createdAt: -1 }).lean();

    const frequencyMap = {};
    queries.forEach(q => {
      const key = q.question.slice(0, 50).toLowerCase().replace(/\s+/g, ' ');
      if (!frequencyMap[key]) { frequencyMap[key] = { count: 0, sample: q }; }
      frequencyMap[key].count++;
    });
    const trending = Object.values(frequencyMap)
      .filter(f => f.count > 1)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return res.json({ queries, trending, totalOpen: queries.filter(q => q.status === 'open').length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/v2/bots/hr/answer ─────────────────────────────────
router.post('/hr/answer', async (req, res) => {
  try {
    const { queryId, hrAnswer, hrAnsweredBy } = req.body;
    if (!queryId || !hrAnswer) {
      return res.status(400).json({ error: 'queryId and hrAnswer required' });
    }
    const query = await BotQuery.findByIdAndUpdate(
      queryId,
      { hrAnswer, hrAnsweredBy, hrAnsweredAt: new Date(), status: 'answered' },
      { new: true }
    );
    if (!query) { return res.status(404).json({ error: 'Query not found' }); }

    try {
      const Notification = require('../../models/Notification');
      await Notification.create({
        title:            '\u2705 Your Query Was Answered by HR',
        message:          `HR answered your question: "${hrAnswer}"`,
        type:             'info',
        from:             hrAnsweredBy || 'HR Team',
        targetType:       'student',
        targetEmployeeId: query.userId,
      });
    } catch (_e) { /* Notification model may differ — skip silently */ }

    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/v2/bots/knowledge/update ──────────────────────────
router.post('/knowledge/update', async (req, res) => {
  try {
    const { topic, content } = req.body;
    if (!topic || !content) {
      return res.status(400).json({ error: 'topic and content required' });
    }
    await SystemKnowledge.findOneAndUpdate(
      { topic },
      { content, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
