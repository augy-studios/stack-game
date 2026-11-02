import { COLOR_THEMES, applyColorTheme, applyMode, getStoredColorTheme, getStoredMode, getModePreference, initTheme } from "./theme.js";
import { hydrateIcons, openModal, closeModal, closeTopModal } from "./ui.js";
import { initUpdateBar } from "./update-bar.js";
import { initTray } from "./tray.js";
import { initLeaderboard } from "./leaderboard.js";
import { initSettings } from "./settings.js";
import { initGame, openShared, showMenu, toast } from "./game.js";
import { initParty, openParty } from "./party.js";
import { unpackRecord, cleanRecord } from "./record.js";
import { runRecord } from "./sim.js";
import { api } from "./api.js";

/* Theme modal, per uwuapps-theme.md section 6. */

function buildThemeModal() {
  const grid = document.getElementById("swatchGrid");
  grid.innerHTML = COLOR_THEMES.map(
    (t) => `
      <button class="swatch" data-theme-id="${t.id}" style="--swatch-color:${t.hex}" type="button" aria-label="${t.label}">
        <span class="swatch-dot"></span>
        <span class="swatch-label">${t.label}</span>
      </button>`
  ).join("");

  syncThemeModalState();

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme-id]");
    if (!btn) return;
    applyColorTheme(btn.dataset.themeId);
    syncThemeModalState();
  });

  document.getElementById("modeToggle").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mode]");
    if (!btn) return;
    applyMode(btn.dataset.mode);
    syncThemeModalState();
  });

  // A tab left open across 09:00 or 18:00 re-resolves itself; redraw the
  // modal so the note and pressed state stay in step with the change.
  document.addEventListener("uwu:modechange", syncThemeModalState);
}

function syncThemeModalState() {
  const activeTheme = getStoredColorTheme();
  const activePreference = getModePreference();
  const resolvedMode = getStoredMode();

  document.querySelectorAll("#swatchGrid .swatch").forEach((el) => {
    el.classList.toggle("active", el.dataset.themeId === activeTheme);
  });
  document.querySelectorAll("#modeToggle .mode-btn").forEach((el) => {
    const isActive = el.dataset.mode === activePreference;
    el.classList.toggle("active", isActive);
    el.setAttribute("aria-pressed", String(isActive));
  });

  const note = document.getElementById("modeNote");
  if (note) {
    note.hidden = activePreference !== "time";
    if (activePreference === "time") {
      note.textContent = `Following the clock. Currently ${resolvedMode}.`;
    }
  }

  updateThemeButtonIcon();
}

function updateThemeButtonIcon() {
  const span = document.querySelector("#themeBtn [data-icon]");
  span.setAttribute("data-icon", getStoredMode() === "dark" ? "moon" : "sun");
  hydrateIcons(document.getElementById("themeBtn"));
}

function wireModals() {
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });
  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeModal(backdrop.id);
    });
  });
  document.getElementById("themeBtn").addEventListener("click", () => openModal("themeModal"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeTopModal();
  });
}

/* Links into the app, read before the game tidies the address. */

// /?watch=<token>: a whole game in the link.
// /r/<id>: a short link to a replay the API stored.
// /join?id=<code>: a race to join.
function readLinks() {
  const params = new URLSearchParams(location.search);
  const short = location.pathname.match(/^\/r\/([A-Za-z0-9]{8})\/?$/);
  return {
    watch: params.get("watch"),
    short: short ? short[1] : null,
    join: location.pathname.replace(/\/$/, "") === "/join" ? params.get("id") : params.get("join"),
  };
}

function watch(record, meta = {}) {
  const run = record ? runRecord(record) : { error: "bad" };
  if (run.error) {
    toast("That replay link is broken.");
    return false;
  }
  openShared({ record, state: run.state, ...meta });
  return true;
}

async function openShort(id) {
  try {
    const data = await api.replay(id);
    const record = cleanRecord(data.record);
    if (watch(record, { name: data.name ?? null, verified: data.verified === true, id })) return true;
  } catch (err) {
    toast(err.code === "offline" ? "Opening a short replay link needs a connection." : "That replay could not be found.");
  }
  showMenu();
  return false;
}

function boot() {
  const links = readLinks();
  const startUrl = location.href;

  initTheme();
  hydrateIcons();
  updateThemeButtonIcon();
  buildThemeModal();
  wireModals();
  initTray();
  initLeaderboard();
  initSettings();
  initGame({ onRace: openParty });
  initParty({ joinCode: links.join });

  // A replay link stays in the address while it is watched, so a reload
  // shows it again.
  if (links.watch) {
    if (watch(unpackRecord(links.watch))) history.replaceState(null, "", startUrl);
  } else if (links.short) {
    openShort(links.short).then((ok) => ok && history.replaceState(null, "", startUrl));
  }

  hydrateIcons();
  initUpdateBar();
}

boot();
