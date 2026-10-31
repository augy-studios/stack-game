// The instant replay: a finished game played back in the same scene, with
// play and pause, a step back or forward one slab at a time, a timeline,
// and 0.5x, 1x, 2x or 4x, the same speeds as the word rain and sudoku
// games' replays. The speed picked last is remembered in this browser.
//
// It holds nothing but a clock over a finished game; js/view.js draws the
// game at whatever moment the clock says.

import { difficultyOf } from "./rules.js";
import { hydrateIcons, store } from "./ui.js";

const SPEEDS = [0.5, 1, 2, 4];
const SPEED_KEY = "uwustack.replaySpeed";
// The replay runs on past the end this long, so the last piece lands.
const TAIL_MS = 1800;

const $ = (id) => document.getElementById(id);

const ENDINGS = {
  miss: "Missed the tower",
  water: "The water rose over the top",
  time: "Time ran out",
  quit: "Stopped",
};

export function createReplay() {
  let state = null;
  let t = 0;
  let playing = false;
  let speed = 1;
  let end = 0;
  let steps = [];
  let jumped = false;
  let label = "";

  function setPlaying(on) {
    playing = on && state !== null;
    const btn = $("rpPlay");
    btn.setAttribute("aria-label", playing ? "Pause replay" : "Play replay");
    btn.title = playing ? "Pause replay" : "Play replay";
    btn.querySelector("[data-icon]").setAttribute("data-icon", playing ? "pause" : "play");
    hydrateIcons(btn);
  }

  function setSpeed(next, { save = true } = {}) {
    if (!SPEEDS.includes(next)) return;
    speed = next;
    if (save) store.set(SPEED_KEY, String(next));
    document.querySelectorAll("#rpSpeed [data-speed]").forEach((el) => {
      const on = Number(el.dataset.speed) === speed;
      el.setAttribute("aria-checked", String(on));
    });
  }

  function syncLabel() {
    if (!state) return;
    const drops = state.drops;
    // The last drop at or before t.
    let i = -1;
    for (let k = drops.length - 1; k >= 0; k--) {
      if (drops[k].t <= t) {
        i = k;
        break;
      }
    }
    let text;
    if (state.over && t >= state.over.at) {
      text = `${ENDINGS[state.over.by]}. ${state.layers.length - 1} high.`;
    } else if (i < 0) {
      text = `The first slab, ${difficultyOf(state.settings.difficulty).label}.`;
    } else {
      const d = drops[i];
      const what = d.perfect
        ? d.combo > 1
          ? `Perfect, ${d.combo} in a row`
          : "Perfect"
        : d.auto
          ? "Dropped by the time limit"
          : `Cut, ${d.accuracy}% kept`;
      text = `Layer ${d.n} of ${state.layers.length - 1}: ${what}${d.grew ? ", and it grew" : ""}.`;
    }
    if (text !== label) {
      label = text;
      $("rpLabel").textContent = text;
    }
    const scrub = $("rpScrub");
    if (Number(scrub.max) !== end) scrub.max = String(end);
    if (document.activeElement !== scrub) scrub.value = String(Math.round(t));
  }

  function seek(ms) {
    t = Math.max(0, Math.min(end, ms));
    jumped = true;
    syncLabel();
  }

  // Each drop is a step; landing just after it shows what it did.
  function stepForward() {
    setPlaying(false);
    const next = steps.find((s) => s > t + 1);
    seek(next === undefined ? end : next + 1);
  }

  function stepBack() {
    setPlaying(false);
    let prev = 0;
    for (const s of steps) {
      if (s + 1 < t - 1) prev = s + 1;
      else break;
    }
    seek(prev);
  }

  function toggle() {
    if (!state) return;
    if (!playing && t >= end) seek(0);
    setPlaying(!playing);
  }

  // A finished game. It shows its end until play is pressed, or until
  // start() if the replay plays by itself.
  function load(finished) {
    state = finished;
    steps = finished.drops.map((d) => d.t);
    if (finished.miss) steps.push(finished.miss.t);
    end = finished.over.at + TAIL_MS;
    setPlaying(false);
    seek(end);
  }

  function start() {
    seek(0);
    setPlaying(true);
  }

  function clear() {
    state = null;
    setPlaying(false);
  }

  // Moves the clock on by `ms` of real time. Returns where it was and
  // where it is, and whether that was a jump rather than playback.
  function tick(ms) {
    const from = t;
    if (playing) {
      t = Math.min(end, t + ms * speed);
      if (t >= end) setPlaying(false);
      syncLabel();
    }
    const out = { from, to: t, jump: jumped };
    jumped = false;
    return out;
  }

  function init() {
    $("rpPlay").addEventListener("click", toggle);
    $("rpBack").addEventListener("click", stepBack);
    $("rpForward").addEventListener("click", stepForward);
    $("rpSpeed").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-speed]");
      if (btn) setSpeed(Number(btn.dataset.speed));
    });
    $("rpScrub").addEventListener("input", (e) => {
      setPlaying(false);
      seek(Number(e.target.value));
    });
    setSpeed(Number(store.get(SPEED_KEY)) || 1, { save: false });
  }

  return {
    init,
    load,
    start,
    clear,
    tick,
    toggle,
    stepBack,
    stepForward,
    get state() {
      return state;
    },
    get t() {
      return t;
    },
    get playing() {
      return playing;
    },
    // Showing the end, rather than playing through: the camera pulls back.
    get atEnd() {
      return state !== null && !playing && t >= state.over.at;
    },
  };
}
