// The game screen: the start panel, the live game, the result, and shared
// replays. One loop draws every frame, whichever of those is showing.
//
// A live game runs on game time, which only moves while the game is on
// screen and not paused. Every tap is kept as the game ms it landed on;
// with the seed and the settings, that is the whole game (js/record.js),
// which is what the replay plays, what a share link carries, and what the
// API checks before a score goes on the leaderboard.
//
// Autoplay is not mentioned anywhere a player would look. It drops every
// slab dead on, two and a half times faster than the game normally runs,
// and a game it touched stays off the leaderboard. It belongs to the game,
// not to the page: the next game starts clean.

import { newGame, tap as tapAt, advance, finish, slabAt, scoreOf } from "./sim.js";
import {
  LAYER, SWING, TURN_LIMITS, GAME_LIMITS,
  difficultyOf, cleanDifficulty, cleanTurn, cleanGameLimit, scoreBreakdown, gameScore,
} from "./rules.js";
import { newSeed } from "./seed.js";
import { packRecord } from "./record.js";
import { createScene } from "./scene.js";
import { createPresenter } from "./view.js";
import { createReplay } from "./replay.js";
import { orbit, setFree, initFreecam } from "./freecam.js";
import * as audio from "./audio.js";
import { api } from "./api.js";
import { getSettings, saveSettings, onSettings } from "./settings.js";
import { openLeaderboard } from "./leaderboard.js";
import { copyText, escapeHtml, hydrateIcons, store } from "./ui.js";

const AUTO_SPEED = 2.5;
// A start ticket that comes back later than this after the game started may
// have been stamped too late for the server's clock check on submit, so
// the game goes unscored rather than refused.
const TICKET_LATE_MS = 2500;
// After a game ends, the camera shows the whole tower this long before the
// replay starts.
const OVERVIEW_MS = 1600;
const BEST_KEY = "uwustack.best";
const HINT_KEY = "uwustack.hinted";

const $ = (id) => document.getElementById(id);

const S = {
  mode: "menu", // menu | countdown | playing | over | shared | party
  state: null,
  sim: 0,
  paused: false,
  auto: false,
  autoUsed: false,
  taps: [],
  gameNo: 0,
  ticket: null,
  ticketState: "none", // none | asking | ok | late | failed | offline
  record: null,
  finishing: null,
  submitted: false,
  race: null,
  countdownAt: 0,
  startedAt: 0,
  shared: null,
  overAt: 0,
  preview: null,
};

let scene = null;
const presenter = createPresenter();
const replay = createReplay();
let raceHooks = null;
let clock = 0;
let last = 0;

/* ---- small helpers ---- */

function show(id, on) {
  $(id).classList.toggle("hidden", !on);
}

function setText(id, text) {
  const el = $(id);
  if (el.textContent !== text) el.textContent = text;
}

let toastTimer = 0;
export function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3200);
}

const modalOpen = () => document.body.classList.contains("modal-open");

function bests() {
  return store.getJSON(BEST_KEY) ?? {};
}

function bestFor(difficulty) {
  const n = Number(bests()[difficulty]);
  return Number.isFinite(n) ? n : 0;
}

function saveBest(difficulty, score) {
  const all = bests();
  if (score <= (Number(all[difficulty]) || 0)) return false;
  all[difficulty] = score;
  store.set(BEST_KEY, all);
  return true;
}

function sheets(which) {
  for (const id of ["menu", "party", "result"]) show(id, id === which);
}

/* ---- the start panel ---- */

function pick(groupId, attr, value) {
  document.querySelectorAll(`#${groupId} [data-${attr}]`).forEach((el) => {
    el.setAttribute("aria-checked", String(el.dataset[attr] === String(value)));
  });
}

function renderMenu() {
  const s = getSettings();
  pick("difficultyPick", "difficulty", s.difficulty);
  pick("turnPick", "turn", s.turn);
  pick("gamePick", "game", s.game);
  const d = difficultyOf(s.difficulty);
  const parts = [`${d.label} counts ${d.percent}%`];
  if (s.turn) parts.push(`${s.turn} s a slab ${TURN_LIMITS[s.turn]}% on every drop`);
  if (s.game) parts.push(`a ${s.game / 60} minute game ${GAME_LIMITS[s.game]}%`);
  setText("scoreNote", `${parts.join(", ")}. Quick drops and long games score more too.`);
}

export function menuSettings() {
  const s = getSettings();
  return { difficulty: s.difficulty, turn: s.turn, game: s.game };
}

export function showMenu() {
  S.mode = "menu";
  S.race = null;
  S.shared = null;
  replay.clear();
  sheets("menu");
  show("hud", false);
  show("playControls", false);
  show("pauseVeil", false);
  show("tapHint", false);
  show("countdown", false);
  if (!S.preview) S.preview = newGame(newSeed(), menuSettings());
  renderMenu();
  // Leaving a shared replay takes its link out of the address.
  if (location.search || location.pathname !== "/") history.replaceState(null, "", "/");
}

/* ---- starting a game ---- */

// opts: { seed, settings, race, auto }
export function startGame(opts = {}) {
  const settings = opts.settings ?? menuSettings();
  const seed = opts.seed ?? newSeed();
  audio.unlock();

  S.gameNo += 1;
  S.mode = "playing";
  S.state = newGame(seed, settings);
  S.sim = 0;
  S.paused = false;
  S.auto = Boolean(opts.auto);
  S.autoUsed = S.auto;
  S.taps = [];
  S.ticket = null;
  S.startedAt = performance.now();
  S.record = null;
  S.finishing = null;
  S.submitted = false;
  S.race = opts.race ?? null;
  S.shared = null;
  S.preview = null;
  replay.clear();

  sheets(null);
  show("hud", true);
  show("playControls", true);
  show("restartBtn", !S.race);
  show("pauseVeil", false);
  show("countdown", false);
  show("tapHint", !store.get(HINT_KEY));
  scene?.snapCamera();
  askForTicket(seed, settings);
  if (location.search || location.pathname !== "/") history.replaceState(null, "", "/");
}

function askForTicket(seed, settings) {
  const no = S.gameNo;
  if (navigator.onLine === false) {
    S.ticketState = "offline";
    return;
  }
  S.ticketState = "asking";
  api
    .start({ mode: S.race ? "party" : "solo", seed, ...settings })
    .then((ticket) => {
      if (no !== S.gameNo) return;
      if (performance.now() - S.startedAt > TICKET_LATE_MS) {
        S.ticketState = "late";
        if (S.mode === "over") renderScoring();
        return;
      }
      S.ticket = ticket;
      S.ticketState = "ok";
      // A game that ended before its ticket came back.
      if (S.record) {
        finishOnServer();
        renderScoring();
      }
    })
    .catch((err) => {
      if (no !== S.gameNo) return;
      S.ticketState = err.code === "offline" ? "offline" : "failed";
      if (S.mode === "over") renderScoring();
    });
}

/* ---- a race, started by js/party.js ---- */

export function setRaceHooks(hooks) {
  raceHooks = hooks;
}

export function startRace({ seed, settings, startIn, round }) {
  S.mode = "countdown";
  S.race = { seed, settings, round };
  S.countdownAt = performance.now() + Math.max(0, startIn);
  S.preview = newGame(seed, settings);
  replay.clear();
  sheets(null);
  show("hud", false);
  show("playControls", false);
  show("countdown", true);
  audio.unlock();
}

function reportRace() {
  if (!S.race || !raceHooks) return;
  const st = S.state;
  raceHooks.progress({
    round: S.race.round,
    layers: st.layers.length - 1,
    score: scoreOf(st, st.over ? st.over.at : Math.floor(S.sim)),
    alive: !st.over,
    outcome: st.over?.by ?? null,
  });
}

/* ---- playing ---- */

// The next whole ms, after `after`, at which the slab lines up. It does
// every 2 * SWING of travel.
function nextAlign(speed, spawnAt, after) {
  for (let k = 0; ; k++) {
    const at = spawnAt + Math.ceil(((1 + 2 * k) * SWING * 1000) / speed);
    if (at > after) return at;
  }
}

// A short tick, where the device has a vibrator, for a game played by hand:
// a perfect drop, and a cut-off piece knocking against the tower or going
// into the water.
function buzz() {
  if (!S.auto && getSettings().haptics) navigator.vibrate?.(6);
}

function drop(t) {
  const st = S.state;
  S.taps.push(t);
  const landed = tapAt(st, t);
  if (landed?.perfect) buzz();
  if (!st.over || st.over.at >= t) presenter.sounds(st, t - 1, t, { slosh: false, buzz });
  if (!store.get(HINT_KEY)) {
    store.set(HINT_KEY, "1");
    show("tapHint", false);
  }
  reportRace();
}

export function onTap() {
  if (S.mode !== "playing" || modalOpen()) return;
  audio.unlock();
  if (S.paused) {
    S.paused = false;
    show("pauseVeil", false);
    return;
  }
  if (S.auto || S.state.over) return;
  const t = Math.max(Math.floor(S.sim), S.state.t + 1);
  drop(t);
  if (S.state.over) endGame();
}

function stepLive(dt) {
  const st = S.state;
  const from = S.sim;
  const to = from + dt * 1000 * (S.auto ? AUTO_SPEED : 1);

  if (S.auto) {
    while (!st.over) {
      const slab = slabAt(st, st.t);
      const at = nextAlign(slab.speed, st.spawnAt, Math.max(st.t, Math.floor(from)));
      if (at > to) break;
      advance(st, at, true);
      if (st.over) break;
      drop(at);
    }
  }
  const dropsBefore = st.drops.length;
  advance(st, Math.floor(to), true);
  if (st.drops.length !== dropsBefore) reportRace();
  S.sim = to;
  presenter.sounds(st, from, to, { buzz });
  if (st.over) endGame();
}

export function toggleAutoplay() {
  if (S.mode === "menu") {
    startGame({ auto: true });
    return;
  }
  if (S.mode === "countdown") {
    S.auto = !S.auto;
    return;
  }
  if (S.mode !== "playing" || S.state.over) return;
  S.auto = !S.auto;
  if (S.auto) {
    S.autoUsed = true;
    S.paused = false;
    show("pauseVeil", false);
  }
}

function pause() {
  if (S.mode !== "playing" || S.paused || S.state.over) return;
  S.paused = true;
  show("pauseVeil", true);
}

function abandon() {
  S.gameNo += 1;
  S.state = null;
  S.race = null;
}

function back() {
  if (S.mode === "playing" && S.race) {
    // Leaving a race ends your tower there, and the others see it.
    finish(S.state, Math.floor(S.sim));
    reportRace();
    endGame();
    return;
  }
  if (S.mode === "playing") abandon();
  showMenu();
}

/* ---- the end of a game ---- */

function recordOf(st) {
  const { rules, ...settings } = st.settings;
  const rec = { v: rules, seed: st.seed, ...settings, taps: [...S.taps], end: st.over.at };
  if (S.autoUsed) rec.auto = true;
  return rec;
}

function finishOnServer() {
  if (!S.ticket || !S.record || S.finishing || S.autoUsed) return;
  S.finishing = api.finish(S.ticket.game_id, S.record).catch(() => null);
}

const ENDINGS = {
  miss: ["Missed", "That slab missed the tower."],
  water: ["Washed away", "The water rose over the top of the tower."],
  time: ["Time's up", "The game ran out of time."],
  quit: ["Stopped", "You left the game there."],
};

function endGame() {
  const st = S.state;
  S.mode = "over";
  S.auto = false;
  S.overAt = performance.now();
  S.record = recordOf(st);
  show("pauseVeil", false);
  show("playControls", false);
  show("tapHint", false);
  audio.setSlosh(0, true);
  reportRace();

  const score = scoreOf(st);
  const isBest = !S.autoUsed && saveBest(st.settings.difficulty, score);

  const [title, reason] = ENDINGS[st.over.by];
  setText("resultTitle", title);
  setText("resultReason", `${reason} ${st.layers.length - 1} high, ${st.perfects} perfect, best run ${st.bestCombo}.`);
  setText("resultScore", `${score} points`);
  show("newBest", isBest);
  renderBreakdown(st);
  setText("againLabel", S.race ? "Back to the race" : "Play again");
  show("shareBtn", true);
  setText("shareLabel", "Share replay");
  $("result").classList.remove("folded");
  sheets("result");
  raceHooks?.ended?.();

  finishOnServer();
  renderScoring();
  replay.load(st);
  if (getSettings().auto_submit && getSettings().name && scorable()) submit(getSettings().name);
}

function renderBreakdown(st) {
  const rows = scoreBreakdown(st.points, st.settings, st.over.at);
  $("breakdown").innerHTML = rows
    .map(([k, v]) => `<div class="breakdown-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join("");
}

function scorable() {
  return !S.autoUsed && S.ticketState === "ok" && S.state.drops.length > 0;
}

function notScoredReason() {
  if (S.autoUsed) return "Autoplay played this game, so it stays off the leaderboard.";
  if (S.state.drops.length === 0) return "Land at least one slab to go on the leaderboard.";
  switch (S.ticketState) {
    case "offline":
      return "This game started offline, so it is not scored. Games started online can go on the leaderboard.";
    case "asking":
      return "Checking with the leaderboard.";
    case "late":
    case "failed":
      return "This game could not get a start ticket from the leaderboard in time, so it is not scored.";
    default:
      return "";
  }
}

function renderScoring() {
  if (S.mode !== "over") return;
  const ok = scorable();
  show("submitForm", ok && !S.submitted);
  show("submitted", S.submitted);
  const reason = ok ? "" : notScoredReason();
  setText("notScored", reason);
  show("notScored", Boolean(reason));
  if (ok && !S.submitted) {
    const name = getSettings().name;
    if (name && !$("nameInput").value) $("nameInput").value = name;
  }
}

async function submit(name) {
  if (!scorable() || S.submitted) return;
  const no = S.gameNo;
  const msg = $("submitMsg");
  $("submitBtn").disabled = true;
  msg.textContent = "Adding.";
  try {
    if (S.finishing) await S.finishing;
    const r = await api.submit(S.ticket.game_id, S.record, name);
    if (no !== S.gameNo) return;
    S.submitted = true;
    saveSettings({ name: r.name });
    setText(
      "submittedText",
      `Added as ${r.name}: ${r.score} points. Best ${r.best_score}, #${r.rank}. Total ${r.total} over ${r.games} ${r.games === 1 ? "game" : "games"}, #${r.total_rank}.`
    );
    msg.textContent = "";
    renderScoring();
  } catch (err) {
    if (no !== S.gameNo) return;
    msg.textContent =
      err.code === "offline" ? "Adding a game needs a connection. Try again once you are back online." : err.message || "That did not go through. Try again in a moment.";
  } finally {
    $("submitBtn").disabled = false;
  }
}

/* ---- sharing a replay ---- */

function longLink(record) {
  return `${location.origin}/?watch=${packRecord(record)}`;
}

async function shareReplay() {
  const record = S.mode === "shared" ? S.shared.record : S.record;
  if (!record) return;
  const label = $("shareLabel");
  label.textContent = "Making the link";
  let link = S.mode === "shared" && S.shared.id ? `${location.origin}/r/${S.shared.id}` : null;

  // Online, a short link stored by the API. A game it started is stored
  // from its own copy and marked checked.
  if (!link && navigator.onLine !== false) {
    try {
      const body =
        S.mode === "over" && S.ticket && S.finishing && !S.autoUsed
          ? { game_id: S.ticket.game_id, name: getSettings().name }
          : { record, name: S.mode === "shared" ? S.shared.name : getSettings().name };
      if (body.game_id) await S.finishing;
      const r = await api.createReplay(body);
      link = `${location.origin}/r/${r.id}`;
    } catch {
      link = null;
    }
  }
  // Offline, or the API said no: the whole game in the link.
  link ??= longLink(record);

  const title = "uwuStack replay";
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ title, url: link });
      label.textContent = "Share replay";
      return;
    }
  } catch (err) {
    if (err?.name === "AbortError") {
      label.textContent = "Share replay";
      return;
    }
  }
  const ok = await copyText(link);
  label.textContent = ok ? "Link copied" : "Could not copy";
  setTimeout(() => (label.textContent = "Share replay"), 2500);
}

/* ---- watching a shared replay ---- */

export function openShared({ record, name = null, verified = false, id = null, state }) {
  S.mode = "shared";
  S.shared = { record, name, verified, id };
  S.state = state;
  S.race = null;
  sheets("result");
  show("hud", true);
  show("playControls", false);
  const d = difficultyOf(record.difficulty);
  const ending = ENDINGS[state.over.by][0].toLowerCase();
  setText("resultTitle", name ? `${name}'s game` : "A shared game");
  setText(
    "resultReason",
    `${d.label} mode, ${state.layers.length - 1} high, ${state.perfects} perfect, ended ${ending === "stopped" ? "early" : `by ${state.over.by === "miss" ? "a miss" : state.over.by === "water" ? "the water" : "the clock"}`}.${record.auto ? " Played by autoplay." : ""}`
  );
  setText("resultScore", `${scoreOf(state)} points`);
  show("newBest", false);
  renderBreakdown(state);
  $("breakdown").insertAdjacentHTML(
    "beforeend",
    `<div class="breakdown-row note"><dt>${verified ? "Checked by the leaderboard" : "Worked out from the replay, not checked"}</dt><dd></dd></div>`
  );
  show("submitForm", false);
  show("submitted", false);
  show("notScored", false);
  setText("againLabel", "Play");
  $("result").classList.remove("folded");
  replay.load(state);
  replay.start();
  audio.unlock();
}

/* ---- the frame loop ---- */

const hud = {};
function hudText(id, text, visible = true) {
  if (hud[id] !== text) {
    hud[id] = text;
    $(id).textContent = text;
  }
  const key = `${id}:v`;
  if (hud[key] !== visible) {
    hud[key] = visible;
    $(id).classList.toggle("hidden", !visible);
  }
}

function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function updateHud(st, t, view) {
  const d = difficultyOf(st.settings.difficulty);
  hudText("modeLabel", `${d.label} mode`);
  // Score so far: the drops up to t, at the multipliers they will end with.
  let points = st.points;
  if (S.mode !== "playing") {
    points = 0;
    for (let i = 0; i < view.count - 1; i++) points += st.drops[i].points;
  }
  const end = st.over ? Math.min(t, st.over.at) : t;
  const score = gameScore(points, st.settings, Math.max(0, Math.floor(end)));
  hudText("scoreValue", String(score));
  const best = bestFor(st.settings.difficulty);
  hudText("bestValue", String(S.mode === "shared" ? best : Math.max(best, S.autoUsed ? 0 : score)));
  $("bestCard").classList.toggle("beaten", S.mode === "playing" && !S.autoUsed && score > best && best > 0);

  hudText("layerChip", `${view.count - 1} high`);
  const drop = st.drops[view.count - 2];
  const combo = drop?.perfect ? drop.combo : 0;
  hudText("comboChip", `Perfect × ${combo}`, combo >= 2);
  const running = !st.over || t < st.over.at;
  hudText("clockChip", `${mmss(st.settings.game * 1000 - t)} left`, Boolean(st.settings.game) && running);
  const spawn = view.count >= 2 ? st.drops[view.count - 2].t : 0;
  hudText("turnChip", `${Math.max(0, (st.settings.turn * 1000 - (t - spawn)) / 1000).toFixed(1)} s`, Boolean(st.settings.turn) && running);
  const gap = (view.top - view.water) / LAYER;
  hudText("waterChip", "Water close", running && gap < 2.5);
  hudText("autoChip", "Autoplay", S.mode === "playing" && S.auto);
}

// How much of a narrow screen's height the open sheet covers, which the
// scene keeps the tower clear of. Wide screens have the sheet at the side.
function sheetCover() {
  if (window.innerWidth >= 900) return 0;
  const open = ["menu", "party", "result"].map($).find((el) => !el.classList.contains("hidden"));
  if (!open) return 0;
  return (window.innerHeight - open.getBoundingClientRect().top) / window.innerHeight;
}

function frame(now) {
  const dt = Math.min(0.1, Math.max(0, (now - (last || now)) / 1000));
  last = now;
  clock += dt;

  let view;
  let overview = 0;

  if (S.mode === "countdown") {
    const left = S.countdownAt - now;
    if (left <= 0) {
      const { seed, settings, round } = S.race;
      const auto = S.auto;
      startGame({ seed, settings, race: { seed, settings, round }, auto });
    } else {
      setText("countdown", String(Math.ceil(left / 1000)));
      view = presenter.view(S.preview, 0);
      view.slab = null;
      overview = 1;
    }
  }

  if (S.mode === "playing") {
    if (modalOpen() || document.hidden) pause();
    if (!S.paused) stepLive(dt);
    if (S.mode === "playing") {
      view = presenter.view(S.state, S.sim);
      updateHud(S.state, S.sim, view);
    }
  }

  if (S.mode === "over" || S.mode === "shared") {
    if (S.mode === "over" && replay.atEnd && !replay.playing && S.overAt && now - S.overAt > OVERVIEW_MS) {
      S.overAt = 0;
      if (getSettings().auto_replay) replay.start();
    }
    const { from, to, jump } = replay.tick(dt * 1000);
    const st = replay.state;
    view = presenter.view(st, to);
    presenter.sounds(st, from, to, { jump });
    overview = replay.atEnd ? 1 : 0;
    updateHud(st, to, view);
  }

  // The start panel and the race lobby: the island waiting, framed whole.
  if (!view) {
    const st = S.preview ?? (S.preview = newGame(newSeed(), menuSettings()));
    view = presenter.view(st, 0);
    view.slab = null;
    overview = 1;
    audio.setSlosh(0, true);
  }

  // A replay showing, after a game or from a link: the camera is free.
  const free = S.mode === "over" || S.mode === "shared";
  setFree(free);
  scene?.draw({ ...view, overview, cover: sheetCover(), dt, clock, orbit: free ? orbit : null });
  requestAnimationFrame(frame);
}

/* ---- wiring ---- */

function onKey(e) {
  if (e.target.closest?.("input, textarea, select")) return;
  if (e.key === "F2") {
    e.preventDefault();
    toggleAutoplay();
    return;
  }
  if (modalOpen()) return;
  const onButton = e.target.closest?.("button, a, [role='radio'], [role='tab']");
  if (S.mode === "playing" && (e.key === " " || e.key === "Enter" || e.key === "ArrowUp")) {
    if (e.repeat) return;
    e.preventDefault();
    onTap();
    return;
  }
  if ((S.mode === "over" || S.mode === "shared") && !onButton) {
    if (e.key === " ") {
      e.preventDefault();
      replay.toggle();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      replay.stepBack();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      replay.stepForward();
    }
    return;
  }
  if (S.mode === "menu" && !onButton && (e.key === " " || e.key === "Enter")) {
    e.preventDefault();
    startGame();
  }
}

// Three quick taps on the name, top left.
function watchBrand() {
  let taps = [];
  $("brand").addEventListener("pointerdown", () => {
    const now = performance.now();
    taps = taps.filter((t) => now - t < 700);
    taps.push(now);
    if (taps.length >= 3) {
      taps = [];
      toggleAutoplay();
    }
  });
}

function bindMenu() {
  const save = (key, clean) => (e) => {
    const btn = e.target.closest(`[data-${key}]`);
    if (!btn) return;
    saveSettings({ [key]: clean(btn.dataset[key]) });
    S.preview = null;
    renderMenu();
  };
  $("difficultyPick").addEventListener("click", save("difficulty", cleanDifficulty));
  $("turnPick").addEventListener("click", save("turn", cleanTurn));
  $("gamePick").addEventListener("click", save("game", cleanGameLimit));
  $("playBtn").addEventListener("click", () => startGame());
}

export function initGame({ onRace }) {
  try {
    scene = createScene($("stage"), { quality: getSettings().quality });
    onSettings((s) => scene.setQuality(s.quality));
  } catch (err) {
    console.error(err);
    show("noWebgl", true);
  }

  replay.init();
  initFreecam($("stage"));
  bindMenu();
  watchBrand();

  $("stage").addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button > 0) return;
    e.preventDefault();
    onTap();
  });
  $("pauseVeil").addEventListener("click", onTap);
  $("backBtn").addEventListener("click", back);
  $("restartBtn").addEventListener("click", () => {
    abandon();
    startGame();
  });
  $("againBtn").addEventListener("click", () => {
    if (S.race && raceHooks) raceHooks.back();
    else startGame();
  });
  $("menuBtn").addEventListener("click", () => {
    if (S.race) raceHooks?.leave();
    showMenu();
  });
  $("resultBoardBtn").addEventListener("click", () => openLeaderboard());
  $("shareBtn").addEventListener("click", shareReplay);
  $("foldBtn").addEventListener("click", () => {
    const folded = $("result").classList.toggle("folded");
    $("foldBtn").setAttribute("aria-expanded", String(!folded));
    $("foldBtn").setAttribute("aria-label", folded ? "Show the panel" : "Hide the panel");
    $("foldBtn").title = folded ? "Show the panel" : "Hide the panel";
  });
  $("submitForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("nameInput").value.trim();
    if (!name) {
      $("submitMsg").textContent = "Enter a name.";
      $("nameInput").focus();
      return;
    }
    submit(name);
  });
  $("raceBtn").addEventListener("click", onRace);
  $("raceBtnTray").addEventListener("click", onRace);

  const soundBtn = $("soundBtn");
  const syncSound = (s) => {
    audio.setSoundOn(s.sound);
    soundBtn.setAttribute("aria-pressed", String(s.sound));
    const label = s.sound ? "Sound on" : "Sound off";
    soundBtn.setAttribute("aria-label", label);
    soundBtn.title = label;
    soundBtn.querySelector("[data-icon]").setAttribute("data-icon", s.sound ? "volume" : "volumeOff");
    hydrateIcons(soundBtn);
  };
  soundBtn.addEventListener("click", () => {
    audio.unlock();
    saveSettings({ sound: !getSettings().sound });
  });
  onSettings(syncSound);
  syncSound(getSettings());

  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    audio.suspend(document.hidden);
  });
  // The scene's colours follow the theme.
  const retheme = () => scene?.readTheme();
  document.addEventListener("uwu:modechange", retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode", "data-color-theme"] });
  window.addEventListener("resize", () => scene?.resize());

  showMenu();
  requestAnimationFrame(frame);
}

// For js/party.js: whether a game is under way here, and the race lobby
// taking over the screen.
export const busy = () => S.mode === "playing" || S.mode === "countdown";

export function enterParty() {
  if (S.mode === "playing") abandon();
  S.mode = "party";
  sheets("party");
  show("hud", false);
  show("playControls", false);
  show("pauseVeil", false);
  show("tapHint", false);
  show("countdown", false);
  // The last race's tower stays on screen behind the lobby.
  if (!replay.state && !S.preview) S.preview = newGame(newSeed(), menuSettings());
}
