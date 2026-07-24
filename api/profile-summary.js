import { buildAdaptiveProfile } from "../shared/student-model.js";

const DEFAULT_MODEL = "gpt-4o-mini";

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

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function addCount(map, value) {
  const key = String(value || "Unknown").trim() || "Unknown";
  map.set(key, (map.get(key) || 0) + 1);
}

function topItems(map, limit = 3) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label]) => label);
}

function normalizeMessages(messages = []) {
  return Array.isArray(messages)
    ? messages
        .slice(-30)
        .map((message) => ({
          from: message?.from === "student" ? "student" : "tutor",
          text: String(message?.text || "").trim().slice(0, 400),
        }))
        .filter((message) => message.text)
    : [];
}

function getLatestAnalyzedSession(sessions = []) {
  return [...sessions].reverse().find((session) => Array.isArray(session?.analyses) && session.analyses.length) || null;
}

function buildConversationSignals(sessions = []) {
  const latestSession = getLatestAnalyzedSession(sessions) || sessions[sessions.length - 1] || null;
  const messages = normalizeMessages(latestSession?.messages || []);
  if (!messages.length) return [];

  const studentMessages = messages.filter((message) => message.from === "student").map((message) => message.text.toLowerCase());
  const tutorMessages = messages.filter((message) => message.from === "tutor").map((message) => message.text.toLowerCase());
  const signals = [];

  if (studentMessages.some((text) => /\b(u+h+|um+|not sure|i don't know|i think|maybe|wait)\b/.test(text))) {
    signals.push("The student showed hesitation before settling on a step.");
  }

  if (studentMessages.some((text) => /\b(oh i get it|got it|that makes sense|i see|okay i understand)\b/.test(text))) {
    signals.push("The student signaled a moment of clarity after guided support.");
  }

  if (tutorMessages.some((text) => /\b(why|what happens|try|check|next step|how would you)\b/.test(text))) {
    signals.push("The tutor used guided prompts to move the student forward.");
  }

  if (!signals.length && messages.length) {
    signals.push("The lesson included active back-and-forth around the problem and whiteboard work.");
  }

  return signals.slice(0, 3);
}

function buildLatestLessonRecap(studentName, sessions = [], subjectStats = []) {
  const latestSession = getLatestAnalyzedSession(sessions) || sessions[sessions.length - 1] || null;
  const latestAnalysis = latestSession?.analyses?.[latestSession.analyses.length - 1] || null;
  const subject = latestAnalysis?.subject || latestSession?.subject || subjectStats[0]?.subject || "the current topic";
  const problem = String(latestAnalysis?.problem || latestSession?.problem || "this problem").trim() || "this problem";
  const misconception = latestAnalysis?.misconception || "the main focus area";

  return `${studentName} worked through ${problem} in ${String(subject).toLowerCase()}, with the session focused on clarifying ${String(
    misconception
  ).toLowerCase()}. The tutor guided the work toward a more reliable step-by-step approach.`;
}

function buildReviewVideoBrief(studentName, sessions = [], subjectStats = []) {
  const latestSession = getLatestAnalyzedSession(sessions) || sessions[sessions.length - 1] || null;
  const latestAnalysis = latestSession?.analyses?.[latestSession.analyses.length - 1] || null;
  const problem = String(latestAnalysis?.problem || latestSession?.problem || "the lesson problem").trim() || "the lesson problem";
  const misconception = latestAnalysis?.misconception || subjectStats[0]?.topMisconception || "the main concept";
  const strength = latestAnalysis?.strengths?.[0] || subjectStats[0]?.topStrength || "staying engaged with the problem";

  return {
    title: `${studentName} lesson review`,
    summary: `Create a short review video around ${problem}, showing how the lesson clarified ${String(
      misconception
    ).toLowerCase()}.`,
    beats: [
      `Re-introduce the original problem: ${problem}`,
      `Highlight the turning point around ${String(misconception).toLowerCase()}`,
      `Close by reinforcing ${strength}`,
    ],
    closingTakeaway: `End with one similar problem the student should now be ready to solve independently.`,
  };
}

function buildHeuristicSummary(studentName, sessions, subjectStats = []) {
  const observations = sessions.flatMap((session) => session.analyses || []);
  const confidenceValues = observations.map((entry) => Number(entry?.confidence ?? entry?.analysis?.confidence ?? 0));
  const misconceptionCounts = new Map();
  const strengthCounts = new Map();

  observations.forEach((entry) => {
    addCount(misconceptionCounts, entry?.misconception || entry?.analysis?.misconception || "Needs review");
    (entry?.strengths || entry?.analysis?.strengths || []).forEach((strength) => addCount(strengthCounts, strength));
  });

  const strongestSubject = [...subjectStats].sort((a, b) => b.masteryPct - a.masteryPct)[0];
  const supportSubject = [...subjectStats].sort((a, b) => a.masteryPct - b.masteryPct)[0];
  const topStrengths = topItems(strengthCounts, 3);
  const topFocusAreas = topItems(misconceptionCounts, 3);
  const conversationSignals = buildConversationSignals(sessions);
  const adaptiveProfile = buildAdaptiveProfile({
    studentName,
    sessions,
    observations,
    subjectStats,
    latestObservation: observations[observations.length - 1] || null,
    topMisconceptions: topFocusAreas.map((label) => ({ label })),
  });

  return {
    summary:
      observations.length > 0
        ? `${studentName} has ${sessions.length} saved session${sessions.length === 1 ? "" : "s"} and ${observations.length} analyzed whiteboard checkpoints. Overall confidence is ${clampPercent(average(confidenceValues) * 100)}%.`
        : `No saved analyses yet for ${studentName}.`,
    learningStyle:
      adaptiveProfile.learningStyle?.length
        ? adaptiveProfile.learningStyle
        : observations.length > 0
          ? [
              "Benefits from guided questioning",
              "Responds well to concrete step-by-step correction",
            ]
          : ["Collect more sessions to infer learning style"],
    strengths: topStrengths.length ? topStrengths : ["No recurring strengths captured yet"],
    focusAreas: topFocusAreas.length ? topFocusAreas : ["No recurring focus area captured yet"],
    latestLessonRecap: buildLatestLessonRecap(studentName, sessions, subjectStats),
    conversationSignals,
    reviewVideoBrief: buildReviewVideoBrief(studentName, sessions, subjectStats),
    adaptationSummary: adaptiveProfile.adaptationSummary,
    focusSkills: adaptiveProfile.focusSkills,
    effectivePracticeModes: adaptiveProfile.effectivePracticeModes,
    nextSessionPlan: adaptiveProfile.nextSessionPlan,
    evolutionLoop: adaptiveProfile.evolutionLoop,
    subjectProfiles: subjectStats.slice(0, 4).map((subject) => ({
      subject: subject.subject,
      masteryPct: subject.masteryPct,
      trend: subject.masteryPct >= 75 ? "Confident" : subject.masteryPct >= 55 ? "Developing" : "Needs support",
      notes: `Top strength: ${subject.topStrength}. Watch for ${subject.topMisconception.toLowerCase()}.`,
    })),
    recommendedTutorMoves: [
      supportSubject
        ? `Open the next ${supportSubject.subject.toLowerCase()} session with a short retrieval warm-up.`
        : "Capture another analysis to generate targeted tutor moves.",
      strongestSubject
        ? `Use ${strongestSubject.subject.toLowerCase()} as a confidence anchor before moving into harder material.`
        : "Reinforce the student’s strongest recent step before correcting errors.",
    ],
  };
}

function cleanProfile(value, fallback) {
  return {
    summary: value?.summary || fallback.summary,
    learningStyle: Array.isArray(value?.learningStyle) ? value.learningStyle.slice(0, 3) : fallback.learningStyle,
    strengths: Array.isArray(value?.strengths) ? value.strengths.slice(0, 4) : fallback.strengths,
    focusAreas: Array.isArray(value?.focusAreas) ? value.focusAreas.slice(0, 4) : fallback.focusAreas,
    latestLessonRecap: value?.latestLessonRecap || fallback.latestLessonRecap,
    conversationSignals: Array.isArray(value?.conversationSignals)
      ? value.conversationSignals.slice(0, 3)
      : fallback.conversationSignals,
    reviewVideoBrief: {
      title: value?.reviewVideoBrief?.title || fallback.reviewVideoBrief?.title || "Lesson review",
      summary: value?.reviewVideoBrief?.summary || fallback.reviewVideoBrief?.summary || "",
      beats: Array.isArray(value?.reviewVideoBrief?.beats)
        ? value.reviewVideoBrief.beats.slice(0, 4)
        : fallback.reviewVideoBrief?.beats || [],
      closingTakeaway:
        value?.reviewVideoBrief?.closingTakeaway || fallback.reviewVideoBrief?.closingTakeaway || "",
    },
    adaptationSummary: value?.adaptationSummary || fallback.adaptationSummary || "",
    focusSkills: Array.isArray(value?.focusSkills)
      ? value.focusSkills.slice(0, 4).map((item, index) => ({
          skill: item?.skill || fallback.focusSkills?.[index]?.skill || `Focus area ${index + 1}`,
          occurrences: Math.max(1, Number(item?.occurrences ?? fallback.focusSkills?.[index]?.occurrences ?? 1)),
          note: item?.note || fallback.focusSkills?.[index]?.note || "Recurring focus from recent work.",
        }))
      : fallback.focusSkills,
    effectivePracticeModes: Array.isArray(value?.effectivePracticeModes)
      ? value.effectivePracticeModes.slice(0, 4).map((item, index) => ({
          mode: item?.mode || fallback.effectivePracticeModes?.[index]?.mode || "Practice",
          attempts: Math.max(0, Number(item?.attempts ?? fallback.effectivePracticeModes?.[index]?.attempts ?? 0)),
          passRate: clampPercent(Number(item?.passRate ?? fallback.effectivePracticeModes?.[index]?.passRate ?? 0)),
          note: item?.note || fallback.effectivePracticeModes?.[index]?.note || "Still collecting evidence.",
        }))
      : fallback.effectivePracticeModes,
    nextSessionPlan: Array.isArray(value?.nextSessionPlan)
      ? value.nextSessionPlan.slice(0, 4)
      : fallback.nextSessionPlan,
    evolutionLoop: value?.evolutionLoop || fallback.evolutionLoop || "",
    subjectProfiles: Array.isArray(value?.subjectProfiles)
      ? value.subjectProfiles.slice(0, 4).map((profile, index) => ({
          subject: profile?.subject || fallback.subjectProfiles[index]?.subject || "General",
          masteryPct: clampPercent(Number(profile?.masteryPct ?? fallback.subjectProfiles[index]?.masteryPct ?? 0)),
          trend: profile?.trend || fallback.subjectProfiles[index]?.trend || "Developing",
          notes: profile?.notes || fallback.subjectProfiles[index]?.notes || "",
        }))
      : fallback.subjectProfiles,
    recommendedTutorMoves: Array.isArray(value?.recommendedTutorMoves)
      ? value.recommendedTutorMoves.slice(0, 4)
      : fallback.recommendedTutorMoves,
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

  const studentName = String(body?.studentName || "Student").trim() || "Student";
  const sessions = Array.isArray(body?.sessions) ? body.sessions : [];
  const subjectStats = Array.isArray(body?.subjectStats) ? body.subjectStats : [];

  if (!sessions.length) {
    return sendJson(res, 400, { error: "At least one saved session is required" });
  }

  const compactSessions = sessions.slice(-12).map((session) => ({
    subject: session?.subject,
    problem: String(session?.problem || "").slice(0, 240),
    startedAt: session?.startedAt,
    updatedAt: session?.updatedAt,
    messages: normalizeMessages(session?.messages || []),
    suggestedPrompts: Array.isArray(session?.suggestedPrompts)
      ? session.suggestedPrompts.slice(-8).map((item) => ({
          createdAt: item?.createdAt,
          prompt: String(item?.prompt || "").slice(0, 240),
        }))
      : [],
    reviewAssignments: Array.isArray(session?.reviewAssignments)
      ? session.reviewAssignments.slice(-3).map((assignment) => ({
          title: assignment?.title,
          summary: assignment?.summary,
          learningPath: Array.isArray(assignment?.learningPath) ? assignment.learningPath.slice(0, 3) : [],
          items: Array.isArray(assignment?.items)
            ? assignment.items.slice(0, 4).map((item) => ({
                kind: item?.kind,
                prompt: String(item?.prompt || "").slice(0, 240),
                coachNote: String(item?.coachNote || "").slice(0, 180),
              }))
            : [],
          responses: assignment?.responses || {},
          grades: assignment?.grades || {},
        }))
      : [],
    analyses: Array.isArray(session?.analyses)
      ? session.analyses.slice(-6).map((entry) => ({
          createdAt: entry?.createdAt,
          subject: entry?.subject,
          problem: String(entry?.problem || "").slice(0, 240),
          misconception: entry?.analysis?.misconception,
          confidence: entry?.analysis?.confidence,
          explanation: entry?.analysis?.explanation,
          suggestedQuestion: entry?.analysis?.suggestedQuestion,
          strengths: entry?.analysis?.strengths,
          nextSteps: entry?.analysis?.nextSteps,
          skillBreakdown: Array.isArray(entry?.analysis?.skillBreakdown) ? entry.analysis.skillBreakdown.slice(0, 4) : [],
          targetedPractice: Array.isArray(entry?.analysis?.targetedPractice) ? entry.analysis.targetedPractice.slice(0, 4) : [],
          adaptationNote: entry?.analysis?.adaptationNote || "",
        }))
      : [],
  }));

  const fallback = buildHeuristicSummary(studentName, compactSessions, subjectStats);

  if (!process.env.OPENAI_API_KEY) {
    return sendJson(res, 200, fallback);
  }

  const prompt = [
    `You are MentorAI, building a longitudinal learning profile for ${studentName}.`,
    "Review the saved tutoring sessions and produce a concise JSON profile for the tutor.",
    "Focus on patterns across sessions, subjects, misconceptions, strengths, and effective teaching moves.",
    "Do not grade harshly. Stay practical and specific.",
    "",
    `Subject stats: ${JSON.stringify(subjectStats)}`,
    `Saved sessions: ${JSON.stringify(compactSessions)}`,
    "",
    "Return only compact JSON with this shape:",
    "{",
    '  "summary": "2-3 sentence profile summary",',
    '  "learningStyle": ["short preference or behavior"],',
    '  "strengths": ["recurring strength"],',
    '  "focusAreas": ["recurring gap or misconception"],',
    '  "latestLessonRecap": "2-3 sentence tutor-facing recap of the latest lesson",',
    '  "conversationSignals": ["short note about hesitation, clarity, or prompting patterns"],',
    '  "reviewVideoBrief": {"title": "short title", "summary": "what the recap video should cover", "beats": ["story beat"], "closingTakeaway": "ending lesson takeaway"},',
    '  "adaptationSummary": "how the agent is updating its approach from repeated patterns",',
    '  "focusSkills": [{"skill": "Distribution", "occurrences": 3, "note": "what keeps showing up"}],',
    '  "effectivePracticeModes": [{"mode": "Quiz", "attempts": 4, "passRate": 75, "note": "what seems to work best"}],',
    '  "nextSessionPlan": ["specific opening move for the next session"],',
    '  "evolutionLoop": "one sentence on how MentorAI changes future practice from prior results",',
    '  "subjectProfiles": [{"subject": "Algebra", "masteryPct": 72, "trend": "Improving", "notes": "short note"}],',
    '  "recommendedTutorMoves": ["specific next teaching move"]',
    "}",
    "Also use recent messages, tutor prompts, assigned review items, student responses, skill breakdowns, targeted practice, and pass versus retry outcomes when they help explain how the lesson unfolded.",
    "Notice exact recurring process-level difficulties like distribution, sign handling, combining like terms, setup, or multi-step equation flow, not just broad subject labels.",
    "Notice hesitation or clarity cues like uncertainty, pauses, or 'I get it' moments, but keep them secondary to the actual academic recap.",
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
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return sendJson(res, 200, fallback);
    }

    const content = data?.choices?.[0]?.message?.content;
    const parsed = content ? JSON.parse(content) : fallback;

    return sendJson(res, 200, cleanProfile(parsed, fallback));
  } catch {
    return sendJson(res, 200, fallback);
  }
}
