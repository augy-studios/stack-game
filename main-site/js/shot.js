// A saved picture of the tower: the scene at 4K from js/scene.js's
// capture(), with a band across the bottom naming the player and the game,
// then straight into the browser's downloads.
//
// The band is frosted glass in the game's own font and colours, light or
// dark with the theme: the scene behind it blurred and washed over, the
// name (if there is one) large in the brand colour, the result under it,
// the seed and the day under that, and the game's name and address in the
// corner. Everything is sized from the picture's shorter side, so it reads
// the same on a wide 4K picture and a tall phone one, and a line too long
// for the width is set smaller rather than cut.

const BRAND = "uwuStack";
const ICON = "/RST-192.png";

let iconImage = null;
function loadIcon() {
  iconImage ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = ICON;
  });
  return iconImage;
}

function cssVar(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

// The words, from what game.js passes:
//   name, score, high, mode, perfects, bestRun, seed, auto, and playedAt,
//   when it was played in ms since 1970, or null if nobody knows
function lines(info) {
  const result = [
    `${info.high} high`,
    `${info.mode} mode`,
    `${info.perfects} perfect`,
    `best run ${info.bestRun}`,
  ];
  if (info.auto) result.push("autoplay");
  const points = `${info.score} ${info.score === 1 ? "point" : "points"}`;
  return {
    title: info.name || points,
    result: (info.name ? [points, ...result] : result).join("  ·  "),
    detail: info.playedAt ? `Seed ${info.seed}  ·  ${playedOn(info.playedAt)}` : `Seed ${info.seed}`,
  };
}

// Day, month, year, the month short and in English like the rest of the
// game, in the viewer's own time zone: "3 Nov 2026".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function playedOn(ms) {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// Sets `font` at `size`, smaller if need be so `text` fits in `room`.
function fit(ctx, text, size, family, room) {
  ctx.font = `${size}px ${family}`;
  const w = ctx.measureText(text).width;
  if (w <= room) return size;
  const smaller = Math.floor((size * room) / w);
  ctx.font = `${smaller}px ${family}`;
  return smaller;
}

export async function caption(canvas, info) {
  const ctx = canvas.getContext("2d");
  const { width: W, height: H } = canvas;
  const u = Math.min(W, H) / 1080;
  const family = getComputedStyle(document.body).fontFamily || "sans-serif";
  const dark = document.documentElement.dataset.mode === "dark";
  const ink = cssVar("--ink", dark ? "#eef2ef" : "#121815");
  const muted = cssVar("--muted", dark ? "#9aa7a0" : "#5b665f");
  const brand = cssVar("--brand-ink", dark ? "#bff5cf" : "#1f6b3d");

  const sizes = { title: Math.round(50 * u), result: Math.round(31 * u), detail: Math.round(25 * u) };
  await Promise.all(
    [...new Set(Object.values(sizes))].map((s) => document.fonts?.load(`${s}px ${family}`).catch(() => null))
  );
  const icon = await loadIcon();

  const text = lines(info);
  const pad = Math.round(34 * u);
  const gap = Math.round(30 * u);
  const host = location.host;

  // The corner: the icon, the name and the address. On a picture too
  // narrow for it beside the words, it drops to its own row under them.
  const iconSize = Math.round(76 * u);
  ctx.font = `${Math.round(40 * u)}px ${family}`;
  const brandW = ctx.measureText(BRAND).width;
  ctx.font = `${sizes.detail}px ${family}`;
  const hostW = ctx.measureText(host).width;
  const cornerW = (icon ? iconSize + Math.round(18 * u) : 0) + Math.max(brandW, hostW);
  ctx.font = `${sizes.title}px ${family}`;
  let wordsW = ctx.measureText(text.title).width;
  ctx.font = `${sizes.result}px ${family}`;
  wordsW = Math.max(wordsW, ctx.measureText(text.result).width);
  const beside = pad * 2 + wordsW + gap + cornerW <= W;
  const room = beside ? W - pad * 2 - gap - cornerW : W - pad * 2;

  const rows = [
    { text: text.title, size: fit(ctx, text.title, sizes.title, family, room), color: brand },
    { text: text.result, size: fit(ctx, text.result, sizes.result, family, room), color: ink },
    { text: text.detail, size: fit(ctx, text.detail, sizes.detail, family, room), color: muted },
  ];
  const lead = 1.32;
  const wordsH = rows.reduce((h, r) => h + r.size * lead, 0) - rows[rows.length - 1].size * (lead - 1);
  const footH = beside ? 0 : Math.round(sizes.detail * 1.9);
  const bandH = Math.round(pad * 2 + Math.max(wordsH, beside ? iconSize : 0) + footH);
  const top = H - bandH;

  // Frosted: the scene behind, blurred, then washed over. A browser that
  // cannot blur a canvas still gets the wash.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, W, bandH);
  ctx.clip();
  if ("filter" in ctx) {
    const behind = document.createElement("canvas");
    behind.width = W;
    behind.height = bandH;
    behind.getContext("2d").drawImage(canvas, 0, top, W, bandH, 0, 0, W, bandH);
    ctx.filter = `blur(${Math.round(22 * u)}px)`;
    ctx.drawImage(behind, 0, top);
    ctx.filter = "none";
  }
  ctx.fillStyle = dark ? "rgba(12, 16, 14, 0.62)" : "rgba(255, 255, 255, 0.66)";
  ctx.fillRect(0, top, W, bandH);
  ctx.fillStyle = dark ? "rgba(255, 255, 255, 0.14)" : "rgba(255, 255, 255, 0.85)";
  ctx.fillRect(0, top, W, Math.max(1, Math.round(2 * u)));
  ctx.restore();

  // The words, top to bottom, centred in the band beside the corner.
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  let y = top + pad + (beside ? Math.max(0, (iconSize - wordsH) / 2) : 0);
  for (const r of rows) {
    ctx.font = `${r.size}px ${family}`;
    ctx.fillStyle = r.color;
    ctx.fillText(r.text, pad, y + r.size * 0.88);
    y += r.size * lead;
  }

  if (beside) {
    const right = W - pad;
    const textX = right - Math.max(brandW, hostW);
    const mid = top + bandH / 2;
    if (icon) {
      const x = textX - Math.round(18 * u) - iconSize;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect?.(x, mid - iconSize / 2, iconSize, iconSize, Math.round(18 * u));
      ctx.clip();
      ctx.drawImage(icon, x, mid - iconSize / 2, iconSize, iconSize);
      ctx.restore();
    }
    ctx.textAlign = "right";
    ctx.font = `${Math.round(40 * u)}px ${family}`;
    ctx.fillStyle = brand;
    ctx.fillText(BRAND, right, mid - Math.round(4 * u));
    ctx.font = `${sizes.detail}px ${family}`;
    ctx.fillStyle = muted;
    ctx.fillText(host, right, mid + sizes.detail * 1.1);
  } else {
    // Its own row: a small icon, then "uwuStack · the address".
    const rowY = H - pad;
    const small = Math.round(sizes.detail * 1.3);
    let x = pad;
    if (icon) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect?.(x, rowY - small + sizes.detail * 0.2, small, small, Math.round(small * 0.24));
      ctx.clip();
      ctx.drawImage(icon, x, rowY - small + sizes.detail * 0.2, small, small);
      ctx.restore();
      x += small + Math.round(12 * u);
    }
    ctx.font = `${sizes.detail}px ${family}`;
    ctx.fillStyle = brand;
    ctx.fillText(BRAND, x, rowY);
    x += ctx.measureText(`${BRAND}  `).width;
    ctx.fillStyle = muted;
    ctx.fillText(`·  ${host}`, x, rowY);
  }
}

function fileName() {
  const d = new Date();
  const two = (n) => String(n).padStart(2, "0");
  const day = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  return `uwustack-${day}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}.png`;
}

// Straight into the browser's downloads, on every device. Where it lands,
// and whether the browser asks first, is the browser's own setting.
export async function save(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("could not encode the picture");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName();
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
