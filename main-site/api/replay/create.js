// POST /api/replay/create -> { id }
//
//   { game_id, client_key, name? }   a game this API started and the page
//                                    finished: stored from the server's
//                                    own copy, and marked checked
//   { record, name? }                any other game, a race or one started
//                                    offline: stored as sent, unchecked
//
// The page links to /r/<id>, much shorter than the long link that carries
// the whole game. A game has one short link; asking again returns the same
// id. Names go through the leaderboard's word filter, and a name that fails
// it is left off.

import { randomInt } from "node:crypto";
import { endpoint, HttpError, clientKey, gameId, limit } from "../_lib/http.js";
import { cleanName } from "../_lib/names.js";
import { rest } from "../_lib/supabase.js";
import { readRecord } from "../_lib/verify.js";
import { runRecord } from "../../js/sim.js";

const ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const ID_LENGTH = 8;

const newId = () => Array.from({ length: ID_LENGTH }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join("");

function nameOrNull(value) {
  if (value == null || value === "") return null;
  try {
    return cleanName(value);
  } catch {
    return null;
  }
}

async function store(row) {
  // Eight characters from 55 make a clash vanishingly rare, but a second
  // try costs nothing.
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = newId();
    try {
      await rest("uwustack_replays", { method: "POST", body: { id, ...row } });
      return id;
    } catch (err) {
      if (!/supabase 409/.test(err.message ?? "")) throw err;
    }
  }
  throw new HttpError(503, "busy", "Could not store the replay. Try again.");
}

async function fromGame(body) {
  const id = gameId(body.game_id);
  const key = clientKey(body.client_key);
  const [game] = (await rest(`uwustack_games?id=eq.${id}&client_key=eq.${encodeURIComponent(key)}&select=id,record`)) ?? [];
  if (!game) throw new HttpError(404, "not_found", "That game does not exist.");
  if (!game.record) throw new HttpError(409, "not_finished", "Only a finished game can be replayed.");

  const [existing] = (await rest(`uwustack_replays?game_id=eq.${id}&select=id`)) ?? [];
  if (existing) return { id: existing.id };

  const record = readRecord(game.record);
  try {
    return { id: await store({ game_id: id, verified: true, name: nameOrNull(body.name), body: record }) };
  } catch (err) {
    // Asked twice at once: the other request stored it first.
    const [row] = (await rest(`uwustack_replays?game_id=eq.${id}&select=id`)) ?? [];
    if (row) return { id: row.id };
    throw err;
  }
}

async function fromRecord(body) {
  const record = readRecord(body.record);
  if (runRecord(record).error) throw new HttpError(400, "bad_record", "Those taps do not make a game.");
  return { id: await store({ verified: false, name: nameOrNull(body.name), body: record }) };
}

export default endpoint("POST", async ({ req, body }) => {
  await limit(req, "replay", 600, 60);
  return body.game_id ? fromGame(body) : fromRecord(body);
});
