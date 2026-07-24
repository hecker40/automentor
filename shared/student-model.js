export function normalizeLabel(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

export function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function normalizeConfidenceScore(value, hasMeaningfulAnalysis = false) {
  const raw = typeof value === "string" ? value.replace(/%/g, "").trim() : value;
  const parsed = Number(raw);

  if (!Number.isFinite(parsed)) return hasMeaningfulAnalysis ? 0.62 : 0;
  if (parsed > 1 && parsed <= 100) return Math.max(0, Math.min(1, parsed / 100));
  if (parsed === 0 && hasMeaningfulAnalysis) return 0.62;
  if (parsed >= 0 && parsed <= 1) return parsed;
  return 0;
}

function uniqueStrings(values = [], limit = 4) {
  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

const SKILL_CATALOG = [
  {
    skill: "Distribution",
    patterns: [/\bdistribut/i, /\bexpand/i, /\bparentheses\b/i, /\bfactor\b/i, /\boutside term\b/i],
    tutorMove: "Have the student point to each term receiving the outside factor before simplifying.",
  },
  {
    skill: "Combining like terms",
    patterns: [/\blike terms\b/i, /\bcombine\b/i, /\bsame variable\b/i, /\bcollect terms\b/i],
    tutorMove: "Ask which terms match exactly before combining coefficients.",
  },
  {
    skill: "Sign handling",
    patterns: [/\bnegative\b/i, /\bminus sign\b/i, /\bsign error\b/i, /\bsubtract/i, /\bopposite\b/i],
    tutorMove: "Slow down the sign changes and narrate why each positive or negative sign stays or flips.",
  },
  {
    skill: "Fractions",
    patterns: [/\bfraction/i, /\bdenominator/i, /\bnumerator/i, /\bcommon denominator/i],
    tutorMove: "Use one smaller fraction example first, then return to the original problem.",
  },
  {
    skill: "Multi-step equations",
    patterns: [/\bequation\b/i, /\bisolate\b/i, /\bsolve for\b/i, /\bboth sides\b/i],
    tutorMove: "Pause after each legal move and check that both sides still balance.",
  },
  {
    skill: "Order of operations",
    patterns: [/\border of operations\b/i, /\bpemdas\b/i, /\bfirst\b.*\bthen\b/i],
    tutorMove: "Mark the next operation explicitly before evaluating it.",
  },
  {
    skill: "Word problem translation",
    patterns: [/\bword problem\b/i, /\btranslate\b/i, /\bset up\b/i, /\bexpression\b/i],
    tutorMove: "Have the student restate the situation as quantities before writing the equation.",
  },
  {
    skill: "Graph interpretation",
    patterns: [/\bgraph\b/i, /\bslope\b/i, /\bintercept\b/i, /\bcoordinate/i],
    tutorMove: "Tie each graph feature back to what it means in the problem context.",
  },
  {
    skill: "Exponents",
    patterns: [/\bexponent/i, /\bpower\b/i, /\bsquared\b/i, /\bcubed\b/i],
    tutorMove: "Use a quick expansion to show what the exponent means before simplifying.",
  },
];

function firstMatchingEvidence(text, patterns = []) {
  const sentences = String(text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  for (const sentence of sentences) {
    if (patterns.some((pattern) => pattern.test(sentence))) {
      return sentence;
    }
  }

  return "";
}

function scoreCatalogEntry(entry, haystacks) {
  let score = 0;
  let evidence = "";

  haystacks.forEach((haystack, index) => {
    const source = String(haystack || "");
    const matches = entry.patterns.reduce((count, pattern) => count + (pattern.test(source) ? 1 : 0), 0);
    if (matches > 0) {
      score += matches * (index === 0 ? 3 : index === 1 ? 2 : 1);
      if (!evidence) {
        evidence = firstMatchingEvidence(source, entry.patterns);
      }
    }
  });

  return { score, evidence };
}

function normalizeSkillNameFromMisconception(value) {
  const text = normalizeLabel(value, "Needs review")
    .replace(/^the\s+/i, "")
    .replace(/^current\s+/i, "")
    .replace(/^likely\s+/i, "")
    .replace(/\.$/, "");

  if (!text) return "Needs review";
  if (text.length <= 36) return text;
  return `${text.slice(0, 33).trim()}...`;
}

function inferPositiveSignals(analysis = {}) {
  const text = [analysis?.misconception, analysis?.explanation, ...(analysis?.strengths || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return {
    correct: /\b(correct|accurate|well done|solid understanding|good understanding|clear understanding|right approach)\b/.test(text),
    struggling: /\b(misconception|incorrect|mistake|confus|stuck|needs support|error|wrong)\b/.test(text),
  };
}

export function inferFocusSkills({ subject = "", problem = "", analysis = {} } = {}) {
  const misconception = String(analysis?.misconception || "");
  const explanation = String(analysis?.explanation || "");
  const suggestedQuestion = String(analysis?.suggestedQuestion || "");
  const strengths = Array.isArray(analysis?.strengths) ? analysis.strengths.join(" ") : "";
  const learningPath = Array.isArray(analysis?.learningPath) ? analysis.learningPath.join(" ") : "";

  const weightedSources = [
    `${misconception} ${explanation}`,
    `${problem} ${suggestedQuestion}`,
    `${subject} ${learningPath} ${strengths}`,
  ];

  const matches = SKILL_CATALOG.map((entry) => {
    const { score, evidence } = scoreCatalogEntry(entry, weightedSources);
    return {
      skill: entry.skill,
      score,
      evidence,
      tutorMove: entry.tutorMove,
    };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.localeCompare(b.skill));

  if (matches.length) return matches.slice(0, 4);

  if (misconception) {
    return [
      {
        skill: normalizeSkillNameFromMisconception(misconception),
        score: 1,
        evidence: explanation || misconception,
        tutorMove: "Ask the student to explain that step out loud before moving on.",
      },
    ];
  }

  return [];
}

export function normalizeSkillBreakdown(items = [], fallback = []) {
  const source = Array.isArray(items) && items.length ? items : fallback;
  return source
    .map((item, index) => ({
      skill: normalizeLabel(item?.skill, `Focus area ${index + 1}`),
      status: ["needs-support", "developing", "solid", "monitoring"].includes(item?.status)
        ? item.status
        : index === 0
          ? "needs-support"
          : "developing",
      evidence: normalizeLabel(item?.evidence, "Observed in recent work."),
      tutorMove: normalizeLabel(item?.tutorMove, "Ask the student to explain that step before continuing."),
    }))
    .slice(0, 4);
}

export function buildSkillBreakdown({ analysis = {}, problem = "", subject = "General" } = {}) {
  const inferred = inferFocusSkills({ subject, problem, analysis });
  const confidence = normalizeConfidenceScore(
    analysis?.confidence,
    Boolean(analysis?.misconception || analysis?.explanation || analysis?.suggestedQuestion)
  );
  const signals = inferPositiveSignals(analysis);

  const fallback = inferred.map((item, index) => ({
    skill: item.skill,
    status:
      signals.correct && index > 0
        ? "solid"
        : signals.struggling || index === 0 || confidence < 0.72
          ? "needs-support"
          : "developing",
    evidence: item.evidence || `Observed in recent ${String(subject || "general").toLowerCase()} work.`,
    tutorMove: item.tutorMove,
  }));

  return normalizeSkillBreakdown(analysis?.skillBreakdown, fallback);
}

export function normalizePracticeSet(items = [], fallback = []) {
  const source = Array.isArray(items) && items.length ? items : fallback;
  return source
    .map((item, index) => ({
      title: normalizeLabel(item?.title, `Targeted practice ${index + 1}`),
      prompt: normalizeLabel(item?.prompt, "Try one short follow-up problem and explain each step."),
      reason: normalizeLabel(item?.reason, "Chosen from the student's recent work."),
    }))
    .slice(0, 4);
}

export function buildTargetedPractice({ analysis = {}, problem = "", subject = "General", studentName = "Student" } = {}) {
  const breakdown = buildSkillBreakdown({ analysis, problem, subject });
  const topSkill = breakdown[0]?.skill || normalizeLabel(analysis?.misconception, `${subject} fundamentals`);
  const baseQuestion = normalizeLabel(
    analysis?.suggestedQuestion,
    `What should ${normalizeLabel(studentName, "the student")} check first when working on ${topSkill.toLowerCase()}?`
  );
  const practicePrompt = String(problem || "").trim()
    ? `Work a new version of this problem and narrate the ${topSkill.toLowerCase()} step clearly: ${problem}`
    : `Solve one short ${String(subject || "general").toLowerCase()} problem focused on ${topSkill.toLowerCase()} and explain each step.`;

  const fallback = [
    {
      title: `${topSkill} check`,
      prompt: baseQuestion,
      reason: `This is the step where ${normalizeLabel(studentName, "the student")} currently needs the most support.`,
    },
    {
      title: `${topSkill} worked example`,
      prompt: practicePrompt,
      reason: "Reinforces the exact step pattern from the latest mistake or hesitation.",
    },
    {
      title: "Transfer check",
      prompt: Array.isArray(analysis?.learningPath) && analysis.learningPath[analysis.learningPath.length - 1]
        ? analysis.learningPath[analysis.learningPath.length - 1]
        : `Try one similar problem independently, then explain why each ${topSkill.toLowerCase()} step works.`,
      reason: "Checks whether the student can transfer the corrected process to a fresh example.",
    },
  ];

  return normalizePracticeSet(analysis?.targetedPractice, fallback);
}

export function summarizeAssignmentResults(sessions = []) {
  const modeMap = new Map();

  sessions.forEach((session) => {
    (session?.reviewAssignments || []).forEach((assignment) => {
      (assignment?.items || []).forEach((item) => {
        const grade = assignment?.grades?.[item?.id];
        if (grade !== "pass" && grade !== "retry") return;

        const key = normalizeLabel(item?.kind, "Review");
        const current = modeMap.get(key) || { mode: key, attempts: 0, passes: 0 };
        current.attempts += 1;
        current.passes += grade === "pass" ? 1 : 0;
        modeMap.set(key, current);
      });
    });
  });

  return [...modeMap.values()]
    .map((entry) => {
      const passRate = clampPercent((entry.passes / Math.max(entry.attempts, 1)) * 100);
      return {
        mode: entry.mode,
        attempts: entry.attempts,
        passRate,
        note:
          passRate >= 70
            ? `${entry.mode} practice is landing well.`
            : passRate >= 45
              ? `${entry.mode} practice is helping, but still needs coaching.`
              : `${entry.mode} practice still needs more scaffolding.`,
      };
    })
    .sort((a, b) => b.passRate - a.passRate || b.attempts - a.attempts || a.mode.localeCompare(b.mode))
    .slice(0, 4);
}

export function buildAdaptiveProfile({
  studentName = "Student",
  sessions = [],
  observations = [],
  subjectStats = [],
  latestObservation = null,
  topMisconceptions = [],
} = {}) {
  const focusMap = new Map();

  observations.forEach((entry) => {
    const analysis = entry?.analysis || entry;
    const breakdown = buildSkillBreakdown({
      analysis,
      problem: entry?.problem || analysis?.problem || "",
      subject: entry?.subject || "General",
    });

    breakdown.forEach((item, index) => {
      const current = focusMap.get(item.skill) || { skill: item.skill, count: 0, notes: [] };
      current.count += item.status === "needs-support" || index === 0 ? 2 : 1;
      current.notes.push(item.evidence);
      focusMap.set(item.skill, current);
    });
  });

  const focusSkills = [...focusMap.values()]
    .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill))
    .slice(0, 4)
    .map((item) => ({
      skill: item.skill,
      occurrences: item.count,
      note: uniqueStrings(item.notes, 1)[0] || `Recurring focus in ${normalizeLabel(subjectStats[0]?.subject, "recent work").toLowerCase()}.`,
    }));

  const effectivePracticeModes = summarizeAssignmentResults(sessions);
  const latestAnalysis = latestObservation?.analysis || latestObservation || {};
  const learningStyle = uniqueStrings(
    [
      latestAnalysis?.suggestedQuestion ? "Responds well to guided questioning" : "Benefits from clearer prompts",
      Array.isArray(latestAnalysis?.learningPath) && latestAnalysis.learningPath.length
        ? "Improves when the work is broken into smaller steps"
        : "Needs more checkpoint data to personalize pacing",
      effectivePracticeModes[0]
        ? `${effectivePracticeModes[0].mode} practice currently works best`
        : "Still learning which practice mode works best",
    ],
    3
  );

  const topFocus = focusSkills[0]?.skill || topMisconceptions?.[0]?.label || "the current concept";
  const adaptationSummary = `${normalizeLabel(studentName, "This student")} is showing the most repeated friction around ${String(
    topFocus
  ).toLowerCase()}. MentorAI now keeps that pattern across sessions and uses it to shape the next question, review, and practice set.`;

  const nextSessionPlan = uniqueStrings(
    [
      focusSkills[0]
        ? `Open with a quick retrieval check on ${focusSkills[0].skill.toLowerCase()} before introducing new work.`
        : "Open with one quick retrieval warm-up from the last session.",
      focusSkills[1]
        ? `Use one guided worked example that isolates ${focusSkills[1].skill.toLowerCase()}.`
        : latestAnalysis?.suggestedQuestion,
      effectivePracticeModes[0]
        ? `End with a short ${effectivePracticeModes[0].mode.toLowerCase()} task because it has shown the best response so far.`
        : "End with one independent transfer problem to see if the correction sticks.",
    ],
    3
  );

  const evolutionLoop = effectivePracticeModes.length
    ? "MentorAI is not only spotting errors, it is checking which intervention types lead to passes versus retries and shifting the next practice set accordingly."
    : "MentorAI updates the student's focus-skill map after each analysis so the next session starts from the last known sticking point instead of from zero.";

  return {
    adaptationSummary,
    focusSkills,
    effectivePracticeModes,
    learningStyle,
    nextSessionPlan,
    evolutionLoop,
  };
}
