import { useState, useEffect, useRef, useId, useCallback } from "react";
import {
  Pencil, Eraser, Undo2, Redo2, Download,
  Trash2, Sparkles, Send, AlertTriangle, CheckCircle2,
  ChevronRight, MessageSquare, User, Monitor, PenLine,
} from "lucide-react";
import {
  CallingState,
  ParticipantView,
  StreamCall,
  StreamTheme,
  StreamVideo,
  StreamVideoClient,
  CallControls,
  useCallStateHooks,
  SfuModels,
} from "@stream-io/video-react-sdk";

import {
  buildAdaptiveProfile,
  buildSkillBreakdown,
  buildTargetedPractice,
} from "../shared/student-model.js";
import "@stream-io/video-react-sdk/dist/css/styles.css";

const apiKey = import.meta.env.VITE_STREAM_API_KEY;
const token = import.meta.env.VITE_STREAM_TOKEN;
const userId = import.meta.env.VITE_STREAM_USER_ID || "mentorai-demo-user";
const callId = import.meta.env.VITE_STREAM_CALL_ID || "mentorai-demo-call";
const hasStreamConfig = Boolean(apiKey && token);

const streamUser = {
  id: userId,
  name: import.meta.env.VITE_STREAM_USER_NAME || "Participant",
  image: "https://getstream.io/random_svg/?id=participant&name=Participant",
};

const streamClient = hasStreamConfig
  ? new StreamVideoClient({
      apiKey,
      user: streamUser,
      token,
    })
  : null;

const call = streamClient?.call("default", callId);
if (call) {
  call
    .join({ create: true })
    .then(() => {
      call.camera.enable().catch(() => {});
      call.microphone.enable().catch(() => {});
    })
    .catch(() => {});
}

const theme = {
  navy: "#161B2E",
  navySoft: "#232A44",
  purple: "#6C5CE7",
  purpleSoft: "#EFECFD",
  purpleLight: "#A792FF",
  bg: "#FAFAF8",
  card: "#FFFFFF",
  border: "#E7E5DE",
  text: "#1C1C1A",
  textMuted: "#767570",
  amber: "#B9781F",
  amberSoft: "#FBF0DE",
  green: "#3E7A52",
  greenSoft: "#E9F3EC",
  greenLight: "#79C993",
  red: "#C85A5A",
  redSoft: "#FCE9E9",
};

const fontDisplay = "'Space Grotesk', 'Segoe UI', sans-serif";
const fontBody = "'Inter', 'Segoe UI', sans-serif";
const fontMono = "'JetBrains Mono', 'Courier New', monospace";

const ANALYTICS_STORAGE_KEY = "mentorai-student-analytics-v1";
const PROFILE_STORAGE_KEY = "mentorai-student-profiles-v1";

function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function slugifyStudentName(value) {
  return String(value || "student")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "student";
}

function normalizeLabel(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeConfidenceScore(value, hasMeaningfulAnalysis = false) {
  const raw = typeof value === "string" ? value.replace(/%/g, "").trim() : value;
  const parsed = Number(raw);

  if (!Number.isFinite(parsed)) return hasMeaningfulAnalysis ? 0.62 : 0;
  if (parsed > 1 && parsed <= 100) return Math.max(0, Math.min(1, parsed / 100));
  if (parsed === 0 && hasMeaningfulAnalysis) return 0.62;
  if (parsed >= 0 && parsed <= 1) return parsed;
  return 0;
}

function getInsightCardTone(analysis) {
  const text = [analysis?.misconception, analysis?.explanation, ...(analysis?.strengths || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const confidence = normalizeConfidenceScore(
    analysis?.confidence,
    Boolean(analysis?.misconception || analysis?.explanation || analysis?.suggestedQuestion)
  );

  const positivePatterns = [
    /correct/,
    /correctly/,
    /right approach/,
    /solid understanding/,
    /strong understanding/,
    /good understanding/,
    /accurate/,
    /well done/,
    /no misconception/,
    /clear understanding/,
  ];
  const negativePatterns = [
    /misconception/,
    /incorrect/,
    /mistake/,
    /confus/,
    /stuck/,
    /needs support/,
    /error/,
    /wrong/,
    /unable to analyze/,
  ];

  const positiveHits = positivePatterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
  const negativeHits = negativePatterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
  const isCorrect = positiveHits > negativeHits || (positiveHits > 0 && confidence >= 0.7);

  if (isCorrect) {
    return {
      background: theme.greenSoft,
      border: "#BCE4C8",
      accent: theme.green,
      surface: "#F4FBF6",
    };
  }

  return {
    background: theme.redSoft,
    border: "#F3CACA",
    accent: theme.red,
    surface: "#FEF4F4",
  };
}

function addCount(map, value) {
  const key = normalizeLabel(value, "Unknown");
  map.set(key, (map.get(key) || 0) + 1);
}

function topItemsFromMap(map, limit = 3) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function describeTrend(recentValues, previousValues) {
  if (recentValues.length === 0) {
    return { label: "No data yet", tone: "muted", deltaPct: 0 };
  }

  if (previousValues.length === 0) {
    return { label: "Building a baseline", tone: "muted", deltaPct: 0 };
  }

  const delta = average(recentValues) - average(previousValues);
  const deltaPct = Math.round(delta * 100);

  if (delta > 0.08) return { label: "Improving", tone: "good", deltaPct };
  if (delta < -0.08) return { label: "Needs support", tone: "warn", deltaPct };
  return { label: "Steady", tone: "muted", deltaPct };
}

function loadAnalyticsStore() {
  if (typeof window === "undefined") return { version: 1, sessions: [] };
  return safeJsonParse(window.localStorage.getItem(ANALYTICS_STORAGE_KEY), {
    version: 1,
    sessions: [],
  });
}

function saveAnalyticsStore(store) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ANALYTICS_STORAGE_KEY, JSON.stringify(store));
}

function loadProfileStore() {
  if (typeof window === "undefined") return {};
  return safeJsonParse(window.localStorage.getItem(PROFILE_STORAGE_KEY), {});
}

function loadCachedProfileRecord(studentKey) {
  const raw = loadProfileStore()?.[studentKey] || null;
  if (!raw) return null;

  if (raw.profile && typeof raw.profile === "object") {
    return {
      profile: raw.profile,
      analysisFingerprint: String(raw.analysisFingerprint || ""),
      savedAt: raw.savedAt || "",
    };
  }

  return {
    profile: raw,
    analysisFingerprint: "",
    savedAt: "",
  };
}

function loadCachedProfile(studentKey) {
  return loadCachedProfileRecord(studentKey)?.profile || null;
}

function loadCachedProfileFingerprint(studentKey) {
  return loadCachedProfileRecord(studentKey)?.analysisFingerprint || "";
}

function saveCachedProfile(studentKey, profile, analysisFingerprint = "") {
  if (typeof window === "undefined") return;
  const store = loadProfileStore();
  store[studentKey] = {
    profile,
    analysisFingerprint,
    savedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(store));
}

function normalizeStoredMessages(messages = []) {
  return Array.isArray(messages)
    ? messages.slice(-30).map((message, index) => ({
        id: message?.id || `message-${index}`,
        from: message?.from === "student" ? "student" : "tutor",
        text: String(message?.text || "").trim().slice(0, 400),
      }))
        .filter((message) => message.text)
    : [];
}

function normalizeStoredAssignment(assignment) {
  if (!assignment) return null;

  const items = Array.isArray(assignment?.items)
    ? assignment.items.slice(0, 4).map((item, index) => ({
        id: item?.id || `item-${index}`,
        kind: normalizeLabel(item?.kind, "Review"),
        prompt: String(item?.prompt || "").trim().slice(0, 320),
        coachNote: String(item?.coachNote || "").trim().slice(0, 220),
      }))
    : [];

  const responses = Object.fromEntries(
    Object.entries(assignment?.responses || {})
      .filter(([key]) => items.some((item) => item.id === key))
      .map(([key, value]) => [key, String(value || "").trim().slice(0, 500)])
  );

  const grades = Object.fromEntries(
    Object.entries(assignment?.grades || {}).filter(([, value]) => value === "pass" || value === "retry")
  );

  const feedback = Object.fromEntries(
    Object.entries(assignment?.feedback || {})
      .filter(([key]) => items.some((item) => item.id === key))
      .map(([key, value]) => [key, {
        verdict: value?.verdict === "pass" ? "pass" : "retry",
        explanation: String(value?.explanation || "").trim().slice(0, 700),
        voiceSummary: String(value?.voiceSummary || "").trim().slice(0, 220),
        nextStep: String(value?.nextStep || "").trim().slice(0, 220),
        confidence: ["low", "medium", "high"].includes(value?.confidence) ? value.confidence : "medium",
        submittedAt: value?.submittedAt || "",
      }])
  );

  const submissionStatus = Object.fromEntries(
    Object.entries(assignment?.submissionStatus || {})
      .filter(([key]) => items.some((item) => item.id === key))
      .map(([key, value]) => [key, value === "submitting" ? "submitting" : value === "submitted" ? "submitted" : "idle"])
  );

  return {
    id: assignment?.id || `assignment-${Date.now()}`,
    title: String(assignment?.title || "Suggested review").trim().slice(0, 120),
    summary: String(assignment?.summary || "").trim().slice(0, 220),
    createdAt: assignment?.createdAt || new Date().toISOString(),
    updatedAt: Number(assignment?.updatedAt || Date.now()),
    learningPath: Array.isArray(assignment?.learningPath)
      ? assignment.learningPath.slice(0, 3).map((step) => String(step || "").trim()).filter(Boolean)
      : [],
    items,
    responses,
    grades,
    feedback,
    submissionStatus,
  };
}

function getLatestAnalyzedSession(sessions = []) {
  return [...sessions].reverse().find((session) => Array.isArray(session?.analyses) && session.analyses.length) || null;
}

function getLatestAnalyzedCheckpoint(sessions = []) {
  const latestSession = getLatestAnalyzedSession(sessions) || sessions[sessions.length - 1] || null;
  const latestEntry = latestSession?.analyses?.[latestSession.analyses.length - 1] || null;

  return {
    session: latestSession,
    entry: latestEntry,
  };
}

function buildConversationSignalsFromSessions(sessions = []) {
  const { session: latestSession, entry: latestEntry } = getLatestAnalyzedCheckpoint(sessions);
  const messages = normalizeStoredMessages(latestEntry?.messagesSnapshot || latestSession?.messages || []);
  if (!messages.length) return [];

  const combined = messages.map((message) => message.text.toLowerCase());
  const studentMessages = messages.filter((message) => message.from === "student").map((message) => message.text.toLowerCase());
  const tutorMessages = messages.filter((message) => message.from === "tutor").map((message) => message.text.toLowerCase());
  const signals = [];

  if (studentMessages.some((text) => /\b(u+h+|um+|not sure|i don't know|i think|maybe|wait)\b/.test(text))) {
    signals.push("The student showed hesitation before locking in a step or answer.");
  }

  if (studentMessages.some((text) => /\b(oh i get it|got it|that makes sense|i see|okay i understand)\b/.test(text))) {
    signals.push("The student signaled a moment of clarity after guided support.");
  }

  if (tutorMessages.some((text) => /\b(why|what happens|try|check|next step|how would you)\b/.test(text))) {
    signals.push("The tutor used prompting questions instead of only giving the answer.");
  }

  if (!signals.length && combined.length) {
    signals.push("The lesson included back-and-forth problem solving around the active whiteboard work.");
  }

  return signals.slice(0, 3);
}

function buildLatestLessonRecap(studentName, sessions = [], stats) {
  const { session: latestSession, entry: latestEntry } = getLatestAnalyzedCheckpoint(sessions);
  const latestAnalysis = stats?.latestObservation?.analysis || latestEntry?.analysis;
  const subject = normalizeLabel(latestEntry?.subject || latestSession?.subject || stats?.supportSubject?.subject, "the current topic");
  const problem = String(stats?.latestObservation?.problem || latestEntry?.problem || latestSession?.problem || "this problem").trim() || "this problem";
  const misconception = latestAnalysis?.misconception || stats?.topMisconceptions?.[0]?.label || "the current concept";

  return `${studentName} worked on ${subject.toLowerCase()} through ${problem}. The main tutoring focus was ${misconception.toLowerCase()}, with the session moving toward a clearer step-by-step solution.`;
}

function buildFallbackVideoBrief(studentName, sessions = [], stats) {
  const { session: latestSession, entry: latestEntry } = getLatestAnalyzedCheckpoint(sessions);
  const latestAnalysis = stats?.latestObservation?.analysis || latestEntry?.analysis;
  const problem = String(stats?.latestObservation?.problem || latestEntry?.problem || latestSession?.problem || "the lesson problem").trim() || "the lesson problem";
  const misconception = latestAnalysis?.misconception || stats?.topMisconceptions?.[0]?.label || "the main focus area";
  const strength = stats?.topStrengths?.[0]?.label || latestAnalysis?.strengths?.[0] || "staying engaged with the problem";

  return {
    title: `${studentName} lesson review`,
    summary: `Recap how the lesson centered on ${problem} and clarified ${misconception.toLowerCase()}.`,
    beats: [
      `Open with the original problem: ${problem}`,
      `Show where ${studentName} needed support around ${misconception.toLowerCase()}`,
      `Close with the strongest takeaway: ${strength}`,
    ],
    closingTakeaway: `Reinforce the corrected process so ${studentName} can solve a similar problem independently next time.`,
  };
}

function buildStudentAnalytics(store, studentName) {
  const studentKey = slugifyStudentName(studentName);
  const sessions = Array.isArray(store?.sessions)
    ? store.sessions.filter((session) => session.studentKey === studentKey)
    : [];

  const observations = sessions
    .flatMap((session) =>
      Array.isArray(session.analyses)
        ? session.analyses.map((entry) => ({
            ...entry,
            sessionId: session.sessionId,
            studentName: session.studentName,
            subject: normalizeLabel(entry.subject || session.subject, "General"),
            messagesSnapshot: normalizeStoredMessages(entry?.messagesSnapshot || session?.messages || []),
            assignmentSnapshot: normalizeStoredAssignment(entry?.assignmentSnapshot || session?.currentAssignment || null),
          }))
        : []
    )
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const analysisSessions = observations.map((entry, index) => {
    const frozenAssignment = normalizeStoredAssignment(entry?.assignmentSnapshot || null);

    return {
      sessionId: `${entry.sessionId || "session"}-${entry.id || index}`,
      studentKey,
      studentName: normalizeLabel(entry.studentName || studentName, "Student"),
      subject: normalizeLabel(entry.subject, "General"),
      problem: String(entry?.problem || "").trim(),
      startedAt: entry.createdAt,
      updatedAt: entry.createdAt,
      messages: normalizeStoredMessages(entry?.messagesSnapshot || []),
      currentAssignment: frozenAssignment,
      reviewAssignments: frozenAssignment ? [frozenAssignment] : [],
      suggestedPrompts: [],
      analyses: [entry],
    };
  });

  const strengthCounts = new Map();
  const misconceptionCounts = new Map();
  const subjectMap = new Map();

  observations.forEach((entry) => {
    const subject = normalizeLabel(entry.subject, "General");
    const confidence = normalizeConfidenceScore(
      entry?.analysis?.confidence,
      Boolean(entry?.analysis?.misconception || entry?.analysis?.explanation || entry?.analysis?.suggestedQuestion)
    );
    const current =
      subjectMap.get(subject) ||
      {
        subject,
        confidences: [],
        analyses: 0,
        sessionIds: new Set(),
        strengths: new Map(),
        misconceptions: new Map(),
      };

    current.analyses += 1;
    current.confidences.push(confidence);
    current.sessionIds.add(entry.sessionId);

    (entry?.analysis?.strengths || []).forEach((strength) => {
      addCount(strengthCounts, strength);
      addCount(current.strengths, strength);
    });

    addCount(misconceptionCounts, entry?.analysis?.misconception || "Needs review");
    addCount(current.misconceptions, entry?.analysis?.misconception || "Needs review");

    subjectMap.set(subject, current);
  });

  const confidenceValues = observations.map((entry) =>
    normalizeConfidenceScore(
      entry?.analysis?.confidence,
      Boolean(entry?.analysis?.misconception || entry?.analysis?.explanation || entry?.analysis?.suggestedQuestion)
    )
  );
  const recentValues = confidenceValues.slice(-3);
  const previousValues = confidenceValues.slice(-6, -3);
  const trend = describeTrend(recentValues, previousValues);

  const subjectStats = [...subjectMap.values()]
    .map((subject) => ({
      subject: subject.subject,
      analyses: subject.analyses,
      sessions: subject.sessionIds.size,
      masteryPct: clampPercent(average(subject.confidences) * 100),
      topStrength: topItemsFromMap(subject.strengths, 1)[0]?.label || "Still collecting",
      topMisconception: topItemsFromMap(subject.misconceptions, 1)[0]?.label || "Still collecting",
    }))
    .sort((a, b) => b.analyses - a.analyses || b.masteryPct - a.masteryPct);

  const strongestSubject = [...subjectStats].sort((a, b) => b.masteryPct - a.masteryPct)[0] || null;
  const supportSubject = [...subjectStats].sort((a, b) => a.masteryPct - b.masteryPct)[0] || null;

  return {
    studentKey,
    sessions,
    analysisSessions,
    observations,
    analysisFingerprint: observations.map((entry) => `${entry.id || "analysis"}:${entry.createdAt || ""}`).join("||"),
    totalSessions: sessions.length,
    totalAnalyses: observations.length,
    averageConfidencePct: clampPercent(average(confidenceValues) * 100),
    trend,
    subjectStats,
    topStrengths: topItemsFromMap(strengthCounts, 3),
    topMisconceptions: topItemsFromMap(misconceptionCounts, 3),
    latestObservation: observations[observations.length - 1] || null,
    strongestSubject,
    supportSubject,
    lastUpdatedAt: observations[observations.length - 1]?.createdAt || null,
  };
}

function buildFallbackProfile(studentName, stats) {
  const profileSessions = stats.analysisSessions?.length ? stats.analysisSessions : stats.sessions;
  const strengths = stats.topStrengths.map((item) => item.label);
  const focusAreas = stats.topMisconceptions.map((item) => item.label);
  const conversationSignals = buildConversationSignalsFromSessions(profileSessions);
  const adaptiveProfile = buildAdaptiveProfile({
    studentName,
    sessions: profileSessions,
    observations: stats.observations,
    subjectStats: stats.subjectStats,
    latestObservation: stats.latestObservation,
    topMisconceptions: stats.topMisconceptions,
  });
  const subjectProfiles = stats.subjectStats.slice(0, 4).map((subject) => ({
    subject: subject.subject,
    masteryPct: subject.masteryPct,
    trend: subject.masteryPct >= 75 ? "Confident" : subject.masteryPct >= 55 ? "Developing" : "Needs support",
    notes: `Top strength: ${subject.topStrength}. Watch for ${subject.topMisconception.toLowerCase()}.`,
  }));

  return {
    summary:
      stats.totalAnalyses > 0
        ? `${studentName} has ${stats.totalSessions} saved session${stats.totalSessions === 1 ? "" : "s"} across ${Math.max(
            subjectProfiles.length,
            1
          )} subject area${subjectProfiles.length === 1 ? "" : "s"}. Current overall confidence is ${stats.averageConfidencePct}%.`
        : `Run an analysis to start building ${studentName}'s cross-session profile.`,
    learningStyle:
      stats.latestObservation?.analysis?.suggestedQuestion
        ? [
            "Responds well to guided questioning",
            "Benefits from step-by-step correction of misconceptions",
          ]
        : ["Collect a few analyses to infer learning preferences"],
    strengths: strengths.length ? strengths : ["No recurring strengths captured yet"],
    focusAreas: focusAreas.length ? focusAreas : ["No recurring focus areas captured yet"],
    subjectProfiles,
    latestLessonRecap: buildLatestLessonRecap(studentName, profileSessions, stats),
    conversationSignals,
    reviewVideoBrief: buildFallbackVideoBrief(studentName, profileSessions, stats),
    adaptationSummary: adaptiveProfile.adaptationSummary,
    focusSkills: adaptiveProfile.focusSkills,
    effectivePracticeModes: adaptiveProfile.effectivePracticeModes,
    nextSessionPlan: adaptiveProfile.nextSessionPlan,
    evolutionLoop: adaptiveProfile.evolutionLoop,
    recommendedTutorMoves: stats.latestObservation?.analysis?.nextSteps?.length
      ? stats.latestObservation.analysis.nextSteps
      : stats.latestObservation?.analysis?.suggestedQuestion
        ? [stats.latestObservation.analysis.suggestedQuestion]
        : ["Capture another whiteboard analysis to generate tutor moves"],
  };
}

function Fonts() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap');
    `}</style>
  );
}

// Fix: by default, browsers show an I-beam ("text") cursor whenever you
// hover selectable text anywhere on the page, and some browsers render a
// blinking insertion caret when you click it, even outside real inputs.
// This resets both to sane app-like defaults globally, while still letting
// real inputs/textareas/contenteditable keep normal text behavior. Inline
// styles (canvas' crosshair cursor, button pointers, etc.) still win over
// this since inline `style` always beats a stylesheet rule.
function GlobalUIReset() {
  return (
    <style>{`
      * {
        cursor: default !important;
        -webkit-user-select: none !important;
        -moz-user-select: none !important;
        -ms-user-select: none !important;
        user-select: none !important;
        caret-color: transparent !important;
      }
      input, textarea, [contenteditable="true"] {
        cursor: text !important;
        -webkit-user-select: text !important;
        -moz-user-select: text !important;
        -ms-user-select: text !important;
        user-select: text !important;
        caret-color: auto !important;
      }
      button, a, [role="button"] {
        cursor: pointer !important;
      }
    `}</style>
  );
}

function VideoCallStyles() {
  return (
    <style>{`
      .mentorai-call .str-video__participant-view,
      .mentorai-call .str-video__video-el,
      .mentorai-call video {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover !important;
      }
      .mentorai-screenshare .str-video__participant-view,
      .mentorai-screenshare .str-video__video-el,
      .mentorai-screenshare video {
        width: 100% !important;
        height: 100% !important;
        object-fit: contain !important;
        background: ${theme.navy} !important;
      }
      .mentorai-call .str-video__participant-details {
        display: none !important;
      }
     .str-video__call-controls {
        gap: 5px !important;
      }
     .str-video__menu-container {
        left: 15px !important;
        color: white;
    }
     .str-video__notification__message {
        color: white;
     }
     .str-video__participant-view .str-video__call-controls__button {
        display: none;
    }
    `}</style>
  );
}

function VideoTileLabel({ children }) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 8,
        left: 8,
        background: "rgba(15, 17, 30, 0.72)",
        color: "#fff",
        fontSize: 11,
        fontWeight: 500,
        padding: "3px 9px",
        borderRadius: 6,
      }}
    >
      {children}
    </div>
  );
}

function AITutorTile({ isSpeaking }) {
  return (
    <div
      style={{
        position: "relative",
        borderRadius: 8,
        overflow: "hidden",
        aspectRatio: "4 / 3",
        background: "radial-gradient(circle at 50% 35%, #3E3490 0%, #241D59 34%, #141A2D 72%, #0F1426 100%)",
        border: "1px solid rgba(167, 146, 255, 0.28)",
      }}
    >
      <style>{`
        @keyframes mentorai-wave {
          0% { transform: translate(-50%, -50%) scale(0.84); opacity: 0.58; }
          72% { transform: translate(-50%, -50%) scale(1.26); opacity: 0.14; }
          100% { transform: translate(-50%, -50%) scale(1.42); opacity: 0; }
        }
        @keyframes mentorai-breathe {
          0%, 100% { transform: translate(-50%, -50%) scale(1); }
          50% { transform: translate(-50%, -50%) scale(1.03); }
        }
      `}</style>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ position: "relative", width: "78%", aspectRatio: "1 / 1" }}>
          {isSpeaking && [0, 1, 2, 3].map((index) => (
            <span
              key={index}
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                width: "100%",
                height: "100%",
                borderRadius: "50%",
                border: "2px solid rgba(190, 178, 255, 0.52)",
                boxShadow: "0 0 24px rgba(140, 123, 255, 0.16)",
                animation: "mentorai-wave 1.45s ease-out infinite",
                animationDelay: `${index * 0.16}s`,
              }}
            />
          ))}

          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              width: "72%",
              height: "72%",
              borderRadius: "50%",
              transform: "translate(-50%, -50%)",
              background: "linear-gradient(145deg, #B9A8FF 0%, #8F7CFF 36%, #6C5CE7 70%, #5543D3 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 20px 50px rgba(108, 92, 231, 0.34)",
              animation: isSpeaking ? "mentorai-breathe 0.95s ease-in-out infinite" : "none",
            }}
          >
            <User
              size={110}
              strokeWidth={1.75}
              color="rgba(255,255,255,0.96)"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveCallLayout({ studentName, aiSpeaking }) {
  const { useCallCallingState, useParticipants } = useCallStateHooks();
  const callingState = useCallCallingState();
  const participants = useParticipants();
  const ordered = [...participants].sort(
    (a, b) => (a.joinedAt?.getTime?.() || 0) - (b.joinedAt?.getTime?.() || 0)
  );
  const studentParticipant = ordered[0] || null;

  return (
    <StreamTheme>
      <div className="mentorai-call">
        <VideoCallStyles />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <div
            style={{
              position: "relative",
              borderRadius: 8,
              overflow: "hidden",
              aspectRatio: "4 / 3",
              background: theme.navy,
            }}
          >
            {callingState === CallingState.JOINED && studentParticipant ? (
              <ParticipantView participant={studentParticipant} />
            ) : (
              <div
                style={{
                  height: "100%",
                  display: "grid",
                  placeItems: "center",
                  color: "rgba(255,255,255,0.72)",
                  fontSize: 13,
                }}
              >
                Connecting student camera...
              </div>
            )}
            <VideoTileLabel>{studentName || studentParticipant?.name || "Student"}</VideoTileLabel>
          </div>

          <AITutorTile
            isSpeaking={aiSpeaking}
          />
        </div>
        {callingState === CallingState.JOINED ? (
          <CallControls />
        ) : (
          <div style={{ fontSize: 12, color: theme.textMuted }}>Joining the student video room...</div>
        )}
      </div>
    </StreamTheme>
  );
}

function ScreenShareView() {
  const { useParticipants } = useCallStateHooks();
  const participants = useParticipants();
  const sharer = participants.find((p) =>
    p.publishedTracks?.includes(SfuModels.TrackType.SCREEN_SHARE)
  );

  if (!sharer) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: theme.textMuted, fontSize: 13 }}>
        <Monitor size={26} style={{ marginBottom: 10, opacity: 0.5 }} />
        <div>No screen shared yet. A participant can share code, homework, or reading material for AI review.</div>
      </div>
    );
  }

  return (
    <div className="mentorai-screenshare" style={{ padding: 16 }}>
      <VideoCallStyles />
      <div
        style={{
          position: "relative",
          borderRadius: 10,
          overflow: "hidden",
          background: theme.navy,
          aspectRatio: "16 / 9",
        }}
      >
        <ParticipantView participant={sharer} trackType="screenShareTrack" />
        <VideoTileLabel>{sharer.name || "Shared screen"}</VideoTileLabel>
      </div>
    </div>
  );
}

function MasteryBar({ label, pct, color }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: theme.text, fontFamily: fontBody, fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 12, color: theme.textMuted, fontFamily: fontMono }}>{pct}%</span>
      </div>
      <div style={{ height: 6, background: "#EFEEE7", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4 }} />
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "8px 10px",
        fontSize: 13,
        fontFamily: fontBody,
        fontWeight: 500,
        border: "none",
        borderBottom: active ? `2px solid ${theme.purple}` : "2px solid transparent",
        background: "transparent",
        color: active ? theme.navy : theme.textMuted,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function useSharedProblem(defaultText) {
  const [problem, setProblem] = useState(defaultText);

  useEffect(() => {
    const unsubscribe = call.on("custom", (event) => {
      const payload = event.custom;
      if (payload?.type === "problem-update" && typeof payload.text === "string") {
        setProblem(payload.text);
      }
    });
    return unsubscribe;
  }, []);

  const updateProblem = (text) => {
    setProblem(text);
    call.sendCustomEvent({ type: "problem-update", text }).catch(() => {});
  };

  return [problem, updateProblem];
}

function useSharedSessionMeta(defaultMeta) {
  const [sessionMeta, setSessionMeta] = useState(defaultMeta);
  const sessionMetaRef = useRef(defaultMeta);

  useEffect(() => {
    sessionMetaRef.current = sessionMeta;
  }, [sessionMeta]);

  useEffect(() => {
    const unsubscribe = call.on("custom", (event) => {
      const payload = event.custom;

      if (payload?.type === "session-meta-update" && payload.meta) {
        setSessionMeta((prev) => {
          const prevUpdatedAt = Number(prev?.updatedAt || 0);
          const incomingUpdatedAt = Number(payload.meta?.updatedAt || 0);

          if (prevUpdatedAt && (!incomingUpdatedAt || incomingUpdatedAt < prevUpdatedAt)) {
            return prev;
          }

          return { ...prev, ...payload.meta };
        });
      } else if (payload?.type === "session-meta-request") {
        call.sendCustomEvent({ type: "session-meta-update", meta: sessionMetaRef.current }).catch(() => {});
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    call.sendCustomEvent({ type: "session-meta-request" }).catch(() => {});
  }, []);

  const updateSessionMeta = (patch) => {
    setSessionMeta((prev) => {
      const next = { ...prev, ...patch, updatedAt: Date.now() };
      call.sendCustomEvent({ type: "session-meta-update", meta: next }).catch(() => {});
      return next;
    });
  };

  return [sessionMeta, updateSessionMeta];
}

function useSharedChat() {
  const [messages, setMessages] = useState([]);
  const sentIdsRef = useRef(new Set());

  useEffect(() => {
    const unsubscribe = call.on("custom", (event) => {
      const payload = event.custom;
      if (payload?.type !== "chat-message") return;
      if (sentIdsRef.current.has(payload.id)) {
        // this is the echo of a message we sent ourselves — already shown locally
        sentIdsRef.current.delete(payload.id);
        return;
      }
      setMessages((prev) => [...prev, { id: payload.id, from: payload.from, text: payload.text }]);
    });
    return unsubscribe;
  }, []);

  const sendChatMessage = (text, options = {}) => {
    if (!text.trim()) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const from = options.from === "tutor" ? "tutor" : "student";
    sentIdsRef.current.add(id);
    setMessages((prev) => [...prev, { id, from, text }]);
    call.sendCustomEvent({ type: "chat-message", id, from, text }).catch(() => {});
  };

  return [messages, sendChatMessage];
}

// --- Shared AI analysis ----------------------------------------------------
// Same broadcast pattern as useSharedProblem/useSharedChat/whiteboard sync:
// whoever clicks "Analyze my work" still does the actual fetch to
// /api/analyze-work, but the loading state and the final result are
// broadcast over the call's custom events so everyone in the room sees the
// same purple insight card at the same time, not just the person who clicked.
function useSharedAnalysis() {
  const [analysis, setAnalysis] = useState(null);
  const [analysisStatus, setAnalysisStatus] = useState("idle"); // 'idle' | 'loading' | 'success' | 'error'
  const [analysisError, setAnalysisError] = useState("");

  useEffect(() => {
    const unsubscribe = call.on("custom", (event) => {
      const payload = event.custom;
      if (payload?.type === "analysis-loading") {
        setAnalysisStatus("loading");
        setAnalysisError("");
      } else if (payload?.type === "analysis-success") {
        setAnalysis(payload.analysis);
        setAnalysisStatus("success");
      } else if (payload?.type === "analysis-error") {
        setAnalysisError(payload.error || "MentorAI analysis failed");
        setAnalysisStatus("error");
      }
    });
    return unsubscribe;
  }, []);

  const broadcastLoading = () => {
    setAnalysisStatus("loading");
    setAnalysisError("");
    call.sendCustomEvent({ type: "analysis-loading" }).catch(() => {});
  };

  const broadcastSuccess = (analysisPayload) => {
    setAnalysis(analysisPayload);
    setAnalysisStatus("success");
    call.sendCustomEvent({ type: "analysis-success", analysis: analysisPayload }).catch(() => {});
  };

  const broadcastError = (message) => {
    setAnalysisError(message);
    setAnalysisStatus("error");
    call.sendCustomEvent({ type: "analysis-error", error: message }).catch(() => {});
  };

  return { analysis, analysisStatus, analysisError, broadcastLoading, broadcastSuccess, broadcastError };
}

function buildSuggestedReviewAssignment({ analysis, subject, studentName, problem }) {
  const safeSubject = normalizeLabel(subject, "Subject");
  const safeStudent = normalizeLabel(studentName, "Student");
  const skillBreakdown = Array.isArray(analysis?.skillBreakdown) && analysis.skillBreakdown.length
    ? analysis.skillBreakdown.slice(0, 3)
    : buildSkillBreakdown({ analysis, problem, subject: safeSubject });
  const targetedPractice = Array.isArray(analysis?.targetedPractice) && analysis.targetedPractice.length
    ? analysis.targetedPractice.slice(0, 3)
    : buildTargetedPractice({ analysis: { ...analysis, skillBreakdown }, problem, subject: safeSubject, studentName: safeStudent });
  const topSkill = skillBreakdown[0]?.skill || safeSubject;
  const learningPath = Array.isArray(analysis?.learningPath) && analysis.learningPath.length
    ? analysis.learningPath.slice(0, 3)
    : [
        `Revisit the core ${safeSubject.toLowerCase()} idea in smaller steps.`,
        analysis?.suggestedQuestion || "Answer one quick check question out loud.",
        `Try one fresh ${safeSubject.toLowerCase()} example and explain each step.`,
      ];
  const misconception = analysis?.misconception || `the current ${topSkill.toLowerCase()} step`;
  const quickCheck =
    targetedPractice[0]?.prompt ||
    analysis?.suggestedQuestion ||
    `What is the next correct step you should take when working through ${misconception.toLowerCase()}?`;
  const practicePrompt =
    targetedPractice[1]?.prompt ||
    (problem
      ? `Redo this style of problem and narrate the ${topSkill.toLowerCase()} step clearly: ${problem}`
      : `Work one short ${safeSubject.toLowerCase()} example that uses ${topSkill.toLowerCase()} and show each step clearly.`);

  return {
    id: `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: `${topSkill} suggested review`,
    summary: `Built from ${safeStudent}'s latest ${topSkill.toLowerCase()} checkpoint.`,
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    learningPath,
    items: [
      {
        id: "review",
        kind: "Review",
        prompt: `In your own words, explain how to handle the ${topSkill.toLowerCase()} step in this kind of problem.`,
        coachNote:
          skillBreakdown[0]?.tutorMove ||
          "Listen for whether the student can restate the concept without copying the prompt.",
      },
      {
        id: "quiz",
        kind: "Quiz",
        prompt: quickCheck,
        coachNote:
          targetedPractice[0]?.reason ||
          `Use this to check whether the confusion around ${misconception.toLowerCase()} is clearing up.`,
      },
      {
        id: "exercise",
        kind: "Exercise",
        prompt: practicePrompt,
        coachNote:
          targetedPractice[1]?.reason ||
          "Look for accurate steps, pacing, and whether the student can explain why each step works.",
      },
    ],
    responses: {},
    grades: {},
  };
}

function buildDemoStrategyCandidates({ analysis, subject, studentName, problem }) {
  const safeSubject = normalizeLabel(subject, "this topic");
  const safeStudent = normalizeLabel(studentName, "Student");
  const skillBreakdown = Array.isArray(analysis?.skillBreakdown) && analysis.skillBreakdown.length
    ? analysis.skillBreakdown.slice(0, 3)
    : buildSkillBreakdown({ analysis, problem, subject: safeSubject });
  const targetedPractice = Array.isArray(analysis?.targetedPractice) && analysis.targetedPractice.length
    ? analysis.targetedPractice.slice(0, 3)
    : buildTargetedPractice({
        analysis: { ...analysis, skillBreakdown },
        problem,
        subject: safeSubject,
        studentName: safeStudent,
      });
  const topSkill = skillBreakdown[0]?.skill || analysis?.misconception || safeSubject;
  const firstPathStep = Array.isArray(analysis?.learningPath) && analysis.learningPath.length
    ? analysis.learningPath[0]
    : `slow down the ${String(topSkill).toLowerCase()} step`;
  const quickPrompt = targetedPractice[0]?.prompt || analysis?.suggestedQuestion || `Explain how you would handle ${String(topSkill).toLowerCase()}.`;
  const exercisePrompt = targetedPractice[1]?.prompt || problem || `Try one more ${safeSubject.toLowerCase()} example.`;

  return [
    {
      id: "quick-check",
      label: "quick check",
      chatText: `I want to test a quick-check strategy first. ${quickPrompt}`,
    },
    {
      id: "worked-example",
      label: "worked example",
      chatText: `I want to try a worked-example strategy. We will ${firstPathStep.charAt(0).toLowerCase()}${firstPathStep.slice(1)} one step at a time.`,
    },
    {
      id: "transfer-practice",
      label: "transfer practice",
      chatText: `I want to test a transfer strategy next. Apply the same idea here: ${exercisePrompt}`,
    },
  ].filter((item) => String(item.chatText || "").trim());
}

function getReviewGradeTone(grade) {
  if (grade === "pass") {
    return {
      background: theme.greenSoft,
      border: theme.greenLight,
    };
  }

  if (grade === "retry") {
    return {
      background: theme.redSoft,
      border: theme.red,
    };
  }

  return {
    background: "#fff",
    border: theme.border,
  };
}

function useSharedTutorReview() {
  const [assignment, setAssignment] = useState(null);
  const [lastRemoteSyncAt, setLastRemoteSyncAt] = useState(0);
  const assignmentRef = useRef(null);
  const sentSyncIdsRef = useRef(new Set());

  useEffect(() => {
    assignmentRef.current = assignment;
  }, [assignment]);

  const syncAssignment = (nextAssignment) => {
    const syncId = `review-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sentSyncIdsRef.current.add(syncId);
    setAssignment(nextAssignment);
    call.sendCustomEvent({ type: "tutor-review-sync", syncId, assignment: nextAssignment }).catch(() => {});
  };

  const patchAssignment = (updater) => {
    setAssignment((prev) => {
      if (!prev) return prev;
      const next = {
        ...updater(prev),
        updatedAt: Date.now(),
      };
      const syncId = `review-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      sentSyncIdsRef.current.add(syncId);
      call.sendCustomEvent({ type: "tutor-review-sync", syncId, assignment: next }).catch(() => {});
      return next;
    });
  };

  useEffect(() => {
    const unsubscribe = call.on("custom", (event) => {
      const payload = event.custom;

      if (payload?.type === "tutor-review-sync" && payload.assignment) {
        if (payload.syncId && sentSyncIdsRef.current.has(payload.syncId)) {
          sentSyncIdsRef.current.delete(payload.syncId);
          return;
        }

        setAssignment((prev) => {
          const prevUpdatedAt = Number(prev?.updatedAt || 0);
          const incomingUpdatedAt = Number(payload.assignment?.updatedAt || 0);

          if (prevUpdatedAt && (!incomingUpdatedAt || incomingUpdatedAt < prevUpdatedAt)) {
            return prev;
          }

          return payload.assignment;
        });
        setLastRemoteSyncAt(Date.now());
      } else if (payload?.type === "tutor-review-request") {
        if (!assignmentRef.current) return;
        const syncId = `review-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        sentSyncIdsRef.current.add(syncId);
        call.sendCustomEvent({ type: "tutor-review-sync", syncId, assignment: assignmentRef.current }).catch(() => {});
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    call.sendCustomEvent({ type: "tutor-review-request" }).catch(() => {});
  }, []);

  const assignSuggestedReview = (nextAssignment) => {
    syncAssignment({
      ...nextAssignment,
      feedback: nextAssignment?.feedback || {},
      submissionStatus: nextAssignment?.submissionStatus || {},
      updatedAt: Date.now(),
    });
  };

  const updateResponse = (itemId, text) => {
    patchAssignment((prev) => {
      const nextGrades = { ...(prev.grades || {}) };
      const nextFeedback = { ...(prev.feedback || {}) };
      const nextSubmissionStatus = { ...(prev.submissionStatus || {}) };

      delete nextGrades[itemId];
      delete nextFeedback[itemId];
      nextSubmissionStatus[itemId] = "idle";

      return {
        ...prev,
        responses: {
          ...(prev.responses || {}),
          [itemId]: text,
        },
        grades: nextGrades,
        feedback: nextFeedback,
        submissionStatus: nextSubmissionStatus,
      };
    });
  };

  const setSubmissionStatus = (itemId, status) => {
    patchAssignment((prev) => ({
      ...prev,
      submissionStatus: {
        ...(prev.submissionStatus || {}),
        [itemId]: status,
      },
    }));
  };

  const saveReviewedResponse = (itemId, result) => {
    patchAssignment((prev) => ({
      ...prev,
      grades: {
        ...(prev.grades || {}),
        [itemId]: result?.verdict === "pass" ? "pass" : "retry",
      },
      feedback: {
        ...(prev.feedback || {}),
        [itemId]: {
          verdict: result?.verdict === "pass" ? "pass" : "retry",
          explanation: String(result?.explanation || "").trim(),
          voiceSummary: String(result?.voiceSummary || "").trim(),
          nextStep: String(result?.nextStep || "").trim(),
          confidence: result?.confidence === "high" || result?.confidence === "low" ? result.confidence : "medium",
          submittedAt: new Date().toISOString(),
        },
      },
      submissionStatus: {
        ...(prev.submissionStatus || {}),
        [itemId]: "submitted",
      },
    }));
  };

  return {
    assignment,
    lastRemoteSyncAt,
    assignSuggestedReview,
    updateResponse,
    setSubmissionStatus,
    saveReviewedResponse,
  };
}

function useStudentProfileAnalytics(studentName) {
  const reactId = useId();
  const sessionIdRef = useRef(`session-${reactId.replace(/:/g, "")}`);
  const studentKey = slugifyStudentName(studentName);

  const [analyticsStore, setAnalyticsStore] = useState(() => loadAnalyticsStore());
  const [profileSummary, setProfileSummary] = useState(() => loadCachedProfile(studentKey));
  const [profileStatus, setProfileStatus] = useState("idle");
  const [profileError, setProfileError] = useState("");
  const profileFingerprintRef = useRef(loadCachedProfileFingerprint(studentKey));

  const studentStats = buildStudentAnalytics(analyticsStore, studentName);
  const studentStatsRef = useRef(studentStats);

  useEffect(() => {
    studentStatsRef.current = studentStats;
  }, [studentStats]);

  const updateSessionRecord = useCallback((prev, activeStudentName, subject, mutate) => {
    const createdAt = new Date().toISOString();
    const normalizedStudent = normalizeLabel(activeStudentName, "Student");
    const normalizedSubject = normalizeLabel(subject, "General");
    const sessions = Array.isArray(prev?.sessions) ? [...prev.sessions] : [];
    const existingIndex = sessions.findIndex(
      (session) => session.sessionId === sessionIdRef.current && session.studentKey === studentKey
    );

    const baseSession =
      existingIndex >= 0
        ? sessions[existingIndex]
        : {
            sessionId: sessionIdRef.current,
            studentKey,
            studentName: normalizedStudent,
            subject: normalizedSubject,
            problem: "",
            startedAt: createdAt,
            updatedAt: createdAt,
            analyses: [],
            messages: [],
            reviewAssignments: [],
            suggestedPrompts: [],
          };

    const nextSession = {
      ...baseSession,
      studentName: normalizedStudent,
      subject: normalizedSubject,
      updatedAt: createdAt,
    };

    const mutatedSession = mutate(nextSession, { createdAt, normalizedStudent, normalizedSubject }) || nextSession;

    if (existingIndex >= 0) {
      sessions[existingIndex] = mutatedSession;
    } else {
      sessions.push(mutatedSession);
    }

    return {
      version: 2,
      sessions,
    };
  }, [studentKey]);

  useEffect(() => {
    saveAnalyticsStore(analyticsStore);
  }, [analyticsStore]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setProfileSummary(loadCachedProfile(studentKey));
      profileFingerprintRef.current = loadCachedProfileFingerprint(studentKey);
      setProfileError("");
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [studentKey]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleStorage = (event) => {
      if (event.key === ANALYTICS_STORAGE_KEY) {
        setAnalyticsStore(loadAnalyticsStore());
      }

      if (event.key === PROFILE_STORAGE_KEY) {
        setProfileSummary(loadCachedProfile(studentKey));
        profileFingerprintRef.current = loadCachedProfileFingerprint(studentKey);
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [studentKey]);

  const refreshProfile = useCallback(async (snapshot, options = {}) => {
    const targetSnapshot = snapshot || studentStatsRef.current;
    const targetFingerprint = String(targetSnapshot?.analysisFingerprint || "");

    if (!targetSnapshot.totalAnalyses) {
      setProfileStatus("idle");
      return;
    }

    if (!options.force && targetFingerprint && profileFingerprintRef.current === targetFingerprint) {
      setProfileStatus("success");
      setProfileError("");
      return;
    }

    setProfileStatus("loading");
    setProfileError("");

    try {
      const response = await fetch("/api/profile-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentName,
          sessions: targetSnapshot.analysisSessions?.length ? targetSnapshot.analysisSessions : targetSnapshot.sessions,
          subjectStats: targetSnapshot.subjectStats,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Profile summary failed");
      }

      setProfileSummary(payload);
      saveCachedProfile(studentKey, payload, targetFingerprint);
      profileFingerprintRef.current = targetFingerprint;
      setProfileStatus("success");
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Profile summary failed");
      setProfileStatus("error");
    }
  }, [studentKey, studentName]);

  const syncSessionContext = useCallback(({ studentName: activeStudentName, subject, problem, messages, assignment }) => {
    setAnalyticsStore((prev) =>
      updateSessionRecord(prev, activeStudentName, subject, (session) => {
        const normalizedAssignment = normalizeStoredAssignment(assignment);
        const reviewAssignments = Array.isArray(session.reviewAssignments) ? [...session.reviewAssignments] : [];

        if (normalizedAssignment) {
          const existingAssignmentIndex = reviewAssignments.findIndex((item) => item.id === normalizedAssignment.id);
          if (existingAssignmentIndex >= 0) {
            reviewAssignments[existingAssignmentIndex] = normalizedAssignment;
          } else {
            reviewAssignments.push(normalizedAssignment);
          }
        }

        return {
          ...session,
          problem: String(problem || "").trim(),
          messages: normalizeStoredMessages(messages),
          currentAssignment: normalizedAssignment,
          reviewAssignments: reviewAssignments.slice(-6),
        };
      })
    );
  }, [updateSessionRecord]);

  const recordSuggestedPrompt = ({ studentName: activeStudentName, subject, prompt }) => {
    const createdAt = new Date().toISOString();
    const promptText = String(prompt || "").trim();
    if (!promptText) return;

    setAnalyticsStore((prev) =>
      updateSessionRecord(prev, activeStudentName, subject, (session) => {
        const suggestedPrompts = Array.isArray(session.suggestedPrompts) ? [...session.suggestedPrompts] : [];

        suggestedPrompts.push({
          id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt,
          prompt: promptText.slice(0, 280),
        });

        return {
          ...session,
          problem: promptText,
          suggestedPrompts: suggestedPrompts.slice(-10),
        };
      })
    );
  };

  const recordAnalysis = ({ studentName: activeStudentName, subject, problem, analysis, messages = [], assignment = null }) => {
    const createdAt = new Date().toISOString();
    const normalizedStudent = normalizeLabel(activeStudentName, "Student");
    const normalizedSubject = normalizeLabel(subject, "General");
    const normalizedMessages = normalizeStoredMessages(messages);
    const normalizedAssignment = normalizeStoredAssignment(assignment);
    const normalizedAnalysis = {
      ...analysis,
      confidence: normalizeConfidenceScore(
        analysis?.confidence,
        Boolean(analysis?.misconception || analysis?.explanation || analysis?.suggestedQuestion)
      ),
      learningPath: Array.isArray(analysis?.learningPath) ? analysis.learningPath.slice(0, 3) : [],
      skillBreakdown: Array.isArray(analysis?.skillBreakdown)
        ? analysis.skillBreakdown.slice(0, 4).map((item, index) => ({
            skill: normalizeLabel(item?.skill, `Focus area ${index + 1}`),
            status: normalizeLabel(item?.status, index === 0 ? "needs-support" : "developing"),
            evidence: String(item?.evidence || "Observed in the latest work.").trim().slice(0, 220),
            tutorMove: String(item?.tutorMove || "Ask the student to explain that step before moving on.").trim().slice(0, 220),
          }))
        : [],
      targetedPractice: Array.isArray(analysis?.targetedPractice)
        ? analysis.targetedPractice.slice(0, 4).map((item, index) => ({
            title: normalizeLabel(item?.title, `Targeted practice ${index + 1}`),
            prompt: String(item?.prompt || "").trim().slice(0, 320),
            reason: String(item?.reason || "Chosen from the student's recent work.").trim().slice(0, 220),
          }))
        : [],
      adaptationNote: String(analysis?.adaptationNote || "").trim().slice(0, 240),
    };

    setAnalyticsStore((prev) => {
      const nextEntry = {
        id: `analysis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt,
        subject: normalizedSubject,
        problem,
        messagesSnapshot: normalizedMessages,
        assignmentSnapshot: normalizedAssignment,
        analysis: normalizedAnalysis,
      };

      return updateSessionRecord(prev, normalizedStudent, normalizedSubject, (session) => {
        const reviewAssignments = Array.isArray(session.reviewAssignments) ? [...session.reviewAssignments] : [];

        if (normalizedAssignment) {
          const existingAssignmentIndex = reviewAssignments.findIndex((item) => item.id === normalizedAssignment.id);
          if (existingAssignmentIndex >= 0) {
            reviewAssignments[existingAssignmentIndex] = normalizedAssignment;
          } else {
            reviewAssignments.push(normalizedAssignment);
          }
        }

        return {
          ...session,
          problem,
          messages: normalizedMessages,
          currentAssignment: normalizedAssignment,
          reviewAssignments: reviewAssignments.slice(-6),
          analyses: [...(session.analyses || []), nextEntry],
        };
      });
    });
  };

  return {
    studentStats,
    profileSummary,
    profileStatus,
    profileError,
    syncSessionContext,
    recordSuggestedPrompt,
    recordAnalysis,
    refreshProfile,
  };
}

// --- Whiteboard export helpers -------------------------------------------
// Reusable now, and exactly what you'd hand to an AI vision model later:
//   canvasToPNGDataURL(canvas)      -> "data:image/png;base64,...."
//   canvasToBase64(canvas)          -> just the base64 payload, no prefix
//   canvasToBlob(canvas).then(blob) -> a real Blob, e.g. for FormData/fetch
function canvasToPNGDataURL(canvas) {
  return canvas.toDataURL("image/png");
}
function canvasToBase64(canvas) {
  return canvasToPNGDataURL(canvas).split(",")[1] || "";
}
function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

const WHITEBOARD_WIDTH = 900;
const WHITEBOARD_HEIGHT = 260;

function useWhiteboard() {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const isDrawingRef = useRef(false);
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const sentSnapshotIdsRef = useRef(new Set());

  const [tool, setTool] = useState("draw"); // 'draw' | 'erase'
  const [, bumpHistoryVersion] = useState(0);

  const fillWhite = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  useEffect(() => {
    if (!canvasRef.current) return;
    fillWhite();
    historyRef.current = [canvasToPNGDataURL(canvasRef.current)];
    historyIndexRef.current = 0;
    bumpHistoryVersion((n) => n + 1);
  }, []);

  const pushHistory = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const snapshot = canvasToPNGDataURL(canvas);
    if (historyRef.current[historyIndexRef.current] === snapshot) return;
    const trimmed = historyRef.current.slice(0, historyIndexRef.current + 1);
    trimmed.push(snapshot);
    historyRef.current = trimmed;
    historyIndexRef.current = trimmed.length - 1;
    bumpHistoryVersion((n) => n + 1);
  };

  // Sends the current canvas to the other participant(s) in the call, the
  // same way useSharedProblem/useSharedChat broadcast their state. The
  // whole board is sent (rather than individual strokes) since it's simple
  // and self-correcting: whatever the sender's canvas looks like right now
  // is exactly what the other side will end up seeing.
  const broadcastSnapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const snapshotId = `whiteboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sentSnapshotIdsRef.current.add(snapshotId);
    call
      .sendCustomEvent({ type: "whiteboard-update", snapshotId, dataUrl: canvasToPNGDataURL(canvas) })
      .catch(() => {});
  };

  // Listens for the other participant's board updates, and for a
  // "whiteboard-request" — sent once by anyone who just joined — which
  // asks whoever already has a board to share it, so a tutor/student who
  // joins mid-session doesn't just see a blank canvas.
  useEffect(() => {
    const unsubscribe = call.on("custom", (event) => {
      const payload = event.custom;
      if (payload?.type === "whiteboard-update" && typeof payload.dataUrl === "string") {
        if (payload.snapshotId && sentSnapshotIdsRef.current.has(payload.snapshotId)) {
          sentSnapshotIdsRef.current.delete(payload.snapshotId);
          return;
        }
        const canvas = canvasRef.current;
        if (!canvas) return;
        if (historyRef.current[historyIndexRef.current] === payload.dataUrl) return;
        const ctx = canvas.getContext("2d");
        const img = new Image();
        img.onload = () => {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          pushHistory();
        };
        img.src = payload.dataUrl;
      } else if (payload?.type === "whiteboard-request") {
        broadcastSnapshot();
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    call.sendCustomEvent({ type: "whiteboard-request" }).catch(() => {});
  }, []);

  const restore = (index, { broadcast = false } = {}) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      if (broadcast) broadcastSnapshot();
    };
    img.src = historyRef.current[index];
  };

  const undo = () => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    restore(historyIndexRef.current, { broadcast: true });
    bumpHistoryVersion((n) => n + 1);
  };

  const redo = () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    restore(historyIndexRef.current, { broadcast: true });
    bumpHistoryVersion((n) => n + 1);
  };

  const clear = () => {
    fillWhite();
    pushHistory();
    broadcastSnapshot();
  };

  const getCoords = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const handlePointerDown = (e) => {
    const { x, y } = getCoords(e);
    isDrawingRef.current = true;
    const ctx = canvasRef.current.getContext("2d");
    ctx.strokeStyle = tool === "erase" ? "#FFFFFF" : theme.text;
    ctx.lineWidth = tool === "erase" ? 20 : 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
    canvasRef.current.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!isDrawingRef.current) return;
    const { x, y } = getCoords(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handlePointerUp = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    pushHistory();
    broadcastSnapshot();
  };

  const exportPNGDataURL = () => canvasToPNGDataURL(canvasRef.current);
  const exportBase64 = () => canvasToBase64(canvasRef.current);
  const exportBlob = () => canvasToBlob(canvasRef.current);

  return {
    canvasRef,
    containerRef,
    tool,
    setTool,
    canUndo: historyIndexRef.current > 0,
    canRedo: historyIndexRef.current < historyRef.current.length - 1,
    undo,
    redo,
    clear,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    exportPNGDataURL,
    exportBase64,
    exportBlob,
  };
}

function MentorAIDemoInner() {
  const [centerTab, setCenterTab] = useState("whiteboard");
  const [mentorTab, setMentorTab] = useState("insights");
  const [chatInput, setChatInput] = useState("");
  const [problemGeneratorStatus, setProblemGeneratorStatus] = useState("idle");
  const [problemGeneratorError, setProblemGeneratorError] = useState("");
  const [sessionMeta, updateSessionMeta] = useSharedSessionMeta({ studentName: "", subject: "", updatedAt: 0 });
  const [problem, setProblem] = useSharedProblem("");
  const [messages, sendChatMessage] = useSharedChat();
  const whiteboard = useWhiteboard();
  const [lastSnapshotInfo, setLastSnapshotInfo] = useState(null);
  const [aiTutorStatus, setAiTutorStatus] = useState("idle");
  const [aiTutorReply, setAiTutorReply] = useState(null);
  const [aiTutorSpeaking, setAiTutorSpeaking] = useState(false);
  const audioRef = useRef(null);
  const pendingQuizAssignmentRef = useRef(null);
  const { analysis, analysisStatus, analysisError, broadcastLoading, broadcastSuccess, broadcastError } =
    useSharedAnalysis();
  const { assignment, assignSuggestedReview, updateResponse, setSubmissionStatus, saveReviewedResponse } = useSharedTutorReview();
  const studentName = String(sessionMeta.studentName || "");
  const subject = String(sessionMeta.subject || "");
  const displayStudentName = normalizeLabel(studentName, "Student");
  const displaySubject = normalizeLabel(subject, "Subject");
  const headerMeta = [subject, studentName].filter(Boolean).join(" · ");
  const {
    studentStats,
    profileSummary,
    profileStatus,
    profileError,
    syncSessionContext,
    recordSuggestedPrompt,
    recordAnalysis,
    refreshProfile,
  } = useStudentProfileAnalytics(displayStudentName);
  const effectiveProfile = profileSummary || buildFallbackProfile(displayStudentName, studentStats);
  const adaptiveProfile = buildAdaptiveProfile({
    studentName: displayStudentName,
    sessions: studentStats.analysisSessions?.length ? studentStats.analysisSessions : studentStats.sessions,
    observations: studentStats.observations,
    subjectStats: studentStats.subjectStats,
    latestObservation: studentStats.latestObservation,
    topMisconceptions: studentStats.topMisconceptions,
  });
  const lastUpdatedLabel = studentStats.lastUpdatedAt
    ? new Date(studentStats.lastUpdatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "Live";
  const insightCardTone = getInsightCardTone(analysis);
  const assignmentSourceAnalysis = analysis || studentStats.latestObservation?.analysis || null;
  const assignmentSourceProblem = problem || studentStats.latestObservation?.problem || "";
  const currentAnalysisSkillBreakdown = analysis
    ? (Array.isArray(analysis?.skillBreakdown) && analysis.skillBreakdown.length
        ? analysis.skillBreakdown
        : buildSkillBreakdown({ analysis, problem, subject: displaySubject }))
    : [];
  const currentTargetedPractice = analysis
    ? (Array.isArray(analysis?.targetedPractice) && analysis.targetedPractice.length
        ? analysis.targetedPractice
        : buildTargetedPractice({
            analysis: { ...analysis, skillBreakdown: currentAnalysisSkillBreakdown },
            problem,
            subject: displaySubject,
            studentName: displayStudentName,
          }))
    : [];
  const latestAnalysisSkillBreakdown = assignmentSourceAnalysis
    ? (Array.isArray(assignmentSourceAnalysis?.skillBreakdown) && assignmentSourceAnalysis.skillBreakdown.length
        ? assignmentSourceAnalysis.skillBreakdown
        : buildSkillBreakdown({
            analysis: assignmentSourceAnalysis,
            problem: assignmentSourceProblem,
            subject: displaySubject,
          }))
    : [];
  const latestTargetedPractice = assignmentSourceAnalysis
    ? (Array.isArray(assignmentSourceAnalysis?.targetedPractice) && assignmentSourceAnalysis.targetedPractice.length
        ? assignmentSourceAnalysis.targetedPractice
        : buildTargetedPractice({
            analysis: { ...assignmentSourceAnalysis, skillBreakdown: latestAnalysisSkillBreakdown },
            problem: assignmentSourceProblem,
            subject: displaySubject,
            studentName: displayStudentName,
          }))
    : [];
  const effectiveFocusSkills = (effectiveProfile.focusSkills || []).length
    ? effectiveProfile.focusSkills
    : adaptiveProfile.focusSkills;
  const effectivePracticeModes = (effectiveProfile.effectivePracticeModes || []).length
    ? effectiveProfile.effectivePracticeModes
    : adaptiveProfile.effectivePracticeModes;
  const nextSessionPlan = (effectiveProfile.nextSessionPlan || []).length
    ? effectiveProfile.nextSessionPlan
    : adaptiveProfile.nextSessionPlan;
  const evolutionLoop = effectiveProfile.evolutionLoop || adaptiveProfile.evolutionLoop;
  const repeatedFocusSkill =
    effectiveFocusSkills[0]?.skill ||
    currentAnalysisSkillBreakdown[0]?.skill ||
    studentStats.topMisconceptions[0]?.label ||
    displaySubject;

  const stopAiAudio = useCallback(() => {
    const currentAudio = audioRef.current;
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.src = "";
      audioRef.current = null;
    }
    setAiTutorSpeaking(false);
  }, []);

  const playAiAudio = useCallback(
    async (audioBase64, mimeType = "audio/mpeg") => {
      if (!audioBase64) return;

      stopAiAudio();

      const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
      audioRef.current = audio;

      audio.addEventListener("play", () => setAiTutorSpeaking(true), { once: true });
      audio.addEventListener("ended", () => setAiTutorSpeaking(false), { once: true });
      audio.addEventListener("pause", () => setAiTutorSpeaking(false), { once: true });

      await audio.play();
    },
    [stopAiAudio]
  );

  useEffect(() => () => stopAiAudio(), [stopAiAudio]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      syncSessionContext({
        studentName: displayStudentName,
        subject: displaySubject,
        problem,
        messages,
        assignment,
      });
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [displayStudentName, displaySubject, problem, messages, assignment, syncSessionContext]);

  const requestTutorSpeech = useCallback(
    async (payload) => {
      setAiTutorStatus("loading");

      const response = await fetch("/api/ai-tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body?.error || "AI tutor response failed");
      }

      setAiTutorReply(body);
      setAiTutorStatus("ready");

      if (body?.audioBase64) {
        try {
          await playAiAudio(body.audioBase64, body.audioMimeType);
        } catch {
          // ignore autoplay block in the compact voice card UI
        }
      }

      return body;
    },
    [playAiAudio]
  );

  const speakDirectTutorText = async (text, options = {}) => {
    if (!String(text || "").trim()) return null;

    const payload = await requestTutorSpeech({
      studentName: displayStudentName,
      subject: displaySubject,
      problem,
      directText: text,
      teachingFocus: options.teachingFocus || "demo-strategy",
    });

    if (options.postToChat) {
      sendChatMessage(options.chatText || payload?.text || text, { from: "tutor" });
    }

    return payload;
  };

  const announceQuizAssignment = async (nextAssignment) => {
    if (!nextAssignment) return;

    pendingQuizAssignmentRef.current = null;
    assignSuggestedReview(nextAssignment);
    setMentorTab("recs");

    await speakDirectTutorText(
      "I assigned a quiz. Answer each prompt in the tutor panel, then press submit when you are done writing each answer.",
      {
        postToChat: true,
        teachingFocus: "quiz-assigned",
      }
    );
  };

  const handleAskAiTutor = async ({ studentMessage = "" } = {}) => {
    setMentorTab("recs");

    try {
      const payload = await requestTutorSpeech({
          studentName: displayStudentName,
          subject: displaySubject,
          problem,
          studentMessage,
          chatHistory: messages,
          analysis: assignmentSourceAnalysis,
          latestLessonRecap: effectiveProfile.latestLessonRecap,
          focusSkills: effectiveFocusSkills.slice(0, 3),
          effectivePracticeModes: effectivePracticeModes.slice(0, 3),
          targetedPractice: (latestTargetedPractice.length ? latestTargetedPractice : currentTargetedPractice).slice(0, 3),
          strengths: (effectiveProfile.strengths || studentStats.topStrengths.map((item) => item.label)).slice(0, 3),
      });

      if (payload?.text) {
        sendChatMessage(payload.text, { from: "tutor" });
      }
    } catch {
      setAiTutorStatus("error");
    }
  };

  const handleGenerateSubjectProblem = async () => {
    const liveSubject = String(subject || "").trim();
    if (!liveSubject) return;

    setProblemGeneratorStatus("loading");
    setProblemGeneratorError("");

    try {
      const response = await fetch("/api/generate-problem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: liveSubject,
          studentName: displayStudentName,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Problem generation failed");
      }

      setProblem(payload.problem || "");
      recordSuggestedPrompt({
        studentName: displayStudentName,
        subject: displaySubject,
        prompt: payload.problem || "",
      });
      setProblemGeneratorStatus("success");
    } catch (error) {
      setProblemGeneratorStatus("error");
      setProblemGeneratorError(error instanceof Error ? error.message : "Problem generation failed");
    }
  };

  const handleAssignSuggestedReview = () => {
    if (!assignmentSourceAnalysis) return;

    const nextAssignment = buildSuggestedReviewAssignment({
        analysis: assignmentSourceAnalysis,
        subject: displaySubject,
        studentName: displayStudentName,
        problem: assignmentSourceProblem,
      });

    announceQuizAssignment(nextAssignment).catch(() => {
      setAiTutorStatus("error");
    });
  };

  const handleSubmitReviewAnswer = async (item) => {
    const responseText = String(assignment?.responses?.[item.id] || "").trim();

    if (!responseText) {
      saveReviewedResponse(item.id, {
        verdict: "retry",
        explanation: "Write an answer before submitting so MentorAI can check the reasoning.",
        voiceSummary: "Write your answer first, then submit it so I can check it.",
        nextStep: "Add your reasoning, then submit again.",
        confidence: "low",
      });
      return;
    }

    setSubmissionStatus(item.id, "submitting");

    try {
      const response = await fetch("/api/quiz-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentName: displayStudentName,
          subject: displaySubject,
          problem: assignmentSourceProblem || problem,
          item,
          response: responseText,
          analysis: assignmentSourceAnalysis,
          learningPath: assignment?.learningPath || assignmentSourceAnalysis?.learningPath || [],
          chatHistory: messages,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Quiz feedback failed");
      }

      saveReviewedResponse(item.id, payload);

      if (payload?.voiceSummary) {
        await speakDirectTutorText(payload.voiceSummary, {
          postToChat: false,
          teachingFocus: payload?.verdict === "pass" ? "quiz-pass" : "quiz-retry",
        });
      }
    } catch {
      setSubmissionStatus(item.id, "idle");
      setAiTutorStatus("error");
    }
  };

  const handleAnalyze = async () => {
    const dataUrl = whiteboard.exportPNGDataURL();
    const approxKB = Math.round((dataUrl.length * 0.75) / 1024);
    setLastSnapshotInfo(`Snapshot captured (~${approxKB} KB) at ${new Date().toLocaleTimeString()}`);
    broadcastLoading();

    try {
      const response = await fetch("/api/analyze-work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          problem,
          whiteboardImage: dataUrl,
          chatHistory: messages,
          studentName: displayStudentName,
          subject: displaySubject,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "MentorAI analysis failed");
      }

      broadcastSuccess(payload);
      recordAnalysis({
        studentName: displayStudentName,
        subject: displaySubject,
        problem,
        analysis: payload,
        messages,
        assignment,
      });

      const strategyOptions = buildDemoStrategyCandidates({
        analysis: payload,
        subject: displaySubject,
        studentName: displayStudentName,
        problem,
      });
      const nextAssignment = buildSuggestedReviewAssignment({
        analysis: payload,
        subject: displaySubject,
        studentName: displayStudentName,
        problem,
      });

      pendingQuizAssignmentRef.current = nextAssignment;

      if (strategyOptions.length) {
        const selectedStrategy = strategyOptions[studentStats.totalAnalyses % strategyOptions.length];
        await speakDirectTutorText(selectedStrategy.chatText, {
          postToChat: true,
          teachingFocus: selectedStrategy.label,
        });
      }
    } catch (error) {
      broadcastError(error instanceof Error ? error.message : "MentorAI analysis failed");
    }
  };

  const handleExportDownload = () => {
    const dataUrl = whiteboard.exportPNGDataURL();
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = "whiteboard-snapshot.png";
    link.click();
  };

  const sendMessage = async () => {
    const nextMessage = chatInput.trim();
    if (!nextMessage) return;

    sendChatMessage(nextMessage, { from: "student" });
    setChatInput("");

    if (pendingQuizAssignmentRef.current) {
      await announceQuizAssignment(pendingQuizAssignmentRef.current);
      return;
    }

    await handleAskAiTutor({ studentMessage: nextMessage });
  };

  return (
    <div style={{ fontFamily: fontBody, background: theme.bg, minHeight: "100vh", color: theme.text }}>
      <Fonts />
      <GlobalUIReset />

      {/* Top nav */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 24px",
          borderBottom: `1px solid ${theme.border}`,
          background: theme.card,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: theme.navy,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Sparkles size={15} color={theme.purple} />
          </div>
          <span style={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: 17 }}>MentorAI</span>
        </div>
        <div style={{ fontSize: 13, color: theme.textMuted }}>{headerMeta || "Mentor session"}</div>
        <div style={{ fontSize: 12, color: theme.textMuted, fontFamily: fontMono }}>{lastUpdatedLabel}</div>
      </div>

      {/* Main 3-column grid */}
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr 300px", gap: 16, padding: 16 }}>
        {/* LEFT: Video + chat */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Panel title="Student + AI tutor">
            <LiveCallLayout
              studentName={displayStudentName}
              aiSpeaking={aiTutorSpeaking}
            />
          </Panel>

          <Panel title={null} noPad>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", borderBottom: `1px solid ${theme.border}` }}>
              <MessageSquare size={14} color={theme.textMuted} />
              <span style={{ fontSize: 13, fontWeight: 500 }}>Session chat</span>
            </div>

            <div
              style={{
                padding: "12px 16px 10px",
                fontSize: 11,
                color: theme.textMuted,
                lineHeight: 1.5,
                borderBottom: `1px solid ${theme.border}`,
                background: "#FCFBF8",
              }}
            >
              Ask MentorAI here and hear the reply from the AI tutor voice.
            </div>

            <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8, height: 260, overflowY: "auto" }}>
              {messages.map((m) => {
                const isMine = m.from === "student";
                return (
                  <div key={m.id} style={{ display: "flex", justifyContent: isMine ? "flex-end" : "flex-start" }}>
                    <div
                      style={{
                        maxWidth: "82%",
                        fontSize: 13,
                        padding: "8px 12px",
                        borderRadius: 10,
                        background: isMine ? theme.navy : "#F1EFE8",
                        color: isMine ? "#fff" : theme.text,
                        lineHeight: 1.45,
                      }}
                    >
                      {m.text}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 8, padding: "10px 16px", borderTop: `1px solid ${theme.border}` }}>
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Ask MentorAI..."
                style={{
                  flex: 1,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: 13,
                  fontFamily: fontBody,
                  outline: "none",
                }}
              />
              <button
                onClick={sendMessage}
                style={{
                  border: "none",
                  background: theme.navy,
                  color: "#fff",
                  borderRadius: 8,
                  padding: "0 14px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <Send size={14} />
              </button>
            </div>
          </Panel>
        </div>

        {/* CENTER: Workspace */}
        <Panel title={null} noPad>
          <div style={{ display: "flex", borderBottom: `1px solid ${theme.border}` }}>
            <TabButton active={centerTab === "whiteboard"} onClick={() => setCenterTab("whiteboard")}>
              <PenLine size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
              Whiteboard
            </TabButton>
            <TabButton active={centerTab === "share"} onClick={() => setCenterTab("share")}>
              <Monitor size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
              Screen share
            </TabButton>
          </div>

          {centerTab === "whiteboard" ? (
            <div style={{ padding: 18 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>Student</div>
                  <input
                    value={studentName}
                    onChange={(e) => updateSessionMeta({ studentName: e.target.value })}
                    placeholder="Student name"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      border: `1px solid ${theme.border}`,
                      borderRadius: 8,
                      padding: "9px 12px",
                      fontSize: 13,
                      fontFamily: fontBody,
                      outline: "none",
                      background: "#fff",
                    }}
                  />
                </div>

                <div>
                  <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>Subject</div>
                  <input
                    value={subject}
                    onChange={(e) => {
                      updateSessionMeta({ subject: e.target.value });
                      setProblem("");
                      setProblemGeneratorError("");
                      setProblemGeneratorStatus("idle");
                    }}
                    placeholder="Subject"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      border: `1px solid ${theme.border}`,
                      borderRadius: 8,
                      padding: "9px 12px",
                      fontSize: 13,
                      fontFamily: fontBody,
                      outline: "none",
                      background: "#fff",
                    }}
                  />
                </div>
              </div>

              <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                Problem
                <span style={{ color: theme.purple, fontWeight: 500, fontSize: 11 }}>
                  &middot; generated live from the subject
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
                <input
                  value={problem}
                  readOnly
                  placeholder="Choose a subject, then tap Suggested question"
                  style={{
                    flex: 1,
                    fontFamily: fontMono,
                    fontSize: 15,
                    background: "#F5F4EE",
                    border: `1px solid ${theme.purple}`,
                    borderRadius: 8,
                    padding: "10px 14px",
                    width: "100%",
                    boxSizing: "border-box",
                    outline: "none",
                    color: problem ? theme.text : theme.textMuted,
                  }}
                />

                <button
                  onClick={handleGenerateSubjectProblem}
                  disabled={!String(subject || "").trim() || problemGeneratorStatus === "loading"}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    border: `1px solid #DDD7F9`,
                    background: theme.purpleSoft,
                    color: "#4A3FA3",
                    borderRadius: 8,
                    padding: "10px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: !String(subject || "").trim() || problemGeneratorStatus === "loading" ? "not-allowed" : "pointer",
                    opacity: !String(subject || "").trim() || problemGeneratorStatus === "loading" ? 0.6 : 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {problemGeneratorStatus === "loading" ? "Generating..." : "Suggested question"}
                </button>
              </div>

              {problemGeneratorError && (
                <div style={{ fontSize: 12, color: theme.red, marginBottom: 16 }}>
                  {problemGeneratorError}
                </div>
              )}

              {!problemGeneratorError && (
                <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 16 }}>
                  The problem is generated from the live subject, then shared with the AI tutor for analysis.
                </div>
              )}

              <div
                style={{
                  background: "#fff",
                  border: `1px solid ${theme.border}`,
                  borderRadius: 10,
                  padding: 12,
                  marginBottom: 16,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>AI tutor voice</div>
                    <div style={{ fontSize: 12, color: theme.textMuted }}>
                      Generate a spoken explanation from the current problem, whiteboard state, and saved learning profile.
                    </div>
                  </div>
                  <button
                    onClick={() => handleAskAiTutor()}
                    disabled={aiTutorStatus === "loading"}
                    style={{
                      border: "none",
                      background: theme.navy,
                      color: "#fff",
                      borderRadius: 8,
                      padding: "10px 12px",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: aiTutorStatus === "loading" ? "not-allowed" : "pointer",
                      opacity: aiTutorStatus === "loading" ? 0.7 : 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {aiTutorStatus === "loading" ? "Preparing voice..." : "Speak with ElevenLabs"}
                  </button>
                </div>

                <div style={{ fontSize: 12, color: theme.textMuted, lineHeight: 1.55 }}>
                  {aiTutorReply?.text || "Ask a question in chat or tap the button to have the AI tutor explain the next step out loud."}
                </div>
              </div>

              <div
                ref={whiteboard.containerRef}
                style={{
                  position: "relative",
                  border: `1px dashed ${theme.border}`,
                  borderRadius: 10,
                  background: "#FFFFFF",
                  overflow: "hidden",
                }}
              >
                <canvas
                  ref={whiteboard.canvasRef}
                  width={WHITEBOARD_WIDTH}
                  height={WHITEBOARD_HEIGHT}
                  style={{
                    width: "100%",
                    height: WHITEBOARD_HEIGHT,
                    display: "block",
                    cursor: "crosshair",
                    touchAction: "none",
                  }}
                  onPointerDown={whiteboard.handlePointerDown}
                  onPointerMove={whiteboard.handlePointerMove}
                  onPointerUp={whiteboard.handlePointerUp}
                  onPointerCancel={whiteboard.handlePointerUp}
                  onPointerLeave={whiteboard.handlePointerUp}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <SmallIconBtn
                    title="Draw"
                    active={whiteboard.tool === "draw"}
                    onClick={() => whiteboard.setTool("draw")}
                  >
                    <Pencil size={14} />
                  </SmallIconBtn>
                  <SmallIconBtn
                    title="Eraser"
                    active={whiteboard.tool === "erase"}
                    onClick={() => whiteboard.setTool("erase")}
                  >
                    <Eraser size={14} />
                  </SmallIconBtn>
                  <SmallIconBtn title="Undo" disabled={!whiteboard.canUndo} onClick={whiteboard.undo}>
                    <Undo2 size={14} />
                  </SmallIconBtn>
                  <SmallIconBtn title="Redo" disabled={!whiteboard.canRedo} onClick={whiteboard.redo}>
                    <Redo2 size={14} />
                  </SmallIconBtn>
                  <SmallIconBtn title="Clear board" onClick={whiteboard.clear}>
                    <Trash2 size={14} />
                  </SmallIconBtn>
                  <SmallIconBtn title="Download PNG" onClick={handleExportDownload}>
                    <Download size={14} />
                  </SmallIconBtn>
                </div>
                <button
                  onClick={handleAnalyze}
                  disabled={analysisStatus === "loading"}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: analysisStatus === "loading" ? theme.navySoft : theme.navy,
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    padding: "9px 16px",
                    fontSize: 13,
                    fontWeight: 500,
                    fontFamily: fontBody,
                    cursor: analysisStatus === "loading" ? "wait" : "pointer",
                    opacity: analysisStatus === "loading" ? 0.8 : 1,
                  }}
                >
                  <Sparkles size={14} color={theme.purple} />
                  {analysisStatus === "loading" ? "Analyzing..." : "Analyze my work"}
                </button>
              </div>

              {lastSnapshotInfo && (
                <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 6, textAlign: "right" }}>
                  {lastSnapshotInfo}
                </div>
              )}

              {analysisStatus === "error" && (
                <div
                  style={{
                    marginTop: 18,
                    border: "1px solid #EEDCB6",
                    background: theme.amberSoft,
                    borderRadius: 10,
                    padding: 16,
                    fontSize: 13,
                    color: theme.text,
                    lineHeight: 1.5,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: theme.amber, marginBottom: 6 }}>
                    <AlertTriangle size={13} />
                    Analysis unavailable
                  </div>
                  {analysisError}
                </div>
              )}

              {analysisStatus === "success" && analysis && (
                <div
                  style={{
                    marginTop: 18,
                    border: `1px solid ${insightCardTone.border}`,
                    background: theme.purpleSoft,
                    borderRadius: 10,
                    padding: 16,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13, color: insightCardTone.accent, marginBottom: 10 }}>
                      <Sparkles size={13} />
                      AI learning insight
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>
                    Our analysis: {analysis.misconception}
                  </div>
                  <div style={{ fontSize: 13, color: theme.textMuted, lineHeight: 1.6, marginBottom: 10 }}>
                    {analysis.explanation}
                  </div>
                  {analysis.strengths?.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      {analysis.strengths.map((s) => (
                        <div
                          key={s}
                          style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: theme.green, marginBottom: 4 }}
                        >
                          <CheckCircle2 size={13} style={{ marginTop: 1, flexShrink: 0 }} />
                          <span>{s}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {analysis.adaptationNote && (
                    <div
                      style={{
                        background: "#fff",
                        border: `1px solid ${theme.border}`,
                        borderRadius: 8,
                        padding: "10px 12px",
                        fontSize: 12,
                        lineHeight: 1.6,
                        marginBottom: 10,
                      }}
                    >
                      <span style={{ color: theme.textMuted }}>Next adaptation: </span>
                      {analysis.adaptationNote}
                    </div>
                  )}
                  <div
                    style={{
                      background: "#fff",
                      border: `1px solid ${theme.border}`,
                      borderRadius: 8,
                      padding: "10px 12px",
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: theme.textMuted }}>Suggested question: </span>
                    "{analysis.suggestedQuestion}"
                  </div>
                  {currentAnalysisSkillBreakdown.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>
                        Focus skill map
                      </div>
                      <div
                        style={{
                          background: "#fff",
                          border: `1px solid ${theme.border}`,
                          borderRadius: 8,
                          padding: "10px 12px",
                        }}
                      >
                        {currentAnalysisSkillBreakdown.slice(0, 3).map((item) => (
                          <div key={`${item.skill}-${item.status}`} style={{ marginBottom: 10, lineHeight: 1.55 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>{item.skill}</div>
                              <div style={{ fontSize: 11, color: item.status === "solid" ? theme.green : theme.amber }}>
                                {item.status.replace(/-/g, " ")}
                              </div>
                            </div>
                            <div style={{ fontSize: 12, color: theme.textMuted }}>{item.evidence}</div>
                            <div style={{ fontSize: 12, marginTop: 4 }}>Tutor move: {item.tutorMove}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {analysis.learningPath?.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>
                        Guided learning path
                      </div>
                      <div
                        style={{
                          background: "#fff",
                          border: `1px solid ${theme.border}`,
                          borderRadius: 8,
                          padding: "10px 12px",
                        }}
                      >
                        {analysis.learningPath.map((step, index) => (
                          <div
                            key={`${index}-${step}`}
                            style={{
                              display: "flex",
                              gap: 8,
                              fontSize: 12,
                              color: theme.text,
                              lineHeight: 1.6,
                              marginBottom: index === analysis.learningPath.length - 1 ? 0 : 6,
                            }}
                          >
                            <span style={{ color: theme.purple, fontFamily: fontMono }}>{index + 1}.</span>
                            <span>{step}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {currentTargetedPractice.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>
                        Targeted practice queue
                      </div>
                      {currentTargetedPractice.slice(0, 3).map((item) => (
                        <div
                          key={`${item.title}-${item.prompt}`}
                          style={{
                            background: "#fff",
                            border: `1px solid ${theme.border}`,
                            borderRadius: 8,
                            padding: "10px 12px",
                            marginBottom: 8,
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{item.title}</div>
                          <div style={{ fontSize: 12, lineHeight: 1.55, marginBottom: 4 }}>{item.prompt}</div>
                          <div style={{ fontSize: 11, color: theme.textMuted }}>{item.reason}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {analysis.nextSteps?.length > 0 && (
                    <div style={{ marginTop: 10, fontSize: 12, color: theme.textMuted, lineHeight: 1.7 }}>
                      {analysis.nextSteps.map((step) => (
                        <div key={step}>&#8594; {step}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <ScreenShareView />
          )}
        </Panel>

        {/* RIGHT: AI Mentor */}
        <Panel title={null} noPad>
          <div style={{ display: "flex", borderBottom: `1px solid ${theme.border}` }}>
            <TabButton active={mentorTab === "insights"} onClick={() => setMentorTab("insights")}>Insights</TabButton>
            <TabButton active={mentorTab === "profile"} onClick={() => setMentorTab("profile")}>Profile</TabButton>
            <TabButton active={mentorTab === "recs"} onClick={() => setMentorTab("recs")}>For tutor</TabButton>
          </div>

          <div style={{ padding: 16 }}>
            {mentorTab === "insights" && (
              <div>
                <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 10 }}>Cross-session insights</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                  <MetricCard label="Sessions" value={studentStats.totalSessions} />
                  <MetricCard label="Analyses" value={studentStats.totalAnalyses} />
                  <MetricCard
                    label="Trend"
                    value={studentStats.trend.label}
                    tone={studentStats.trend.tone}
                    style={{ gridColumn: "1 / -1" }}
                  />
                </div>

                {studentStats.totalAnalyses === 0 ? (
                  <EmptyStateCard text="Run “Analyze my work” to start building persistent insights for this student." />
                ) : (
                  <>
                    {effectiveProfile.latestLessonRecap && (
                      <div
                        style={{
                          marginBottom: 12,
                          background: "#F7F6F1",
                          border: `1px solid ${theme.border}`,
                          borderRadius: 8,
                          padding: 12,
                        }}
                      >
                        <div style={{ fontSize: 12, color: theme.textMuted, fontWeight: 600, marginBottom: 6 }}>
                          Tutor memory recap
                        </div>
                        <div style={{ fontSize: 13, lineHeight: 1.55, marginBottom: effectiveProfile.conversationSignals?.length ? 8 : 0 }}>
                          {effectiveProfile.latestLessonRecap}
                        </div>
                        {(effectiveProfile.conversationSignals || []).slice(0, 3).map((signal) => (
                          <div key={signal} style={{ fontSize: 12, color: theme.textMuted, lineHeight: 1.6 }}>
                            &#8594; {signal}
                          </div>
                        ))}
                      </div>
                    )}

                    {analysis && (
                      <div
                        style={{
                          marginBottom: 12,
                          background: theme.purpleSoft,
                          border: "1px solid #DDD7F9",
                          borderRadius: 8,
                          padding: 12,
                        }}
                      >
                        <div style={{ fontSize: 12, color: "#4A3FA3", fontWeight: 600, marginBottom: 4 }}>
                          Latest AI signal
                        </div>
                        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                          {analysis.explanation}
                        </div>
                      </div>
                    )}

                    {studentStats.topStrengths[0] && (
                      <InsightRow ok text={`Recurring strength: ${studentStats.topStrengths[0].label}`} />
                    )}
                    {studentStats.topMisconceptions[0] && (
                      <InsightRow text={`Recurring misconception: ${studentStats.topMisconceptions[0].label}`} />
                    )}
                    {studentStats.strongestSubject && (
                      <InsightRow
                        ok
                        text={`Strongest subject so far: ${studentStats.strongestSubject.subject} (${studentStats.strongestSubject.masteryPct}%)`}
                      />
                    )}
                    {studentStats.supportSubject &&
                      studentStats.supportSubject.subject !== studentStats.strongestSubject?.subject && (
                        <InsightRow
                          text={`Needs the most support: ${studentStats.supportSubject.subject} (${studentStats.supportSubject.masteryPct}%)`}
                        />
                      )}
                  </>
                )}
              </div>
            )}

            {mentorTab === "profile" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        background: theme.purpleSoft,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: theme.purple,
                      }}
                    >
                      <User size={15} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{displayStudentName}</div>
                      <div style={{ fontSize: 12, color: theme.textMuted }}>
                        {studentStats.totalSessions} sessions logged &middot; {studentStats.totalAnalyses} analyses
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => refreshProfile(undefined, { force: true })}
                    disabled={profileStatus === "loading" || !studentStats.totalAnalyses}
                    style={{
                      border: `1px solid ${theme.border}`,
                      background: "#fff",
                      borderRadius: 8,
                      padding: "6px 10px",
                      fontSize: 12,
                      color: theme.text,
                      cursor:
                        profileStatus === "loading" || !studentStats.totalAnalyses ? "not-allowed" : "pointer",
                      opacity: profileStatus === "loading" || !studentStats.totalAnalyses ? 0.6 : 1,
                    }}
                  >
                    {profileStatus === "loading" ? "Refreshing..." : "Refresh"}
                  </button>
                </div>

                {studentStats.totalAnalyses === 0 ? (
                  <EmptyStateCard text="Once this student has a few saved analyses, MentorAI will build a profile here." />
                ) : (
                  <>
                    <div
                      style={{
                        background: "#F7F6F1",
                        border: `1px solid ${theme.border}`,
                        borderRadius: 10,
                        padding: 12,
                        fontSize: 13,
                        lineHeight: 1.55,
                        marginBottom: 12,
                      }}
                    >
                      {effectiveProfile.summary}
                    </div>

                    {effectiveProfile.latestLessonRecap && (
                      <div
                        style={{
                          background: "#fff",
                          border: `1px solid ${theme.border}`,
                          borderRadius: 10,
                          padding: 12,
                          fontSize: 13,
                          lineHeight: 1.55,
                          marginBottom: 12,
                        }}
                      >
                        <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>Latest lesson memory</div>
                        <div>{effectiveProfile.latestLessonRecap}</div>
                      </div>
                    )}

                    {profileError && (
                      <div style={{ fontSize: 11, color: theme.amber, marginBottom: 12 }}>
                        Couldn’t refresh the AI profile just now. Showing the saved local summary instead.
                      </div>
                    )}

                    {(effectiveProfile.subjectProfiles?.length || studentStats.subjectStats.length > 0) && (
                      <>
                        <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 8 }}>Subject mastery</div>
                        {(effectiveProfile.subjectProfiles?.length
                          ? effectiveProfile.subjectProfiles
                          : studentStats.subjectStats
                        )
                          .slice(0, 4)
                          .map((subjectProfile) => (
                            <MasteryBar
                              key={subjectProfile.subject}
                              label={subjectProfile.subject}
                              pct={subjectProfile.masteryPct}
                              color={subjectProfile.masteryPct >= 70 ? theme.green : theme.amber}
                            />
                          ))}
                      </>
                    )}

                    <div style={{ marginTop: 14, fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>
                      Learning preferences
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                      {(effectiveProfile.learningStyle || []).slice(0, 3).map((item) => (
                        <div key={item}>&#10003; {item}</div>
                      ))}
                    </div>

                    {(effectiveProfile.conversationSignals || []).length > 0 && (
                      <>
                        <div style={{ marginTop: 14, fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>
                          Conversation signals
                        </div>
                        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                          {(effectiveProfile.conversationSignals || []).slice(0, 3).map((item) => (
                            <div key={item}>&#10003; {item}</div>
                          ))}
                        </div>
                      </>
                    )}

                    <div style={{ marginTop: 14, fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>
                      Observed strengths
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                      {(effectiveProfile.strengths || []).slice(0, 3).map((item) => (
                        <div key={item}>&#10003; {item}</div>
                      ))}
                    </div>

                    {effectiveProfile.reviewVideoBrief?.summary && (
                      <>
                        <div style={{ marginTop: 14, fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>
                          AI review video brief
                        </div>
                        <div
                          style={{
                            background: "#fff",
                            border: `1px solid ${theme.border}`,
                            borderRadius: 10,
                            padding: 12,
                            fontSize: 13,
                            lineHeight: 1.6,
                          }}
                        >
                          <div style={{ fontWeight: 600, marginBottom: 6 }}>
                            {effectiveProfile.reviewVideoBrief.title || `${displayStudentName} lesson review`}
                          </div>
                          <div style={{ marginBottom: 8 }}>{effectiveProfile.reviewVideoBrief.summary}</div>
                          {(effectiveProfile.reviewVideoBrief.beats || []).slice(0, 3).map((beat) => (
                            <div key={beat} style={{ color: theme.textMuted }}>
                              &#8594; {beat}
                            </div>
                          ))}
                          {effectiveProfile.reviewVideoBrief.closingTakeaway && (
                            <div style={{ marginTop: 8, color: theme.text }}>
                              {effectiveProfile.reviewVideoBrief.closingTakeaway}
                            </div>
                          )}
                        </div>
                      </>
                    )}

                  </>
                )}
              </div>
            )}

            {mentorTab === "recs" && (
              <div>
                {studentStats.totalAnalyses === 0 && !assignment ? (
                  <EmptyStateCard text="MentorAI will generate tutor recommendations after the first saved analysis." />
                ) : (
                  <>
                    <div
                      style={{
                        border: `1px solid ${theme.border}`,
                        borderRadius: 10,
                        padding: 12,
                        background: "#fff",
                        marginBottom: 12,
                      }}
                    >
                      <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>AI tutor practice tools</div>
                      <div style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 10 }}>
                        Build a shared review, quiz, and exercise set from the latest guided learning path. It appears after you generate it here.
                      </div>
                      <button
                        onClick={handleAssignSuggestedReview}
                        disabled={!assignmentSourceAnalysis}
                        style={{
                          border: "none",
                          background: theme.navy,
                          color: "#fff",
                          borderRadius: 8,
                          padding: "10px 12px",
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: assignmentSourceAnalysis ? "pointer" : "not-allowed",
                          opacity: assignmentSourceAnalysis ? 1 : 0.6,
                        }}
                      >
                        Generate suggested review
                      </button>
                    </div>

                    {assignment && (
                      <div
                        style={{
                          border: "1px solid #DDD7F9",
                          borderRadius: 10,
                          padding: 12,
                          background: theme.purpleSoft,
                          marginBottom: 12,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: theme.navy }}>{assignment.title}</div>
                            <div style={{ fontSize: 12, color: "#4A3FA3", marginTop: 2 }}>{assignment.summary}</div>
                          </div>
                          <div style={{ fontSize: 11, color: "#4A3FA3", fontFamily: fontMono }}>Live on both screens</div>
                        </div>

                        {assignment.learningPath?.length > 0 && (
                          <div
                            style={{
                              background: "#fff",
                              border: `1px solid ${theme.border}`,
                              borderRadius: 8,
                              padding: "10px 12px",
                              marginBottom: 10,
                            }}
                          >
                            <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 6 }}>Guided learning path</div>
                            {assignment.learningPath.map((step, index) => (
                              <div key={`${index}-${step}`} style={{ fontSize: 12, lineHeight: 1.6, marginBottom: index === assignment.learningPath.length - 1 ? 0 : 6 }}>
                                <span style={{ color: theme.purple, fontFamily: fontMono }}>{index + 1}.</span>{" "}
                                {step}
                              </div>
                            ))}
                          </div>
                        )}

                        {(assignment.items || []).map((item) => (
                          <div
                            key={item.id}
                            style={{
                              background: getReviewGradeTone(assignment.grades?.[item.id]).background,
                              border: `1px solid ${getReviewGradeTone(assignment.grades?.[item.id]).border}`,
                              borderRadius: 8,
                              padding: 12,
                              marginBottom: 10,
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                              <div style={{ fontSize: 12, fontWeight: 600 }}>{item.kind}</div>
                              <div style={{ fontSize: 11, color: theme.textMuted }}>Student + AI tutor</div>
                            </div>
                            <div style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 8 }}>{item.prompt}</div>
                            <div style={{ fontSize: 11, color: theme.textMuted, lineHeight: 1.5, marginBottom: 8 }}>
                              {item.coachNote}
                            </div>

                            <textarea
                              value={assignment.responses?.[item.id] || ""}
                              onChange={(e) => updateResponse(item.id, e.target.value)}
                              placeholder="Type your response here..."
                              style={{
                                width: "100%",
                                minHeight: 72,
                                border: `1px solid ${theme.border}`,
                                borderRadius: 8,
                                padding: "10px 12px",
                                fontSize: 13,
                                fontFamily: fontBody,
                                resize: "vertical",
                                outline: "none",
                                background: "#fff",
                                boxSizing: "border-box",
                              }}
                            />

                            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                              <button
                                onClick={() => handleSubmitReviewAnswer(item)}
                                disabled={!String(assignment.responses?.[item.id] || "").trim() || assignment.submissionStatus?.[item.id] === "submitting"}
                                style={{
                                  border: "none",
                                  background: theme.navy,
                                  color: "#fff",
                                  borderRadius: 8,
                                  padding: "8px 12px",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: !String(assignment.responses?.[item.id] || "").trim() || assignment.submissionStatus?.[item.id] === "submitting" ? "not-allowed" : "pointer",
                                  opacity: !String(assignment.responses?.[item.id] || "").trim() || assignment.submissionStatus?.[item.id] === "submitting" ? 0.6 : 1,
                                }}
                              >
                                {assignment.submissionStatus?.[item.id] === "submitting" ? "Analyzing..." : "Submit answer"}
                              </button>

                              {assignment.feedback?.[item.id]?.submittedAt && (
                                <div style={{ fontSize: 11, color: theme.textMuted }}>
                                  Checked {new Date(assignment.feedback[item.id].submittedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                                </div>
                              )}
                            </div>

                            {assignment.feedback?.[item.id] && (
                              <div
                                style={{
                                  marginTop: 10,
                                  background: assignment.feedback[item.id].verdict === "pass" ? theme.greenSoft : theme.redSoft,
                                  border: `1px solid ${assignment.feedback[item.id].verdict === "pass" ? theme.greenLight : theme.red}`,
                                  borderRadius: 8,
                                  padding: "10px 12px",
                                }}
                              >
                                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: assignment.feedback[item.id].verdict === "pass" ? theme.green : theme.red }}>
                                  {assignment.feedback[item.id].verdict === "pass" ? "Answer looks good" : "Why this needs another try"}
                                </div>
                                <div style={{ fontSize: 12, lineHeight: 1.6, marginBottom: assignment.feedback[item.id].nextStep ? 8 : 0 }}>
                                  {assignment.feedback[item.id].explanation}
                                </div>
                                {assignment.feedback[item.id].nextStep && (
                                  <div style={{ fontSize: 11, color: theme.textMuted, lineHeight: 1.5 }}>
                                    Next step: {assignment.feedback[item.id].nextStep}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    <div
                      style={{
                        background: theme.amberSoft,
                        border: "1px solid #EEDCB6",
                        borderRadius: 8,
                        padding: 12,
                        marginBottom: 12,
                      }}
                    >
                      <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, fontWeight: 600, color: theme.amber, marginBottom: 6 }}>
                        <AlertTriangle size={13} />
                        Repeated pattern
                      </div>
                      <div style={{ fontSize: 13, color: theme.text }}>
                        {repeatedFocusSkill
                          ? `${displayStudentName} most often needs support around ${String(repeatedFocusSkill).toLowerCase()}.`
                          : `MentorAI is still looking for a repeated misconception for ${displayStudentName}.`}
                      </div>
                    </div>

                    <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>Suggested action</div>
                    <div style={{ fontSize: 13, marginBottom: 14 }}>
                      {analysis?.adaptationNote || analysis?.suggestedQuestion || nextSessionPlan[0] || effectiveProfile.recommendedTutorMoves?.[0] || "Capture another analysis for a tailored tutor move."}
                    </div>

                    {analysis?.learningPath?.length > 0 && (
                      <>
                        <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>Simple learning path</div>
                        <div
                          style={{
                            border: `1px solid ${theme.border}`,
                            borderRadius: 8,
                            padding: "10px 12px",
                            fontSize: 12,
                            marginBottom: 14,
                            background: "#fff",
                          }}
                        >
                          {analysis.learningPath.map((step, index) => (
                            <div key={`${index}-${step}`} style={{ marginBottom: index === analysis.learningPath.length - 1 ? 0 : 6, lineHeight: 1.6 }}>
                              <span style={{ color: theme.purple, fontFamily: fontMono }}>{index + 1}.</span>{" "}
                              {step}
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {latestTargetedPractice.length > 0 && (
                      <>
                        <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>Personalized practice</div>
                        {latestTargetedPractice.slice(0, 3).map((item) => (
                          <div
                            key={`${item.title}-${item.prompt}`}
                            style={{
                              border: `1px solid ${theme.border}`,
                              borderRadius: 8,
                              padding: "10px 12px",
                              fontSize: 13,
                              background: "#fff",
                              marginBottom: 10,
                            }}
                          >
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>{item.title}</div>
                            <div style={{ lineHeight: 1.55, marginBottom: 4 }}>{item.prompt}</div>
                            <div style={{ fontSize: 11, color: theme.textMuted }}>{item.reason}</div>
                          </div>
                        ))}
                      </>
                    )}

                    <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>Recommended activity</div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        border: `1px solid ${theme.border}`,
                        borderRadius: 8,
                        padding: "10px 12px",
                        fontSize: 13,
                      }}
                    >
                      {studentStats.supportSubject
                        ? `10-minute ${studentStats.supportSubject.subject.toLowerCase()} spiral review`
                        : `10-minute ${displaySubject.toLowerCase()} warm-up`}
                      <ChevronRight size={14} color={theme.textMuted} />
                    </div>

                    {(effectiveProfile.recommendedTutorMoves || []).slice(1, 3).map((move) => (
                      <div key={move} style={{ marginTop: 10, fontSize: 12, color: theme.textMuted, lineHeight: 1.6 }}>
                        &#8594; {move}
                      </div>
                    ))}

                    {evolutionLoop && (
                      <div
                        style={{
                          marginTop: 12,
                          background: "#F7F6F1",
                          border: `1px solid ${theme.border}`,
                          borderRadius: 8,
                          padding: 12,
                          fontSize: 12,
                          color: theme.textMuted,
                          lineHeight: 1.6,
                        }}
                      >
                        {evolutionLoop}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default function MentorAIDemo() {
  if (!streamClient || !call) {
    return <MissingStreamConfiguration />;
  }

  return (
    <StreamVideo client={streamClient}>
      <StreamCall call={call}>
        <MentorAIDemoInner />
      </StreamCall>
    </StreamVideo>
  );
}

function MissingStreamConfiguration() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: theme.bg,
        color: theme.text,
        fontFamily: fontBody,
      }}
    >
      <div
        style={{
          maxWidth: 560,
          padding: 28,
          background: theme.card,
          border: `1px solid ${theme.border}`,
          borderRadius: 12,
        }}
      >
        <h1 style={{ margin: "0 0 12px", fontSize: 22 }}>Video setup required</h1>
        <p style={{ margin: 0, color: theme.textMuted, lineHeight: 1.5 }}>
          Add <code>VITE_STREAM_API_KEY</code> and <code>VITE_STREAM_TOKEN</code> to your local
          <code> .env</code> file, then restart the development server. The app will not attempt to
          join a video call until those values are available.
        </p>
      </div>
    </div>
  );
}

function Panel({ title, children, noPad }) {
  return (
    <div
      style={{
        background: theme.card,
        border: `1px solid ${theme.border}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {title && (
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${theme.border}`, fontSize: 13, fontWeight: 500 }}>
          {title}
        </div>
      )}
      <div style={{ padding: noPad ? 0 : 16 }}>{children}</div>
    </div>
  );
}

function MetricCard({ label, value, tone = "muted", style }) {
  const toneColor = tone === "good" ? theme.green : tone === "warn" ? theme.amber : theme.navy;

  return (
    <div
      style={{
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
        padding: "10px 12px",
        background: "#fff",
        ...style,
      }}
    >
      <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: toneColor }}>{value}</div>
    </div>
  );
}

function EmptyStateCard({ text }) {
  return (
    <div
      style={{
        border: `1px dashed ${theme.border}`,
        borderRadius: 8,
        padding: 14,
        fontSize: 13,
        color: theme.textMuted,
        lineHeight: 1.5,
        background: "#FCFBF8",
      }}
    >
      {text}
    </div>
  );
}

function SmallIconBtn({ children, onClick, active, disabled, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        border: `1px solid ${active ? theme.purple : theme.border}`,
        background: active ? theme.purpleSoft : "#fff",
        color: disabled ? "#C9C7BE" : active ? theme.purple : theme.textMuted,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );
}

function InsightRow({ ok, text }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 13 }}>
      {ok ? <CheckCircle2 size={15} color={theme.green} /> : <AlertTriangle size={15} color={theme.amber} />}
      <span>{text}</span>
    </div>
  );
}
