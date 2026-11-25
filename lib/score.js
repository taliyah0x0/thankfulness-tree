import { randomUUID } from "node:crypto";

const API_KEY = process.env.PANGRAM_API_KEY;
const PANGRAM = "https://text.external-api.pangram.com";

const validShape = (shape) =>
  Array.isArray(shape?.points) &&
  shape.points.length === 21 &&
  shape.points.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isFinite(n) && n >= -20 && n <= 140)) &&
  Number.isFinite(shape.w) && shape.w > 0 && shape.w <= 40;

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
};

const readBody = async (req) => {
  if (req.body !== undefined) return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {};
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error("Body too large");
  }
  return JSON.parse(raw || "{}");
};

const scoreWithPangram = async (text) => {
  const headers = { "Content-Type": "application/json", "x-api-key": API_KEY };
  const created = await fetch(`${PANGRAM}/task`, { method: "POST", headers, body: JSON.stringify({ text, model: "pangram-4" }) });
  if (!created.ok) throw new Error(`Pangram rejected the request (${created.status})`);
  const { task_id } = await created.json();

  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((r) => setTimeout(r, 1000));
    const poll = await fetch(`${PANGRAM}/task/${task_id}`, { headers });
    if (!poll.ok) continue;
    const result = await poll.json();
    if (result.stage === "STAGE_FAILED") throw new Error("Pangram could not score this one");
    if (result.stage !== "STAGE_SUCCESS") continue;
    return {
      human: Math.round(result.fraction_human * 100),
      headline: result.headline,
      confidence: result.windows?.[0]?.confidence ?? null,
    };
  }
  throw new Error("Pangram took too long to answer");
};

const handleScore = async (req, res) => {
  if (!API_KEY) return send(res, 503, { error: "The server is missing PANGRAM_API_KEY." });
  const { gratitude, shape } = await readBody(req);
  if (!validShape(shape)) return send(res, 400, { error: "Capture your hand first so we can shape your leaf!" });
  const cleaned = String(gratitude ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (cleaned.length < 2) return send(res, 400, { error: "Tell us what you're thankful for first!" });

  const score = await scoreWithPangram(`I am thankful for ${cleaned}`);
  const leaf = {
    id: randomUUID(),
    gratitude: cleaned,
    ...score,
    shape: { points: shape.points.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]), w: Math.round(shape.w * 10) / 10 },
    createdAt: Date.now(),
  };
  send(res, 200, leaf);
};

export const handleApi = async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const route = url.searchParams.get("route");
    const path = route == null ? url.pathname : `/api/${route}`;
    if (path === "/api/score" && req.method === "POST") return await handleScore(req, res);
    send(res, 404, { error: "Not found" });
  } catch (err) {
    send(res, 502, { error: err.message });
  }
};
