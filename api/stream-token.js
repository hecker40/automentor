import crypto from "node:crypto";

const base64Url = (value) => Buffer.from(value).toString("base64url");

function createUserToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ user_id: userId, iat: now, exp: now + 60 * 60 })
  );
  const signature = crypto
    .createHmac("sha256", process.env.STREAM_API_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.STREAM_API_SECRET) {
    return res.status(500).json({ error: "Video service is not configured." });
  }

  const userId = String(req.query.userId || "");
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(userId)) {
    return res.status(400).json({ error: "Invalid video user id." });
  }

  return res.status(200).json({ token: createUserToken(userId) });
}
