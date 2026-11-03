// GET /api/replay?id=<8 characters> -> { record, name, verified, created_at, played_at }
// What a short /r/<id> link plays. A stored replay never changes, so it is
// cached hard at the edge.
//
// played_at is when the game was played: kept in the body by replay/create
// since it learned to, or for an older link, the start time of the game the
// server ran, or failing that the time the link was made.

import { endpoint, HttpError, replayId } from "../_lib/http.js";
import { rest } from "../_lib/supabase.js";

export default endpoint("GET", async ({ req, res }) => {
  const id = replayId(req.query?.id);
  const [row] = (await rest(`uwustack_replays?id=eq.${id}&select=body,name,verified,created_at,game_id`)) ?? [];
  if (!row) throw new HttpError(404, "not_found", "That replay could not be found.");
  let played = typeof row.body?.played_at === "string" ? row.body.played_at : null;
  if (!played && row.game_id) {
    const [game] = (await rest(`uwustack_games?id=eq.${row.game_id}&select=created_at`)) ?? [];
    played = game?.created_at ?? null;
  }
  played ??= row.created_at;
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800");
  return { record: row.body, name: row.name, verified: row.verified === true, created_at: row.created_at, played_at: played };
});
