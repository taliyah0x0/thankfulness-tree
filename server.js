import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { handleApi } from "./lib/tree.js";

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = join(import.meta.dirname, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

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

createServer((req, res) => {
  if (req.url.startsWith("/api/")) return handleApi(req, res);
  if (req.method === "GET") return serveStatic(req, res);
  res.writeHead(405).end("Method not allowed");
}).listen(PORT, () => console.log(`Thankfulness tree growing at http://localhost:${PORT}`));
