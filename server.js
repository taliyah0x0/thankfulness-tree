import { createServer } from "node:http";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.PANGRAM_API_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const PANGRAM = "https://text.external-api.pangram.com";
const PUBLIC_DIR = join(import.meta.dirname, "public");
const DATA_FILE = join(import.meta.dirname, "data", "leaves.json");
const MAX_LEAVES = 17;
const PENDING_TTL_MS = 30 * 60 * 1000;
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

let leaves = [];
try {
  leaves = JSON.parse(await readFile(DATA_FILE, "utf8"))
    .slice(-MAX_LEAVES)
    .map((leaf, i) => ({ ...leaf, slot: leaf.slot ?? i }));
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}

const pending = new Map();

let saveQueue = Promise.resolve();
const updateLeaves = (update) => {
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    const next = update(leaves);
    await mkdir(join(import.meta.dirname, "data"), { recursive: true });
    const tmp = `${DATA_FILE}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(next));
    await rename(tmp, DATA_FILE);
    leaves = next;
  });
  return saveQueue;
};

const publicLeaf = ({ deleteToken, ...leaf }) => leaf;

const validShape = (shape) =>
  Array.isArray(shape?.points) &&
  shape.points.length === 21 &&
  shape.points.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isFinite(n) && n >= -20 && n <= 140)) &&
  Number.isFinite(shape.w) && shape.w > 0 && shape.w <= 40;

const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const readBody = async (req) => {
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
  for (const [id, old] of pending) if (Date.now() - old.createdAt > PENDING_TTL_MS) pending.delete(id);
  pending.set(leaf.id, leaf);
  send(res, 200, leaf);
};

const handleHang = async (req, res) => {
  const { id } = await readBody(req);
  const leaf = pending.get(id);
  if (!leaf) return send(res, 404, { error: "That leaf blew away. Try growing it again!" });
  pending.delete(id);
  let hung;
  try {
    await updateLeaves((current) => {
      const kept = current.length >= MAX_LEAVES ? current.slice(current.length - MAX_LEAVES + 1) : current;
      const used = new Set(kept.map((l) => l.slot));
      let slot = 0;
      while (used.has(slot)) slot++;
      hung = { ...leaf, slot, deleteToken: randomUUID() };
      return [...kept, hung];
    });
  } catch (err) {
    pending.set(id, leaf);
    throw err;
  }
  send(res, 200, hung);
};

const handleDelete = async (req, res, id) => {
  const leaf = leaves.find((l) => l.id === id);
  if (!leaf) return send(res, 404, { error: "That leaf already fell off." });
  const isOwner = Boolean(leaf.deleteToken) && req.headers["x-delete-token"] === leaf.deleteToken;
  const isAdmin = Boolean(ADMIN_TOKEN) && req.headers["x-admin-token"] === ADMIN_TOKEN;
  if (!isOwner && !isAdmin) return send(res, 403, { error: "Only the person who hung this leaf can remove it." });
  await updateLeaves((current) => current.filter((l) => l.id !== id));
  send(res, 200, { ok: true });
};

const serveStatic = async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\.])+/, "");
  try {
    const file = await readFile(join(PUBLIC_DIR, path || "index.html"));
    res.writeHead(200, { "Content-Type": MIME[extname(path || "index.html")] ?? "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404).end("Not found");
  }
};

createServer(async (req, res) => {
  try {
    if (req.url === "/api/leaves" && req.method === "GET") return send(res, 200, leaves.map(publicLeaf));
    const deleteMatch = req.method === "DELETE" && req.url.match(/^\/api\/leaves\/([\w-]+)$/);
    if (deleteMatch) return await handleDelete(req, res, deleteMatch[1]);
    if (req.url === "/api/leaves" && req.method === "POST") return await handleHang(req, res);
    if (req.url === "/api/score" && req.method === "POST") return await handleScore(req, res);
    if (req.method === "GET") return await serveStatic(req, res);
    send(res, 405, { error: "Method not allowed" });
  } catch (err) {
    send(res, 502, { error: err.message });
  }
}).listen(PORT, () => console.log(`Thankfulness tree growing at http://localhost:${PORT}`));
