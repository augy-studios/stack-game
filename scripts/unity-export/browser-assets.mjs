// Makes the assets that need a browser: the cloud texture and the star field
// as the scene draws them, the UI icons as PNGs, and every sound the game
// synthesises, rendered offline through js/audio.js itself.
//
//   node scripts/unity-export/browser-assets.mjs <assets-dir>
//
// Runs a headless Chromium over the DevTools protocol, so nothing needs
// installing: set CHROME to its path, or it uses Playwright's headless
// shell if one is installed.

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.resolve(process.argv[2] ?? path.join(ROOT, "assets"));

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = path.join(os.homedir(), "AppData/Local/ms-playwright");
  const shells = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => d.startsWith("chromium_headless_shell-")).sort() : [];
  for (const dir of shells.reverse()) {
    const exe = path.join(base, dir, "chrome-headless-shell-win64/chrome-headless-shell.exe");
    if (fs.existsSync(exe)) return exe;
  }
  throw new Error("No Chromium found: set CHROME to one.");
}

// The repo, served, so the page can load js/audio.js and the recordings.
function serve() {
  const types = { ".js": "text/javascript", ".wav": "audio/wav", ".html": "text/html" };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (url === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<!doctype html><title>export</title>");
    }
    const file = path.join(ROOT, url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function launch(origin) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "unity-export-"));
  const chrome = spawn(findChrome(), [
    "--headless", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--autoplay-policy=no-user-gesture-required", "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolve, reject) => {
    let text = "";
    chrome.stderr.on("data", (d) => {
      text += d;
      const m = text.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) resolve(m[1]);
    });
    chrome.on("exit", () => reject(new Error(`Chromium exited:\n${text}`)));
  });
  const port = new URL(wsUrl).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const waiting = new Map();
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      waiting.set(n, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  await send("Page.enable");
  await send("Page.navigate", { url: origin });
  await new Promise((r) => setTimeout(r, 500));
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  const close = () => {
    ws.close();
    chrome.kill();
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {}
  };
  return { evaluate, close };
}

const write = (rel, base64) => {
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(base64, "base64"));
  console.log(`${rel}  ${fs.statSync(file).size} bytes`);
};

/* ---- in the page ---- */

// The cloud sprite, drawn as cloudTexture() in js/scene.js draws it, at four
// times the size: the same picture, sharper when a sprite is big on screen.
const CLOUD = `(() => {
  const k = 4;
  const c = document.createElement("canvas");
  c.width = 128 * k;
  c.height = 64 * k;
  const g = c.getContext("2d");
  const blob = (x, y, r) => {
    x *= k; y *= k; r *= k;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.9)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  blob(40, 38, 26);
  blob(66, 30, 30);
  blob(92, 38, 24);
  return c.toDataURL("image/png").split(",")[1];
})()`;

// The stars, from the same seeded scatter as createScene(): x across the
// whole screen, fewer towards the bottom. The scene draws them as 2.2 pixel
// points over the sky; here they are soft dots on a square texture the sky
// shader lays over the screen.
const STARS = `(() => {
  const size = 2048;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  let s = 12345;
  const rand = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  const r = 2.2 * size / 1080 / 2;
  for (let i = 0; i < 220; i++) {
    const x = rand() * 2 - 1;
    const y = 1 - 2 * rand() ** 1.6;
    const px = (x + 1) / 2 * size;
    const py = (1 - (y + 1) / 2) * size;
    const grad = g.createRadialGradient(px, py, 0, px, py, r * 1.6);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.6, "rgba(255,255,255,0.9)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(px, py, r * 1.6, 0, Math.PI * 2);
    g.fill();
  }
  return c.toDataURL("image/png").split(",")[1];
})()`;

// Every icon in js/icons.js, white on clear so Unity's UI can tint them,
// at 128 pixels square.
const ICONS = `(async () => {
  const { icons } = await import("/main-site/js/icons.js");
  const out = {};
  for (const [name, svg] of Object.entries(icons)) {
    const text = svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" color="#ffffff" ');
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text);
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    c.getContext("2d").drawImage(img, 0, 0, 128, 128);
    out[name] = c.toDataURL("image/png").split(",")[1];
  }
  return out;
})()`;

// js/audio.js, loaded with three changes so it can play into an offline
// context: ready() is always true, and __bind() hands it the context, with
// the master at 1 and no limiter, so each file holds the sound at its own
// level. Nothing else in it changes.
const AUDIO_SETUP = `(async () => {
  let src = await (await fetch("/main-site/js/audio.js")).text();
  const ready = 'const ready = () => ctx && on && ctx.state === "running";';
  if (!src.includes(ready)) throw new Error("js/audio.js changed: update browser-assets.mjs");
  src = src.replace(ready, "const ready = () => true;");
  src += \`
export function __bind(c) {
  ctx = c;
  master = c.createGain();
  master.gain.value = 1;
  master.connect(c.destination);
  noise = makeNoise();
}
export { seamless, synthSlosh, SLOSH_URL };
\`;
  window.audio = await import(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));

  // 16-bit PCM WAV of an AudioBuffer, as base64.
  window.wav = (buffer) => {
    const channels = buffer.numberOfChannels;
    const frames = buffer.length;
    const bytes = new DataView(new ArrayBuffer(44 + frames * channels * 2));
    const text = (at, s) => [...s].forEach((ch, i) => bytes.setUint8(at + i, ch.charCodeAt(0)));
    text(0, "RIFF");
    bytes.setUint32(4, 36 + frames * channels * 2, true);
    text(8, "WAVEfmt ");
    bytes.setUint32(16, 16, true);
    bytes.setUint16(20, 1, true);
    bytes.setUint16(22, channels, true);
    bytes.setUint32(24, buffer.sampleRate, true);
    bytes.setUint32(28, buffer.sampleRate * channels * 2, true);
    bytes.setUint16(32, channels * 2, true);
    bytes.setUint16(34, 16, true);
    text(36, "data");
    bytes.setUint32(40, frames * channels * 2, true);
    const data = [...Array(channels)].map((_, ch) => buffer.getChannelData(ch));
    let peak = 0;
    for (let i = 0; i < frames; i++) {
      for (let ch = 0; ch < channels; ch++) {
        const x = data[ch][i];
        peak = Math.max(peak, Math.abs(x));
        bytes.setInt16(44 + (i * channels + ch) * 2, Math.max(-1, Math.min(1, x)) * 32767, true);
      }
    }
    let bin = "";
    const u8 = new Uint8Array(bytes.buffer);
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return { base64: btoa(bin), peak };
  };

  // Renders one call into js/audio.js, seconds long, trimming the silence
  // its tail leaves.
  window.render = async (seconds, play, channels = 1) => {
    const ctx = new OfflineAudioContext(channels, Math.ceil(44100 * seconds), 44100);
    audio.__bind(ctx);
    play(ctx);
    let buffer = await ctx.startRendering();
    const data = buffer.getChannelData(0);
    let end = data.length;
    while (end > 1 && Math.abs(data[end - 1]) < 1e-4) end--;
    end = Math.min(data.length, end + Math.round(0.01 * 44100));
    const trimmed = new AudioBuffer({ length: end, numberOfChannels: channels, sampleRate: 44100 });
    for (let ch = 0; ch < channels; ch++) trimmed.copyToChannel(buffer.getChannelData(ch).subarray(0, end), ch);
    return wav(trimmed);
  };
  return true;
})()`;

// Every sound the game makes itself. Random parts (the noise, a little
// jitter in pitch) differ every time the game plays one, so the knocks get
// a few takes each to pick between.
const SOUNDS = `(async () => {
  const out = {};
  const take = async (name, seconds, play) => (out[name] = await render(seconds, play));
  for (let i = 1; i <= 3; i++) await take("Drop" + i, 0.6, () => audio.playDrop(1));
  for (let i = 1; i <= 3; i++) await take("Land" + i, 0.6, () => audio.playLand(1));
  await take("GameOver", 1, () => audio.playGameOver());

  // The perfect's notes: C major from C3 to C6, the step-th perfect in a
  // row playing note step - 1.
  const NAMES = ["C", "D", "E", "F", "G", "A", "B"];
  for (let n = 0; n <= 21; n++) {
    const name = "Perfect" + String(n + 1).padStart(2, "0") + "_" + NAMES[n % 7] + (3 + Math.floor(n / 7));
    await take(name, 1.2, () => audio.playPerfect(n + 1));
  }

  // The stand-ins js/audio.js plays until a recording has loaded.
  for (let i = 1; i <= 3; i++) await take("Fallback/HitSynth" + i, 0.6, () => audio.playHit(1));
  for (let i = 1; i <= 3; i++) await take("Fallback/SplashSynth" + i, 1.5, () => audio.playSplash(1, 0));
  await take("Fallback/GrowSynth", 1, () => audio.playGrow(0.67));
  return out;
})()`;

// The water's loop, as the game builds it from sounds/haishui.wav: its ends
// cut and its end crossfaded into its start, so it loops without a seam.
// And the stand-in, filtered noise lapping, given the same treatment: two
// LFOs at 0.32 and 0.11 Hz never line up, so 18 s of it crossfade.
const LOOPS = `(async () => {
  const ctx = new OfflineAudioContext(2, 44100, 44100);
  audio.__bind(ctx);
  const bytes = await (await fetch("/main-site" + audio.SLOSH_URL)).arrayBuffer();
  const recorded = audio.seamless(await ctx.decodeAudioData(bytes));

  const seconds = 18;
  const fade = 2;
  const off = new OfflineAudioContext(1, 44100 * (seconds + fade), 44100);
  audio.__bind(off);
  audio.synthSlosh(off.destination);
  const raw = (await off.startRendering()).getChannelData(0);
  const length = 44100 * seconds;
  const f = 44100 * fade;
  const synth = new AudioBuffer({ length, numberOfChannels: 1, sampleRate: 44100 });
  const d = new Float32Array(length);
  d.set(raw.subarray(f, f + length));
  for (let i = 0; i < f; i++) {
    const k = (i / f) * (Math.PI / 2);
    d[i] = raw[f + i] * Math.sin(k) + raw[i] * Math.cos(k);
  }
  synth.copyToChannel(d, 0);
  return { WaterLoop: wav(recorded), "Fallback/WaterLoopSynth": wav(synth) };
})()`;

/* ---- run ---- */

const server = await serve();
const page = await launch(`http://127.0.0.1:${server.address().port}/`);
try {
  write("Textures/Cloud.png", await page.evaluate(CLOUD));
  write("Textures/Stars.png", await page.evaluate(STARS));
  for (const [name, png] of Object.entries(await page.evaluate(ICONS))) {
    write(`Icons/UI/${name[0].toUpperCase()}${name.slice(1)}.png`, png);
  }
  await page.evaluate(AUDIO_SETUP);
  const sounds = { ...(await page.evaluate(SOUNDS)), ...(await page.evaluate(LOOPS)) };
  for (const [name, { base64, peak }] of Object.entries(sounds)) {
    write(`Audio/${name}.wav`, base64);
    if (peak > 1) console.warn(`  ${name} clipped: peak ${peak.toFixed(2)}`);
  }
} finally {
  page.close();
  server.close();
}
