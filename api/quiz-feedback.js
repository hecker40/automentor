const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

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

function clipText(value, max = 500) {
  return cleanText(value).slice(0, max);
}

function buildFallbackFeedback({ item, response, analysis, subject, studentName }) {
  const answer = cleanText(response);
  const misconception = cleanText(analysis?.misconception, "the main step");
  const specificMishap = cleanText(analysis?.specificMishap, misconception);
  const itemKind = cleanText(item?.kind, "Quiz");
  const prompt = cleanText(item?.prompt, "the prompt");
  const safeSubject = cleanText(subject, "this topic");
  const safeStudent = cleanText(studentName);
  const directAddress = safeStudent ? `${safeStudent}, ` : "";

  if (!answer) {
    return {
      verdict: "retry",
      explanation: `${directAddress}there is not enough written yet to evaluate this ${itemKind.toLowerCase()}. Add your full thinking for ${prompt}.`,
      voiceSummary: `${directAddress}I need a fuller answer before I can check it. Write out your reasoning, then submit again.`,
      nextStep: `Write the next step and explain why it works.`,
      confidence: "low",
      source: "fallback",
    };
  }

  const wordCount = answer.split(/\s+/).filter(Boolean).length;
  const hasMathSignal = /[=+\-*/()\d]/.test(answer);
  const hasReasoningSignal = /because|so|then|first|next|divide|multiply|combine|distribute|simplif|subtract|add/i.test(answer);
  const looksComplete = wordCount >= 8 && (hasMathSignal || hasReasoningSignal);

  if (looksComplete) {
    return {
      verdict: "pass",
      explanation: `${directAddress}this answer looks directionally solid for ${safeSubject.toLowerCase()}. The strongest part is that you addressed ${specificMishap.toLowerCase()} instead of skipping straight to a short final answer.`,
      voiceSummary: `${directAddress}that one is on track. Keep the same step-by-step explanation as you move to the next prompt.`,
      nextStep: `Move to the next prompt and keep naming each step out loud.`,
      confidence: "medium",
      source: "fallback",
    };
  }

  return {
    verdict: "retry",
    explanation: `${directAddress}this answer is still missing the key reasoning around ${specificMishap.toLowerCase()}. Right now it feels too short or skips the why behind that step.`,
    voiceSummary: `${directAddress}you are close, but I still need the reasoning behind that step. Add why it works, then submit again.`,
    nextStep: `Rewrite the answer with one explicit reason for the step you chose.`,
    confidence: "medium",
    source: "fallback",
  };
}

async function generateFeedback({ studentName, subject, problem, item, response, analysis, learningPath, chatHistory }) {
  if (!process.env.OPENAI_API_KEY) {
    return buildFallbackFeedback({ item, response, analysis, subject, studentName });
  }

  const prompt = [
    "You are MentorAI evaluating a student's answer inside a live tutoring demo.",
    "Judge whether the student's written answer should pass or retry.",
    "Be concrete and specific about what is missing or what is correct.",
    "If the answer is weak, explain why it is wrong or incomplete in plain tutoring language.",
    "Address the exact mishap from the latest analysis when one is available.",
    "Return compact JSON only with this shape:",
    '{"verdict":"pass|retry","explanation":"2-4 sentence feedback shown in the UI","voiceSummary":"1-2 sentence spoken summary","nextStep":"short next action","confidence":"low|medium|high"}',
    "Mark retry unless the answer clearly shows the right reasoning, not just a guess.",
    "Keep explanation under 120 words and voiceSummary under 45 words.",
    "Speak directly to the learner using second person, like you and your.",
    "If a given name is available, you may address the learner by name naturally.",
    "Never refer to the learner as 'the student' in explanation, voiceSummary, or nextStep.",
    "Do not mention rubrics, hidden evaluation, or internal scoring.",
    "",
    `Student: ${cleanText(studentName, "Student")}`,
    `Subject: ${cleanText(subject, "General")}`,
    `Problem: ${cleanText(problem, "None provided")}`,
    `Assignment item: ${JSON.stringify({
      kind: cleanText(item?.kind, "Quiz"),
      prompt: clipText(item?.prompt, 320),
      coachNote: clipText(item?.coachNote, 220),
    })}`,
    `Student answer: ${clipText(response, 700) || "(empty)"}`,
    `Latest analysis: ${JSON.stringify(analysis || {})}`,
    `Selected teaching strategy: ${JSON.stringify(analysis?.selectedStrategy || null)}`,
    `Learning path: ${JSON.stringify(Array.isArray(learningPath) ? learningPath.slice(0, 4) : [])}`,
    `Recent chat: ${JSON.stringify(Array.isArray(chatHistory) ? chatHistory.slice(-6) : [])}`,
  ].join("\n");

  const apiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
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

  const data = await apiResponse.json();

  if (!apiResponse.ok) {
    throw new Error(data?.error?.message || "Quiz feedback failed");
  }

  const content = data?.choices?.[0]?.message?.content;
  const parsed = content ? JSON.parse(content) : {};
  const fallback = buildFallbackFeedback({ item, response, analysis, subject, studentName });
  const verdict = parsed?.verdict === "pass" ? "pass" : "retry";

  return {
    verdict,
    explanation: clipText(parsed?.explanation, 700) || fallback.explanation,
    voiceSummary: clipText(parsed?.voiceSummary, 220) || fallback.voiceSummary,
    nextStep: clipText(parsed?.nextStep, 220) || fallback.nextStep,
    confidence: ["low", "medium", "high"].includes(parsed?.confidence) ? parsed.confidence : fallback.confidence,
    source: "openai",
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

  try {
    const result = await generateFeedback({
      studentName: body?.studentName,
      subject: body?.subject,
      problem: body?.problem,
      item: body?.item,
      response: body?.response,
      analysis: body?.analysis,
      learningPath: body?.learningPath,
      chatHistory: body?.chatHistory,
    });

    return sendJson(res, 200, result);
  } catch (error) {
    return sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Quiz feedback failed",
    });
  }
}
