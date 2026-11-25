import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { MAX_TREE, SPOTS, clampPosition, pickSpot } from "../public/tree-layout.js";

const API_KEY = process.env.PANGRAM_API_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const SIGNING_SECRET = process.env.LEAF_SECRET || API_KEY || "";
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const PANGRAM = "https://text.external-api.pangram.com";
const DATA_DIR = join(import.meta.dirname, "..", "data");
const DATA_FILE = join(DATA_DIR, "leaves.json");
const LEAVES_KEY = "thankfulness:leaves";
const VERSION_KEY = "thankfulness:version";
const MAX_PILE = 30;
const PENDING_TTL_MS = 30 * 60 * 1000;

const settle = (list) => {
  const onTree = list.filter((l) => !l.fallen);
  const evicted = new Set(onTree.slice(0, Math.max(0, onTree.length - MAX_TREE)).map((l) => l.id));
  const settled = list.map((l) => (evicted.has(l.id) ? { ...l, fallen: true, fallenAt: Date.now() } : l));
  const kept = new Set(settled.filter((l) => l.fallen).sort((a, b) => a.fallenAt - b.fallenAt).slice(-MAX_PILE).map((l) => l.id));
  return settled.filter((l) => !l.fallen || kept.has(l.id));
};

const migrate = (list) => settle(list.map(({ slot, ...leaf }, i) => ({ ...leaf, ...(leaf.x == null && SPOTS[(slot ?? i) % SPOTS.length]) })));

const redis = async (commands) => {
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Storage error (${res.status})`);
  const results = await res.json();
  const failed = results.find((r) => r.error);
  if (failed) throw new Error(`Storage error: ${failed.error}`);
  return results.map((r) => r.result);
};

const LOAD_SCRIPT = "return { redis.call('GET', KEYS[1]) or '', redis.call('GET', KEYS[2]) or '0' }";
const COMMIT_SCRIPT = "if (redis.call('GET', KEYS[2]) or '0') ~= ARGV[1] then return 0 end redis.call('SET', KEYS[1], ARGV[2]) redis.call('INCR', KEYS[2]) return 1";

const redisStore = {
  async load() {
    const [[raw, version]] = await redis([["EVAL", LOAD_SCRIPT, "2", LEAVES_KEY, VERSION_KEY]]);
    return { leaves: raw ? JSON.parse(raw) : [], version };
  },
  async commit(next, version) {
    const [ok] = await redis([["EVAL", COMMIT_SCRIPT, "2", LEAVES_KEY, VERSION_KEY, String(version), JSON.stringify(next)]]);
    return ok === 1;
  },
};

let fileLeaves = null;
let fileQueue = Promise.resolve();
const fileStore = {
  async load() {
    if (!fileLeaves) {
      try {
        fileLeaves = migrate(JSON.parse(await readFile(DATA_FILE, "utf8")));
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
        fileLeaves = [];
      }
    }
    return { leaves: fileLeaves, version: fileLeaves };
  },
  async commit(next, version) {
    if (version !== fileLeaves) return false;
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(next));
    await rename(tmp, DATA_FILE);
    fileLeaves = next;
    return true;
  },
};

const store = REDIS_URL && REDIS_TOKEN ? redisStore : fileStore;

const loadLeaves = async () => (await store.load()).leaves;

const attemptUpdates = async (update) => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const { leaves, version } = await store.load();
    const next = update(leaves);
    if (await store.commit(next, version)) return next;
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 80 * (attempt + 1)));
  }
  throw new Error("The tree is busy, try again in a moment.");
};

const updateLeaves = (update) => {
  if (store === redisStore) return attemptUpdates(update);
  const run = fileQueue.catch(() => {}).then(() => attemptUpdates(update));
  fileQueue = run;
  return run;
};

const publicLeaf = ({ deleteToken, ...leaf }) => leaf;

const sign = (leaf) => createHmac("sha256", SIGNING_SECRET).update(JSON.stringify(leaf)).digest("hex");
const signatureMatches = (leaf, signature) => {
  const expected = Buffer.from(sign(leaf));
  const given = Buffer.from(String(signature ?? ""));
  return expected.length === given.length && timingSafeEqual(expected, given);
};

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
  send(res, 200, { ...leaf, signature: sign(leaf) });
};

const handleHang = async (req, res) => {
  if (!SIGNING_SECRET) return send(res, 503, { error: "The server is missing PANGRAM_API_KEY." });
  const { leaf, signature } = await readBody(req);
  if (!leaf || !signatureMatches(leaf, signature) || Date.now() - leaf.createdAt > PENDING_TTL_MS) {
    return send(res, 404, { error: "That leaf blew away. Try growing it again!" });
  }
  let hung;
  await updateLeaves((current) => {
    if (current.some((l) => l.id === leaf.id)) {
      hung = current.find((l) => l.id === leaf.id);
      return current;
    }
    const onTree = current.filter((l) => !l.fallen);
    const oldest = onTree.length >= MAX_TREE ? onTree[0].id : null;
    const next = current.map((l) => (l.id === oldest ? { ...l, fallen: true, fallenAt: Date.now() } : l));
    hung = { ...leaf, ...pickSpot(next.filter((l) => !l.fallen)), deleteToken: randomUUID() };
    return settle([...next, hung]);
  });
  send(res, 200, hung);
};

const handleMove = async (req, res, id) => {
  const { x, y } = await readBody(req);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return send(res, 400, { error: "Where should the leaf go?" });
  const position = clampPosition(x, y);
  let found = false;
  await updateLeaves((current) => {
    found = false;
    return current.map((l) => {
      if (l.id !== id || l.fallen) return l;
      found = true;
      return { ...l, ...position };
    });
  });
  if (!found) return send(res, 404, { error: "That leaf isn't on the tree anymore." });
  send(res, 200, position);
};

const handleDelete = async (req, res, id) => {
  const leaf = (await loadLeaves()).find((l) => l.id === id);
  if (!leaf) return send(res, 404, { error: "That leaf already fell off." });
  const isOwner = Boolean(leaf.deleteToken) && req.headers["x-delete-token"] === leaf.deleteToken;
  const isAdmin = Boolean(ADMIN_TOKEN) && req.headers["x-admin-token"] === ADMIN_TOKEN;
  if (!isOwner && !isAdmin) return send(res, 403, { error: "Only the person who hung this leaf can remove it." });
  await updateLeaves((current) => current.filter((l) => l.id !== id));
  send(res, 200, { ok: true });
};

export const handleApi = async (req, res) => {
  try {
    if (process.env.VERCEL && store === fileStore) return send(res, 503, { error: "Add Upstash Redis to this Vercel project so the tree can save leaves." });
    const url = new URL(req.url, "http://x");
    const route = url.searchParams.get("route");
    const path = route == null ? url.pathname : `/api/${route}`;
    if (path === "/api/leaves" && req.method === "GET") return send(res, 200, (await loadLeaves()).map(publicLeaf));
    if (path === "/api/leaves" && req.method === "POST") return await handleHang(req, res);
    if (path === "/api/score" && req.method === "POST") return await handleScore(req, res);
    const deleteMatch = req.method === "DELETE" && path.match(/^\/api\/leaves\/([\w-]+)$/);
    if (deleteMatch) return await handleDelete(req, res, deleteMatch[1]);
    const moveMatch = req.method === "POST" && path.match(/^\/api\/leaves\/([\w-]+)\/position$/);
    if (moveMatch) return await handleMove(req, res, moveMatch[1]);
    send(res, 404, { error: "Not found" });
  } catch (err) {
    send(res, 502, { error: err.message });
  }
};
