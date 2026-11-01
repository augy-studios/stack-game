// Plays a submitted game again with the same modules the browser plays
// with, and works out what it is worth. Nothing a browser says about a game
// is taken on trust: the score comes from the taps, the taps have to make
// the game the ticket started, the game cannot have run faster than the
// server's own clock, and it has to look like a person played it.
//
// None of this proves who tapped. It is meant to stop scripted and
// doctored games, and games autoplay touched, which is as far as a game
// that runs in the browser can go.

import { runRecord, scoreOf } from "../../js/sim.js";
import { cleanRecord } from "../../js/record.js";
import { difficultyOf } from "../../js/rules.js";
import { HttpError } from "./http.js";

// The start ticket's round trip, and a little drift between clocks.
const CLOCK_SLACK_MS = 3000;
// A slab cannot be in place again this soon after the last; taps closer
// together than this, more than now and then, are not a hand.
const MIN_GAP_MS = 90;
const MAX_QUICK_GAPS = 2;
// A person's perfect drops are spread across the window that counts as
// perfect. A script's sit dead centre.
const PRECISE_MIN_DROPS = 20;
const PRECISE_SHARE = 0.15;

export function readRecord(value) {
  const record = cleanRecord(value);
  if (!record) throw new HttpError(400, "bad_record", "That game could not be read.");
  return record;
}

// game: the uwustack_games row. elapsedMs: the server's time from the
// start ticket to the end of the game.
export function check(game, record, elapsedMs) {
  if (record.auto) throw new HttpError(409, "autoplay", "Autoplay played that game, so it stays off the leaderboard.");

  if (
    record.seed !== game.seed ||
    record.difficulty !== game.difficulty ||
    record.turn !== game.turn_limit ||
    record.game !== game.game_limit
  ) {
    throw new HttpError(409, "not_this_game", "That is not the game this ticket started.");
  }

  const run = runRecord(record);
  if (run.error) throw new HttpError(409, "bad_record", "Those taps do not make a game.");
  const state = run.state;
  if (state.drops.length === 0) throw new HttpError(409, "no_drops", "Land at least one slab to go on the leaderboard.");

  // Game time only runs while the game is on screen, so it can fall behind
  // the server's clock but never get ahead of it.
  if (state.over.at > elapsedMs + CLOCK_SLACK_MS) {
    throw new HttpError(409, "too_fast", "That game ran faster than real time.");
  }

  let quick = 0;
  for (let i = 1; i < record.taps.length; i++) {
    if (record.taps[i] - record.taps[i - 1] < MIN_GAP_MS) quick += 1;
  }
  const d = difficultyOf(record.difficulty, record.v);
  const perfects = state.drops.filter((drop) => drop.perfect && !drop.auto);
  const meanOff = perfects.reduce((sum, drop) => sum + Math.abs(drop.raw), 0) / Math.max(1, perfects.length);
  if (quick > MAX_QUICK_GAPS || (perfects.length >= PRECISE_MIN_DROPS && meanOff < d.perfect * PRECISE_SHARE)) {
    throw new HttpError(409, "inhuman", "That game was played faster or more precisely than a person can.");
  }

  return {
    score: scoreOf(state),
    layers: state.layers.length - 1,
    outcome: state.over.by,
    durationMs: state.over.at,
  };
}
