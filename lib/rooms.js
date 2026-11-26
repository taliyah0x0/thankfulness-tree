import { randomUUID } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { mergeRooms } from "../public/tree-sync.js";

// Rooms are saved so their trees outlast everyone closing the tab.
// On Vercel they live in Upstash Redis; locally (without Redis settings) in data/rooms.json.
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const ROOM_TTL_SECONDS = 60 * 60 * 24 * 90;
const DATA_DIR = join(import.meta.dirname, "..", "data");
const DATA_FILE = join(DATA_DIR, "rooms.json");
const EMPTY = { leaves: [], removed: [] };

export const validCode = (code) => typeof code === "string" && /^[A-Z0-9]{5,8}$/.test(code);

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

// Load a room and its version together, then only save if nobody else saved in between.
const LOAD = "return { redis.call('GET', KEYS[1]) or '', redis.call('GET', KEYS[2]) or '0' }";
const COMMIT =
  "if (redis.call('GET', KEYS[2]) or '0') ~= ARGV[1] then return 0 end " +
  "redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]) redis.call('INCR', KEYS[2]) redis.call('EXPIRE', KEYS[2], ARGV[3]) return 1";
const keys = (code) => [`thankful:room:${code}`, `thankful:room:${code}:v`];

const redisStore = {
  async load(code) {
    const [[raw, version]] = await redis([["EVAL", LOAD, "2", ...keys(code)]]);
    return { room: raw ? JSON.parse(raw) : EMPTY, version };
  },
  async commit(code, room, version) {
    const [ok] = await redis([["EVAL", COMMIT, "2", ...keys(code), String(version), JSON.stringify(room), String(ROOM_TTL_SECONDS)]]);
    return ok === 1;
  },
};

let fileRooms = null;
const fileStore = {
  async load(code) {
    if (!fileRooms) {
      try {
        fileRooms = JSON.parse(await readFile(DATA_FILE, "utf8"));
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
        fileRooms = {};
      }
    }
    const room = fileRooms[code] ?? EMPTY;
    return { room, version: room };
  },
  async commit(code, room, version) {
    if ((fileRooms[code] ?? EMPTY) !== version) return false;
    fileRooms = { ...fileRooms, [code]: room };
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(fileRooms));
    await rename(tmp, DATA_FILE);
    return true;
  },
};

const store = REDIS_URL && REDIS_TOKEN ? redisStore : fileStore;

export const loadRoom = async (code) => (await store.load(code)).room;

export const saveRoom = async (code, incoming) => {
  for (let attempt = 0; attempt < 10; attempt++) {
    const { room, version } = await store.load(code);
    const next = mergeRooms(room, incoming);
    if (await store.commit(code, next, version)) return next;
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 60 * (attempt + 1)));
  }
  throw new Error("The room is busy, try again");
};
