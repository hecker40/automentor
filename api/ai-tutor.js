const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_ELEVENLABS_MODEL = "eleven_multilingual_v2";
const DEFAULT_AUDIO_MIME = "audio/mpeg";

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
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

function cleanText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function compactList(values = [], limit = 3) {
  return Array.isArray(values)
    ? values
        .map((value) => {
          if (!value) return null;
          if (typeof value === "string") return cleanText(value);
          if (typeof value === "object") return cleanText(value.skill || value.mode || value.title || value.note || value.prompt);
          return cleanText(String(value));
        })
        .filter(Boolean)
        .slice(0, limit)
    : [];
}

function normalizeChatHistory(chatHistory = []) {
  return Array.isArray(chatHistory)
    ? chatHistory.slice(-8).map((message) => ({
        from: message?.from === "student" ? "student" : "tutor",
        text: cleanText(message?.text).slice(0, 280),
      })).filter((message) => message.text)
    : [];
}

function buildFallbackTutorText({ studentName, subject, problem, studentMessage, analysis, latestLessonRecap }) {
  const safeStudent = cleanText(studentName, "there");
  const safeSubject = cleanText(subject, "this problem");
  const misconception = cleanText(analysis?.misconception);
  const explanation = cleanText(analysis?.explanation);
  const nextQuestion = cleanText(analysis?.suggestedQuestion);
  const focusPrompt = cleanText(problem || studentMessage || latestLessonRecap, "the next step");

  if (misconception && explanation) {
    return `Alright ${safeStudent}, let’s slow this down. In ${safeSubject.toLowerCase()}, the main thing to fix is ${misconception.toLowerCase()}. ${explanation} Try this next: ${nextQuestion || `walk me through ${focusPrompt}`}`;
  }

  return `Alright ${safeStudent}, let’s work through ${focusPrompt}. I want you to say the next step out loud, and I’ll help you check it as you go.`;
}

async function generateTutorText({
  studentName,
  subject,
  problem,
  studentMessage,
  chatHistory,
  analysis,
  latestLessonRecap,
  focusSkills,
  effectivePracticeModes,
  targetedPractice,
  strengths,
}) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      text: buildFallbackTutorText({ studentName, subject, problem, studentMessage, analysis, latestLessonRecap }),
      source: "fallback",
    };
  }

  const prompt = [
    "You are MentorAI, a calm and sharp AI tutor speaking directly to a student in a live session.",
    "Write exactly one concise spoken reply for the AI tutor to say out loud right now.",
    "Use the student context, latest analysis, and saved profile signals to choose the next teaching move.",
    "Do not mention profiles, analytics, checkpoints, hidden signals, memory systems, or that you are using OpenAI.",
    "Do not sound theatrical. Do not overpraise. Be natural, direct, and supportive.",
    "Keep the response under 110 words.",
    "Prefer one concrete next step and one short follow-up question.",
    "Return compact JSON only with this shape:",
    '{"text":"spoken tutor reply","teachingFocus":"very short label"}',
    "",
    `Student: ${cleanText(studentName, "Student")}`,
    `Subject: ${cleanText(subject, "General")}`,
    `Problem: ${cleanText(problem, "No problem provided")}`,
    `Student message: ${cleanText(studentMessage, "") || "None"}`,
    `Recent chat: ${JSON.stringify(normalizeChatHistory(chatHistory))}`,
    `Latest analysis: ${JSON.stringify(analysis || {})}`,
    `Latest lesson recap: ${cleanText(latestLessonRecap, "None")}`,
    `Focus skills: ${JSON.stringify(focusSkills || [])}`,
    `Practice modes that have worked: ${JSON.stringify(effectivePracticeModes || [])}`,
    `Targeted practice options: ${JSON.stringify(targetedPractice || [])}`,
    `Observed strengths: ${JSON.stringify(strengths || [])}`,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "OpenAI tutor response failed");
  }

  const content = data?.choices?.[0]?.message?.content;
  const parsed = content ? JSON.parse(content) : {};
  const text = cleanText(parsed?.text, buildFallbackTutorText({ studentName, subject, problem, studentMessage, analysis, latestLessonRecap }));

  return {
    text,
    teachingFocus: cleanText(parsed?.teachingFocus),
    source: "openai",
  };
}

async function synthesizeSpeech(text, voiceId) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || !voiceId) {
    return {
      audioBase64: null,
      audioMimeType: null,
      provider: null,
      warning: !apiKey
        ? "ELEVENLABS_API_KEY is not configured"
        : "ELEVENLABS_VOICE_ID is not configured",
    };
  }

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      Accept: DEFAULT_AUDIO_MIME,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL_ID || DEFAULT_ELEVENLABS_MODEL,
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.8,
        style: 0.2,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    let message = "ElevenLabs speech synthesis failed";
    try {
      const errorData = await response.json();
      message = errorData?.detail?.message || errorData?.detail || errorData?.message || message;
    } catch {
      // ignore JSON parse failure on binary/error bodies
    }

    return {
      audioBase64: null,
      audioMimeType: null,
      provider: "elevenlabs",
      warning: message,
    };
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    audioBase64: Buffer.from(arrayBuffer).toString("base64"),
    audioMimeType: DEFAULT_AUDIO_MIME,
    provider: "elevenlabs",
    warning: "",
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON body" });
  }

  const studentName = cleanText(body?.studentName, "Student");
  const subject = cleanText(body?.subject, "General");
  const problem = cleanText(body?.problem);
  const studentMessage = cleanText(body?.studentMessage);
  const chatHistory = normalizeChatHistory(body?.chatHistory || []);
  const latestLessonRecap = cleanText(body?.latestLessonRecap);
  const analysis = body?.analysis && typeof body.analysis === "object" ? body.analysis : null;
  const focusSkills = compactList(body?.focusSkills || [], 3);
  const effectivePracticeModes = compactList(body?.effectivePracticeModes || [], 3);
  const targetedPractice = compactList(body?.targetedPractice || [], 3);
  const strengths = compactList(body?.strengths || [], 3);
  const voiceId = cleanText(body?.voiceId || process.env.ELEVENLABS_VOICE_ID);

  try {
    const tutor = await generateTutorText({
      studentName,
      subject,
      problem,
      studentMessage,
      chatHistory,
      analysis,
      latestLessonRecap,
      focusSkills,
      effectivePracticeModes,
      targetedPractice,
      strengths,
    });

    const speech = await synthesizeSpeech(tutor.text, voiceId);

    return sendJson(res, 200, {
      text: tutor.text,
      teachingFocus: tutor.teachingFocus || "",
      audioBase64: speech.audioBase64,
      audioMimeType: speech.audioMimeType,
      provider: speech.provider,
      warning: speech.warning || "",
      voiceId: voiceId || "",
      source: tutor.source,
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: error instanceof Error ? error.message : "AI tutor response failed",
    });
  }
}
