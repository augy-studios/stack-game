// The Edge Tray, per edge-tray-spec.md: the app's buttons in a column pinned
// top right, with an arrow tab beside it that slides the column off the
// edge, leaving only the tab. Whether it is open is remembered in this
// browser; the head of index.html applies it before first paint.

import { store } from "./ui.js";

const TRAY_KEY = "uwustack.trayOpen";

const $ = (id) => document.getElementById(id);

function setTray(open, { save = true } = {}) {
  $("tray").classList.toggle("collapsed", !open);
  $("trayTab").setAttribute("aria-expanded", String(open));
  $("trayTab").setAttribute("aria-label", open ? "Hide menu" : "Show menu");
  $("trayTab").title = open ? "Hide menu" : "Show menu";
  // Off-screen buttons must not take focus or clicks.
  $("trayButtons").inert = !open;
  document.body.classList.toggle("tray-open", open);
  if (save) store.set(TRAY_KEY, open ? "1" : "0");
}

// The update bar publishes its height so the tray starts below it.
export function watchBanner(el) {
  const sizer = new ResizeObserver(([entry]) => {
    document.documentElement.style.setProperty("--banner-h", `${entry.target.offsetHeight}px`);
  });
  sizer.observe(el);
  return () => {
    sizer.disconnect();
    document.documentElement.style.setProperty("--banner-h", "0px");
  };
}

export function initTray() {
  setTray(store.get(TRAY_KEY) !== "0", { save: false });
  $("trayTab").addEventListener("click", () => setTray($("tray").classList.contains("collapsed")));
  // Later toggles animate; the first paint did not.
  requestAnimationFrame(() => document.documentElement.classList.remove("tray-start-collapsed"));
}
