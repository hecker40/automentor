const DEFAULT_MODEL = "gpt-4o-mini";

const fallbackAnalysis = {
  misconception: "Unable to analyze the work yet",
  confidence: 0.18,
  explanation: "MentorAI could not read the whiteboard response.",
  suggestedQuestion: "Can you walk me through the steps you wrote on the board?",
  learningPath: [
    "Restate the problem in your own words.",
    "Work through one guided example with the tutor.",
    "Try one similar problem and explain each step out loud.",
  ],
  strengths: [],
  nextSteps: [],
};

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  // Vercel parses application/json requests before this handler runs. Use that
  // parsed body when it is available; reading the stream again would be empty.
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (typeof req.body === "string" || Buffer.isBuffer(req.body)) {
    return JSON.parse(req.body.toString());
  }

  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) return {};

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function cleanAnalysis(value) {
  const hasMeaningfulAnalysis = Boolean(
    value?.misconception || value?.explanation || value?.suggestedQuestion
  );

  return {
    misconception: value?.misconception || fallbackAnalysis.misconception,
    confidence: normalizeConfidence(value?.confidence, hasMeaningfulAnalysis),
    explanation: value?.explanation || fallbackAnalysis.explanation,
    suggestedQuestion: value?.suggestedQuestion || fallbackAnalysis.suggestedQuestion,
    learningPath: Array.isArray(value?.learningPath)
      ? value.learningPath.slice(0, 3)
      : fallbackAnalysis.learningPath,
    strengths: Array.isArray(value?.strengths) ? value.strengths.slice(0, 3) : [],
    nextSteps: Array.isArray(value?.nextSteps) ? value.nextSteps.slice(0, 3) : [],
  };
}

function normalizeConfidence(value, hasMeaningfulAnalysis = false) {
  const raw = typeof value === "string" ? value.replace(/%/g, "").trim() : value;
  const parsed = Number(raw);

  if (Number.isFinite(parsed)) {
    if (parsed > 1 && parsed <= 100) return Math.max(0, Math.min(1, parsed / 100));
    if (parsed > 0 && parsed <= 1) return parsed;
    if (parsed === 0 && hasMeaningfulAnalysis) return 0.62;
  }

  return hasMeaningfulAnalysis ? 0.62 : fallbackAnalysis.confidence;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return sendJson(res, 500, { error: "OPENAI_API_KEY is not configured" });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON body" });
  }

  const { problem, whiteboardImage, chatHistory = [] } = body || {};

  if (!whiteboardImage || typeof whiteboardImage !== "string") {
    return sendJson(res, 400, { error: "whiteboardImage is required" });
  }

  const recentChat = Array.isArray(chatHistory)
    ? chatHistory.slice(-8).map((message) => ({
        from: message?.from || "unknown",
        text: String(message?.text || "").slice(0, 500),
      }))
    : [];

  const prompt = [
    "You are MentorAI, an expert math tutor observing a live tutoring whiteboard.",
    "Analyze the student's visible work and respond only with compact JSON.",
    "Focus on actionable tutoring feedback, not grading. If the user's work is correct, still analyze their work and congratulate the user instead of stating a misconception. Otherwise, if it is wrong, identify the misconception.",
    "Keep the learner moving forward with simple, guided next steps.",
    "",
    `Problem: ${problem || "No problem text provided"}`,
    `Recent chat: ${JSON.stringify(recentChat)}`,
    "",
    "Return this JSON shape:",
    "{",
    '  "misconception": "short label for the likely misconception, if the answer is right then please state that our answer is correct",',
    '  "confidence": 0.78,',
    '  "explanation": "one or two sentences explaining what you see",',
    '  "suggestedQuestion": "a Socratic question the tutor can ask next",',
    '  "learningPath": ["short guided step", "short guided practice step", "quick mastery check"],',
    '  "strengths": ["what the student did well"],',
    '  "nextSteps": ["specific next tutoring move"]',
    "}",
    "",
    "Rules:",
    "- Confidence must be a number between 0 and 1.",
    "- If the work is readable and you can infer a real misconception, confidence should usually be between 0.45 and 0.95, not 0.",
    "- The learningPath should be simple, supportive, and no more than 3 steps.",
  ].join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: whiteboardImage } },
            ],
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data?.error?.message || "OpenAI request failed";
      return sendJson(res, response.status, { error: message });
    }

    const content = data?.choices?.[0]?.message?.content;
    const parsed = content ? JSON.parse(content) : fallbackAnalysis;

    return sendJson(res, 200, cleanAnalysis(parsed));
  } catch (error) {
    return sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Analysis failed",
    });
  }
}