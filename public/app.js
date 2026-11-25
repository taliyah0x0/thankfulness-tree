const COLORS = ["#e8742b", "#b8322f", "#f2b134", "#d2552b", "#a8572a", "#e39b2d", "#c9442c", "#8f3b1f"];
const LEAF_SVG = `<svg viewBox="0 0 100 120" aria-hidden="true">
  <path class="stem" d="M50 98 Q52 110 47 118" />
  <path class="blade" d="M50 4 C82 22 96 56 50 100 C4 56 18 22 50 4 Z" />
  <path class="vein" d="M50 12 L50 94 M50 40 L33 30 M50 40 L67 30 M50 58 L30 48 M50 58 L70 48" />
</svg>`;

const $ = (id) => document.getElementById(id);
const form = $("form"), input = $("gratitude"), submit = $("submit");
const bigLeaf = $("bigLeaf"), leafBody = $("leafBody");
const result = $("result"), errorEl = $("error"), hang = $("hang");
const leavesEl = $("leaves"), popover = $("popover");

let leaves = [];
let pending = null;

const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const colorFor = (leaf) => COLORS[hash(leaf.id) % COLORS.length];

const SLOTS = 80;
const spot = (i) => {
  const slot = (i * 37 + 11) % SLOTS;
  const r = Math.sqrt((slot + 0.5) / SLOTS);
  const angle = slot * 2.39996;
  return { x: 50 + Math.cos(angle) * r * 38, y: 36 + Math.sin(angle) * r * 21 };
};

const verdictFor = (human) =>
  human >= 80 ? "Heartfelt and 100% homegrown" :
  human >= 40 ? "A little bit mixed, like stuffing" :
  "Hmm, Pangram thinks a robot helped with this one";

const setLeafText = (text) => {
  leafBody.textContent = text || "...";
  leafBody.classList.toggle("small", text.length > 30 && text.length <= 80);
  leafBody.classList.toggle("tiny", text.length > 80);
};

const renderTree = (freshId) => {
  leavesEl.replaceChildren(...leaves.map((leaf, i) => {
    const { x, y } = spot(i);
    const el = document.createElement("button");
    el.type = "button";
    el.className = "tree-leaf" + (leaf.id === freshId ? " fresh" : "");
    el.style.left = x + "%";
    el.style.top = y + "%";
    el.style.setProperty("--leaf", colorFor(leaf));
    el.style.setProperty("--rot", (hash(leaf.id) % 70) - 35 + "deg");
    el.style.setProperty("--delay", -(hash(leaf.id) % 30) / 10 + "s");
    el.setAttribute("aria-label", `I am thankful for ${leaf.gratitude}. ${leaf.human}% human.`);
    el.innerHTML = LEAF_SVG + `<span class="num">${leaf.human}</span>`;
    el.addEventListener("mouseenter", () => showPopover(el, leaf));
    el.addEventListener("focus", () => showPopover(el, leaf));
    el.addEventListener("click", () => showPopover(el, leaf));
    el.addEventListener("mouseleave", hidePopover);
    el.addEventListener("blur", hidePopover);
    return el;
  }));
  $("count").textContent = `${leaves.length} ${leaves.length === 1 ? "leaf" : "leaves"} of gratitude`;
  $("empty").hidden = leaves.length > 0;
};

const showPopover = (el, leaf) => {
  popover.innerHTML = `<p class="lead">I am thankful for</p><p class="body"></p>
    <div class="bar"><span style="width:${leaf.human}%"></span></div>
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

input.addEventListener("input", () => {
  if (pending) return;
  setLeafText(input.value.trim());
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const gratitude = input.value.trim();
  if (!gratitude) return;
  showError("");
  result.hidden = true;
  submit.disabled = true;
  submit.textContent = "Pangram is reading...";
  bigLeaf.classList.add("thinking");
  try {
    const res = await fetch("/api/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gratitude }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong");
    pending = data;
    setLeafText(data.gratitude);
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
    submit.disabled = false;
    submit.textContent = "Grow a leaf";
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
  const index = Math.min(leaves.length, SLOTS - 1);
  const treeBox = $("tree").getBoundingClientRect();
  const { x, y } = spot(index);
  const from = bigLeaf.getBoundingClientRect();
  const targetW = treeBox.width * (matchMedia("(max-width: 820px)").matches ? 0.11 : 0.09);
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
      leaves = [...leaves, leaf].slice(-SLOTS);
      renderTree(leaf.id);
    });

  pending = null;
  result.hidden = true;
  input.value = "";
  setLeafText("");
  bigLeaf.style.removeProperty("--leaf");
});

const startFalling = () => {
  const box = document.querySelector(".falling");
  for (let i = 0; i < 12; i++) {
    const s = document.createElement("span");
    s.style.left = Math.random() * 100 + "vw";
    s.style.animationDuration = 9 + Math.random() * 10 + "s";
    s.style.animationDelay = -Math.random() * 18 + "s";
    s.innerHTML = `<svg viewBox="0 0 100 120"><path fill="${COLORS[i % COLORS.length]}" d="M50 4 C82 22 96 56 50 100 C4 56 18 22 50 4 Z"/></svg>`;
    box.append(s);
  }
};

startFalling();
fetch("/api/leaves").then((r) => r.json()).then((data) => { leaves = data; renderTree(); }).catch(() => renderTree());
