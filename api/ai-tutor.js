const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_ELEVENLABS_MODEL = "eleven_multilingual_v2";
const DEFAULT_AUDIO_MIME = "audio/mpeg";
const PLACEHOLDER_VOICE_IDS = new Set([
  "test",
  "voice-id",
  "your-voice-id",
  "your_voice_id",
  "placeholder",
  "demo",
]);

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

function isPlaceholderVoiceId(value) {
  const normalized = cleanText(value).toLowerCase();
  return !normalized || PLACEHOLDER_VOICE_IDS.has(normalized);
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
  const specificMishap = cleanText(analysis?.specificMishap);
  const focusPrompt = cleanText(problem || studentMessage || latestLessonRecap, "the next step");

  if (misconception && explanation) {
    return `Alright ${safeStudent}, let’s slow this down. In ${safeSubject.toLowerCase()}, the main thing to fix is ${specificMishap || misconception.toLowerCase()}. ${explanation} Try this next: ${nextQuestion || `walk me through ${focusPrompt}`}`;
  }

  return `Alright ${safeStudent}, let’s work through ${focusPrompt}. I want you to say the next step out loud, and I’ll help you check it as you go.`;
}

async function listVoices(apiKey) {
  const response = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: {
      "xi-api-key": apiKey,
    },
  });

  if (!response.ok) {
    let message = "Unable to load ElevenLabs voices";

    try {
      const errorData = await response.json();
      message = errorData?.detail?.message || errorData?.detail || errorData?.message || message;
    } catch {
      // ignore parse failure
    }

    throw new Error(message);
  }

  const data = await response.json();
  return Array.isArray(data?.voices) ? data.voices : [];
}

function pickVoiceFromList(voices, preferredName = "") {
  if (!voices.length) return null;

  const normalizedPreferred = cleanText(preferredName).toLowerCase();

  if (normalizedPreferred) {
    const exactMatch = voices.find((voice) => cleanText(voice?.name).toLowerCase() === normalizedPreferred);
    if (exactMatch) return exactMatch;

    const partialMatch = voices.find((voice) => cleanText(voice?.name).toLowerCase().includes(normalizedPreferred));
    if (partialMatch) return partialMatch;
  }

  return voices[0] || null;
}

async function resolveVoiceSelection(apiKey, requestedVoiceId) {
  const preferredName = cleanText(process.env.ELEVENLABS_VOICE_NAME);
  const cleanedVoiceId = cleanText(requestedVoiceId);

  if (cleanedVoiceId && !isPlaceholderVoiceId(cleanedVoiceId)) {
    return {
      voiceId: cleanedVoiceId,
      voiceName: "",
      warning: "",
      autoSelected: false,
    };
  }

  const voices = await listVoices(apiKey);
  const chosenVoice = pickVoiceFromList(voices, preferredName);

  if (!chosenVoice?.voice_id) {
    return {
      voiceId: "",
      voiceName: "",
      warning: "No ElevenLabs voices were available for this account.",
      autoSelected: true,
    };
  }

  return {
    voiceId: chosenVoice.voice_id,
    voiceName: cleanText(chosenVoice.name),
    warning:
      cleanedVoiceId && isPlaceholderVoiceId(cleanedVoiceId)
        ? `ELEVENLABS_VOICE_ID is set to a placeholder (${cleanedVoiceId}). Using ${cleanText(chosenVoice.name, "an available ElevenLabs voice")} instead.`
        : preferredName
          ? `Using ElevenLabs voice ${cleanText(chosenVoice.name, "from your account")} from ELEVENLABS_VOICE_NAME.`
          : `Using ElevenLabs voice ${cleanText(chosenVoice.name, "from your account")} automatically.`,
    autoSelected: true,
  };
}

async function requestSpeechFromElevenLabs({ apiKey, voiceId, text }) {
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
      ok: false,
      warning: message,
      status: response.status,
    };
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    ok: true,
    audioBase64: Buffer.from(arrayBuffer).toString("base64"),
    audioMimeType: DEFAULT_AUDIO_MIME,
  };
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
  strategyProfiles,
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
    "Be specific about the exact mishap or missing step instead of giving generic encouragement.",
    "Prefer a teaching move that has helped this learner before when the strategy history supports it.",
    "Do not mention profiles, analytics, checkpoints, hidden signals, memory systems, or that you are using OpenAI.",
    "Do not sound theatrical. Do not overpraise. Be natural, direct, and supportive.",
    "If the student has a given name, you may address them by name naturally.",
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
    `Teaching strategies that have worked: ${JSON.stringify(strategyProfiles || [])}`,
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
  if (!apiKey) {
    return {
      audioBase64: null,
      audioMimeType: null,
      provider: null,
      voiceId: "",
      voiceName: "",
      warning: "ELEVENLABS_API_KEY is not configured",
    };
  }

  try {
    const resolvedVoice = await resolveVoiceSelection(apiKey, voiceId);

    if (!resolvedVoice.voiceId) {
      return {
        audioBase64: null,
        audioMimeType: null,
        provider: "elevenlabs",
        voiceId: "",
        voiceName: "",
        warning: resolvedVoice.warning || "No ElevenLabs voice could be selected.",
      };
    }

    let speech = await requestSpeechFromElevenLabs({ apiKey, voiceId: resolvedVoice.voiceId, text });

    if (!speech.ok && /voice.+not found/i.test(speech.warning || "")) {
      const fallbackVoice = await resolveVoiceSelection(apiKey, "");

      if (fallbackVoice.voiceId && fallbackVoice.voiceId !== resolvedVoice.voiceId) {
        const retry = await requestSpeechFromElevenLabs({ apiKey, voiceId: fallbackVoice.voiceId, text });
        if (retry.ok) {
          return {
            audioBase64: retry.audioBase64,
            audioMimeType: retry.audioMimeType,
            provider: "elevenlabs",
            voiceId: fallbackVoice.voiceId,
            voiceName: fallbackVoice.voiceName,
            warning: `The configured ElevenLabs voice was not found. Using ${cleanText(fallbackVoice.voiceName, "another available voice")} instead.`,
          };
        }
      }
    }

    if (!speech.ok) {
      return {
        audioBase64: null,
        audioMimeType: null,
        provider: "elevenlabs",
        voiceId: resolvedVoice.voiceId,
        voiceName: resolvedVoice.voiceName,
        warning: speech.warning || resolvedVoice.warning || "ElevenLabs speech synthesis failed",
      };
    }

    return {
      audioBase64: speech.audioBase64,
      audioMimeType: speech.audioMimeType,
      provider: "elevenlabs",
      voiceId: resolvedVoice.voiceId,
      voiceName: resolvedVoice.voiceName,
      warning: resolvedVoice.warning || "",
    };
  } catch (error) {
    return {
      audioBase64: null,
      audioMimeType: null,
      provider: "elevenlabs",
      voiceId: "",
      voiceName: "",
      warning: error instanceof Error ? error.message : "ElevenLabs speech synthesis failed",
    };
  }
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
  const strategyProfiles = Array.isArray(body?.strategyProfiles) ? body.strategyProfiles.slice(0, 4) : [];
  const targetedPractice = compactList(body?.targetedPractice || [], 3);
  const strengths = compactList(body?.strengths || [], 3);
  const directText = cleanText(body?.directText);
  const voiceId = cleanText(body?.voiceId || process.env.ELEVENLABS_VOICE_ID);

  try {
    const tutor = directText
      ? {
          text: directText,
          teachingFocus: cleanText(body?.teachingFocus, "direct-speech"),
          source: "direct",
        }
      : await generateTutorText({
          studentName,
          subject,
          problem,
          studentMessage,
          chatHistory,
          analysis,
          latestLessonRecap,
          focusSkills,
          effectivePracticeModes,
          strategyProfiles,
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
      voiceName: speech.voiceName || "",
      warning: speech.warning || "",
      voiceId: speech.voiceId || voiceId || "",
      source: tutor.source,
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: error instanceof Error ? error.message : "AI tutor response failed",
    });
  }
}
