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

function cleanText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function buildFallbackProblem(subject) {
  const topic = cleanText(subject, "algebra").toLowerCase();

  if (/(distribut|expand|parenthes)/.test(topic)) {
    return "Distribute and simplify: -3(2x - 5) + 4";
  }

  if (/(like term|combine)/.test(topic)) {
    return "Combine like terms: 4x + 7 - 2x + 5";
  }

  if (/(fraction|denominator|numerator)/.test(topic)) {
    return "Add the fractions: 3/4 + 2/3";
  }

  if (/(equation|solve|isolate)/.test(topic)) {
    return "Solve for x: 3x - 7 = 11";
  }

  if (/(slope|coordinate|graph)/.test(topic)) {
    return "Find the slope between (2, 5) and (6, 13).";
  }

  if (/(exponent|power|squared|cubed)/.test(topic)) {
    return "Simplify: (2x^3)(3x^2)";
  }

  if (/(quadratic|factor)/.test(topic)) {
    return "Factor completely: x^2 + 7x + 12";
  }

  return "Solve for x: 2(x + 4) - 3 = 11";
}

async function generateProblem(subject) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      problem: buildFallbackProblem(subject),
      source: "fallback",
    };
  }

  const prompt = [
    "You are generating exactly one short live tutoring problem for a student whiteboard demo.",
    "Return compact JSON only with this shape:",
    '{"problem":"one problem only"}',
    "",
    `Subject: ${cleanText(subject, "algebra")}`,
    "",
    "Rules:",
    "- Generate exactly one problem, not a list.",
    "- Do not include the solution.",
    "- Keep it concise enough to fit in a single problem input field.",
    "- Use concrete live values and symbols.",
    "- Stay tightly relevant to the subject provided.",
    "- Do not mention presets, templates, options, or explanations.",
  ].join("\n");

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
    throw new Error(data?.error?.message || "Problem generation failed");
  }

  const content = data?.choices?.[0]?.message?.content;
  const parsed = content ? JSON.parse(content) : {};

  return {
    problem: cleanText(parsed?.problem, buildFallbackProblem(subject)),
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

  const subject = cleanText(body?.subject);
  if (!subject) {
    return sendJson(res, 400, { error: "subject is required" });
  }

  try {
    const result = await generateProblem(subject);
    return sendJson(res, 200, result);
  } catch (error) {
    return sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Problem generation failed",
    });
  }
}
