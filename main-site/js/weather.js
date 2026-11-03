// The weather a game is played in: whether it rains, and when the thunder
// rolls. Pure, with no DOM and no clock, and drawn from the seed, so a
// replay rains and thunders exactly as the game did.
//
// One game in five starts in the rain, and on Hard three in five (one in
// ten and one in four before RAIN_CHANGED_AT, which replays of older games
// keep). Hard's rain is a storm: lightning now and then, its thunder
// arriving a moment later, the further off the strike the longer after
// and the softer.
// Ordinary rain has no lightning, only a distant roll of thunder now and
// then.
//
// Now and then in any rain a light gust of wind blows for a few seconds and
// slants it. The wind makes no sound.
//
// Times are game milliseconds, like everything else in a game.

import { mix } from "./seed.js";

const RAIN_SALT = 0x7261696e;
const EVENT_SALT = 0x7468756e;

// How many games in five rain.
const CHANCE = { easy: 1, medium: 1, hard: 3 };
// Until RAIN_CHANGED_AT it was 1 in n games, and a game played before then,
// or one whose time nobody knows (every game since records it), keeps the
// weather it was played in.
const OLD_CHANCE = { easy: 10, medium: 10, hard: 4 };
export const RAIN_CHANGED_AT = Date.UTC(2026, 10, 3, 22, 0);

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

// playedAt: when the game was played, ms since 1970, or null if unknown.
export function weatherOf(seedNum, difficulty, playedAt = null) {
  const h = mix(seedNum, RAIN_SALT);
  const rain = playedAt != null && playedAt >= RAIN_CHANGED_AT
    ? h % 5 < (CHANCE[difficulty] ?? CHANCE.medium)
    : h % (OLD_CHANCE[difficulty] ?? OLD_CHANCE.medium) === 0;
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

// Gusts: at most one a slot, in that share of slots, lasting GUST_MS and up
// to GUST_SPREAD more, easing up and dying away.
const GUST_SLOT = 18000;
const GUST_ODDS = 60;
const GUST_MS = 4000;
const GUST_SPREAD = 4000;
const GUST_SALT = 0x77696e64;

// The gust blowing at t: { strength, angle }, strength 0 when still, up to
// 1, angle in radians round from x towards z.
export function windAt(weather, seedNum, t) {
  if (!weather?.rain || t < 0) return { strength: 0, angle: 0 };
  // Across the camera's usual view, so the slant shows: towards the left
  // of the screen or the right, as the game's seed has it, give or take a
  // little for each gust.
  const base = mix(seedNum, GUST_SALT) % 2 ? 2.356 : -0.785;
  const k = Math.floor(t / GUST_SLOT);
  for (const j of [k, k - 1]) {
    if (j < 0) continue;
    const h = mix(mix(seedNum, GUST_SALT + 1), j);
    if (h % 100 >= GUST_ODDS) continue;
    const length = GUST_MS + (mix(h, 1) % GUST_SPREAD);
    const at = j * GUST_SLOT + 2000 + (mix(h, 2) % (GUST_SLOT - 4000));
    const u = (t - at) / length;
    if (u < 0 || u > 1) continue;
    const strength = (0.55 + (mix(h, 3) % 450) / 1000) * Math.sin(Math.PI * u) ** 2;
    const angle = base + ((mix(h, 4) % 1001) / 1000 - 0.5) * 0.7;
    return { strength, angle };
  }
  return { strength: 0, angle: base };
}
