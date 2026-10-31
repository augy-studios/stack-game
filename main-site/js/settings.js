// Player settings, after MRT Station Guesser's: the leaderboard name, saved
// ahead of time under the same check a submission gets, the switches, and
// the graphics quality.
// Kept in this browser. The difficulty and time limits are kept here too,
// but picked on the start panel rather than in the window.

import { api } from "./api.js";
import { cleanDifficulty, cleanTurn, cleanGameLimit } from "./rules.js";
import { openModal, store } from "./ui.js";

const STORAGE = "uwustack.settings";

const DEFAULTS = {
  name: null,
  auto_submit: false,
  auto_replay: true,
  sound: true,
  haptics: true,
  quality: "high",
  difficulty: "medium",
  turn: 0,
  game: 0,
};

// The switches in the window, in the order they appear.
const SWITCHES = ["auto_submit", "auto_replay", "sound", "haptics"];

let current = null;
const listeners = new Set();

function load() {
  const saved = store.getJSON(STORAGE) ?? {};
  const out = { ...DEFAULTS };
  if (typeof saved.name === "string" && saved.name.trim()) out.name = saved.name.trim();
  for (const key of SWITCHES) if (typeof saved[key] === "boolean") out[key] = saved[key];
  out.quality = saved.quality === "low" ? "low" : "high";
  out.difficulty = cleanDifficulty(saved.difficulty);
  out.turn = cleanTurn(saved.turn);
  out.game = cleanGameLimit(saved.game);
  // Adding games automatically needs a name to add them under.
  if (!out.name) out.auto_submit = false;
  return out;
}

export function getSettings() {
  current ??= load();
  return { ...current };
}

export function saveSettings(changes) {
  current = { ...getSettings(), ...changes };
  if (!current.name) current.auto_submit = false;
  store.set(STORAGE, current);
  render();
  listeners.forEach((fn) => fn(getSettings()));
  return getSettings();
}

export function onSettings(fn) {
  listeners.add(fn);
}

const $ = (id) => document.getElementById(id);

function render() {
  const s = getSettings();
  $("clearNameBtn").classList.toggle("hidden", !s.name);
  $("savedName").textContent = `Now: ${s.name ?? "Not set"}`;

  document.querySelectorAll("#settingsModal [data-setting]").forEach((el) => {
    const on = s[el.dataset.setting];
    el.setAttribute("aria-checked", String(on));
    el.querySelector(".switch-state").textContent = on ? "On" : "Off";
  });
  document.querySelectorAll("#qualityPick [data-quality]").forEach((el) => {
    el.setAttribute("aria-checked", String(el.dataset.quality === s.quality));
  });
  const auto = document.querySelector('[data-setting="auto_submit"]');
  auto.disabled = !s.name;
  $("autoNote").classList.toggle("hidden", Boolean(s.name));
}

async function onSaveName(event) {
  event.preventDefault();
  const input = $("settingsName");
  const msg = $("nameMsg");
  const name = input.value.trim();
  if (!name) {
    msg.textContent = "Enter a name.";
    input.focus();
    return;
  }
  $("saveNameBtn").disabled = true;
  msg.textContent = "";
  try {
    // The API cleans and checks it, the same check a submission gets.
    const result = await api.checkName(name);
    saveSettings({ name: result.name });
    input.value = "";
    msg.textContent = "Saved.";
  } catch (err) {
    msg.textContent =
      err.code === "offline"
        ? "Checking a name needs a connection."
        : err.message || "That did not go through. Try again in a moment.";
  } finally {
    $("saveNameBtn").disabled = false;
  }
}

export function openSettings() {
  $("nameMsg").textContent = "";
  $("settingsName").value = "";
  render();
  openModal("settingsModal");
}

export function initSettings() {
  $("settingsBtn").addEventListener("click", openSettings);
  $("nameForm").addEventListener("submit", onSaveName);
  $("clearNameBtn").addEventListener("click", () => {
    saveSettings({ name: null });
    $("nameMsg").textContent = "Name cleared.";
  });
  document.querySelectorAll("#settingsModal [data-setting]").forEach((el) => {
    el.addEventListener("click", () => saveSettings({ [el.dataset.setting]: !getSettings()[el.dataset.setting] }));
  });
  $("qualityPick").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-quality]");
    if (btn) saveSettings({ quality: btn.dataset.quality });
  });
  render();
}
