// Full screen. The game always fills the window, with no header or footer,
// and the first tap that starts a game also asks the browser for real full
// screen, since browsers only grant it from a tap. Leaving full screen,
// with the tray's button or the browser's own Esc, is respected for the
// rest of the page view: the next game does not drag the page back in.
// Safari on iPhone lets only video go full screen; there, and wherever the
// browser refuses, the game just keeps filling the window. Installed from
// the home screen, the app opens full screen already.

import { hydrateIcons } from "./ui.js";

const root = document.documentElement;
let declined = false;

function element() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function supported() {
  return Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled);
}

function standalone() {
  return window.matchMedia?.("(display-mode: fullscreen)").matches || window.matchMedia?.("(display-mode: standalone)").matches;
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

// From the tap that starts a game.
export function enterOnPlay() {
  if (declined || standalone()) return;
  enter();
}

export function initFullscreen() {
  const btn = document.getElementById("fullBtn");
  if (!supported()) btn.classList.add("hidden");
  btn.addEventListener("click", () => {
    if (element()) {
      declined = true;
      leave();
    } else {
      declined = false;
      enter();
    }
  });
  const changed = () => {
    // Out of full screen without the button: the browser's own way out.
    if (!element()) declined = true;
    sync();
  };
  document.addEventListener("fullscreenchange", changed);
  document.addEventListener("webkitfullscreenchange", changed);
  sync();
}
