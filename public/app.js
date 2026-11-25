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
const camStart = $("camStart"), captureBtn = $("capture"), captured = $("captured"), retake = $("retake");

let leaves = [];
let pending = null;
let handShape = null;
let liveHand = null;
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
  submit.disabled = !handShape || !input.value.trim();
  submit.textContent = handShape ? "Grow a leaf" : "Capture your hand first";
};

const renderTree = (freshId) => {
  leavesEl.replaceChildren(...leaves.map((leaf) => {
    const { x, y } = SPOTS[leaf.slot % SPOTS.length];
    const el = document.createElement("div");
    el.className = "tree-leaf" + (leaf.id === freshId ? " fresh" : "");
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

const stopCamera = () => {
  overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  liveHand = null;
};

const detectLoop = () => {
  if (!stream) return;
  if (video.readyState >= 2) {
    const { videoWidth: w, videoHeight: h } = video;
    overlay.width = w;
    overlay.height = h;
    const ctx = overlay.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    const found = landmarker.detectForVideo(video, performance.now()).landmarks[0];
    liveHand = found ? toPixels(found, w, h) : null;
    if (liveHand) drawHand(ctx, liveHand, "rgba(232, 116, 43, .55)");
    captureBtn.disabled = !liveHand;
    camHint.textContent = liveHand ? "Got it! Hold still and capture" : "Hold your palm up to the camera, fingers spread";
  }
  requestAnimationFrame(detectLoop);
};

camStart.addEventListener("click", async () => {
  showError("");
  camStart.disabled = true;
  camStart.textContent = "Starting camera...";
  try {
    if (!landmarker) {
      const { FilesetResolver, HandLandmarker } = await import(`${VISION}/vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${VISION}/wasm`);
      landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: HAND_MODEL },
        runningMode: "VIDEO",
        numHands: 1,
      });
    }
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 480 } });
    video.srcObject = stream;
    await video.play();
    camera.classList.add("live");
    camStart.hidden = true;
    captureBtn.hidden = false;
    detectLoop();
  } catch (err) {
    stopCamera();
    showError(err.name === "NotAllowedError" ? "We need your camera to trace your hand into a leaf." : `Camera trouble: ${err.message}`);
  } finally {
    camStart.disabled = false;
    camStart.textContent = "Turn on camera";
  }
});

captureBtn.addEventListener("click", () => {
  if (!liveHand) return;
  handShape = normalizeHand(liveHand);
  stopCamera();
  camera.hidden = true;
  camera.classList.remove("live");
  captured.hidden = false;
  renderBigLeaf();
  updateSubmit();
  input.focus();
});

const resetCamera = () => {
  handShape = null;
  captured.hidden = true;
  camera.hidden = false;
  camStart.hidden = false;
  captureBtn.hidden = true;
  captureBtn.disabled = true;
  camHint.textContent = "Hold your palm up to the camera, fingers spread";
  updateSubmit();
};

retake.addEventListener("click", () => {
  pending = null;
  result.hidden = true;
  bigLeaf.style.removeProperty("--leaf");
  resetCamera();
  camStart.click();
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
setInterval(() => { if (popover.hidden) loadLeaves().catch(() => {}); }, 20000);
