#!/usr/bin/env node
// The API's check on a submitted game, without a database: a game played
// like a person passes and scores what the page said; autoplay, a doctored
// record, a game run faster than real time, a script's precision, and taps
// faster than a hand are all refused.
//
// Run: node scripts/test-verify.mjs

import { check } from "../main-site/api/_lib/verify.js";
import { newGame, tap, advance, finish, slabAt, scoreOf } from "../main-site/js/sim.js";
import { alignMs } from "../main-site/js/rules.js";
import { newSeed } from "../main-site/js/seed.js";

let failures = 0;
const expect = (label, fn, code) => {
  try {
    const out = fn();
    if (code) {
      failures += 1;
      console.error(`  FAIL ${label}: accepted, wanted ${code}`);
    } else {
      console.log(`  ok   ${label}`);
    }
    return out;
  } catch (err) {
    const codes = [code].flat();
    if (code && codes.includes(err.code)) console.log(`  ok   ${label}: ${err.code}`);
    else {
      failures += 1;
      console.error(`  FAIL ${label}: ${err.code ?? err.message}${code ? `, wanted ${code}` : ""}`);
    }
  }
};

// A player aiming at the line-up with a person's spread.
function play(settings, { spread = 28, perfectAim = false, maxDrops = 60 } = {}) {
  const seed = newSeed();
  const state = newGame(seed, settings);
  const taps = [];
  let s = 7;
  const rand = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  while (!state.over && taps.length < maxDrops) {
    const slab = slabAt(state, state.t);
    const off = perfectAim ? 0 : Math.round((rand() + rand() + rand() - 1.5) * spread);
    const at = Math.max(state.t + 1, state.spawnAt + alignMs(slab.speed) + off);
    advance(state, at, true);
    if (state.over) break;
    taps.push(at);
    tap(state, at);
  }
  if (!state.over) finish(state, state.t + 400);
  const game = { seed, difficulty: settings.difficulty, turn_limit: settings.turn, game_limit: settings.game };
  return { state, game, record: { v: state.settings.rules, seed, ...settings, taps, end: state.over.at } };
}

const settings = { difficulty: "medium", turn: 0, game: 0 };

console.log("verify");
{
  const { state, game, record } = play(settings);
  const out = expect("a person's game", () => check(game, record, state.over.at + 1500));
  if (out && out.score !== scoreOf(state)) {
    failures += 1;
    console.error(`  FAIL score ${out.score}, the page had ${scoreOf(state)}`);
  }
  expect("autoplay flagged", () => check(game, { ...record, auto: true }, state.over.at + 1500), "autoplay");
  expect("another seed", () => check({ ...game, seed: newSeed() }, record, state.over.at + 1500), "not_this_game");
  expect("another difficulty", () => check({ ...game, difficulty: "easy" }, record, state.over.at + 1500), "not_this_game");
  expect("faster than real time", () => check(game, record, state.over.at - 10000), "too_fast");
}
{
  // A game that ended on its own, by a miss, takes no more taps.
  const { state, game, record } = play(settings, { spread: 90, maxDrops: 1000 });
  if (state.over.by !== "miss") console.error("  (that game did not end by a miss)");
  expect("taps after a miss", () => check(game, { ...record, taps: [...record.taps, record.end + 500], end: record.end + 500 }, record.end + 5000), "bad_record");
}
{
  const { state, game, record } = play(settings, { perfectAim: true, maxDrops: 40 });
  expect("dead-centre every time", () => check(game, record, state.over.at + 1500), "inhuman");
}
{
  const { state, game, record } = play(settings, { maxDrops: 30 });
  // Squeeze a few taps right up against the ones before them.
  const taps = [...record.taps];
  const forged = { ...record, taps: taps.slice(0, 4).concat(taps.slice(0, 4).map((t) => t + 20)).sort((a, b) => a - b) };
  forged.end = Math.max(forged.end, forged.taps.at(-1));
  // Usually the slab is nowhere near in line that soon and the record no
  // longer makes a game; either way it is refused.
  expect("taps faster than a hand", () => check(game, forged, state.over.at + 60000), ["inhuman", "bad_record"]);
}
{
  const { state, game, record } = play({ difficulty: "hard", turn: 3, game: 60 });
  expect("hard, 3 s a slab, 1 minute", () => check({ ...game }, record, state.over.at + 1500));
}

if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log("verify ok");
