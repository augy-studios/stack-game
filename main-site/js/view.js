// Turns a game, at a moment in it, into what the scene draws and what the
// speakers play. The live game hands it the state as it grows; the replay
// hands it a finished game and any moment in it. Both go through here, so a
// replay looks and sounds exactly like the game did.

import { LAYER, speedFor, swingAt, waterAt } from "./rules.js";
import { axisOf, difficultyOfGame } from "./sim.js";
import { simulateFall } from "./fall.js";
import * as audio from "./audio.js";

const PIECE_WINDOW_MS = 10000;
const RING_MS = 650;
// How long a layer a run of perfects grew takes to push its side out: as
// long as the slide in sounds/PlateSliding.wav, at the rate js/audio.js
// plays it.
const GROW_MS = 670;
// After the game ends the water keeps rising this long, then stops.
const AFTER_MS = 2500;

export function createPresenter() {
  let game = null;
  const falls = new Map();

  function bind(state) {
    if (state !== game) {
      game = state;
      falls.clear();
    }
  }

  function fallFor(key, piece) {
    let fall = falls.get(key);
    if (!fall) {
      fall = simulateFall(piece, game.layers, difficultyOfGame(game));
      falls.set(key, fall);
    }
    return fall;
  }

  // Layers standing at t: the base and every drop up to t.
  function countAt(t) {
    const drops = game.drops;
    let lo = 0;
    let hi = drops.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (drops[mid].t <= t) lo = mid + 1;
      else hi = mid;
    }
    return 1 + lo;
  }

  function slabAt(count, t) {
    const over = game.over;
    if (over && t >= over.at) return null;
    if (count > game.layers.length) return null;
    const n = count;
    const prev = game.layers[n - 1];
    const spawn = n >= 2 ? game.drops[n - 2].t : 0;
    const speed = speedFor(difficultyOfGame(game), n);
    const raw = swingAt(speed, Math.max(0, t - spawn));
    const axis = axisOf(n);
    return {
      n,
      x: prev.x + (axis === "x" ? raw : 0),
      z: prev.z + (axis === "z" ? raw : 0),
      sx: prev.sx,
      sz: prev.sz,
    };
  }

  const pieceOf = (drop) => ({
    ...drop.chop,
    n: drop.n,
    axis: drop.axis,
    sign: drop.raw > 0 ? 1 : -1,
    t: drop.t,
  });

  // Pieces in the air or the water at t, and the ones resting on the island.
  function piecesAt(count, t, each) {
    const drops = game.drops;
    for (let i = count - 2; i >= 0; i--) {
      const drop = drops[i];
      if (drop.t < t - PIECE_WINDOW_MS) break;
      if (drop.chop) each(fallFor(i, pieceOf(drop)), drop.chop, drop.n);
    }
    // The island is only above water in the first seconds of a game.
    for (let i = 0; i < Math.min(count - 1, 40); i++) {
      const drop = drops[i];
      if (!drop.chop || drop.t >= t - PIECE_WINDOW_MS) continue;
      const fall = fallFor(i, pieceOf(drop));
      if (fall.rest !== null) each(fall, drop.chop, drop.n);
    }
    const miss = game.miss;
    if (miss && t >= miss.t) {
      const fall = fallFor("miss", { ...miss, sign: miss.raw > 0 ? 1 : -1 });
      each(fall, miss, miss.n);
    }
  }

  const waterAtTime = (t) => {
    const end = game.over ? game.over.at + AFTER_MS : Infinity;
    return waterAt(difficultyOfGame(game), Math.min(t, end));
  };

  // What the scene needs to draw `state` at game time t.
  function view(state, t) {
    bind(state);
    const count = countAt(t);
    const waterLevel = waterAtTime(t);
    const pieces = [];
    piecesAt(count, t, (fall, box, n) => pieces.push({ fall, sx: box.sx, sz: box.sz, n }));

    // Layers still pushing out a side a run of perfects grew back.
    const growing = [];
    for (let i = count - 2; i >= 0; i--) {
      const drop = game.drops[i];
      if (t - drop.t >= GROW_MS) break;
      if (drop.grew) growing.push({ t: drop.t, n: drop.n, ms: GROW_MS, ...drop.grew });
    }

    const rings = [];
    for (let i = count - 2; i >= 0; i--) {
      const drop = game.drops[i];
      if (t - drop.t >= RING_MS) break;
      if (drop.perfect) {
        const l = drop.layer;
        rings.push({ t: drop.t, x: l.x, z: l.z, sx: l.sx, sz: l.sz, n: l.n, big: Boolean(drop.grew) });
      }
    }

    return {
      t,
      seedNum: game.seedNum,
      layers: game.layers,
      count,
      slab: slabAt(count, t),
      water: waterLevel,
      pieces,
      rings,
      growing,
      top: (count - 1) * LAYER,
    };
  }

  // Plays what happened in (from, to]. Skipped for a jump, so seeking the
  // replay does not play every sound at once. buzz, when given, is called
  // for a piece knocking against the tower or going into the water.
  function sounds(state, from, to, { jump = false, slosh = true, buzz = null } = {}) {
    bind(state);
    if (!(to > from)) return;
    const count = countAt(to);
    if (!jump && to - from < 600) {
      for (let i = count - 2; i >= 0; i--) {
        const drop = game.drops[i];
        if (drop.t <= from) break;
        if (drop.perfect) {
          audio.playPerfect(drop.combo);
        } else {
          audio.playDrop(drop.auto ? 0.7 : 1);
        }
        if (drop.grew) audio.playGrow(GROW_MS / 1000);
      }
      piecesAt(count, to, (fall) => {
        for (const hit of fall.impacts) {
          if (hit.t <= from || hit.t > to) continue;
          if (hit.kind === "water") audio.playSplash(hit.strength, ((count - 1) * LAYER - waterAtTime(hit.t)) / LAYER);
          else if (hit.kind === "island") audio.playLand(hit.strength);
          else audio.playHit(hit.strength);
          if (hit.kind !== "island") buzz?.();
        }
      });
      if (game.over && game.over.at > from && game.over.at <= to) audio.playGameOver();
    }
    if (slosh) {
      const ended = game.over && to >= game.over.at;
      const gap = (count - 1) * LAYER - waterAtTime(to);
      audio.setSlosh(gap / LAYER, ended);
    }
  }
  return { view, sounds, countAt };
}
