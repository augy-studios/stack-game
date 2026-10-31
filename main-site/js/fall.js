// What happens to a piece once it is cut off: it tips, falls, knocks against
// any wider layer below, and splashes into the water, or lands on the island
// and waits for the water to come for it.
//
// Worked out once per piece in fixed steps and kept as frames, so the piece
// falls the same way live and in the replay at any speed, and the impacts
// come out as a list with times, which is what the sounds play from. Only
// for show: nothing here touches the score.

import { LAYER, ISLAND_TOP, waterAt } from "./rules.js";

const STEP_MS = 4;
const FRAME_MS = 16;
const GRAVITY = 9800;           // units per second per second
const MAX_MS = 9000;
const ISLAND_RADIUS = 2300;

export const FALL_FRAME_MS = FRAME_MS;

// piece: { x, z, sx, sz, n, axis, sign, t } where n is the layer it was cut
// from, sign which way it overhung, and t the game ms it was cut.
// layers: the tower's layers, at least up to n - 1. d: the difficulty, for
// the water.
//
// Returns { t0, frames, impacts, end, rest } where frames holds x, y, z, rx,
// rz for every FRAME_MS, impacts is [{ t, kind: "slab" | "island" | "water",
// strength 0 to 1 }], and rest, when the piece came to a stop on the island,
// is the height of its top.
export function simulateFall(piece, layers, d) {
  let x = piece.x;
  let z = piece.z;
  let y = piece.n * LAYER - LAYER / 2;
  const along = piece.axis === "x";
  const sign = piece.sign || 1;
  // Out over the edge it was cut from, and tipping that way.
  let vx = along ? sign * 260 : 0;
  let vz = along ? 0 : sign * 260;
  let vy = 0;
  let rx = 0;
  let rz = 0;
  let wx = along ? 0 : sign * 2.4;
  let wz = along ? -sign * 2.4 : 0;
  const halfX = piece.sx / 2;
  const halfZ = piece.sz / 2;

  const frames = [];
  const impacts = [];
  let wet = false;
  let rest = null;
  let bounces = 0;

  const push = () => frames.push(x, y, z, rx, rz);
  push();

  for (let ms = STEP_MS; ms <= MAX_MS; ms += STEP_MS) {
    const dt = STEP_MS / 1000;
    const water = waterAt(d, piece.t + ms);
    const bottomBefore = y - LAYER / 2;

    if (!wet) vy -= GRAVITY * dt;
    x += vx * dt;
    z += vz * dt;
    y += vy * dt;
    rx += wx * dt;
    rz += wz * dt;
    const bottom = y - LAYER / 2;

    // Any layer whose top it just came down through, and whose footprint
    // it overlaps, stops it and throws it off.
    if (!wet && vy < 0 && bounces < 5) {
      const from = Math.min(piece.n - 1, Math.floor(bottomBefore / LAYER));
      const to = Math.max(0, Math.ceil(bottom / LAYER));
      for (let k = from; k >= to; k--) {
        const layer = layers[k];
        if (!layer) continue;
        const top = k * LAYER;
        if (bottomBefore < top || bottom > top) continue;
        const overX = Math.abs(x - layer.x) < halfX + layer.sx / 2;
        const overZ = Math.abs(z - layer.z) < halfZ + layer.sz / 2;
        if (!overX || !overZ) continue;
        impacts.push({ t: piece.t + ms, kind: "slab", strength: Math.min(1, -vy / 4000) });
        y = top + LAYER / 2;
        vy = -vy * 0.3;
        // Off the edge it overhangs.
        if (along) vx = sign * Math.max(Math.abs(vx) * 1.3, 700);
        else vz = sign * Math.max(Math.abs(vz) * 1.3, 700);
        wx *= 1.5;
        wz *= 1.5;
        bounces += 1;
        break;
      }
    }

    // The island, while it is still above the water.
    const onIsland = Math.hypot(x, z) < ISLAND_RADIUS && water < ISLAND_TOP;
    if (!wet && onIsland && y - LAYER / 2 <= ISLAND_TOP && vy < 0) {
      impacts.push({ t: piece.t + ms, kind: "island", strength: Math.min(1, -vy / 4000) });
      y = ISLAND_TOP + LAYER / 2;
      rx = Math.round(rx / (Math.PI / 2)) * (Math.PI / 2);
      rz = Math.round(rz / (Math.PI / 2)) * (Math.PI / 2);
      push();
      rest = ISLAND_TOP + LAYER;
      break;
    }

    if (!wet && y < water) {
      wet = true;
      impacts.push({ t: piece.t + ms, kind: "water", strength: Math.min(1, -vy / 5000) });
      vx *= 0.25;
      vz *= 0.25;
      vy = -260;
      wx *= 0.3;
      wz *= 0.3;
    }

    if (ms % FRAME_MS === 0) push();
    if (wet && y < water - 3 * LAYER) break;
  }

  const count = frames.length / 5;
  return {
    t0: piece.t,
    frames: Float32Array.from(frames),
    impacts,
    end: piece.t + (count - 1) * FRAME_MS,
    rest,
  };
}

// Where a fallen piece is at game time t, between its frames, or null once
// it has sunk out of sight.
export function fallAt(fall, t, water) {
  const count = fall.frames.length / 5;
  const at = (t - fall.t0) / FRAME_MS;
  if (at >= count - 1) {
    // Resting on the island until the water covers it.
    if (fall.rest !== null && water < fall.rest) {
      const i = (count - 1) * 5;
      const f = fall.frames;
      return { x: f[i], y: f[i + 1], z: f[i + 2], rx: f[i + 3], rz: f[i + 4] };
    }
    return null;
  }
  const i = Math.max(0, Math.floor(at));
  const k = at - i;
  const f = fall.frames;
  const a = i * 5;
  const b = a + 5;
  const mixed = (j) => f[a + j] + (f[b + j] - f[a + j]) * k;
  return { x: mixed(0), y: mixed(1), z: mixed(2), rx: mixed(3), rz: mixed(4) };
}
