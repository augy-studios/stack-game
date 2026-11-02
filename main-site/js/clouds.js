// The cumulus clouds the scene drifts across the sky, drawn on a 2D canvas.
// No imports, so the Unity export (scripts/unity-export/browser-assets.mjs)
// draws the very same clouds into its texture.
//
// A cumulus cloud: a heap of soft puffs, highest in the middle and squared
// off along a flat base, the way fair-weather cumulus look. The tops are lit
// and the base is in its own shade, a little bluer. Drawn white and grey,
// so whatever shows it tints it for the theme. Each variant heaps its puffs
// differently. W by H is the area to draw in, best twice as wide as tall.

export const CLOUD_VARIANTS = 5;

export function drawCloud(g, variant, W, H) {
  let s = 7919 * (variant + 1);
  const rand = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  const base = H * 0.78;

  // The puffs: a row along the base, then smaller ones heaped on top,
  // under a dome that is tallest a little off centre.
  const puffs = [];
  const peak = 0.4 + rand() * 0.2;
  const tall = 0.75 + rand() * 0.35;
  for (let i = 0; i < 7; i++) {
    const u = 0.16 + (i / 6) * 0.68 + (rand() - 0.5) * 0.06;
    const dome = Math.max(0, 1 - ((u - peak) / 0.5) ** 2);
    const r = H * (0.14 + 0.1 * dome + rand() * 0.05);
    puffs.push({ x: u * W, y: base - r * 0.7, r });
  }
  for (let i = 0; i < 18; i++) {
    const u = 0.18 + rand() * 0.64;
    const dome = Math.max(0, 1 - ((u - peak) / 0.38) ** 2);
    if (dome <= 0.08) continue;
    const r = H * (0.11 + 0.1 * dome + 0.06 * rand());
    const y = base - r * 0.9 - dome * tall * H * 0.36 * (0.6 + rand() * 0.4);
    // Kept inside the top edge, so no puff is cut flat.
    puffs.push({ x: u * W, y: Math.max(y, r * 1.05), r });
  }

  // Each puff is a soft disc: whiter towards its upper side, where the sun
  // catches it, and greyer below.
  for (const { x, y, r } of puffs) {
    const shade = g.createRadialGradient(x, y + r * 0.2, 0, x, y + r * 0.2, r);
    shade.addColorStop(0, "rgba(214,222,238,1)");
    shade.addColorStop(0.72, "rgba(214,222,238,0.9)");
    shade.addColorStop(1, "rgba(214,222,238,0)");
    g.fillStyle = shade;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  for (const { x, y, r } of puffs) {
    const lit = g.createRadialGradient(x - r * 0.15, y - r * 0.3, 0, x - r * 0.15, y - r * 0.3, r * 1.05);
    lit.addColorStop(0, "rgba(255,255,255,1)");
    lit.addColorStop(0.6, "rgba(255,255,255,0.85)");
    lit.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = lit;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  // The base: a darker band along the bottom, then cut flat and soft.
  g.globalCompositeOperation = "source-atop";
  const under = g.createLinearGradient(0, base - H * 0.22, 0, base);
  under.addColorStop(0, "rgba(180,192,214,0)");
  under.addColorStop(1, "rgba(180,192,214,0.4)");
  g.fillStyle = under;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = "destination-in";
  const px = H / 128;
  const cut = g.createLinearGradient(0, base - 6 * px, 0, base + 3 * px);
  cut.addColorStop(0, "rgba(0,0,0,1)");
  cut.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = cut;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = "source-over";
}
