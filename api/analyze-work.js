import {
  buildSkillBreakdown,
  buildTargetedPractice,
  normalizePracticeSet,
  normalizeSkillBreakdown,
} from "../shared/student-model.js";

const DEFAULT_MODEL = "gpt-4o-mini";

const fallbackAnalysis = {
  misconception: "Unable to analyze the work yet",
  confidence: 0.18,
  explanation: "MentorAI could not read the whiteboard response clearly enough to make a reliable call.",
  suggestedQuestion: "Can you walk me through the exact step you meant to write on the board?",
  learningPath: [
    "Restate the problem in your own words.",
    "Show one step clearly on the board before simplifying anything else.",
    "Try one similar problem and explain each move out loud.",
  ],
  strengths: [],
  nextSteps: [],
  skillBreakdown: [],
  targetedPractice: [],
  adaptationNote: "Capture another clear checkpoint so MentorAI can refine its student model.",
  observedWork: "",
  observedSteps: [],
  observedOperations: [],
  missingOrIncorrectSteps: [],
  result: "unclear",
  specificMishap: "",
  strategyCandidates: [],
  selectedStrategy: null,
};

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

function cleanList(values = [], limit = 4) {
  return Array.isArray(values)
    ? values
        .map((value) => cleanText(value))
        .filter(Boolean)
        .slice(0, limit)
    : [];
}

function normalizeConfidence(value, hasMeaningfulAnalysis = false) {
  const raw = typeof value === "string" ? value.replace(/%/g, "").trim() : value;
  const parsed = Number(raw);

  if (Number.isFinite(parsed)) {
    if (parsed > 1 && parsed <= 100) return Math.max(0, Math.min(1, parsed / 100));
    if (parsed > 0 && parsed <= 1) return parsed;
    if (parsed === 0 && hasMeaningfulAnalysis) return 0.52;
  }

  return hasMeaningfulAnalysis ? 0.52 : fallbackAnalysis.confidence;
}

function normalizeResult(value) {
  return ["correct", "incorrect", "incomplete", "unclear"].includes(value)
    ? value
    : fallbackAnalysis.result;
}

function normalizeOperationName(value) {
  const raw = cleanText(value).toLowerCase();

  if (!raw) return "";
  if (/(distribut|expand|parenthes)/.test(raw)) return "distribution";
  if (/(combine|like term|collect term)/.test(raw)) return "combining like terms";
  if (/(sign|negative|subtract|minus)/.test(raw)) return "sign handling";
  if (/(fraction|denominator|numerator|common denominator)/.test(raw)) return "fractions";
  if (/(equation|both sides|isolate|solve for)/.test(raw)) return "multi-step equations";
  if (/(pemdas|order of operations)/.test(raw)) return "order of operations";
  if (/(graph|slope|intercept|coordinate)/.test(raw)) return "graph interpretation";
  if (/(exponent|power|squared|cubed)/.test(raw)) return "exponents";

  return raw;
}

function includesDistributionSignal(text = "") {
  return /(distribut|expand|outside factor|parenthes)/i.test(text);
}

function trimSentenceSpacing(text = "") {
  return cleanText(text).replace(/\s+/g, " ");
}

function normalizeStrategyCandidate(value, index = 0) {
  if (!value || typeof value !== "object") return null;

  return {
    label: cleanText(value?.label, index === 0 ? "error isolation" : `strategy ${index + 1}`),
    rationale: cleanText(value?.rationale || value?.reason, "Chosen from the live mistake pattern."),
    tutorMove: cleanText(value?.tutorMove, "Use one direct move tied to the exact visible mistake."),
    chatText: cleanText(value?.chatText || value?.tutorLine || value?.spokenLine, ""),
  };
}

function normalizeStrategyList(values = []) {
  return Array.isArray(values)
    ? values.map((value, index) => normalizeStrategyCandidate(value, index)).filter(Boolean).slice(0, 4)
    : [];
}

function enforceLiveEvidence(analysis, context = {}) {
  const observedWork = cleanText(analysis?.observedWork);
  const observedSteps = cleanList(analysis?.observedSteps, 4);
  const observedOperations = cleanList(analysis?.observedOperations, 4).map(normalizeOperationName).filter(Boolean);
  const missingOrIncorrectSteps = cleanList(analysis?.missingOrIncorrectSteps, 4);
  const visibleEvidence = trimSentenceSpacing([
    observedWork,
    ...observedSteps,
    ...observedOperations,
    ...missingOrIncorrectSteps,
    ...(Array.isArray(analysis?.skillBreakdown)
      ? analysis.skillBreakdown.map((item) => `${item?.skill || ""} ${item?.evidence || ""}`)
      : []),
  ].join(" "));
  const baseText = trimSentenceSpacing([
    analysis?.misconception,
    analysis?.explanation,
    analysis?.suggestedQuestion,
    ...(analysis?.strengths || []),
  ].join(" "));
  const combinedProblemContext = trimSentenceSpacing(`${context.problem || ""} ${context.subject || ""}`);
  const distributionRelevant = includesDistributionSignal(`${combinedProblemContext} ${baseText}`);
  const distributionVisible = includesDistributionSignal(visibleEvidence) || observedOperations.includes("distribution");

  let next = {
    ...analysis,
    observedWork,
    observedSteps,
    observedOperations,
    missingOrIncorrectSteps,
  };

  if (!observedWork && !observedSteps.length) {
    next = {
      ...next,
      confidence: Math.min(Number(next.confidence || 0), 0.35) || 0.28,
      result: next.result === "correct" ? "unclear" : next.result,
      misconception: "Visible work is too limited to verify the step yet",
      explanation: "MentorAI needs clearer live work on the board before it can say whether the answer is right or wrong.",
      strengths: [],
    };
  }

  if (distributionRelevant && !distributionVisible) {
    next = {
      ...next,
      confidence: Math.min(Number(next.confidence || 0), 0.62),
      result: next.result === "correct" ? "incomplete" : next.result,
      misconception: /correct|distributed/i.test(next.misconception)
        ? "Distribution step not shown yet"
        : next.misconception,
      explanation: /distributed correctly|correctly distributed|distribution correctly/i.test(next.explanation)
        ? "The live board does not clearly show a completed distribution step yet, so MentorAI should treat that step as missing or unfinished instead of correct."
        : next.explanation,
      specificMishap: cleanText(next.specificMishap, "The distribution step is missing or unfinished on the live board."),
      strengths: (next.strengths || []).filter((item) => !/distribut|expand/i.test(item)),
      skillBreakdown: [
        {
          skill: "Distribution",
          status: "needs-support",
          evidence:
            missingOrIncorrectSteps.find((item) => includesDistributionSignal(item)) ||
            "The live board does not clearly show the distribution step yet.",
          tutorMove: "Ask the student to distribute the outside factor to each term before simplifying.",
        },
        ...((next.skillBreakdown || []).filter((item) => !/distribution/i.test(item?.skill || ""))),
      ].slice(0, 4),
    };
  }

  if (next.result === "correct") {
    next = {
      ...next,
      misconception: cleanText(next.misconception, "The solution path looks correct"),
      explanation: cleanText(next.explanation, "The visible board work appears consistent with the problem shown."),
    };
  }

  return next;
}

function cleanAnalysis(value, context = {}) {
  const observedWork = cleanText(value?.observedWork);
  const observedSteps = cleanList(value?.observedSteps, 4);
  const observedOperations = cleanList(value?.observedOperations, 4).map(normalizeOperationName).filter(Boolean);
  const missingOrIncorrectSteps = cleanList(value?.missingOrIncorrectSteps, 4);
  const result = normalizeResult(value?.result);
  const hasMeaningfulAnalysis = Boolean(
    value?.misconception || value?.explanation || value?.suggestedQuestion || observedWork || observedSteps.length
  );

  const base = {
    misconception: cleanText(value?.misconception, fallbackAnalysis.misconception),
    confidence: normalizeConfidence(value?.confidence, hasMeaningfulAnalysis),
    explanation: cleanText(value?.explanation, fallbackAnalysis.explanation),
    suggestedQuestion: cleanText(value?.suggestedQuestion, fallbackAnalysis.suggestedQuestion),
    learningPath: cleanList(value?.learningPath, 3).length ? cleanList(value?.learningPath, 3) : fallbackAnalysis.learningPath,
    strengths: cleanList(value?.strengths, 3),
    nextSteps: cleanList(value?.nextSteps, 3),
    observedWork,
    observedSteps,
    observedOperations,
    missingOrIncorrectSteps,
    result,
    specificMishap: cleanText(
      value?.specificMishap,
      missingOrIncorrectSteps[0] || observedSteps[0] || cleanText(value?.misconception)
    ),
  };

  const heuristicBreakdown = buildSkillBreakdown({
    analysis: base,
    problem: context.problem,
    subject: context.subject,
  });
  const skillBreakdown = normalizeSkillBreakdown(value?.skillBreakdown, heuristicBreakdown);
  const targetedPractice = normalizePracticeSet(
    value?.targetedPractice,
    buildTargetedPractice({
      analysis: { ...base, skillBreakdown },
      problem: context.problem,
      subject: context.subject,
      studentName: context.studentName,
    })
  );
  const strategyCandidates = normalizeStrategyList(value?.strategyCandidates);
  const selectedStrategy = normalizeStrategyCandidate(value?.selectedStrategy || strategyCandidates[0], 0);

  return enforceLiveEvidence(
    {
      ...base,
      skillBreakdown,
      targetedPractice,
      strategyCandidates,
      selectedStrategy,
      adaptationNote:
        cleanText(value?.adaptationNote) ||
        `MentorAI will keep tracking ${skillBreakdown[0]?.skill?.toLowerCase() || "this concept"} and use it to shape the next live check-in and practice set.`,
    },
    context
  );
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

  const {
    problem,
    whiteboardImage,
    chatHistory = [],
    studentName = "Student",
    subject = "General",
  } = body || {};

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
    "You are MentorAI, an expert tutor analyzing a live student whiteboard.",
    "Use only the current whiteboard image, the current subject, and the current problem text.",
    "Do not rely on canned examples, preset values, or earlier default questions.",
    "Read the board literally before you judge it.",
    "Never say a step was done correctly unless that step is visibly shown on the board.",
    "If a step such as distribution seems required by the problem but is not actually shown, mark that step as missing, incomplete, or unsupported, not correct.",
    "If the board is hard to read or mostly blank, say so clearly and keep confidence low.",
    "Return only compact JSON.",
    "",
    `Problem: ${cleanText(problem, "No problem text provided")}`,
    `Recent chat: ${JSON.stringify(recentChat)}`,
    `Student: ${cleanText(studentName, "Student")}`,
    `Subject: ${cleanText(subject, "General")}`,
    "",
    "Return this JSON shape:",
    "{",
    '  "observedWork": "literal transcription or short description of what is visibly written on the board",',
    '  "observedSteps": ["visible step 1", "visible step 2"],',
    '  "observedOperations": ["only operations visibly shown, such as distribution, combining like terms, fractions"],',
    '  "missingOrIncorrectSteps": ["missing or wrong step tied to the live board"],',
    '  "result": "correct|incorrect|incomplete|unclear",',
    '  "specificMishap": "the exact visible mishap or missing step MentorAI should address first",',
    '  "misconception": "short label for the main live issue, or say the solution path looks correct",',
    '  "confidence": 0.78,',
    '  "explanation": "one or two sentences explaining what you actually see on this board",',
    '  "suggestedQuestion": "one live follow-up question the tutor should ask next",',
    '  "learningPath": ["short guided step", "short guided practice step", "quick mastery check"],',
    '  "strengths": ["visible step the student did well"],',
    '  "nextSteps": ["specific next tutoring move based on the current board"],',
    '  "skillBreakdown": [{"skill": "Distribution", "status": "needs-support", "evidence": "what on the live board supports this", "tutorMove": "what to do next"}],',
    '  "targetedPractice": [{"title": "Distribution check", "prompt": "one tailored follow-up task using the live topic", "reason": "why this helps right now"}],',
    '  "strategyCandidates": [{"label": "error isolation", "rationale": "why this teaching move fits the visible mistake", "tutorMove": "what the tutor should do", "chatText": "a short tutor line to say next"}],',
    '  "selectedStrategy": {"label": "error isolation", "rationale": "why this is the best next move now", "tutorMove": "exact tutoring move", "chatText": "short tutor line to say next"},',
    '  "adaptationNote": "how MentorAI should adjust the next question or practice based on this live checkpoint"',
    "}",
    "",
    "Rules:",
    "- Confidence must be a number between 0 and 1.",
    "- Use the live values and symbols from this board when they are readable.",
    "- Do not invent a different problem, different numbers, or a hidden step.",
    "- Strengths must be visible on the board. If no strength is visible, return an empty array.",
    "- observedOperations must list only what is visibly present, not what the student should have done.",
    "- If a concept is missing, put that in missingOrIncorrectSteps and mark the relevant skill as needs-support.",
    "- skillBreakdown should identify the exact live step or concept the student is struggling with, not just the broad subject.",
    "- specificMishap must name the exact wrong, missing, or unsupported step that should be addressed first.",
    "- strategyCandidates and selectedStrategy should stay grounded, practical, and not overhyped. Use simple moves like error isolation, retrieval check, worked example, or transfer practice only when they fit what is visible.",
    "- chatText should speak directly to the learner and mention the exact mishap when possible.",
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
              { type: "image_url", image_url: { url: whiteboardImage, detail: "high" } },
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

    return sendJson(
      res,
      200,
      cleanAnalysis(parsed, {
        problem,
        subject,
        studentName,
      })
    );
  } catch (error) {
    return sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Analysis failed",
    });
  }
}
