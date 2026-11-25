import { leafSvg, textBox, normalizeHand, toPixels, drawHand } from "./leaf-shape.js";

const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3";
const HAND_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const FALL_COLORS = ["#e8742b", "#b8322f", "#f2b134", "#d2552b", "#a8572a", "#e39b2d"];
const STOPS = [[0, [139, 117, 96]], [50, [242, 177, 52]], [100, [210, 64, 42]]];
const SPOTS = [
  [50, 25], [33, 38], [67, 38], [41, 12], [59, 12], [16, 25], [84, 25], [50, 50],
  [25, 51], [75, 51], [33, 25], [67, 25], [8, 38], [92, 38], [42, 38], [58, 38], [16, 51],
].map(([x, y]) => ({ x, y: y + 4 }));
const TOKENS_KEY = "thankful-leaf-tokens";

const $ = (id) => document.getElementById(id);
const form = $("form"), input = $("gratitude"), submit = $("submit");
const bigLeaf = $("bigLeaf"), result = $("result"), errorEl = $("error"), hang = $("hang");
const leavesEl = $("leaves"), popover = $("popover");
const camera = $("camera"), video = $("video"), overlay = $("overlay"), camHint = $("camHint");
const camStart = $("camStart"), camProgress = $("camProgress"), captured = $("captured"), retake = $("retake");
const playToggle = $("playToggle"), pip = $("pip"), pipVideo = $("pipVideo"), pipCanvas = $("pipCanvas"), handLayer = $("handLayer");

let leaves = [];
let pending = null;
let handShape = null;
let stream = null;
let landmarker = null;

const params = new URLSearchParams(location.search);
if (params.get("admin")) sessionStorage.setItem("thankful-admin", params.get("admin"));
const adminToken = sessionStorage.getItem("thankful-admin");
const tokens = JSON.parse(localStorage.getItem(TOKENS_KEY) || "{}");
const saveTokens = () => localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));

const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const colorFor = ({ human }) => {
  const upper = STOPS.findIndex(([at]) => human <= at);
  const [[a, from], [b, to]] = upper <= 0 ? [STOPS[0], STOPS[0]] : [STOPS[upper - 1], STOPS[upper]];
  const t = b === a ? 0 : (human - a) / (b - a);
  return `rgb(${from.map((c, i) => Math.round(c + (to[i] - c) * t)).join(",")})`;
};
const leafWidth = () => (matchMedia("(max-width: 820px)").matches ? 0.2 : 0.18);
const sizeClass = (text) => (text.length > 50 ? "long" : text.length > 22 ? "medium" : "short");

const placeText = (el, shape) => {
  const box = textBox(shape);
  Object.assign(el.style, {
    left: box.x - box.w / 2 + "%",
    width: box.w + "%",
    top: ((box.y - box.h / 2) / 120) * 100 + "%",
    height: (box.h / 120) * 100 + "%",
  });
};

const verdictFor = (human) =>
  human >= 80 ? "Heartfelt and 100% homegrown" :
  human >= 40 ? "A little bit mixed, like stuffing" :
  "Hmm, Pangram thinks a robot helped with this one";

const renderBigLeaf = () => {
  const text = pending?.gratitude ?? input.value.trim();
  bigLeaf.innerHTML = leafSvg(handShape) + `<div class="leaf-text"><span class="leaf-lead">I am thankful for</span><span class="leaf-body"></span></div>`;
  const body = bigLeaf.querySelector(".leaf-body");
  body.textContent = text || "...";
  body.classList.add(sizeClass(text));
  placeText(bigLeaf.querySelector(".leaf-text"), handShape);
};

const updateSubmit = () => {
  submit.hidden = !handShape;
  submit.disabled = !input.value.trim();
};

const renderTree = (freshId) => {
  leavesEl.replaceChildren(...leaves.map((leaf) => {
    const { x, y } = SPOTS[leaf.slot % SPOTS.length];
    const el = document.createElement("div");
    el.className = "tree-leaf" + (leaf.id === freshId ? " fresh" : "");
    el.dataset.id = leaf.id;
    el.style.left = x + "%";
    el.style.top = y + "%";
    el.style.setProperty("--leaf", colorFor(leaf));
    el.style.setProperty("--rot", (hash(leaf.id) % 30) - 15 + "deg");
    el.style.setProperty("--delay", -(hash(leaf.id) % 30) / 10 + "s");

    const face = document.createElement("button");
    face.type = "button";
    face.className = "leaf-face";
    face.setAttribute("aria-label", `I am thankful for ${leaf.gratitude}. ${leaf.human}% human.`);
    face.innerHTML = leafSvg(leaf.shape) + '<span class="words"></span>';
    const words = face.querySelector(".words");
    words.textContent = leaf.gratitude;
    words.classList.add(sizeClass(leaf.gratitude));
    placeText(words, leaf.shape);
    face.addEventListener("mouseenter", () => showPopover(el, leaf));
    face.addEventListener("focus", () => showPopover(el, leaf));
    face.addEventListener("click", () => showPopover(el, leaf));
    face.addEventListener("mouseleave", hidePopover);
    face.addEventListener("blur", hidePopover);
    el.append(face);

    if (tokens[leaf.id] || adminToken) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "leaf-delete";
      del.textContent = "×";
      del.setAttribute("aria-label", `Remove the leaf "${leaf.gratitude}"`);
      del.addEventListener("click", () => deleteLeaf(leaf));
      el.append(del);
    }
    return el;
  }));
  $("count").textContent = `${leaves.length} ${leaves.length === 1 ? "leaf" : "leaves"} of gratitude`;
  $("empty").hidden = leaves.length > 0;
};

const loadLeaves = async (freshId) => {
  const res = await fetch("/api/leaves");
  leaves = await res.json();
  for (const id of Object.keys(tokens)) if (!leaves.some((l) => l.id === id)) delete tokens[id];
  saveTokens();
  renderTree(freshId);
};

const deleteLeaf = async (leaf) => {
  if (!confirm(`Remove "${leaf.gratitude}" from the tree?`)) return;
  hidePopover();
  const headers = tokens[leaf.id] ? { "x-delete-token": tokens[leaf.id] } : { "x-admin-token": adminToken };
  const res = await fetch(`/api/leaves/${leaf.id}`, { method: "DELETE", headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || "Couldn't remove that leaf.");
    return;
  }
  delete tokens[leaf.id];
  saveTokens();
  await loadLeaves();
};

const showPopover = (el, leaf) => {
  popover.innerHTML = `<p class="lead">I am thankful for</p><p class="body"></p>
    <div class="bar"><span style="width:${leaf.human}%; background:${colorFor(leaf)}"></span></div>
    <p class="meta"><b>${leaf.human}% human</b> · ${leaf.headline ?? ""}</p>`;
  popover.querySelector(".body").textContent = leaf.gratitude;
  const wrap = popover.parentElement.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  const left = Math.min(Math.max(box.left + box.width / 2 - wrap.left, 125), wrap.width - 125);
  popover.style.left = left + "px";
  popover.style.top = box.top - wrap.top + "px";
  popover.hidden = false;
};
const hidePopover = () => { popover.hidden = true; };

const showError = (message) => {
  errorEl.textContent = message;
  errorEl.hidden = !message;
};

const HOLD_MS = 1200;
const HINT = "Hold your palm up to the camera, fingers spread";
const handlers = {};
const onStop = {};
let mode = null;
let activeVideo = null;

const ensureLandmarker = async () => {
  if (landmarker) return;
  const { FilesetResolver, HandLandmarker } = await import(`${VISION}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${VISION}/wasm`);
  landmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: HAND_MODEL },
    runningMode: "VIDEO",
    numHands: 1,
  });
};

const stopCamera = () => {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  const stopped = mode;
  mode = null;
  onStop[stopped]?.();
};

const detectLoop = () => {
  if (!stream) return;
  if (activeVideo.readyState >= 2) {
    const now = performance.now();
    handlers[mode](landmarker.detectForVideo(activeVideo, now).landmarks[0], now);
  }
  requestAnimationFrame(detectLoop);
};

const startCamera = async (nextMode, videoEl) => {
  stopCamera();
  await ensureLandmarker();
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 480 } });
  videoEl.srcObject = stream;
  await videoEl.play();
  mode = nextMode;
  activeVideo = videoEl;
  detectLoop();
};

const cameraError = (err) =>
  err.name === "NotAllowedError" ? "We need your camera to see your hand." : `Camera trouble: ${err.message}`;

const lmDist = (lm, a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
const isOpenHand = (lm) => [[8, 5], [12, 9], [16, 13], [20, 17]].filter(([tip, mcp]) => lmDist(lm, 0, tip) > lmDist(lm, 0, mcp) * 1.45).length === 4;

let steadyMs = 0;
let lastHand = null;
let lastFrame = 0;

handlers.capture = (lm, now) => {
  const { videoWidth: w, videoHeight: h } = video;
  overlay.width = w;
  overlay.height = h;
  const ctx = overlay.getContext("2d");
  const dt = lastFrame ? now - lastFrame : 0;
  lastFrame = now;
  if (!lm) {
    steadyMs = 0;
    lastHand = null;
    camHint.textContent = HINT;
    camProgress.style.width = "0%";
    return;
  }
  const size = lmDist(lm, 0, 9);
  const movement = lastHand ? lm.reduce((sum, p, i) => sum + Math.hypot(p.x - lastHand[i].x, p.y - lastHand[i].y), 0) / lm.length / size : 1;
  lastHand = lm;
  const open = isOpenHand(lm);
  steadyMs = open && movement < 0.025 ? steadyMs + dt : Math.max(0, steadyMs - dt * 2);
  const progress = Math.min(steadyMs / HOLD_MS, 1);
  const pts = toPixels(lm, w, h);
  drawHand(ctx, pts, `rgba(232, 116, 43, ${0.35 + progress * 0.5})`);
  camProgress.style.width = progress * 100 + "%";
  camHint.textContent = !open ? "Spread your fingers wide" : progress > 0 ? "Hold still..." : "Hold still to capture";
  if (progress < 1) return;
  handShape = normalizeHand(pts);
  stopCamera();
  camera.hidden = true;
  captured.hidden = false;
  renderBigLeaf();
  updateSubmit();
  input.focus();
};

onStop.capture = () => {
  overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
  camera.classList.remove("live");
  camStart.hidden = false;
  steadyMs = 0;
  lastHand = null;
  lastFrame = 0;
  camProgress.style.width = "0%";
  camHint.textContent = HINT;
};

camStart.addEventListener("click", async () => {
  showError("");
  camStart.disabled = true;
  camStart.textContent = "Starting camera...";
  try {
    await startCamera("capture", video);
    camera.classList.add("live");
    camStart.hidden = true;
  } catch (err) {
    stopCamera();
    showError(cameraError(err));
  } finally {
    camStart.disabled = false;
    camStart.textContent = "Turn on camera";
  }
});

const resetCamera = () => {
  handShape = null;
  captured.hidden = true;
  camera.hidden = false;
  updateSubmit();
};

retake.addEventListener("click", () => {
  pending = null;
  result.hidden = true;
  bigLeaf.style.removeProperty("--leaf");
  resetCamera();
  camStart.click();
});

const PINCH_ON = 0.3, PINCH_OFF = 0.45;
let pinching = false;
let held = null;
let shakeTrail = [];
let lastShake = 0;

const toTree = (p, W, H) => {
  const clamp = (v) => Math.min(Math.max(v, 0), 1);
  return [clamp((1 - p.x - 0.15) / 0.7) * W, clamp((p.y - 0.1) / 0.7) * H];
};

const releaseLeaf = () => {
  if (!held) return;
  const { el, leaf } = held;
  const { x, y } = SPOTS[leaf.slot % SPOTS.length];
  el.classList.remove("held");
  el.classList.add("returning");
  el.style.left = x + "%";
  el.style.top = y + "%";
  setTimeout(() => el.classList.remove("returning"), 700);
  held = null;
};

const grabLeaf = ([cx, cy], W, H) => {
  let best = null;
  for (const el of leavesEl.querySelectorAll(".tree-leaf")) {
    const leaf = leaves.find((l) => l.id === el.dataset.id);
    const { x, y } = SPOTS[leaf.slot % SPOTS.length];
    const d = Math.hypot((x / 100) * W - cx, (y / 100) * H - cy);
    if (d < W * 0.1 && (!best || d < best.d)) best = { el, leaf, d };
  }
  if (!best) return;
  hidePopover();
  held = best;
  best.el.classList.add("held");
};

const shakeTree = () => {
  const tree = $("tree");
  tree.classList.remove("shaking");
  void tree.offsetWidth;
  tree.classList.add("shaking");
  setTimeout(() => tree.classList.remove("shaking"), 1000);
  for (let i = 0; i < 7; i++) {
    const s = document.createElement("span");
    s.className = "debris";
    s.style.left = 15 + Math.random() * 70 + "%";
    s.style.top = 10 + Math.random() * 40 + "%";
    s.style.animationDelay = Math.random() * 0.4 + "s";
    s.innerHTML = `<svg viewBox="0 0 100 120"><path fill="${FALL_COLORS[i % FALL_COLORS.length]}" d="M50 4 C82 22 96 56 50 100 C4 56 18 22 50 4 Z"/></svg>`;
    s.addEventListener("animationend", () => s.remove());
    tree.append(s);
  }
};

const detectShake = (x, now, W) => {
  shakeTrail = [...shakeTrail.filter((p) => now - p.t < 800), { t: now, x }];
  let reversals = 0, dir = 0, anchor = shakeTrail[0].x;
  for (const p of shakeTrail) {
    const delta = p.x - anchor;
    if (Math.abs(delta) < W * 0.05) continue;
    const sign = Math.sign(delta);
    if (dir && sign !== dir) reversals++;
    dir = sign;
    anchor = p.x;
  }
  if (reversals < 2 || now - lastShake < 1200) return;
  lastShake = now;
  shakeTrail = [];
  shakeTree();
};

handlers.play = (lm, now) => {
  const treeEl = $("tree");
  const W = treeEl.clientWidth, H = treeEl.clientHeight;
  handLayer.width = W;
  handLayer.height = H;
  const ctx = handLayer.getContext("2d");
  const { videoWidth: vw, videoHeight: vh } = pipVideo;
  pipCanvas.width = vw;
  pipCanvas.height = vh;
  const pctx = pipCanvas.getContext("2d");
  if (!lm) {
    releaseLeaf();
    pinching = false;
    return;
  }
  drawHand(pctx, toPixels(lm, vw, vh), "rgba(232, 116, 43, .5)");

  const ratio = lmDist(lm, 4, 8) / lmDist(lm, 0, 9);
  const mid = { x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 };
  const cursor = toTree(mid, W, H);
  if (!pinching && ratio < PINCH_ON) {
    pinching = true;
    grabLeaf(cursor, W, H);
  } else if (pinching && ratio > PINCH_OFF) {
    pinching = false;
    releaseLeaf();
  }
  if (held) {
    held.el.style.left = (cursor[0] / W) * 100 + "%";
    held.el.style.top = (cursor[1] / H) * 100 + "%";
  } else if (!pinching) {
    detectShake(toTree(lm[9], W, H)[0], now, W);
  }

  ctx.fillStyle = "rgba(255, 250, 242, .9)";
  ctx.strokeStyle = "rgba(122, 74, 43, .8)";
  ctx.lineWidth = 2;
  for (const tip of [4, 8, 12, 16, 20]) {
    const [x, y] = toTree(lm[tip], W, H);
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cursor[0], cursor[1], pinching ? 10 : 16, 0, Math.PI * 2);
  ctx.strokeStyle = pinching ? "rgba(184, 50, 47, .9)" : "rgba(232, 116, 43, .9)";
  ctx.lineWidth = 3;
  ctx.stroke();
};

onStop.play = () => {
  releaseLeaf();
  pinching = false;
  shakeTrail = [];
  handLayer.getContext("2d").clearRect(0, 0, handLayer.width, handLayer.height);
  pip.hidden = true;
  playToggle.textContent = "Play with the tree";
};

playToggle.addEventListener("click", async () => {
  if (mode === "play") return stopCamera();
  playToggle.disabled = true;
  playToggle.textContent = "Starting camera...";
  try {
    pip.hidden = false;
    await startCamera("play", pipVideo);
    playToggle.textContent = "Stop playing";
  } catch (err) {
    stopCamera();
    alert(cameraError(err));
  } finally {
    playToggle.disabled = false;
  }
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    form.requestSubmit();
  }
});

input.addEventListener("input", () => {
  updateSubmit();
  if (!pending && handShape) renderBigLeaf();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const gratitude = input.value.trim();
  if (!gratitude || !handShape) return;
  showError("");
  result.hidden = true;
  submit.disabled = true;
  submit.textContent = "Pangram is reading...";
  bigLeaf.classList.add("thinking");
  try {
    const res = await fetch("/api/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gratitude, shape: handShape }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong");
    pending = data;
    renderBigLeaf();
    bigLeaf.style.setProperty("--leaf", colorFor(data));
    $("scoreNum").textContent = data.human;
    $("verdict").textContent = verdictFor(data.human);
    $("meta").textContent = [data.headline, data.confidence && `${data.confidence} confidence`].filter(Boolean).join(" · ");
    result.hidden = false;
    hang.focus();
  } catch (err) {
    showError(err.message);
  } finally {
    bigLeaf.classList.remove("thinking");
    updateSubmit();
  }
});

hang.addEventListener("click", async () => {
  if (!pending) return;
  hang.disabled = true;
  showError("");
  let leaf;
  try {
    const res = await fetch("/api/leaves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: pending.id }),
    });
    leaf = await res.json();
    if (!res.ok) throw new Error(leaf.error || "Something went wrong");
  } catch (err) {
    showError(err.message);
    return;
  } finally {
    hang.disabled = false;
  }
  tokens[leaf.id] = leaf.deleteToken;
  saveTokens();

  const treeBox = $("tree").getBoundingClientRect();
  const { x, y } = SPOTS[leaf.slot % SPOTS.length];
  const from = bigLeaf.getBoundingClientRect();
  const targetW = treeBox.width * leafWidth();
  const targetH = targetW * 1.2;
  const toX = treeBox.left + (treeBox.width * x) / 100 - targetW / 2;
  const toY = treeBox.top + (treeBox.height * y) / 100 - targetH / 2;

  const ghost = bigLeaf.cloneNode(true);
  ghost.removeAttribute("id");
  ghost.classList.add("flying");
  Object.assign(ghost.style, { left: from.left + "px", top: from.top + "px", width: from.width + "px", height: from.height + "px" });
  document.body.append(ghost);

  const dx = toX - from.left, dy = toY - from.top, s = targetW / from.width;
  ghost.animate([
    { transform: "translate(0,0) scale(1) rotate(0deg)" },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 120}px) scale(${(1 + s) / 2}) rotate(-25deg)`, offset: 0.55 },
    { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(15deg)` },
  ], { duration: 1100, easing: "cubic-bezier(.45,.05,.4,1)", fill: "forwards" })
    .finished.then(() => {
      ghost.remove();
      loadLeaves(leaf.id);
    });

  pending = null;
  result.hidden = true;
  input.value = "";
  bigLeaf.style.removeProperty("--leaf");
  resetCamera();
});

const startFalling = () => {
  const box = document.querySelector(".falling");
  for (let i = 0; i < 12; i++) {
    const s = document.createElement("span");
    s.style.left = Math.random() * 100 + "vw";
    s.style.animationDuration = 9 + Math.random() * 10 + "s";
    s.style.animationDelay = -Math.random() * 18 + "s";
    s.innerHTML = `<svg viewBox="0 0 100 120"><path fill="${FALL_COLORS[i % FALL_COLORS.length]}" d="M50 4 C82 22 96 56 50 100 C4 56 18 22 50 4 Z"/></svg>`;
    box.append(s);
  }
};

startFalling();
updateSubmit();
loadLeaves().catch(() => renderTree());
setInterval(() => { if (popover.hidden && mode !== "play") loadLeaves().catch(() => {}); }, 20000);
