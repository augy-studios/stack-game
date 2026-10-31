#!/usr/bin/env node
// The game rules: the same taps always make the same game, played live a
// frame at a time or all at once from a record; records survive packing
// into a link; and simulated players of a few skill levels last a sensible
// time on each difficulty.
//
// Run: node scripts/test-sim.mjs

import { newGame, advance, tap, finish, slabAt, runRecord, scoreOf } from "../main-site/js/sim.js";
import { alignMs, passMs, DIFFICULTIES } from "../main-site/js/rules.js";
import { packRecord, unpackRecord, cleanRecord } from "../main-site/js/record.js";
import { newSeed } from "../main-site/js/seed.js";

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`  FAIL ${msg}`);
};

// A small seeded generator for the simulated players, so a run repeats.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gaussian-ish noise from the sum of three uniforms.
const noise = (r) => (r() + r() + r() - 1.5) / 0.5;

// Plays like the page does: frames of ~16 ms, a strict advance each frame,
// taps at a player's chosen moment. jitterMs is the player's timing spread.
function playLive(seed, settings, jitterMs, r, { quitAt = Infinity, autoplay = false, hesitate = 0 } = {}) {
  const state = newGame(seed, settings);
  const taps = [];
  // A hesitant player lets the slab go round again now and then.
  const wait = (speed) => (r() < hesitate ? 2 * passMs(speed) : 0);
  let now = 0;
  let nextTap = null;
  while (!state.over && now < 3 * 60 * 60 * 1000) {
    now += 16 + Math.floor(r() * 3);
    if (now >= quitAt) {
      finish(state, quitAt);
      break;
    }
    // Pick when to tap this slab: aiming at the line-up, with jitter.
    const slab = slabAt(state, state.t);
    if (nextTap === null || nextTap.n !== slab?.n) {
      if (!slab) break;
      const aim = state.spawnAt + alignMs(slab.speed);
      const off = autoplay ? 0 : Math.round(noise(r) * jitterMs) + wait(slab.speed);
      nextTap = { n: slab.n, at: Math.max(state.spawnAt + 1, aim + off) };
    }
    while (!state.over && nextTap && nextTap.at <= now) {
      const at = nextTap.at;
      advance(state, at, true);
      if (state.over) break;
      const res = tap(state, at);
      taps.push(at);
      if (!res) break;
      const s = slabAt(state, at);
      if (!s) break;
      const aim = state.spawnAt + alignMs(s.speed);
      const off = autoplay ? 0 : Math.round(noise(r) * jitterMs) + wait(s.speed);
      nextTap = { n: s.n, at: Math.max(at + 1, aim + off) };
    }
    advance(state, now, true);
  }
  const end = state.over ? state.over.at : now;
  if (!state.over) finish(state, end);
  return { state, record: { v: 1, seed: state.seed, ...state.settings, taps, end } };
}

console.log("determinism and records");
{
  const r = rng(1);
  for (let i = 0; i < 60; i++) {
    const difficulty = ["easy", "medium", "hard"][i % 3];
    const turn = [0, 10, 5, 3][i % 4];
    const game = [0, 300, 180, 60][(i >> 2) % 4];
    const quitAt = i % 7 === 0 ? 20000 + i * 300 : Infinity;
    const { state, record } = playLive(newSeed(), { difficulty, turn, game }, 25 + (i % 5) * 10, r, { quitAt });
    const clean = cleanRecord(record);
    if (!clean) {
      fail(`game ${i}: record did not clean`);
      continue;
    }
    const again = runRecord(clean);
    if (again.error) {
      fail(`game ${i}: replay error ${again.error}`);
      continue;
    }
    const a = again.state;
    if (a.layers.length !== state.layers.length || scoreOf(a) !== scoreOf(state) || a.over.by !== state.over.by || a.over.at !== state.over.at) {
      fail(`game ${i}: replay differs (${state.layers.length}/${scoreOf(state)}/${state.over.by}@${state.over.at} vs ${a.layers.length}/${scoreOf(a)}/${a.over.by}@${a.over.at})`);
    }
    const unpacked = unpackRecord(packRecord(clean));
    if (JSON.stringify(unpacked) !== JSON.stringify(clean)) fail(`game ${i}: pack round trip differs`);
  }
  // Taps after the end, and out of order, are refused.
  const { record } = playLive(newSeed(), { difficulty: "medium", turn: 0, game: 0 }, 60, rng(9));
  if (!runRecord({ ...record, taps: [...record.taps, record.end + 5000], end: record.end + 5000 }).error) fail("a tap after the end was accepted");
  if (record.taps.length > 2 && !runRecord({ ...record, taps: [record.taps[1], record.taps[0], ...record.taps.slice(2)] }).error) fail("taps out of order were accepted");
  if (unpackRecord("garbage") !== null) fail("garbage unpacked");
  console.log(`  ok, 60 games replay exactly`);
}

console.log("how long games last (median of 25)");
for (const difficulty of Object.keys(DIFFICULTIES)) {
  const row = [];
  for (const [jitter, hesitate] of [[15, 0], [30, 0], [50, 0], [80, 0], [30, 0.3], [30, 0.6]]) {
    const r = rng(jitter * 7 + difficulty.length);
    const runs = [];
    for (let i = 0; i < 25; i++) runs.push(playLive(newSeed(), { difficulty, turn: 0, game: 0 }, jitter, r, { hesitate }).state);
    runs.sort((a, b) => a.layers.length - b.layers.length);
    const mid = runs[12];
    const why = {};
    for (const s of runs) why[s.over.by] = (why[s.over.by] ?? 0) + 1;
    row.push(`±${jitter}ms${hesitate ? `, waits ${hesitate * 100}%` : ""}: ${mid.layers.length - 1} layers, ${Math.round(mid.over.at / 1000)}s, ${scoreOf(mid)} pts [${Object.entries(why).map(([k, v]) => `${k} ${v}`).join(", ")}]`);
  }
  console.log(`  ${difficulty}\n    ${row.join("\n    ")}`);
}

{
  const { state } = playLive(newSeed(), { difficulty: "medium", turn: 0, game: 0 }, 0, rng(3), { autoplay: true, quitAt: 10 * 60 * 1000 });
  console.log(`  autoplay, medium: ${state.layers.length - 1} layers by ${Math.round(state.over.at / 1000)}s, ended by ${state.over.by}, ${state.perfects} perfects`);
  if (state.over.by === "miss") fail("autoplay missed");
}

if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log("sim ok");
