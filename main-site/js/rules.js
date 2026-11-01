// The game's numbers: sizes, speeds, the water, and scoring. One file for
// everything that applies them, the page, the replay and the API, so they
// can never disagree about a score.
//
// Pure, and integers only. Distances are in units, where the base of the
// tower is 1000 units square and a slab is 200 thick; times are in
// milliseconds of game time. A rate is units per second, and an
// acceleration is thousandths of a unit per second per second, so nothing
// ever needs a fraction.

// BASE is full size: Medium's starting slab, and the size a run of perfects
// grows a slab back towards on every difficulty. Easy starts above it, so
// its slab only grows back once cuts take it under; Hard starts a little
// below it, so a good run can grow its slab past where it began.
export const BASE = 1000;
export const LAYER = 200;
// How far the moving slab swings either side of the one below it.
export const SWING = 1200;
// The water starts this far below the top of the base, and the island's top
// sits between the two.
export const WATER_START = -1600;
export const ISLAND_TOP = -1000;

// The most taps one game may hold, and the longest it may run. Far beyond
// anything a person plays; they keep a record a sensible size.
export const MAX_TAPS = 20000;
export const MAX_GAME_MS = 6 * 60 * 60 * 1000;

// Per difficulty. The starting slab is what sets them apart most; the rest
// differ only a little.
//   start                        the base's size, and so the first slab's,
//                                square; growing never takes a slab past
//                                BASE, whatever this is
//   speed0, speedStep, speedMax  the slab's speed for layer n is
//                                speed0 + speedStep * (n - 1), up to speedMax
//   perfect                      how far off a drop may be and still count
//                                as perfect, which snaps it into line
//   water0, waterAccel           the water rises at water0 at first, and
//                                faster by waterAccel every second for as
//                                long as the game lasts, so in the end it
//                                always wins
//   combo, grow                  from this many perfects in a row, each
//                                perfect also grows the slab back towards
//                                BASE by grow units, more as the combo
//                                goes on
//   percent                      what the game's points count for
export const DIFFICULTIES = {
  easy: {
    label: "Easy",
    start: 1400,
    speed0: 1100, speedStep: 12, speedMax: 3000,
    perfect: 48,
    water0: 80, waterAccel: 1200,
    combo: 4, grow: 30,
    percent: 75,
  },
  medium: {
    label: "Medium",
    start: 1000,
    speed0: 1200, speedStep: 14, speedMax: 3200,
    perfect: 42,
    water0: 90, waterAccel: 1333,
    combo: 4, grow: 30,
    percent: 100,
  },
  hard: {
    label: "Hard",
    start: 900,
    speed0: 1300, speedStep: 16, speedMax: 3400,
    perfect: 38,
    water0: 100, waterAccel: 1450,
    combo: 4, grow: 30,
    percent: 150,
  },
};
// The biggest base any difficulty starts with, for the scene to leave room.
export const MAX_START = Math.max(...Object.values(DIFFICULTIES).map((d) => d.start));
export const DEFAULT_DIFFICULTY = "medium";

// Time limits, in seconds, and the percentage each counts for. A turn limit
// drops a slab by itself once it has been swinging that long, wherever it
// is; it counts on every drop. A game limit ends the game when it runs out;
// it counts on the whole game. 0 is no limit.
export const TURN_LIMITS = { 0: 100, 10: 110, 5: 125, 3: 150 };
export const GAME_LIMITS = { 0: 100, 300: 110, 180: 125, 60: 150 };

// A drop made on the slab's first pass over the tower counts for more, and
// on its second pass a little more.
export const FIRST_PASS = 125;
export const SECOND_PASS = 110;

// The game total grows by 1% for every 6 seconds survived, up to 50% at five
// minutes.
export const SURVIVAL_STEP_MS = 6000;
export const SURVIVAL_MAX = 50;

export const difficultyOf = (id) => DIFFICULTIES[id] ?? DIFFICULTIES[DEFAULT_DIFFICULTY];

export function cleanDifficulty(value) {
  return Object.hasOwn(DIFFICULTIES, value) ? value : DEFAULT_DIFFICULTY;
}

export function cleanTurn(value) {
  const n = Number(value);
  return Object.hasOwn(TURN_LIMITS, String(n)) ? n : 0;
}

export function cleanGameLimit(value) {
  const n = Number(value);
  return Object.hasOwn(GAME_LIMITS, String(n)) ? n : 0;
}

export function describeTurn(seconds) {
  return seconds ? `${seconds} s a slab` : "No turn limit";
}

export function describeGame(seconds) {
  return seconds ? `${seconds / 60} min game` : "No game limit";
}

/* ---- the slab ---- */

export function speedFor(d, layer) {
  return Math.min(d.speedMax, d.speed0 + d.speedStep * (layer - 1));
}

// Where the moving slab is `ms` after it appeared, as an offset from the
// slab below it along its axis. It starts SWING behind, and runs back and
// forth between -SWING and +SWING at `speed`.
export function swingAt(speed, ms) {
  const travelled = Math.floor((speed * ms) / 1000);
  const phase = travelled % (4 * SWING);
  return phase < 2 * SWING ? -SWING + phase : 3 * SWING - phase;
}

// Ms the slab takes to cross from one end of its swing to the other.
export function passMs(speed) {
  return Math.floor((2 * SWING * 1000) / speed);
}

// The exact ms after appearing at which the slab first lines up, which is
// when the autoplayer taps.
export function alignMs(speed) {
  return Math.ceil((SWING * 1000) / speed);
}

/* ---- the water ---- */

// The water's height at `ms` into the game. The part that accelerates is
// worked out a whole second at a time and filled in straight between, which
// keeps every product far inside the range doubles hold exactly, even six
// hours in.
export function waterAt(d, ms) {
  const t = Math.max(0, ms);
  const s = Math.floor(t / 1000);
  const q = (x) => Math.floor((d.waterAccel * x * x) / 2000);
  const lo = q(s);
  const rise = lo + Math.floor(((q(s + 1) - lo) * (t - s * 1000)) / 1000);
  return WATER_START + Math.floor((d.water0 * t) / 1000) + rise;
}

// The first whole ms in (from, to] at which the water is above `top`, or
// null if it stays at or below it. The water never falls, so a binary
// search finds it.
export function waterOverAt(d, top, from, to) {
  if (waterAt(d, to) <= top) return null;
  let lo = from;
  let hi = to;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (waterAt(d, mid) > top) hi = mid;
    else lo = mid;
  }
  return hi;
}

/* ---- scoring ---- */

// A layer's own points before anything multiplies them: higher layers are
// worth more, so the score grows with the game.
export const layerPoints = (layer) => 10 + layer;

// Percent for how well a drop landed. A perfect is worth double and more
// with every perfect before it in a row; a cut keeps the share of the slab
// that stayed on, never less than a quarter.
export function accuracyPercent(perfect, combo, kept, size) {
  if (perfect) return 200 + 10 * Math.min(combo, 10);
  return Math.max(25, Math.floor((kept * 100) / size));
}

// Percent for how soon a drop came: on the first pass, the second, or later.
// A drop the turn limit made gets nothing extra.
export function speedPercent(ms, speed, auto) {
  if (auto) return 100;
  const pass = passMs(speed);
  if (ms <= pass) return FIRST_PASS;
  if (ms <= 2 * pass) return SECOND_PASS;
  return 100;
}

export function dropPoints(layer, accuracy, speed, turn) {
  return Math.floor((layerPoints(layer) * accuracy * speed * TURN_LIMITS[turn]) / 1e6);
}

export function survivalPercent(ms) {
  return 100 + Math.min(SURVIVAL_MAX, Math.floor(ms / SURVIVAL_STEP_MS));
}

// The game's score: every drop's points, then the difficulty, the game
// limit and the time survived.
export function gameScore(points, settings, ms) {
  const d = difficultyOf(settings.difficulty);
  return Math.floor((points * d.percent * GAME_LIMITS[settings.game] * survivalPercent(ms)) / 1e6);
}

// The same, as lines a person can read.
export function scoreBreakdown(points, settings, ms) {
  const d = difficultyOf(settings.difficulty);
  return [
    ["Drops", points],
    [`${d.label}`, `${d.percent}%`],
    [describeGame(settings.game), `${GAME_LIMITS[settings.game]}%`],
    ["Time survived", `${survivalPercent(ms)}%`],
  ];
}
