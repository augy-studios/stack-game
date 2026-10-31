// Races on one network, per STUN-p2p-spec.md, over js/net.js.
//
// One device hosts with a six character code, a link or a QR code; up to
// seven others join. When the host starts a race, every device builds its
// own tower from the same seed and settings, at the same moment, after a
// three second count. Taps never cross the network, so nobody's game waits
// on the wifi. Each device reports its height and score as it goes; the
// host keeps everyone's and sends the whole table to every guest 20 times a
// second, which is also how a guest knows the link is alive. The highest
// score when the last tower falls wins.
//
// Each player's tower is an ordinary game of their own: started online, it
// gets its own start ticket with the race's seed and can go on the
// leaderboard like any other.
//
// Messages, all small and all checked on arrival:
//   guest to host   hello { v, name }, progress { round, layers, score,
//                   alive, outcome }, bye
//   host to guest   state { v, phase, race, startIn, players, you },
//                   full, old

import { Host, Guest, generateCode, normaliseCode, isValidCode, CODE_LENGTH, PROTOCOL_VERSION } from "./net.js";
import { qrToSvg } from "./qr.js";
import { newSeed, cleanSeed } from "./seed.js";
import { cleanDifficulty, cleanTurn, cleanGameLimit, difficultyOf, describeTurn, describeGame } from "./rules.js";
import { getSettings } from "./settings.js";
import { copyText, escapeHtml, store } from "./ui.js";
import { startRace, setRaceHooks, menuSettings, showMenu, enterParty, busy, toast } from "./game.js";

const HOST_CODE_KEY = "uwustack.hostCode";
const LAST_CODE_KEY = "uwustack.lastCode";
const CLIENT_KEY = "uwustack.partyClient";
const MAX_GUESTS = 7;
const COUNTDOWN_MS = 3500;
const STALE_MS = 2000;
const OUTCOMES = new Set(["miss", "water", "time", "quit"]);

const $ = (id) => document.getElementById(id);

const P = {
  role: null, // null | host | guest
  host: null,
  guest: null,
  code: "",
  status: "idle",
  message: "",
  players: new Map(), // id -> { id, name, layers, score, alive, outcome, round, gone }
  phase: "lobby", // lobby | countdown | racing | done
  race: null, // { seed, settings, round }
  raceAt: 0, // host: when the countdown ends
  me: "host",
  joined: 0, // guest: the round this device is playing
  lastState: 0,
  retriedTaken: false,
};

let beat = null;
let wakeLock = null;

/* ---- names and the table ---- */

function cleanName(value, fallback) {
  const text = typeof value === "string" ? value.normalize("NFKC").replace(/\p{C}/gu, "").replace(/\s+/gu, " ").trim() : "";
  const cut = Array.from(text).slice(0, 20).join("").trim();
  return cut || fallback;
}

const myName = () => getSettings().name ?? (P.role === "host" ? "Host" : "Guest");

function int(value, max) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;
}

function freshPlayer(id, name) {
  return { id, name, layers: 0, score: 0, alive: true, outcome: null, round: 0, gone: false };
}

function ranked() {
  return [...P.players.values()]
    .filter((p) => !p.gone || p.round === P.race?.round)
    .sort((a, b) => b.score - a.score || b.layers - a.layers || a.name.localeCompare(b.name));
}

function snapshot(to) {
  return {
    type: "state",
    v: PROTOCOL_VERSION,
    phase: P.phase,
    race: P.race,
    startIn: P.phase === "countdown" ? Math.max(0, Math.round(P.raceAt - performance.now())) : 0,
    players: ranked().map(({ id, name, layers, score, alive, outcome, round, gone }) => ({ id, name, layers, score, alive, outcome, round, gone })),
    you: to,
  };
}

function broadcast() {
  if (!P.host) return;
  for (const id of P.host.links.keys()) P.host.send(snapshot(id), id);
}

// Host only: moves the race on as players finish.
function settlePhase() {
  if (P.phase === "countdown" && performance.now() >= P.raceAt) P.phase = "racing";
  if (P.phase === "racing") {
    const racers = [...P.players.values()].filter((p) => p.round === P.race.round && !p.gone);
    if (racers.length && racers.every((p) => !p.alive)) P.phase = "done";
  }
}

/* ---- drawing ---- */

function describeRace(race) {
  if (!race) return "";
  const s = race.settings;
  return `${difficultyOf(s.difficulty).label}, ${describeTurn(s.turn).toLowerCase()}, ${describeGame(s.game).toLowerCase()}.`;
}

const ENDED = { miss: "missed", water: "washed away", time: "time up", quit: "left" };

function playerLine(p, { live }) {
  const you = p.id === P.me ? " (you)" : "";
  const state = p.gone ? "gone" : live ? (p.alive ? `${p.layers} high` : `${ENDED[p.outcome] ?? "out"}, ${p.layers} high`) : "ready";
  return `<li class="seat${p.id === P.me ? " me" : ""}${live && !p.alive ? " out" : ""}">
    <span class="seat-name">${escapeHtml(p.name)}${you}</span>
    <span class="seat-state">${escapeHtml(state)}</span>
    ${live ? `<span class="seat-score">${p.score}</span>` : ""}
  </li>`;
}

function render() {
  const inParty = P.role !== null;
  $("partyChoose").classList.toggle("hidden", inParty);
  $("partyHost").classList.toggle("hidden", P.role !== "host");
  $("newCodeBtn").classList.toggle("hidden", P.role !== "host");
  $("partyRetryBtn").classList.toggle("hidden", !(P.role === "guest" && ["unreachable", "error", "dropped"].includes(P.status)));
  $("partyLeaveLabel").textContent = inParty ? "Leave" : "Cancel";

  const live = P.phase !== "lobby";
  const list = ranked();
  $("seatList").classList.toggle("hidden", !inParty || list.length === 0);
  $("seatList").innerHTML = list.map((p) => playerLine(p, { live })).join("");

  const settingsText = P.role === "host" ? `Next race: ${describeRace({ settings: menuSettings() })} Change these on the start panel.` : P.race ? `This race: ${describeRace(P.race)}` : "";
  $("partySettings").textContent = settingsText;
  $("partySettings").classList.toggle("hidden", !settingsText);

  const guests = P.host ? P.host.links.size : 0;
  const canStart = P.role === "host" && (P.phase === "lobby" || P.phase === "done") && guests > 0;
  $("raceStartBtn").classList.toggle("hidden", !canStart);

  $("partyStatus").textContent = statusText();
  $("partyStatus").classList.toggle("error", ["error", "unreachable", "dropped"].includes(P.status));

  renderBoards();
}

function statusText() {
  if (P.message) return P.message;
  const guests = P.host ? P.host.links.size : 0;
  switch (P.status) {
    case "connecting":
      return P.role === "host" ? "Getting a code." : "Connecting.";
    case "waiting":
      return "Waiting for players to join.";
    case "connected":
      if (P.role === "host") {
        if (P.phase === "racing" || P.phase === "countdown") return "Race under way.";
        return `${guests} ${guests === 1 ? "player has" : "players have"} joined. Start when everyone is in.`;
      }
      if (P.phase === "racing" && P.joined !== P.race?.round) return "A race is under way. You are in the next one.";
      if (P.phase === "done") return "Race over. Waiting for the host to start the next one.";
      return "Connected. Waiting for the host to start the race.";
    case "dropped":
      return "The connection to the host dropped.";
    case "unreachable":
      return "Could not reach the other device. Both have to be on the same network: join the same wifi, or turn on a hotspot on one and join it from the other. Check the code is still the one on screen.";
    case "stale":
      return "The connection looks stale. Waiting to hear from the host.";
    default:
      return "";
  }
}

// The table during a race, top left, and in the result panel after it.
function renderBoards() {
  const racing = P.role !== null && P.race && P.joined === P.race.round && P.phase !== "lobby";
  const list = ranked().filter((p) => p.round === P.race?.round);
  const rows = list
    .map((p, i) => `<li class="race-row${p.id === P.me ? " me" : ""}${p.alive ? "" : " out"}"><span class="race-rank">${i + 1}</span><span class="race-name">${escapeHtml(p.name)}</span><span class="race-num">${p.layers}</span><span class="race-num">${p.score}</span></li>`)
    .join("");
  $("raceList").classList.toggle("hidden", !racing || list.length < 2);
  $("raceList").innerHTML = rows;

  const done = P.phase === "done";
  $("raceStandings").classList.toggle("hidden", !racing);
  $("raceStandings").innerHTML = racing
    ? `<li class="race-head">${done ? `Race over. ${escapeHtml(list[0]?.name ?? "")} wins.` : "Race standings, still going"}</li>${rows}`
    : "";
}

/* ---- wake lock: the screen stays on while in a race ---- */

async function holdScreen() {
  try {
    if (!wakeLock && "wakeLock" in navigator && document.visibilityState === "visible") {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    }
  } catch {
    // Refused or unsupported: the screen may sleep.
  }
}

function releaseScreen() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

/* ---- hosting ---- */

function joinLink(code) {
  return `${location.origin}/join?id=${code}`;
}

async function startHosting() {
  if (P.host) return;
  const stored = store.get(HOST_CODE_KEY);
  const code = isValidCode(stored) ? normaliseCode(stored) : generateCode();
  store.set(HOST_CODE_KEY, code);
  P.role = "host";
  P.code = code;
  P.me = "host";
  P.message = "";
  P.phase = P.phase === "lobby" ? "lobby" : "done";
  if (!P.players.has("host")) P.players.set("host", freshPlayer("host", myName()));
  $("hostCode").textContent = code;
  $("hostQr").innerHTML = qrToSvg(joinLink(code));

  const host = new Host({ maxGuests: MAX_GUESTS });
  P.host = host;
  host.addEventListener("status", ({ detail }) => {
    if (detail.taken && !P.retriedTaken) {
      P.retriedTaken = true;
      newCode();
      return;
    }
    if (detail.status === "waiting") P.retriedTaken = false;
    P.status = detail.status;
    P.message = detail.status === "error" ? detail.message : "";
    render();
  });
  host.addEventListener("join", ({ detail }) => {
    const id = detail.id;
    const existing = P.players.get(id);
    P.players.set(id, existing ? { ...existing, gone: false } : freshPlayer(id, cleanName(detail.metadata?.name, "Guest")));
    render();
    broadcast();
  });
  host.addEventListener("leave", ({ detail }) => {
    const p = P.players.get(detail.id);
    if (!p) return;
    // Mid race, their line stays with what they had.
    if (p.round === P.race?.round && P.phase !== "lobby") p.gone = true;
    else P.players.delete(detail.id);
    settlePhase();
    render();
    broadcast();
  });
  host.addEventListener("message", ({ detail: { message, from } }) => onHostMessage(message, from));

  render();
  holdScreen();
  try {
    await host.start(code);
  } catch {
    P.host = null;
    P.status = "error";
    P.message = "Could not load pairing. Check your connection.";
    render();
  }
}

function onHostMessage(message, from) {
  const p = P.players.get(from);
  switch (message.type) {
    case "hello": {
      if (message.v !== PROTOCOL_VERSION) {
        P.host.send({ type: "old" }, from);
        return;
      }
      if (p) p.name = cleanName(message.name, p.name);
      P.host.send(snapshot(from), from);
      render();
      break;
    }
    case "progress": {
      if (!p || !P.race || message.round !== P.race.round) return;
      p.round = P.race.round;
      p.layers = int(message.layers, 100000);
      p.score = int(message.score, 1e9);
      p.alive = message.alive === true;
      p.outcome = OUTCOMES.has(message.outcome) ? message.outcome : null;
      settlePhase();
      render();
      break;
    }
    case "bye": {
      // Leaving on purpose frees the seat; the code stays, since the
      // others are still on it.
      P.host.dropPeer(from);
      break;
    }
    default:
      break; // Unknown types are ignored, never thrown on.
  }
}

function newCode() {
  const players = P.players;
  stopHosting();
  store.remove(HOST_CODE_KEY);
  P.players = new Map([...players].filter(([id]) => id === "host"));
  startHosting();
}

function stopHosting() {
  P.host?.close();
  P.host = null;
}

function startRaceAsHost() {
  if (!P.host || P.host.links.size === 0) return;
  const round = (P.race?.round ?? 0) + 1;
  P.race = { seed: newSeed(), settings: menuSettings(), round };
  P.raceAt = performance.now() + COUNTDOWN_MS;
  P.phase = "countdown";
  for (const p of P.players.values()) Object.assign(p, { layers: 0, score: 0, alive: true, outcome: null, round, gone: p.gone });
  [...P.players].forEach(([id, p]) => p.gone && P.players.delete(id));
  P.players.get("host").name = myName();
  broadcast();
  P.joined = round;
  startRace({ ...P.race, startIn: COUNTDOWN_MS });
  render();
}

/* ---- joining ---- */

function clientId() {
  let id = store.get(CLIENT_KEY);
  if (!/^[A-Za-z0-9]{12}$/.test(id ?? "")) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
    store.set(CLIENT_KEY, id);
  }
  return id;
}

async function join(input) {
  const code = normaliseCode(input);
  if (!isValidCode(code)) {
    P.status = "error";
    P.message = `A code is ${CODE_LENGTH} characters.`;
    render();
    $("joinInput").classList.add("shake");
    setTimeout(() => $("joinInput").classList.remove("shake"), 320);
    return;
  }
  P.guest?.close();
  P.role = "guest";
  P.code = code;
  P.me = null;
  P.message = "";
  P.players = new Map();
  P.phase = "lobby";
  P.race = null;
  const guest = new Guest();
  P.guest = guest;
  guest.addEventListener("status", ({ detail }) => {
    if (guest !== P.guest) return;
    P.status = detail.status;
    P.message = detail.status === "error" ? detail.message : "";
    if (detail.status === "connected") P.lastState = performance.now();
    render();
  });
  guest.addEventListener("message", ({ detail: { message } }) => onGuestMessage(message));
  render();
  holdScreen();
  try {
    await guest.connect(code, { client: clientId(), name: myName() });
    store.set(LAST_CODE_KEY, code);
  } catch {
    P.status = "error";
    P.message = "Could not load pairing. Check your connection.";
    render();
  }
}

function onGuestMessage(message) {
  if (message.type === "full") {
    P.status = "error";
    P.message = "This race is full.";
    P.guest?.close();
    render();
    return;
  }
  if (message.type === "old") {
    P.status = "error";
    P.message = "The host is on a different version. Reload the page on both devices.";
    render();
    return;
  }
  if (message.type !== "state" || message.v !== PROTOCOL_VERSION) return;
  P.lastState = performance.now();
  if (P.status === "stale") P.status = "connected";

  const phases = ["lobby", "countdown", "racing", "done"];
  P.phase = phases.includes(message.phase) ? message.phase : "lobby";
  P.me = typeof message.you === "string" ? message.you : P.me;
  P.players = new Map();
  for (const p of Array.isArray(message.players) ? message.players.slice(0, MAX_GUESTS + 1) : []) {
    if (!p || typeof p.id !== "string") continue;
    P.players.set(p.id, {
      id: p.id.slice(0, 64),
      name: cleanName(p.name, "Player"),
      layers: int(p.layers, 100000),
      score: int(p.score, 1e9),
      alive: p.alive === true,
      outcome: OUTCOMES.has(p.outcome) ? p.outcome : null,
      round: int(p.round, 1e6),
      gone: p.gone === true,
    });
  }
  const race = cleanRace(message.race);
  P.race = race;
  // A new race counting down: join it.
  if (race && P.phase === "countdown" && P.joined !== race.round && !busy()) {
    P.joined = race.round;
    startRace({ ...race, startIn: int(message.startIn, COUNTDOWN_MS) });
  }
  render();
}

function cleanRace(value) {
  if (!value || typeof value !== "object") return null;
  const seed = cleanSeed(value.seed);
  if (!seed) return null;
  const s = value.settings ?? {};
  return {
    seed,
    settings: { difficulty: cleanDifficulty(s.difficulty), turn: cleanTurn(s.turn), game: cleanGameLimit(s.game) },
    round: int(value.round, 1e6),
  };
}

/* ---- leaving ---- */

function leave() {
  if (P.role === "guest") {
    P.guest?.leave();
    store.remove(LAST_CODE_KEY);
  }
  if (P.role === "host") stopHosting();
  P.guest = null;
  P.role = null;
  P.status = "idle";
  P.message = "";
  P.players = new Map();
  P.phase = "lobby";
  P.race = null;
  P.joined = 0;
  releaseScreen();
  render();
}

/* ---- this device's own race ---- */

function progress(info) {
  if (P.role === "host") {
    const me = P.players.get("host");
    if (!me || info.round !== P.race?.round) return;
    Object.assign(me, { round: info.round, layers: info.layers, score: info.score, alive: info.alive, outcome: info.outcome });
    settlePhase();
    renderBoards();
  } else if (P.role === "guest") {
    P.guest?.send({ type: "progress", ...info });
    // Show it here straight away; the host's next table confirms it.
    const me = P.players.get(P.me);
    if (me) Object.assign(me, info);
    renderBoards();
  }
}

export function openParty() {
  if (busy() && !P.role) {
    toast("Finish this game first.");
    return;
  }
  enterParty();
  render();
}

export function initParty({ joinCode = null } = {}) {
  setRaceHooks({
    progress,
    ended: renderBoards,
    back: () => openParty(),
    leave,
  });

  $("hostBtn").addEventListener("click", startHosting);
  $("joinForm").addEventListener("submit", (e) => {
    e.preventDefault();
    join($("joinInput").value);
  });
  $("raceStartBtn").addEventListener("click", startRaceAsHost);
  $("newCodeBtn").addEventListener("click", newCode);
  $("partyRetryBtn").addEventListener("click", () => join(P.code));
  $("partyLeaveBtn").addEventListener("click", () => {
    leave();
    showMenu();
  });
  $("copyLinkBtn").addEventListener("click", async () => {
    const ok = await copyText(joinLink(P.code));
    $("copyLinkLabel").textContent = ok ? "Link copied" : "Could not copy";
    setTimeout(() => ($("copyLinkLabel").textContent = "Copy link"), 2200);
  });

  // The host's beat: the whole table 20 times a second, which doubles as
  // the heartbeat. Guests watch for it going quiet.
  beat = setInterval(() => {
    if (P.role === "host") {
      const before = P.phase;
      settlePhase();
      if (before !== P.phase) render();
      broadcast();
    } else if (P.role === "guest" && P.status === "connected" && performance.now() - P.lastState > STALE_MS) {
      P.status = "stale";
      render();
    }
  }, 50);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !P.role) return;
    holdScreen();
    // Back from the background with a channel that died meanwhile.
    if (P.role === "guest" && P.status === "dropped") join(P.code);
  });

  // Fill the code in from the link, or from last time.
  const initial = normaliseCode(joinCode) || normaliseCode(store.get(LAST_CODE_KEY));
  if (initial) $("joinInput").value = initial;
  if (joinCode && isValidCode(joinCode)) {
    openParty();
    join(joinCode);
  }
}
