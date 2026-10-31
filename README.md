# uwuStack

Stack slabs as high as you can before the water rises over the top. Tap to
drop each slab; whatever hangs over the edge is cut off and falls. A perfect
drop rings a rising chime, and a run of them grows the slab back. Race
friends on the same wifi, watch every game back, and share the replay.

Live at <https://stack.uwuapps.org>. A PWA: once opened, it plays offline.

## What runs where

| Part | Runs on |
| --- | --- |
| `main-site/`, the PWA and its API (`main-site/api/`) | Vercel, root directory `main-site` |
| Database, `uwustack_*` tables | The shared uwuapps Supabase project |
| Races | Browser to browser over WebRTC. PeerJS's public broker introduces the devices; nothing of ours is in between |

There is nothing on the VPS.

## Layout

```text
README.md
docs/            the specs this is built to, and the reference screenshots
migrations/      SQL to run in the Supabase SQL editor, in number order
scripts/         pre-deploy checks and the rules tests
main-site/       the site Vercel deploys, including api/
```

`docs/` holds `uwuapps-theme.md`, `uwuapps-retrofit-time-mode.md`,
`update-bar-spec.md`, `edge-tray-spec.md` and `STUN-p2p-spec.md`.
`main-site/README.md` covers the app itself.

## First setup

1. Run every file in `migrations/`, in number order, in the Supabase SQL
   editor of the shared uwuapps project.
2. On the Vercel project (root directory `main-site`), set the variables in
   `main-site/.env.example`: `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.
3. Add the domain `stack.uwuapps.org` to the Vercel project.
4. Deploy.

Without the variables the site still plays in full; the API answers
`not_configured` and every game says it is not scored.

## Migrations

**Never edit a file once it has been run.** Every change to the schema is a
new file with the next number. Each file is safe to run again.

| File | What it does |
| --- | --- |
| `001_uwustack_schema.sql` | Games (the start tickets), the leaderboard and its best and total views, the short replay links, rate limits, and the finish, submit and prune functions. |

Every table has row level security on with no policies. Only the service
role key, used by the Vercel functions, can read or write, and only it can
call the functions.

## Before every deploy

1. Bump `VERSION` in `main-site/sw.js`. Without it, returning visitors keep
   the previous build and never see the update bar.
2. Run the checks, from the repo root, with Node 20 or later and nothing to
   install:

```text
node scripts/check-sw.mjs          # the worker only activates when asked
node scripts/check-precache.mjs    # everything the app loads works offline
node scripts/check-theme.mjs       # pre-paint script matches js/theme.js
node scripts/test-sim.mjs          # same taps, same game; how long games last
node scripts/test-verify.mjs       # the API's check on a game, without a database
```

**If you change `js/sim.js`, `js/rules.js`, `js/seed.js` or
`js/record.js`,** two things that were played on the old build change with
them: games still open in someone's tab stop verifying, since the API plays
every game again with the code it has now; and old replay links play out
differently. Bump `RECORD_VERSION` in `js/record.js` for any change that
alters how a record plays, and keep reading the old version, or accept that
old links break.
