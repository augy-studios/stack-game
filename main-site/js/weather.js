// The weather a game is played in: whether it rains, and when the thunder
// rolls. Pure, with no DOM and no clock, and drawn from the seed, so a
// replay rains and thunders exactly as the game did.
//
// One game in ten starts in the rain. On Hard it is one in four, and
// Hard's rain is a storm: lightning now and then, its thunder arriving a
// moment later, the further off the strike the longer after and the softer.
// Ordinary rain has no lightning, only a distant roll of thunder now and
// then.
//
// Times are game milliseconds, like everything else in a game.

import { mix } from "./seed.js";

const RAIN_SALT = 0x7261696e;
const EVENT_SALT = 0x7468756e;

// 1 in n games rain.
const CHANCE = { easy: 10, medium: 10, hard: 4 };

// Thunder comes at most once a slot, at a time in it the seed picks, in
// that share of slots. A storm's slots are shorter.
const SLOT = { rain: 26000, storm: 12000 };
const ODDS = { rain: 55, storm: 80 };
// Nothing in the first few seconds of a game, and a gap before the next.
const QUIET = 3500;

// How long a strike lights the scene. Its thunder follows it by DELAY_MS
// and up to DELAY_SPREAD more the further it is.
export const FLASH_MS = 650;
const DELAY_MS = 700;
const DELAY_SPREAD = 2800;

export function weatherOf(seedNum, difficulty) {
  const n = CHANCE[difficulty] ?? CHANCE.medium;
  const rain = mix(seedNum, RAIN_SALT) % n === 0;
  return { rain, storm: rain && difficulty === "hard" };
}

// The thunder in slot k, or null.
//   at       when the strike lights the sky (a storm's), or the roll starts
//   thunder  when the thunder starts
//   near     0 for far off, 1 for close by
//   side     -1 to 1, where across the sky it is
//   seed     a number for its shape
function eventIn(weather, seedNum, k) {
  const kind = weather.storm ? "storm" : "rain";
  const slot = SLOT[kind];
  const h = mix(mix(seedNum, EVENT_SALT), k);
  if (h % 100 >= ODDS[kind]) return null;
  const h2 = mix(h, 1);
  const h3 = mix(h, 2);
  const at = k * slot + QUIET + (h2 % (slot - 2 * QUIET));
  if (weather.storm) {
    const near = (h3 % 1000) / 1000;
    const side = ((mix(h, 3) % 2001) - 1000) / 1000;
    return { k, at, thunder: at + DELAY_MS + Math.round((1 - near) * DELAY_SPREAD), near, side, seed: mix(h, 4), flash: true };
  }
  // Rain's thunder is always some way off.
  const near = (h3 % 350) / 1000;
  return { k, at, thunder: at, near, side: 0, seed: mix(h, 4), flash: false };
}

// Calls each(event) for every roll of thunder that starts in (from, to].
export function thunderBetween(weather, seedNum, from, to, each) {
  if (!weather?.rain || !(to > from)) return;
  const slot = weather.storm ? SLOT.storm : SLOT.rain;
  const first = Math.max(0, Math.floor((from - DELAY_MS - DELAY_SPREAD) / slot));
  const last = Math.floor(to / slot);
  for (let k = first; k <= last; k++) {
    const e = eventIn(weather, seedNum, k);
    if (e && e.thunder > from && e.thunder <= to) each(e);
  }
}

// The strike lighting the sky at t, with its age in ms, or null.
export function strikeAt(weather, seedNum, t) {
  if (!weather?.storm || t < 0) return null;
  const k = Math.floor(t / SLOT.storm);
  for (const j of [k, k - 1]) {
    if (j < 0) continue;
    const e = eventIn(weather, seedNum, j);
    if (e && t >= e.at && t < e.at + FLASH_MS) return { ...e, age: t - e.at };
  }
  return null;
}
