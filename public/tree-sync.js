// Rules for combining room trees. Browsers and the server both use these,
// so every copy of a room's tree settles on the same leaves in the same places.
import { MAX_TREE, clampPosition } from "./tree-layout.js";

export const MAX_PILE = 30;
export const MAX_LEAVES = MAX_TREE + MAX_PILE;
export const MAX_REMOVED = 500;

export const num = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
export const str = (s, max) => typeof s === "string" && s.length <= max;

export const validShape = (shape) =>
  Array.isArray(shape?.points) &&
  shape.points.length === 21 &&
  shape.points.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => num(n, -20, 140))) &&
  num(shape.w, 0.01, 40);

// Leaves from other people arrive over the network, so only accept well-formed ones.
export const cleanLeaf = (l) => {
  if (!l || !str(l.id, 64) || !l.id || !str(l.gratitude, 100) || !num(l.human, 0, 100) || !validShape(l.shape)) return null;
  if (!num(l.createdAt, 0, 1e14) || !num(l.v, 0, 1e14) || !str(l.by, 64)) return null;
  const spot = clampPosition(Number(l.x) || 50, Number(l.y) || 30);
  return {
    id: l.id,
    gratitude: l.gratitude,
    human: Math.round(l.human),
    headline: str(l.headline, 200) ? l.headline : null,
    confidence: str(l.confidence, 40) ? l.confidence : null,
    shape: { points: l.shape.points.map(([x, y]) => [x, y]), w: l.shape.w },
    createdAt: l.createdAt,
    x: spot.x,
    y: spot.y,
    fallen: l.fallen === true,
    fallenAt: num(l.fallenAt, 0, 1e14) ? l.fallenAt : 0,
    v: l.v,
    by: l.by,
  };
};

// Every change bumps a leaf's version; the newest version of each leaf wins everywhere.
export const isNewer = (a, b) => a.v > b.v || (a.v === b.v && a.by > b.by);

// Order by age, let the oldest leaves fall off a full tree, and trim the pile.
// Sorts and updates the list in place, and returns it without the trimmed leaves.
export const settle = (list) => {
  list.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  const onTree = list.filter((l) => !l.fallen);
  const newest = onTree.at(-1);
  for (const leaf of onTree.slice(0, Math.max(0, onTree.length - MAX_TREE))) {
    leaf.fallen = true;
    leaf.fallenAt = newest.createdAt;
  }
  const pile = list.filter((l) => l.fallen).sort((a, b) => a.fallenAt - b.fallenAt);
  const dropped = new Set(pile.slice(0, Math.max(0, pile.length - MAX_PILE)).map((l) => l.id));
  return dropped.size ? list.filter((l) => !dropped.has(l.id)) : list;
};

export const cleanRemoved = (ids) => (Array.isArray(ids) ? ids.filter((id) => str(id, 64) && id) : []).slice(-MAX_REMOVED);

// Combine a stored room with one sent by a browser: union of leaves, newest version wins, deletions stick.
export const mergeRooms = (base, incoming) => {
  const removed = new Set([...cleanRemoved(base?.removed), ...cleanRemoved(incoming?.removed)]);
  const byId = new Map();
  for (const raw of [...(base?.leaves ?? []), ...(Array.isArray(incoming?.leaves) ? incoming.leaves.slice(0, MAX_LEAVES) : [])]) {
    const leaf = cleanLeaf(raw);
    if (!leaf || removed.has(leaf.id)) continue;
    const current = byId.get(leaf.id);
    if (!current || isNewer(leaf, current)) byId.set(leaf.id, leaf);
  }
  return { leaves: settle([...byId.values()]), removed: [...removed].slice(-MAX_REMOVED) };
};
