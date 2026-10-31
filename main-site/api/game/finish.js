// POST /api/game/finish  { game_id, client_key, record } -> { elapsed_ms }
// Sent by the page the moment a game ends, so the server's clock stops
// then and not whenever somebody gets round to submitting, and so the game
// is kept for a checked replay link. The record is checked as it would be
// on submit; a game that would be refused there is refused here too.

import { endpoint, HttpError, clientKey, gameId, limit } from "../_lib/http.js";
import { rest, rpc } from "../_lib/supabase.js";
import { readRecord, check } from "../_lib/verify.js";

const REFUSALS = {
  not_found: [404, "That game does not exist."],
  expired: [410, "That game started more than 12 hours ago."],
  not_yours: [403, "That game was started in a different browser."],
  mismatch: [409, "That game already ended with other taps."],
};

export default endpoint("POST", async ({ req, body }) => {
  const id = gameId(body.game_id);
  const key = clientKey(body.client_key);
  const record = readRecord(body.record);

  await limit(req, "finish", 600, 120);

  const [game] = (await rest(`uwustack_games?id=eq.${id}&select=*`)) ?? [];
  if (!game) throw new HttpError(404, "not_found", REFUSALS.not_found[1]);
  check(game, record, Date.now() - Date.parse(game.created_at));

  const [row] = (await rpc("uwustack_finish", { p_game_id: id, p_client_key: key, p_record: record })) ?? [];
  if (row?.status !== "ok") {
    const [status, message] = REFUSALS[row?.status] ?? [500, "Could not record the end of the game."];
    throw new HttpError(status, row?.status ?? "server", message);
  }
  return { elapsed_ms: Date.parse(row.finished_at) - Date.parse(row.created_at) };
});
