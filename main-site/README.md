# main-site

What Vercel deploys, served at <https://stack.uwuapps.org>. No build step:
the files are served as they are, and `api/` holds the serverless functions.

| Path | What it is |
| --- | --- |
| `index.html` | The only page. Its `<head>` is the template for any page added later. |
| `404.html`, `404.css` | The shared not-found page. |
| `sw.js` | Service worker: the offline shell, and the update bar's waiting worker. |
| `manifest.json` | PWA manifest. Opens full screen when installed. |
| `RST-main.png`, `RST-192.png`, `RST-512.png`, `favicon.ico` | The app icon. Everything sits inside the circle a launcher crops to, so the 512 doubles as the maskable icon. |
| `css/theme.css` | The uwuapps theme, verbatim from `docs/uwuapps-theme.md`, time-based mode included. |
| `css/style.css` | Layout: the full-bleed game, the score, the sheets and the Edge Tray. |
| `js/` | ES modules, below. |
| `vendor/three/` | three.js r187, with its licence, vendored so it is precached and the game draws offline. |
| `api/` | The API, below. |
| `images/` | Manifest screenshots, at the sizes `manifest.json` gives. |

## js

Every file here is precached; `scripts/check-precache.mjs` fails if one is
not. The first four are pure, with no DOM, and the API imports them too, so
the browser and the server always agree on a game.

| File | What it does |
| --- | --- |
| `rules.js` | The numbers: sizes, speeds, the water, the difficulties, time limits and scoring. Integers only. |
| `seed.js` | Seeds, and the integer random numbers a game draws from. |
| `sim.js` | The game as data: a seed, the settings and the tap times in, every landing, cut, growth, the water and the score out. |
| `record.js` | A game as it is kept, sent and shared, and the token a long replay link carries. |
| `fall.js` | Cut-off pieces tipping, knocking against wider layers and splashing, worked out once in fixed steps so they fall the same way live and in the replay. |
| `clouds.js` | Draws the cumulus cloud sprites on a canvas, with no imports, so the Unity export draws the same ones. |
| `post.js` | High quality's post-processing: the offscreen multisampled picture, the bloom chain, and the grade, vignette and dither it is finished with. |
| `scene.js` | The three.js world: the gradient sky with its drifting cumulus and cirrus, twinkling stars and night meteors, the cloud sprites, the water, the island, the tower, the slab, the pieces and the perfect rings. |
| `view.js` | Turns a game at a moment into what the scene draws and the speakers play, for the live game and the replay alike. |
| `audio.js` | Every sound. A falling piece's knock, a grown layer's slide, the splash and the water's loop are recordings in `sounds/`; the rest are synthesised with Web Audio. The water's sounds get quieter and duller the further below the top it is. |
| `game.js` | The game screen: the start panel, play, the result, submitting, sharing, and shared replays. |
| `replay.js` | The instant replay's controls. |
| `party.js` | Races on one network, on top of `net.js`. |
| `net.js` | Pairing over PeerJS, STUN only, from `STUN-p2p-spec.md`, after uwuChess's. |
| `qr.js` | QR encoder for the join link, from uwuPromptr, so it works offline. |
| `tray.js` | The Edge Tray. |
| `freecam.js` | The replay's free camera: drag, pinch and scroll to look round the tower. |
| `api.js`, `leaderboard.js`, `settings.js` | The API client, and the leaderboard and settings windows, after MRT Station Guesser's. |
| `theme.js`, `icons.js`, `ui.js`, `update-bar.js`, `app.js` | Theme, inline SVG icons, modal and storage helpers, the update bar, and boot. |

## The game

**Playing.** A slab swings back and forth over the tower, along one side and
then the other. Tap, Space or Enter drops it. Whatever hangs over the edge
of the layer below is cut off and falls, knocking against any wider layer on
the way down, and the next slab is only as big as what stayed on. A drop
close enough to dead centre is perfect: it snaps into line, leaves a ring,
and plays a Shepard tone a semitone higher for every perfect in a row, which
keeps rising for as long as the run lasts. From a few perfects in a row, each
perfect also grows the slab back towards full size, on a side the seed
picks. The slab swings faster with every layer.

**The water** starts below the island and rises for the whole game, slowly
at first and faster all the time. When it is over the top of the tower, the
game is over. It sloshes louder the closer it gets to the layer being built,
and a chip says so.

**A game ends** when a slab misses the tower entirely, when the water rises
over the top, when the game's time limit runs out, or when the player leaves
it.

**Modes and limits**, picked on the start panel:

| Mode | Slab speed | Perfect window | Water | Counts |
| --- | --- | --- | --- | --- |
| Easy | slowest | widest | slowest | 75% |
| Medium | | | | 100% |
| Hard | fastest | narrowest | fastest | 150% |

A slab limit of 10, 5 or 3 seconds drops each slab wherever it is once it has
swung that long, and counts 110%, 125% or 150% on every drop. A game length
of 5, 3 or 1 minute ends the game when it runs out, and counts 110%, 125% or
150% on the whole game.

**Scoring.** Each drop scores its layer's points, 10 plus the layer number,
so the score grows with the game. Then:

| | |
| --- | --- |
| A perfect | 200%, plus 10% for each perfect before it in a row, up to 300% |
| A cut | the share of the slab that stayed on, never under 25% |
| Dropped on the slab's first pass over the tower | 125% |
| On its second pass | 110% |
| The slab limit | as above, on every drop |

The game's total is then scaled by the mode, the game length, and the time
survived: 1% more for every 6 seconds, up to 50% at five minutes.

**The window.** The game always fills the window, with no header or footer.
Added to the home screen, it opens full screen.

**The Edge Tray**, top right, per `edge-tray-spec.md`: sound,
races, the leaderboard, settings, the theme, and the coffee link. Its tab
slides it off the edge, and the choice is remembered.

**Instant replay.** When a game ends the camera pulls back to show the whole
tower, then the game plays itself back (a setting turns this off), sounds
and all. Play and pause, a step back or forward one slab at a time, a
timeline, and 0.5x, 1x, 2x or 4x as in the word rain game, the speed picked
last remembered in this browser. Space, and the left and right arrows, work
too. The panel folds away to watch the replay with nothing in front of it.
While a replay shows, the camera is free: drag to turn round the tower and
look from higher or lower, pinch or scroll to zoom, drag with two fingers
(or the right mouse button, or Shift) to move up and down it, and
double-tap to put it back.

**Quality.** Settings has High and Low graphics. Low draws one pixel per
CSS pixel without antialiasing and gives the water a coarser mesh and no
fine ripples, for a smoother game on a slower device. High also finishes
every frame with post-processing (`post.js`): the scene is drawn into a
multisampled, half-float picture, then a soft bloom on whatever is brighter
than white, a gentle colour grade, a vignette and a speck of dither go on
it on the way to the screen. Low skips all of it and frees its memory.

**Sharing a replay.** Share replay makes a link, through the device's share
sheet where it has one and the clipboard otherwise. Online, it is a short
link such as `/r/Xk3m9QaB`, stored by the API; one for a game the API
started is copied from the server's own record and marked checked. Offline,
or if the API is unavailable, the link carries the whole game instead,
`/?watch=1.BCDFGHJK.m.0.0.6y0.zAjSBu4F...`, and opens offline once the site
has been visited. A shared replay's score is worked out from its taps, and
says whether the leaderboard checked it.

**Seeds.** Every game has one, such as `BXK4-M9TR`. It decides which way
growing slabs grow and the colours of the tower and sky. The same seed and
the same taps are always the same game.

## Races

Per `STUN-p2p-spec.md`: STUN only, no TURN relay. **Every device has to be on
the same network**: the same wifi, or one sharing a hotspot with the others.
PeerJS loads from cdnjs only when somebody hosts or joins, and is never
cached.

One device hosts with a six character code, a link (`/join?id=CODE`) or a
QR code; up to seven others join. The host starts a race with the settings
on its start panel. After a three second count, every device builds its own
tower from the same seed, so nobody's taps wait on the wifi. Each device
reports its height and score; the host sends the whole table to every guest
20 times a second, which is also the heartbeat. The table shows top left
during the race and in the result panel after it. The highest score when the
last tower falls wins, and the host can start the next race straight away. A
guest that reloads or drops rejoins with the same code.

Each player's tower is an ordinary game: started online, it gets its own
start ticket with the race's seed and can go on the leaderboard.

## The leaderboard and anti-cheat

A game counts only if it started while online: starting asks
`/api/game/start` for a ticket, whose time comes from the server. A game
started offline plays the same and says it is not scored.

The page sends the end of every game to `/api/game/finish` the moment it
ends, so the server's clock stops then. On submit the API trusts nothing but
the name. It plays the game again from its seed and taps with the same
modules, works the score out itself, and refuses a game that:

| Code | When |
| --- | --- |
| `autoplay` | autoplay played any of it |
| `not_this_game` | is on a different seed or settings from its ticket |
| `bad_record` | has taps that do not make a game, such as taps after it ended |
| `too_fast` | ran faster than the server's clock: game time only moves while the game is on screen, so it can fall behind but never get ahead |
| `inhuman` | has taps closer together than a hand can tap, more than now and then, or perfect drops that sit dead centre over and over, which a script's do and a person's never do |

The database then refuses one that:

| Code | When |
| --- | --- |
| `not_yours` | comes from a browser other than the one that started it |
| `already_submitted` | is already on the board |
| `mismatch` | ended with other taps than the ones first reported |
| `overlap` | was played at the same time as another game under the same name |

Autoplay belongs to a game, not to the page: a game it touched stays off the
leaderboard, and the next game starts clean. None of this proves who tapped.
It stops scripted, doctored and autoplayed games.

Two boards, after MRT Station Guesser's: each name's best game, and every
game under a name added up.

## Offline and updates

Everything the page loads is precached, three.js and the Jua font included,
so the site opens and plays with no connection, replays and long replay
links too. Only the leaderboard, short replay links and races need the
network. Nothing under `/api/` is ever cached.

A new service worker installs and waits. The update bar offers Reload or Not
now, and nothing reloads until the player asks. Bump `VERSION` in `sw.js` on
every change to anything in this directory.

## API

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /api/game/start` | `client_key, mode, seed, difficulty, turn, game` | `game_id, seed, created_at` |
| `POST /api/game/finish` | `game_id, client_key, record` | `elapsed_ms` |
| `POST /api/game/submit` | `game_id, client_key, name, record` | `name, score, layers, elapsed_ms, rank, best_score, total, games, total_rank` |
| `POST /api/leaderboard/name` | `name` | `name`, cleaned, or a `400` saying why not |
| `GET /api/leaderboard` | `?board=best`, `?board=tallest` or `?board=total` | `board, entries`, cached 30 s |
| `POST /api/replay/create` | `game_id, client_key, name?`, or `record, name?` | `id`, for `/r/<id>` |
| `GET /api/replay` | `?id=` | `record, name, verified, created_at`, cached a day |

`mode` is `solo` or `party`. `record` is `js/record.js`'s shape. Errors are
`{ error, message? }` with a matching status. Start and finish are limited to
120 an address per 10 minutes, submit and replay create to 60.

## Environment variables (Vercel)

Documented in `.env.example`. `.vercelignore` keeps every env file out of
deployments, since anything in this directory would otherwise be served.

| Variable | Used for |
| --- | --- |
| `SUPABASE_URL` | The shared uwuapps project. |
| `SUPABASE_SERVICE_KEY` | Service role key. Server side only, never sent to a browser. |
