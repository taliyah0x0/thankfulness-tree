export const MAX_TREE = 17;

export const SPOTS = [
  [50, 25], [33, 38], [67, 38], [41, 12], [59, 12], [16, 25], [84, 25], [50, 50],
  [25, 51], [75, 51], [33, 25], [67, 25], [8, 38], [92, 38], [42, 38], [58, 38], [16, 51],
].map(([x, y]) => ({ x, y: y + 4 }));

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const round = (n) => Math.round(n * 10) / 10;

export const clampPosition = (x, y) => ({ x: round(clamp(x, 6, 94)), y: round(clamp(y, 10, 64)) });

export const pickSpot = (onTree) => {
  let best = SPOTS[0], bestGap = -1;
  for (const spot of SPOTS) {
    const gap = Math.min(Infinity, ...onTree.map((l) => Math.hypot(l.x - spot.x, (l.y - spot.y) * 1.2)));
    if (gap > bestGap) [best, bestGap] = [spot, gap];
  }
  return { x: best.x, y: best.y };
};
