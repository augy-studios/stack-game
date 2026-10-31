-- uwuStack: the tallest-tower board. Paste into the Supabase SQL editor and
-- run once, after 001. Safe to run again.
--
-- Each name's highest tower. layers is the tower's final height, worked out
-- by the API playing the game again, so it is as trustworthy as the score.
-- The earliest of an equal top height wins, and the casing shown is the one
-- attached to that game.
create or replace view uwustack_leaderboard_tallest
with (security_invoker = true) as
select distinct on (lower(name)) name, layers, score, difficulty, created_at
from uwustack_leaderboard
order by lower(name), layers desc, created_at asc;
