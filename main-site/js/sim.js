// The game itself, as data: a seed, the settings, and the moments the player
// tapped. Everything else, where each slab landed, what was cut off, the
// water, the score, is worked out from those by this file.
//
// Pure, integers only, no clock and no randomness of its own: the page, the
// replay viewer and the API all run games through it, and the same taps
// always make the same game. That is what lets the API check a score
// without trusting the browser, and lets a replay be a few hundred bytes.
//
// Layers are numbered from 0, the base. Layer n's slab appears the moment
// layer n - 1 lands (layer 1 at 0 ms) and swings along x when n is odd and
// along z when n is even. A layer's top is at n * LAYER.
//
// A game ends one of four ways:
//   miss   a slab dropped clear of the one below
//   water  the water rose above the top of the tower
//   time   the game limit ran out
//   quit   the player stopped it

import {
  BASE, LAYER,
  difficultyOf, cleanDifficulty, cleanTurn, cleanGameLimit, cleanRules,
  speedFor, swingAt, waterOverAt,
  accuracyPercent, speedPercent, dropPoints, gameScore,
} from "./rules.js";
import { cleanSeed, seedNumber, draw } from "./seed.js";

export const axisOf = (layer) => (layer % 2 === 1 ? "x" : "z");

// The game's difficulty, under the rules it is played by.
export const difficultyOfGame = (state) => difficultyOf(state.settings.difficulty, state.settings.rules);

export function newGame(seed, settings) {
  const clean = cleanSeed(seed);
  if (!clean) throw new Error("bad seed");
  const rules = cleanRules(settings.rules);
  const start = difficultyOf(settings.difficulty, rules).start;
  return {
    seed: clean,
    seedNum: seedNumber(clean),
    settings: {
      // The rules version, js/rules.js's RULES_VERSION unless replaying a
      // game played under older ones.
      rules,
      difficulty: cleanDifficulty(settings.difficulty),
      turn: cleanTurn(settings.turn),
      game: cleanGameLimit(settings.game),
    },
    // Placed layers, the base first, at the difficulty's starting size.
    // x and z are centres; sx and sz sizes. Centres can sit on a half unit,
    // which doubles hold exactly.
    layers: [{ n: 0, x: 0, z: 0, sx: start, sz: start, t: 0 }],
    // One entry per drop that landed; see drop() for the fields.
    drops: [],
    // The slab that missed, if one did.
    miss: null,
    combo: 0,
    bestCombo: 0,
    perfects: 0,
    points: 0,
    // Everything up to and including this ms has been worked out.
    t: 0,
    spawnAt: 0,
    over: null,
  };
}

export const topOf = (state) => (state.layers.length - 1) * LAYER;

// The slab now swinging, at `t`, or null once the game is over.
export function slabAt(state, t) {
  if (state.over) return null;
  const n = state.layers.length;
  const prev = state.layers[n - 1];
  const axis = axisOf(n);
  const speed = speedFor(difficultyOfGame(state), n);
  const ms = Math.max(0, t - state.spawnAt);
  const raw = swingAt(speed, ms);
  return {
    n,
    axis,
    speed,
    ms,
    raw,
    x: prev.x + (axis === "x" ? raw : 0),
    z: prev.z + (axis === "z" ? raw : 0),
    sx: prev.sx,
    sz: prev.sz,
  };
}

// Drops the swinging slab at `t`. Returns the drop, or the miss.
function drop(state, t, auto) {
  const d = difficultyOfGame(state);
  const slab = slabAt(state, t);
  const prev = state.layers[slab.n - 1];
  const { n, axis, raw, speed, ms } = slab;
  const size = axis === "x" ? prev.sx : prev.sz;
  const centre = axis === "x" ? prev.x : prev.z;
  const perfect = Math.abs(raw) <= d.perfect;

  let kept = { x: prev.x, z: prev.z, sx: prev.sx, sz: prev.sz };
  let chop = null;
  let grew = null;

  if (perfect) {
    state.combo += 1;
    state.perfects += 1;
    state.bestCombo = Math.max(state.bestCombo, state.combo);

    // A long enough run of perfects grows the slab back towards BASE, on a
    // side the seed picks for this layer. Never past it: on Easy, a slab
    // still bigger than BASE does not grow at all.
    if (state.combo >= d.combo) {
      const want = Math.min(d.grow * (state.combo - d.combo + 1), 3 * d.grow);
      const pick = draw(state.seedNum, n, 7, 4);
      const side = pick & 1 ? 1 : -1;
      const order = pick < 2 ? ["x", "z"] : ["z", "x"];
      for (const a of order) {
        const have = a === "x" ? kept.sx : kept.sz;
        if (have >= BASE) continue;
        const amount = Math.min(want, BASE - have);
        if (a === "x") {
          kept.sx += amount;
          kept.x += (side * amount) / 2;
        } else {
          kept.sz += amount;
          kept.z += (side * amount) / 2;
        }
        grew = { axis: a, side, amount };
        break;
      }
    }
  } else {
    const overlap = size - Math.abs(raw);
    if (overlap <= 0) {
      state.miss = { n, t, auto, raw, axis, x: slab.x, z: slab.z, sx: slab.sx, sz: slab.sz };
      state.combo = 0;
      state.t = t;
      state.over = { by: "miss", at: t };
      return state.miss;
    }
    state.combo = 0;
    const sign = raw > 0 ? 1 : -1;
    const keptCentre = centre + raw / 2;
    const chopCentre = centre + (sign * size) / 2 + raw / 2;
    if (axis === "x") {
      kept = { x: keptCentre, z: prev.z, sx: overlap, sz: prev.sz };
      chop = { x: chopCentre, z: prev.z, sx: Math.abs(raw), sz: prev.sz };
    } else {
      kept = { x: prev.x, z: keptCentre, sx: prev.sx, sz: overlap };
      chop = { x: prev.x, z: chopCentre, sx: prev.sx, sz: Math.abs(raw) };
    }
  }

  const accuracy = accuracyPercent(perfect, state.combo, size - Math.abs(raw), size);
  const quick = speedPercent(ms, speed, auto);
  const points = dropPoints(n, accuracy, quick, state.settings.turn);
  state.points += points;

  const layer = { n, ...kept, t };
  state.layers.push(layer);
  const entry = { n, t, ms, raw, axis, speed, perfect, combo: state.combo, auto, grew, chop, points, accuracy, quick, layer };
  state.drops.push(entry);
  state.spawnAt = t;
  state.t = t;
  return entry;
}

// Works the game out up to `t`: slabs the turn limit drops, the game limit
// running out, and the water. With `strict`, only what happens before `t`,
// leaving `t` itself for a tap; tap() and the page's frame loop both use
// that, so a tap and a turn limit landing on the same ms always go the
// tap's way. Returns the drops it made.
export function advance(state, t, strict = false) {
  const made = [];
  const until = strict ? t - 1 : t;
  const d = difficultyOfGame(state);
  const { turn, game } = state.settings;

  while (!state.over && state.t < until) {
    const dropAt = turn ? state.spawnAt + turn * 1000 : Infinity;
    const endAt = game ? game * 1000 : Infinity;
    const next = Math.min(dropAt, endAt);
    const stop = next <= until ? next : until;

    const drowned = waterOverAt(d, topOf(state), state.t, stop);
    if (drowned !== null) {
      state.t = drowned;
      state.over = { by: "water", at: drowned };
      break;
    }
    if (next > until) {
      state.t = until;
      break;
    }
    if (endAt <= dropAt) {
      state.t = endAt;
      state.over = { by: "time", at: endAt };
      break;
    }
    made.push(drop(state, dropAt, true));
  }
  return made;
}

// A tap at `t`. Returns what it did, or null if the game was already over
// by then.
export function tap(state, t) {
  advance(state, t, true);
  if (state.over) return null;
  return drop(state, t, false);
}

// Stops the game at `t`, unless something ended it first.
export function finish(state, t) {
  advance(state, t);
  if (!state.over) {
    state.t = Math.max(state.t, t);
    state.over = { by: "quit", at: state.t };
  }
  return state.over;
}

export const scoreOf = (state, t = state.over?.at ?? state.t) => gameScore(state.points, state.settings, t);

// Plays a whole record, js/record.js's shape, under the rules its v names.
// Returns { state } or { error } naming what was wrong with it.
export function runRecord(record) {
  let state;
  try {
    state = newGame(record.seed, { ...record, rules: record.v });
  } catch {
    return { error: "seed" };
  }
  let last = 0;
  for (const t of record.taps) {
    if (!Number.isInteger(t) || t < last) return { error: "order" };
    last = t;
    if (!tap(state, t)) return { error: "after_end" };
  }
  if (!Number.isInteger(record.end) || record.end < last) return { error: "end" };
  finish(state, record.end);
  return { state };
}
