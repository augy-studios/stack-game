// Full screen. The game always fills the window, with no header or footer.
// Real full screen happens only when the tray's button asks for it: starting
// a game never does. Safari on iPhone lets only video go full screen; there,
// and wherever the browser refuses, the game just keeps filling the window.
// Installed from the home screen, the app opens full screen already.

import { hydrateIcons } from "./ui.js";

const root = document.documentElement;
function element() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function supported() {
  return Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled);
}

async function enter() {
  if (!supported() || element()) return;
  try {
    await (root.requestFullscreen?.call(root, { navigationUI: "hide" }) ?? root.webkitRequestFullscreen?.call(root));
  } catch {
    // Refused. The game fills the window anyway.
  }
}

async function leave() {
  if (!element()) return;
  try {
    await (document.exitFullscreen?.call(document) ?? document.webkitExitFullscreen?.call(document));
  } catch {
    // Already out.
  }
}

function sync() {
  const full = Boolean(element());
  root.classList.toggle("is-full", full);
  const btn = document.getElementById("fullBtn");
  const label = full ? "Leave full screen" : "Full screen";
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.querySelector("[data-icon]").setAttribute("data-icon", full ? "shrink" : "expand");
  hydrateIcons(btn);
}

export function initFullscreen() {
  const btn = document.getElementById("fullBtn");
  if (!supported()) btn.classList.add("hidden");
  btn.addEventListener("click", () => {
    if (element()) leave();
    else enter();
  });
  document.addEventListener("fullscreenchange", sync);
  document.addEventListener("webkitfullscreenchange", sync);
  sync();
}
