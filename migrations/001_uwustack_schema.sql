-- uwuStack (stack.uwuapps.org) schema, in the shared uwuapps Supabase project.
-- Paste into the Supabase SQL editor and run once. Safe to run again:
-- everything is "if not exists" or "or replace".
--
-- Access model: only the Vercel functions touch these tables, with the
-- service role key. RLS is on with no policies, so an anon key reads nothing.
--
-- The game's rules are not in here. The API plays every submitted game again
-- with the same code the browser plays with (main-site/js/sim.js), works out
-- its score, and only then calls uwustack_submit, which does the checks that
-- need the database.

-- One row per game that could go on the leaderboard: a game started while
-- online. The row is the start ticket; created_at is the server's clock,
-- which a browser cannot move.
create table if not exists uwustack_games (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('solo', 'party')),
  seed text not null check (seed ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  -- Seconds, 0 for no limit.
  turn_limit smallint not null default 0 check (turn_limit in (0, 3, 5, 10)),
  game_limit smallint not null default 0 check (game_limit in (0, 60, 180, 300)),
  client_key text not null,             -- the browser that started it
  created_at timestamptz not null default now(),
  -- Set when the page reports the end of the game: the whole game, in
  -- main-site/js/record.js's shape, and the server's time it ended.
  record jsonb check (record is null or octet_length(record::text) <= 262144),
  finished_at timestamptz
);

create index if not exists uwustack_games_created on uwustack_games (created_at);

create table if not exists uwustack_leaderboard (
  id bigserial primary key,
  name text not null,
  score int not null check (score >= 0),
  layers int not null check (layers >= 0),
  difficulty text not null,
  mode text not null,
  game_id uuid not null unique references uwustack_games(id) on delete cascade,
  -- The game's own times, copied here so the overlap check survives pruning.
  started_at timestamptz not null,
  finished_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists uwustack_lb_name on uwustack_leaderboard (lower(name), score desc);

-- Each name's best game. The earliest of an equal top score wins, and the
-- casing shown is the one attached to that score.
create or replace view uwustack_leaderboard_best
with (security_invoker = true) as
select distinct on (lower(name)) name, score, layers, difficulty, created_at
from uwustack_leaderboard
order by lower(name), score desc, created_at asc;

-- Every submitted game added up per name. The casing shown is the most
-- recent one.
create or replace view uwustack_leaderboard_total
with (security_invoker = true) as
select
  (array_agg(name order by created_at desc))[1] as name,
  sum(score)::bigint as total,
  count(*)::int as games,
  max(created_at) as last_at
from uwustack_leaderboard
group by lower(name);

-- Replays behind the short /r/<id> links. One from a game this API started
-- is copied from the game's own record and is verified; one sent by a page
-- is not. The body is the whole record, so it outlives the game row, which
-- uwustack_prune may delete.
create table if not exists uwustack_replays (
  id text primary key check (id ~ '^[A-Za-z0-9]{8}$'),
  game_id uuid unique references uwustack_games(id) on delete set null,
  verified boolean not null default false,
  name text check (name is null or char_length(name) <= 20),
  body jsonb not null check (octet_length(body::text) <= 262144),
  created_at timestamptz not null default now()
);

-- Fixed window counters for rate limiting by (hashed) IP. There are no
-- accounts to limit against, and Vercel functions share no memory.
create table if not exists uwustack_rate_limits (
  bucket text primary key,
  window_start timestamptz not null,
  hits int not null
);

alter table uwustack_games enable row level security;
alter table uwustack_leaderboard enable row level security;
alter table uwustack_replays enable row level security;
alter table uwustack_rate_limits enable row level security;

-- True while the bucket is under its limit. One statement, so concurrent
-- hits cannot both read the old count.
create or replace function uwustack_hit(p_bucket text, p_window_seconds int, p_max int)
returns boolean
language sql
volatile
as $$
  insert into uwustack_rate_limits as r (bucket, window_start, hits)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update set
    window_start = case
      when r.window_start < now() - make_interval(secs => p_window_seconds) then now()
      else r.window_start end,
    hits = case
      when r.window_start < now() - make_interval(secs => p_window_seconds) then 1
      else r.hits + 1 end
  returning hits <= p_max;
$$;

-- Records the end of a game, sent by the page the moment it ends, so the
-- time spent afterwards watching the replay or typing a name is not
-- counted. The API has played the record through first. A game ends once:
-- a second, different ending is refused.
--
--   not_found   no such game
--   expired     started more than 12 hours ago
--   not_yours   sent from a browser other than the one that started it
--   mismatch    the game already ended with other taps
create or replace function uwustack_finish(p_game_id uuid, p_client_key text, p_record jsonb)
returns table (status text, created_at timestamptz, finished_at timestamptz)
language plpgsql
volatile
as $$
#variable_conflict use_column
declare
  v_game uwustack_games%rowtype;
begin
  select * into v_game from uwustack_games where id = p_game_id for update;
  if not found then
    return query select 'not_found'::text, null::timestamptz, null::timestamptz;
    return;
  end if;
  if v_game.created_at < now() - interval '12 hours' then
    return query select 'expired'::text, null::timestamptz, null::timestamptz;
    return;
  end if;
  if p_client_key <> v_game.client_key then
    return query select 'not_yours'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  if v_game.record is null then
    update uwustack_games set record = p_record, finished_at = now() where id = p_game_id
    returning finished_at into v_game.finished_at;
  elsif v_game.record <> p_record then
    return query select 'mismatch'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  return query select 'ok'::text, v_game.created_at, v_game.finished_at;
end;
$$;

-- Puts a checked game on the board. The API has already played the record
-- through, held it against the server's clock, and worked out the score;
-- this checks what only the database can:
--
--   not_found          no such game
--   expired            started more than 12 hours ago
--   not_yours          submitted from a browser other than the one that
--                      started it
--   already_submitted  this game is already on the board
--   mismatch           the game already ended with other taps
--   overlap            played while another game on the board under this
--                      name was also being played; a person plays one
--                      tower at a time
create or replace function uwustack_submit(
  p_game_id uuid,
  p_client_key text,
  p_name text,
  p_record jsonb,
  p_score int,
  p_layers int
)
returns table (status text, best_score int, rank bigint, total bigint, games int, total_rank bigint)
language plpgsql
volatile
as $$
#variable_conflict use_column
declare
  v_game uwustack_games%rowtype;
  v_best int;
  v_best_at timestamptz;
  v_total bigint;
  v_games int;
begin
  select * into v_game from uwustack_games where id = p_game_id for update;

  if not found then
    return query select 'not_found'::text, null::int, null::bigint, null::bigint, null::int, null::bigint;
    return;
  end if;
  if v_game.created_at < now() - interval '12 hours' then
    return query select 'expired'::text, null::int, null::bigint, null::bigint, null::int, null::bigint;
    return;
  end if;
  if p_client_key <> v_game.client_key then
    return query select 'not_yours'::text, null::int, null::bigint, null::bigint, null::int, null::bigint;
    return;
  end if;
  if exists (select 1 from uwustack_leaderboard l where l.game_id = p_game_id) then
    return query select 'already_submitted'::text, null::int, null::bigint, null::bigint, null::int, null::bigint;
    return;
  end if;

  -- A game the page never reported the end of ends now.
  if v_game.record is null then
    update uwustack_games set record = p_record, finished_at = now() where id = p_game_id
    returning finished_at into v_game.finished_at;
  elsif v_game.record <> p_record then
    return query select 'mismatch'::text, null::int, null::bigint, null::bigint, null::int, null::bigint;
    return;
  end if;

  -- One submission per name at a time, so two sent together cannot both
  -- miss each other in the check below.
  perform pg_advisory_xact_lock(hashtext('uwustack_submit:' || lower(p_name)));

  if exists (
    select 1
    from uwustack_leaderboard l
    where lower(l.name) = lower(p_name)
      and l.started_at < v_game.finished_at
      and l.finished_at > v_game.created_at
  ) then
    return query select 'overlap'::text, null::int, null::bigint, null::bigint, null::int, null::bigint;
    return;
  end if;

  insert into uwustack_leaderboard (name, score, layers, difficulty, mode, game_id, started_at, finished_at)
  values (p_name, p_score, p_layers, v_game.difficulty, v_game.mode, p_game_id, v_game.created_at, v_game.finished_at);

  select l.score, l.created_at into v_best, v_best_at
  from uwustack_leaderboard l
  where lower(l.name) = lower(p_name)
  order by l.score desc, l.created_at asc
  limit 1;

  select sum(l.score)::bigint, count(*)::int into v_total, v_games
  from uwustack_leaderboard l
  where lower(l.name) = lower(p_name);

  return query
  select
    'ok'::text,
    v_best,
    (
      select count(*) + 1
      from uwustack_leaderboard_best b
      where b.score > v_best or (b.score = v_best and b.created_at < v_best_at)
    ),
    v_total,
    v_games,
    (
      select count(*) + 1
      from uwustack_leaderboard_total t
      where lower(t.name) <> lower(p_name)
        and (
          t.total > v_total
          or (t.total = v_total and t.games < v_games)
          -- This name's total was only just reached, so an equal one got there first.
          or (t.total = v_total and t.games = v_games)
        )
    );
end;
$$;

-- Housekeeping, called now and then by /api/game/start: old counters, and
-- games nobody submitted that are past any use. Replays keep their own
-- copy of the game.
create or replace function uwustack_prune()
returns void
language sql
volatile
as $$
  delete from uwustack_rate_limits where window_start < now() - interval '1 day';
  delete from uwustack_games g
  where g.created_at < now() - interval '2 days'
    and not exists (select 1 from uwustack_leaderboard l where l.game_id = g.id);
$$;

-- Service role only.
revoke all on function uwustack_hit(text, int, int) from public, anon, authenticated;
revoke all on function uwustack_finish(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function uwustack_submit(uuid, text, text, jsonb, int, int) from public, anon, authenticated;
revoke all on function uwustack_prune() from public, anon, authenticated;
grant execute on function uwustack_hit(text, int, int) to service_role;
grant execute on function uwustack_finish(uuid, text, jsonb) to service_role;
grant execute on function uwustack_submit(uuid, text, text, jsonb, int, int) to service_role;
grant execute on function uwustack_prune() to service_role;
