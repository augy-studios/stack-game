// POST /api/game/start
//   { client_key, mode, seed, difficulty, turn, game } -> { game_id, seed, created_at }
// The start ticket. A game can only go on the leaderboard if it began here,
// which is what gives it a start time no browser can move. Games started
// offline play the same; they just have no ticket.
//
// The browser picks the seed, so the game can start the moment the player
// taps rather than after a round trip. A seed only decides which way
// growing slabs grow and what colour things are; knowing it ahead buys
// nothing. A race passes the host's seed, so every player gets the same one.

import { endpoint, HttpError, clientKey, limit } from "../_lib/http.js";
import { rest, rpc } from "../_lib/supabase.js";
import { cleanSeed } from "../../js/seed.js";
import { DIFFICULTIES, TURN_LIMITS, GAME_LIMITS } from "../../js/rules.js";

export default endpoint("POST", async ({ req, body }) => {
  const key = clientKey(body.client_key);
  const mode = body.mode;
  if (mode !== "solo" && mode !== "party") throw new HttpError(400, "bad_mode");
  const seed = cleanSeed(body.seed);
  if (!seed) throw new HttpError(400, "bad_seed");
  if (!Object.hasOwn(DIFFICULTIES, body.difficulty)) throw new HttpError(400, "bad_difficulty");
  if (!Object.hasOwn(TURN_LIMITS, String(body.turn))) throw new HttpError(400, "bad_turn");
  if (!Object.hasOwn(GAME_LIMITS, String(body.game))) throw new HttpError(400, "bad_game");

  await limit(req, "start", 600, 120);

  const [row] = await rest("uwustack_games?select=id,created_at", {
    method: "POST",
    prefer: "return=representation",
    body: {
      mode,
      seed,
      difficulty: body.difficulty,
      turn_limit: Number(body.turn),
      game_limit: Number(body.game),
      client_key: key,
    },
  });

  // Now and then, clear out what nobody will submit.
  if (Math.random() < 0.02) rpc("uwustack_prune", {}).catch(() => {});

  return { game_id: row.id, seed, created_at: row.created_at };
});
