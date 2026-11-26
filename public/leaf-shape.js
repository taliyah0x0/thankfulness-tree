const FINGERS = [[0, 1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
const PALM = [0, 1, 5, 9, 13, 17];
const TIPS = [4, 8, 12, 16, 20];

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const fingerWidth = (pts) => dist(pts[5], pts[17]) / 2.4;
const round = (n) => Math.round(n * 10) / 10;

export const DEFAULT_TEXT_BOX = { x: 50, y: 58, w: 58, h: 52 };

export const toPixels = (landmarks, width, height) => landmarks.map((p) => [(1 - p.x) * width, p.y * height]);

export const normalizeHand = (pts) => {
  const [ox, oy] = pts[0];
  const [vx, vy] = [pts[9][0] - ox, pts[9][1] - oy];
  const theta = Math.atan2(vx, -vy);
  const cos = Math.cos(-theta), sin = Math.sin(-theta);
  const rotated = pts.map(([x, y]) => [(x - ox) * cos - (y - oy) * sin, (x - ox) * sin + (y - oy) * cos]);
  const pad = fingerWidth(rotated) / 2;
  const xs = rotated.map((p) => p[0]), ys = rotated.map((p) => p[1]);
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const scale = Math.min(92 / (maxX - minX), 98 / (maxY - minY));
  const offX = 50 - ((minX + maxX) / 2) * scale;
  const offY = 102 - maxY * scale;
  const points = rotated.map(([x, y]) => [round(x * scale + offX), round(y * scale + offY)]);
  return { points, w: round(fingerWidth(points)) };
};

export const textBox = (shape) => {
  if (!shape) return DEFAULT_TEXT_BOX;
  const pts = shape.points;
  const knuckles = [5, 9, 13, 17].map((i) => pts[i]);
  const knuckleY = knuckles.reduce((sum, p) => sum + p[1], 0) / 4;
  const cx = (pts[0][0] + pts[5][0] + pts[17][0]) / 3;
  const top = knuckleY - shape.w;
  const bottom = pts[0][1];
  return { x: cx, y: (top + bottom) / 2, w: dist(pts[5], pts[17]) + shape.w, h: bottom - top };
};

const line = (pts, ids) => ids.map((i) => pts[i].join(",")).join(" ");

export const leafSvg = (shape) => {
  if (!shape) {
    return `<svg viewBox="0 0 100 120" aria-hidden="true">
      <path class="stem" d="M50 98 Q52 110 47 118" />
      <path class="blade" d="M50 4 C82 22 96 56 50 100 C4 56 18 22 50 4 Z" />
      <path class="vein" d="M50 12 L50 94 M50 40 L33 30 M50 40 L67 30 M50 58 L30 48 M50 58 L70 48 M50 76 L36 68 M50 76 L64 68" />
    </svg>`;
  }
  const { points: pts, w } = shape;
  const [wx, wy] = pts[0];
  const c = textBox(shape);
  const fingers = FINGERS.map((ids, f) =>
    `<polyline class="hand-line" points="${line(pts, ids)}" stroke-width="${f === 0 ? w * 1.15 : w}" />`).join("");
  const veins = TIPS.map((tip) => `<polyline class="vein" points="${c.x},${c.y} ${line(pts, [tip - 3, tip - 1])}" />`).join("");
  return `<svg viewBox="0 0 100 120" aria-hidden="true">
    <path class="stem" d="M${wx} ${wy} Q${wx + 3} ${wy + 9} ${wx - 2} 118" />
    <g class="blade">
      <polygon class="hand-fill" points="${line(pts, PALM)}" stroke-width="${w}" />
      ${fingers}
    </g>
    ${veins}
  </svg>`;
};

export const drawHand = (ctx, pts, color) => {
  const w = fingerWidth(pts);
  ctx.save();
  ctx.fillStyle = ctx.strokeStyle = color;
  ctx.lineJoin = ctx.lineCap = "round";
  ctx.lineWidth = w;
  ctx.beginPath();
  PALM.forEach((i, n) => (n ? ctx.lineTo(...pts[i]) : ctx.moveTo(...pts[i])));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  for (const ids of FINGERS) {
    ctx.beginPath();
    ids.forEach((i, n) => (n ? ctx.lineTo(...pts[i]) : ctx.moveTo(...pts[i])));
    ctx.stroke();
  }
  ctx.restore();
};
