// A game as it is kept, sent and shared: what js/sim.js needs to play it
// again, and nothing it can work out for itself.
//
// {
//   v: 2,                          the rules it was played by (js/rules.js's
//                                  RULES_VERSION); a v 1 game replays under
//                                  version 1's rules
//   seed: "BXK4-M9TR",
//   difficulty: "easy" | "medium" | "hard",
//   turn: 0 | 10 | 5 | 3,          seconds a slab may swing, 0 for no limit
//   game: 0 | 300 | 180 | 60,      seconds the game may last, 0 for no limit
//   taps: [ms, ...],               game time of every tap, in order
//   end: ms,                       when the game stopped
//   auto: true,                    present when autoplay played any of it
// }
//
// The score is never part of it. Whoever reads a record works the score out
// again with sim.js, so a record cannot claim points its taps do not add
// up to. It can still be made up, which is why the leaderboard only takes
// games the API started and checks how they were played.
//
// Shared as one URL-safe token, packRecord(), with the taps as
// variable-length gaps:
//
//   <v>.<seed>.<difficulty letter>.<turn>.<game>.<end>.<taps>[.a]
//
// end in base 36, taps base64url. A few hundred taps fit in about a
// kilobyte, well inside what any browser keeps in an address.

import { MAX_TAPS, MAX_GAME_MS, RULES_VERSION, cleanDifficulty, cleanTurn, cleanGameLimit, TURN_LIMITS, GAME_LIMITS, DIFFICULTIES } from "./rules.js";
import { cleanSeed } from "./seed.js";

// The version new games are recorded under, and every version still read.
export const RECORD_VERSION = RULES_VERSION;
const READABLE = [1, 2];

const LETTERS = { easy: "e", medium: "m", hard: "h" };
const FROM_LETTER = { e: "easy", m: "medium", h: "hard" };

// A record from anywhere, a request or a link, checked and in canonical
// form, or null if it is not one.
export function cleanRecord(value) {
  if (!value || typeof value !== "object") return null;
  if (!READABLE.includes(value.v)) return null;
  const seed = cleanSeed(value.seed);
  if (!seed) return null;
  if (!Object.hasOwn(DIFFICULTIES, value.difficulty)) return null;
  if (!Object.hasOwn(TURN_LIMITS, String(value.turn))) return null;
  if (!Object.hasOwn(GAME_LIMITS, String(value.game))) return null;
  if (!Array.isArray(value.taps) || value.taps.length > MAX_TAPS) return null;

  let last = 0;
  for (const t of value.taps) {
    if (!Number.isInteger(t) || t < last || t > MAX_GAME_MS) return null;
    last = t;
  }
  if (!Number.isInteger(value.end) || value.end < last || value.end > MAX_GAME_MS) return null;

  const out = {
    v: value.v,
    seed,
    difficulty: cleanDifficulty(value.difficulty),
    turn: cleanTurn(value.turn),
    game: cleanGameLimit(value.game),
    taps: [...value.taps],
    end: value.end,
  };
  if (value.auto === true) out.auto = true;
  return out;
}

/* ---- the token ---- */

function toBase64Url(bytes) {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  const plain = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(plain + "===".slice((plain.length + 3) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// Gaps between taps, seven bits to a byte, high bit set on all but the last
// byte of each.
function packTaps(taps) {
  const bytes = [];
  let last = 0;
  for (const t of taps) {
    let gap = t - last;
    last = t;
    while (gap >= 0x80) {
      bytes.push((gap & 0x7f) | 0x80);
      gap = Math.floor(gap / 0x80);
    }
    bytes.push(gap);
  }
  return toBase64Url(bytes);
}

function unpackTaps(text) {
  const bytes = fromBase64Url(text);
  const taps = [];
  let last = 0;
  let gap = 0;
  let scale = 1;
  for (const b of bytes) {
    gap += (b & 0x7f) * scale;
    if (b & 0x80) {
      scale *= 0x80;
      if (scale > 2 ** 35) return null;
      continue;
    }
    last += gap;
    taps.push(last);
    gap = 0;
    scale = 1;
    if (taps.length > MAX_TAPS) return null;
  }
  return scale === 1 ? taps : null;
}

export function packRecord(record) {
  const parts = [
    record.v,
    record.seed.replace("-", ""),
    LETTERS[record.difficulty],
    record.turn,
    record.game,
    record.end.toString(36),
    packTaps(record.taps),
  ];
  if (record.auto) parts.push("a");
  return parts.join(".");
}

// A token back into a record, or null.
export function unpackRecord(token) {
  try {
    const parts = String(token ?? "").trim().split(".");
    if (parts.length < 7 || parts.length > 8) return null;
    const [v, seed, letter, turn, game, end, taps, flag] = parts;
    if (!READABLE.includes(Number(v)) || (flag !== undefined && flag !== "a")) return null;
    if (!/^[0-9a-z]{1,8}$/.test(end)) return null;
    const list = taps ? unpackTaps(taps) : [];
    if (!list) return null;
    return cleanRecord({
      v: Number(v),
      seed,
      difficulty: FROM_LETTER[letter],
      turn: Number(turn),
      game: Number(game),
      taps: list,
      end: parseInt(end, 36),
      auto: flag === "a",
    });
  } catch {
    return null;
  }
}
