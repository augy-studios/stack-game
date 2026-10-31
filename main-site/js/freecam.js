// The replay's free camera. While a replay is showing, the picture can be
// handled like an object on a table:
//
//   drag                          turn round the tower, and look from higher
//                                 or lower
//   pinch, or the mouse wheel     zoom in and out
//   two-finger drag, right-drag   move up and down the tower
//     or Shift-drag
//   double-tap                    put the camera back
//
// It only keeps the offsets, in orbit; js/scene.js applies them to its own
// camera and eases them, and eases back to its own camera once they are
// switched off. The live game never has them.

export const orbit = { yaw: 0, pitch: 0, zoom: 1, lift: 0 };

// Radians either side of the usual angle, and how far in and out.
const PITCH = [-0.33, 1.08];
const ZOOM = [0.25, 4];
const DOUBLE_TAP_MS = 320;

let on = false;
let canvas = null;

const clamp = (x, [lo, hi]) => Math.min(hi, Math.max(lo, x));

export function resetOrbit() {
  orbit.yaw = 0;
  orbit.pitch = 0;
  orbit.zoom = 1;
  orbit.lift = 0;
}

export function setFree(value) {
  if (value === on) return;
  on = value;
  canvas?.classList.toggle("free", on);
  if (!on) resetOrbit();
}

export function initFreecam(stage) {
  canvas = stage;
  const pointers = new Map();
  let lastTap = { t: 0, x: 0, y: 0 };
  const height = () => canvas.clientHeight || window.innerHeight;

  canvas.addEventListener("pointerdown", (e) => {
    if (!on) return;
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, lift: e.button === 2 || e.shiftKey });
    canvas.classList.add("dragging");
    const now = performance.now();
    const again = now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
    if (pointers.size === 1 && again) {
      resetOrbit();
      lastTap = { t: 0, x: 0, y: 0 };
    } else {
      lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!on || !p) return;
    const h = height();
    if (pointers.size === 1) {
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (p.lift || e.shiftKey) {
        orbit.lift += dy / h;
      } else {
        orbit.yaw -= (dx / h) * 3;
        orbit.pitch = clamp(orbit.pitch + (dy / h) * 2, PITCH);
      }
    } else if (pointers.size === 2) {
      // Both fingers: the gap between them zooms, their midpoint lifts.
      const [a, b] = [...pointers.values()];
      const gap = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = (a.y + b.y) / 2;
      p.x = e.clientX;
      p.y = e.clientY;
      const nextGap = Math.hypot(a.x - b.x, a.y - b.y);
      if (gap > 0 && nextGap > 0) orbit.zoom = clamp(orbit.zoom * (gap / nextGap), ZOOM);
      orbit.lift += ((a.y + b.y) / 2 - mid) / h;
    }
    p.x = e.clientX;
    p.y = e.clientY;
  });

  const lift = (e) => {
    pointers.delete(e.pointerId);
    if (!pointers.size) canvas.classList.remove("dragging");
  };
  canvas.addEventListener("pointerup", lift);
  canvas.addEventListener("pointercancel", lift);

  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!on) return;
      e.preventDefault();
      orbit.zoom = clamp(orbit.zoom * Math.exp(e.deltaY * 0.0012), ZOOM);
    },
    { passive: false }
  );

  // Right-drag moves up and down, so no menu.
  canvas.addEventListener("contextmenu", (e) => {
    if (on) e.preventDefault();
  });
}
