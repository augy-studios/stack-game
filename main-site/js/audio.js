// Every sound in the game, made with the Web Audio API as it plays. There
// are no sound files, so there is nothing to download, cache or license,
// and the game sounds the same offline.
//
//   drop      a slab landing with a cut: a short wooden knock
//   perfect   a Shepard tone, one semitone higher for every perfect in a
//             row. Its partials sit an octave apart under a fixed bell
//             curve, so it keeps rising for as long as the combo lasts
//             without ever leaving the range a speaker plays well
//   hit       a cut-off piece knocking against a layer below
//   land      a piece landing on the island
//   splash    a piece, or a missed slab, going into the water
//   slosh     the water itself, a loop that grows louder as it nears the
//             layer being built
//
// Browsers only allow sound after a tap or a key, so nothing is made until
// unlock() is called from one.

let ctx = null;
let master = null;
let noise = null;
let slosh = null;
let on = true;
let sloshLevel = 0;
let sloshHeld = false;

export function setSoundOn(value) {
  on = value;
  if (master) master.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, 0.05);
}

export function unlock() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = on ? 0.9 : 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 6;
    master.connect(limiter).connect(ctx.destination);
    noise = makeNoise();
    startSlosh();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
}

// Two seconds of white noise and two of brown, made once.
function makeNoise() {
  const length = ctx.sampleRate * 2;
  const white = ctx.createBuffer(1, length, ctx.sampleRate);
  const brown = ctx.createBuffer(1, length, ctx.sampleRate);
  const w = white.getChannelData(0);
  const b = brown.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const x = Math.random() * 2 - 1;
    w[i] = x;
    last = (last + 0.02 * x) / 1.02;
    b[i] = last * 3.5;
  }
  return { white, brown };
}

function noiseSource(kind = "white") {
  const src = ctx.createBufferSource();
  src.buffer = noise[kind];
  return src;
}

function envelope(gain, at, peak, attack, decay) {
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
}

const ready = () => ctx && on && ctx.state === "running";

/* ---- one-shots ---- */

export function playDrop(strength = 1) {
  if (!ready()) return;
  const at = ctx.currentTime;
  const body = ctx.createOscillator();
  const bodyGain = ctx.createGain();
  body.type = "sine";
  body.frequency.setValueAtTime(190, at);
  body.frequency.exponentialRampToValueAtTime(95, at + 0.09);
  envelope(bodyGain, at, 0.5 * strength, 0.004, 0.12);
  body.connect(bodyGain).connect(master);
  body.start(at);
  body.stop(at + 0.2);

  const click = noiseSource();
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 900;
  band.Q.value = 1.4;
  const clickGain = ctx.createGain();
  envelope(clickGain, at, 0.35 * strength, 0.002, 0.06);
  click.connect(band).connect(clickGain).connect(master);
  click.start(at, Math.random());
  click.stop(at + 0.1);
}

export function playPerfect(step) {
  if (!ready()) return;
  const at = ctx.currentTime;
  const pos = (((step - 1) % 12) + 12) % 12 / 12;
  const out = ctx.createGain();
  out.gain.value = 0.32;
  out.connect(master);
  for (let k = 0; k < 8; k++) {
    const octave = k + pos;
    const freq = 55 * 2 ** octave;
    // The fixed bell curve over octaves that makes the rise endless.
    const weight = Math.exp(-((octave - 4) ** 2) / (2 * 1.3 ** 2));
    if (weight < 0.02) continue;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    envelope(g, at, weight * 0.5, 0.008, 0.55);
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + 0.7);
  }
  // A soft bright edge on top, so a perfect reads as a chime.
  const shine = ctx.createOscillator();
  shine.type = "triangle";
  shine.frequency.value = 55 * 2 ** (4 + pos) * 2;
  const sg = ctx.createGain();
  envelope(sg, at, 0.06, 0.004, 0.25);
  shine.connect(sg).connect(out);
  shine.start(at);
  shine.stop(at + 0.35);
}

export function playHit(strength = 0.5) {
  if (!ready()) return;
  const at = ctx.currentTime;
  const level = 0.15 + 0.45 * strength;
  const tone = ctx.createOscillator();
  tone.type = "triangle";
  tone.frequency.setValueAtTime(760 + Math.random() * 180, at);
  tone.frequency.exponentialRampToValueAtTime(420, at + 0.05);
  const tg = ctx.createGain();
  envelope(tg, at, level * 0.6, 0.002, 0.07);
  tone.connect(tg).connect(master);
  tone.start(at);
  tone.stop(at + 0.12);

  const click = noiseSource();
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 2200;
  band.Q.value = 2;
  const cg = ctx.createGain();
  envelope(cg, at, level * 0.5, 0.001, 0.04);
  click.connect(band).connect(cg).connect(master);
  click.start(at, Math.random());
  click.stop(at + 0.08);
}

export function playLand(strength = 0.5) {
  if (!ready()) return;
  const at = ctx.currentTime;
  const thud = noiseSource("brown");
  const low = ctx.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 420;
  const g = ctx.createGain();
  envelope(g, at, 0.3 + 0.5 * strength, 0.004, 0.16);
  thud.connect(low).connect(g).connect(master);
  thud.start(at, Math.random());
  thud.stop(at + 0.25);
}

export function playSplash(strength = 0.6) {
  if (!ready()) return;
  const at = ctx.currentTime;
  const size = 0.35 + 0.65 * strength;
  const wash = noiseSource();
  const low = ctx.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.setValueAtTime(3800, at);
  low.frequency.exponentialRampToValueAtTime(380, at + 0.5 * size + 0.15);
  const g = ctx.createGain();
  envelope(g, at, 0.45 * size, 0.01, 0.4 * size + 0.15);
  wash.connect(low).connect(g).connect(master);
  wash.start(at, Math.random());
  wash.stop(at + 0.8);

  // A few bubbles after it.
  for (let i = 0; i < 3; i++) {
    const t = at + 0.08 + i * 0.07 + Math.random() * 0.05;
    const b = ctx.createOscillator();
    b.type = "sine";
    b.frequency.setValueAtTime(260 + Math.random() * 200, t);
    b.frequency.exponentialRampToValueAtTime(700 + Math.random() * 400, t + 0.06);
    const bg = ctx.createGain();
    envelope(bg, t, 0.08 * size, 0.004, 0.05);
    b.connect(bg).connect(master);
    b.start(t);
    b.stop(t + 0.09);
  }
}

export function playGameOver() {
  if (!ready()) return;
  const at = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(220, at);
  osc.frequency.exponentialRampToValueAtTime(70, at + 0.6);
  const g = ctx.createGain();
  envelope(g, at, 0.35, 0.01, 0.6);
  osc.connect(g).connect(master);
  osc.start(at);
  osc.stop(at + 0.7);
}

/* ---- the water's loop ---- */

function startSlosh() {
  const src = noiseSource("brown");
  src.loop = true;
  const low = ctx.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 520;
  low.Q.value = 0.8;
  // A slow swell, the water lapping.
  const swell = ctx.createGain();
  swell.gain.value = 0.6;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.32;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.4;
  lfo.connect(lfoDepth).connect(swell.gain);
  const lfo2 = ctx.createOscillator();
  lfo2.frequency.value = 0.11;
  const lfo2Depth = ctx.createGain();
  lfo2Depth.gain.value = 220;
  lfo2.connect(lfo2Depth).connect(low.frequency);
  const level = ctx.createGain();
  level.gain.value = 0;
  src.connect(low).connect(swell).connect(level).connect(master);
  src.start();
  lfo.start();
  lfo2.start();
  slosh = level;
}

// 0 when the water is far below the top of the tower, 1 when it is about
// to reach it. Held at silence while the game is paused or over.
export function setSlosh(level, held = false) {
  sloshLevel = Math.max(0, Math.min(1, level));
  sloshHeld = held;
  if (!slosh) return;
  const target = sloshHeld ? 0 : 0.02 + sloshLevel * sloshLevel * 0.9;
  slosh.gain.setTargetAtTime(target, ctx.currentTime, 0.25);
}

// Silence the loop when the page is hidden, and bring it back after.
export function suspend(hidden) {
  if (!ctx) return;
  if (hidden) ctx.suspend().catch(() => {});
  else ctx.resume().catch(() => {});
}
