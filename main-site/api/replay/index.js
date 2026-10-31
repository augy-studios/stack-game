// GET /api/replay?id=<8 characters> -> { record, name, verified, created_at }
// What a short /r/<id> link plays. A stored replay never changes, so it is
// cached hard at the edge.

import { endpoint, HttpError, replayId } from "../_lib/http.js";
import { rest } from "../_lib/supabase.js";

export default endpoint("GET", async ({ req, res }) => {
  const id = replayId(req.query?.id);
  const [row] = (await rest(`uwustack_replays?id=eq.${id}&select=body,name,verified,created_at`)) ?? [];
  if (!row) throw new HttpError(404, "not_found", "That replay could not be found.");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800");
  return { record: row.body, name: row.name, verified: row.verified === true, created_at: row.created_at };
});
