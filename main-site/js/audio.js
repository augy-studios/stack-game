// Every sound in the game, made with the Web Audio API as it plays, but
// four: a piece knocking as it falls, a grown layer's slide, the splash
// and the water's loop are recordings, sounds/*.wav, precached by sw.js so they play offline
// too. Until one has loaded, or if it cannot, a synthesised stand-in plays
// in its place.
//
//   drop      a slab landing with a cut: a wooden knock with the thud of
//             its weight under it
//   perfect   the next note up the C major scale for every perfect in a
//             row, from C3 up to C6, and C6 from then on. A soft mallet:
//             a pure note with two quiet overtones that fade first, a long
//             fade, and the higher notes a little quieter, since the ear
//             hears them louder. A softer knock sits under it: the slab
//             still lands
//   grow      a run of perfects pushing a layer's side back out: glazed
//             ceramic sliding over glazed ceramic
//   hit       a cut-off piece knocking against a layer below
//   land      a piece landing on the island: dull, the sand takes the ring
//   splash    a piece, or a missed slab, going into the water
//   slosh     the water itself, waves lapping on a loop
//
// The water's sounds come from as far below the layer being built as the
// water is, so they are quieter and duller the further down it is, as
// distance makes any sound: see far().
//
// The wood is modal synthesis: a struck block rings at a few inharmonic
// modes, here a free-free beam's (1, 2.756, 5.404, 8.933 times the lowest),
// each a decaying sine, the higher ones dying faster, set off by a click
// a few milliseconds long where the two surfaces meet.
//
// The stand-in splash follows what is heard when a solid goes into water:
// the slap as it hits, the hiss of the crown thrown up, the low plunk of the air
// cavity pinching off into a bubble whose pitch rises as it rings, a burst
// of smaller bubbles, higher the smaller they are (Minnaert), and the
// drops falling back.
//
// Browsers only allow sound after a tap or a key, so nothing is made until
// unlock() is called from one.

let ctx = null;
let master = null;
let noise = null;
let slosh = null;
let on = true;
let sloshGap = Infinity;
let sloshHeld = false;

// The recordings, and where in each the sound starts, so it lands on the
// moment it belongs to rather than after the file's lead-in.
const RECORDINGS = {
  hit: { url: "/sounds/SoccerKick.wav", from: 0.04, gain: 0.33 },
  // An average splash peaks as loud as the waves do.
  splash: { url: "/sounds/waterSplash.wav", from: 0.26, gain: 1.9 },
  // A plate slid across a plate; its slide runs from 0.08 s to about 0.65 s.
  // Played at GROW_RATE, a few semitones down, which stretches it to about
  // 0.67 s: GROW_MS in js/view.js matches.
  grow: { url: "/sounds/PlateSliding.wav", from: 0.08, gain: 0.24 },
};
const recorded = {};

// The perfect's scale: C major, as semitones above C, from C3 up OCTAVES
// octaves to C6. Loudness is set against middle C.
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const C3 = 130.81;
const MIDDLE_C = 261.63;
const OCTAVES = 3;
const PERFECT_GAIN = 0.21;

const GROW_GAIN = 0.13;
const GROW_RATE = 0.85;

// A free-free beam's modes, as multiples of the lowest.
const WOOD = [1, 2.756, 5.404, 8.933];

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
    for (const [name, { url }] of Object.entries(RECORDINGS)) {
      loadSound(url).then((buffer) => (recorded[name] = buffer), () => {});
    }
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

// A recording, fetched and decoded for this context.
function loadSound(url) {
  return fetch(url)
    .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`${res.status}`))))
    .then((bytes) => ctx.decodeAudioData(bytes));
}

// A sound gap layers below the one being built: quieter by about the
// inverse square of the distance past the first few layers, and duller,
// since distance takes the highs off a sound first. The splash and the
// waves both go by it, so a splash is always as loud as the waves there.
function far(gap) {
  const d = Math.max(0, gap);
  return { gain: 1 / (1 + (d / 3) ** 2), cutoff: 18000 / (1 + d * 0.6) };
}

// A way into the master for one sound from gap layers down.
function distant(gap) {
  const { gain, cutoff } = far(gap);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = cutoff;
  const g = ctx.createGain();
  g.gain.value = gain;
  filter.connect(g).connect(master);
  return filter;
}

// Plays a loaded recording from its start point. Returns false when it has
// not loaded, so the caller can play its stand-in.
function playRecorded(name, level, rate, dest = master) {
  const buffer = recorded[name];
  if (!buffer) return false;
  const { from: start, gain } = RECORDINGS[name];
  const at = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain * level, at + 0.004);
  src.connect(g).connect(dest);
  src.start(at, start);
  return true;
}

/* ---- the pieces of a sound ---- */

const jitter = (amount) => 1 + (Math.random() - 0.5) * amount;

// A sine that starts at level and dies away with the given time constant,
// its pitch rising by rise over the first part of that.
function ring(at, freq, level, decay, dest = master, rise = 1) {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(freq, at);
  if (rise !== 1) osc.frequency.exponentialRampToValueAtTime(freq * rise, at + decay * 4);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + 0.0015);
  g.gain.setTargetAtTime(0, at + 0.0015, decay);
  osc.connect(g).connect(dest);
  osc.start(at);
  osc.stop(at + 0.0015 + decay * 7);
}

// A burst of filtered noise: the click of a contact, a slap, a hiss.
// Returns the filter, so a caller can sweep it.
function burst(at, { level, decay, attack = 0.0008, type = "bandpass", freq = 3000, q = 0.8, kind = "white", dest = master }) {
  const src = noiseSource(kind);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + attack);
  g.gain.setTargetAtTime(0, at + attack, decay);
  src.connect(filter).connect(g).connect(dest);
  src.start(at, Math.random());
  src.stop(at + attack + decay * 7);
  return filter;
}

// A wooden block struck: its modes, set off by a contact click. ringFor
// stretches or shortens every mode's decay; bright is the click's centre.
function knock(at, f0, level, ringFor = 1, { bright = 3200, dest = master } = {}) {
  const out = ctx.createGain();
  out.gain.value = level;
  out.connect(dest);
  const levels = [0.6, 0.3, 0.15, 0.07];
  const decays = [0.055, 0.032, 0.017, 0.009];
  WOOD.forEach((ratio, i) => ring(at, f0 * ratio * jitter(0.04), levels[i], decays[i] * ringFor, out));
  burst(at, { level: 0.45, decay: 0.0012, freq: bright * jitter(0.2), q: 0.7, dest: out });
}

// A bubble ringing at its own pitch, which rises as it nears the surface.
// The smaller it is, the higher and the shorter.
function bubble(at, freq, level, dest = master) {
  ring(at, freq, level, Math.min(0.045, 22 / freq), dest, 1.15 + Math.random() * 0.3);
}

/* ---- one-shots ---- */

export function playDrop(strength = 1) {
  if (!ready()) return;
  const at = ctx.currentTime;
  // The weight of the slab coming down on the tower.
  const thud = ctx.createOscillator();
  thud.frequency.setValueAtTime(110 * jitter(0.1), at);
  thud.frequency.exponentialRampToValueAtTime(62, at + 0.08);
  const tg = ctx.createGain();
  envelope(tg, at, 0.25 * strength, 0.003, 0.1);
  thud.connect(tg).connect(master);
  thud.start(at);
  thud.stop(at + 0.15);

  knock(at, 300 + Math.random() * 40, 0.32 * strength);
}

export function playPerfect(step) {
  if (!ready()) return;
  const at = ctx.currentTime;
  const n = Math.min(Math.max(0, step - 1), MAJOR.length * OCTAVES);
  const freq = C3 * 2 ** ((12 * Math.floor(n / MAJOR.length) + MAJOR[n % MAJOR.length]) / 12);
  const out = ctx.createGain();
  out.gain.value = PERFECT_GAIN * (MIDDLE_C / freq) ** 0.3;
  const soft = ctx.createBiquadFilter();
  soft.type = "lowpass";
  soft.frequency.value = 3000;
  soft.Q.value = 0.5;
  out.connect(soft).connect(master);
  // The note, then its second and third harmonics, quieter and shorter.
  [
    [1, 0.5, 0.95],
    [2, 0.12, 0.45],
    [3, 0.04, 0.25],
  ].forEach(([harmonic, level, decay]) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = freq * harmonic;
    const g = ctx.createGain();
    envelope(g, at, level, 0.01, decay);
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + decay + 0.05);
  });

  knock(at, 330 + Math.random() * 30, 0.15);
}

// A layer's side pushed out over seconds, glazed ceramic sliding over
// glazed ceramic: the recording, pitched down and a little higher or lower
// each time, or
// until it has loaded, this stand-in. A slide, not a knock. Sliding is
// the surfaces' tiny
// bumps going by too fast to hear one by one, so it is noise, smooth with
// a fine grain, as loud and as bright as the side is fast: it starts
// quick and bright and dulls and fades as it eases to a stop. Nothing low,
// and a lift near 3 kHz for the glassy sheen of a glaze.
export function playGrow(seconds = 0.67) {
  if (!ready()) return;
  if (playRecorded("grow", 1, GROW_RATE * jitter(0.06))) return;
  const at = ctx.currentTime;
  const rate = ctx.sampleRate;
  const length = Math.ceil(seconds * rate);
  const slide = ctx.createBuffer(1, length, rate);
  const d = slide.getChannelData(0);
  const fadeIn = Math.round(0.015 * rate);
  const grainEvery = Math.round(rate / 45);
  let grain = 1;
  let grainTo = 1;
  for (let i = 0; i < length; i++) {
    // How fast the side is moving: it eases out, fast to still.
    const speed = (1 - i / length) ** 2;
    // The glaze's grain: the level wanders a little, smoothly.
    if (i % grainEvery === 0) grainTo = 0.7 + 0.3 * Math.random();
    grain += (grainTo - grain) * 0.002;
    d[i] = (Math.random() * 2 - 1) * speed * grain * Math.min(1, i / fadeIn);
  }
  const src = ctx.createBufferSource();
  src.buffer = slide;
  const low = ctx.createBiquadFilter();
  low.type = "highpass";
  low.frequency.value = 1200;
  low.Q.value = 0.7;
  const bright = ctx.createBiquadFilter();
  bright.type = "lowpass";
  bright.Q.value = 0.7;
  bright.frequency.setValueAtTime(7000, at);
  bright.frequency.exponentialRampToValueAtTime(2200, at + seconds);
  const sheen = ctx.createBiquadFilter();
  sheen.type = "peaking";
  sheen.frequency.value = 3000 * jitter(0.1);
  sheen.Q.value = 1.5;
  sheen.gain.value = 6;
  const out = ctx.createGain();
  out.gain.value = GROW_GAIN;
  src.connect(low).connect(bright).connect(sheen).connect(out).connect(master);
  src.start(at);
}

export function playHit(strength = 0.5) {
  if (!ready()) return;
  // Harder knocks a little lower, and no two quite the same.
  if (playRecorded("hit", 0.2 + 0.8 * strength, (1.08 - 0.12 * strength) * jitter(0.1))) return;
  const at = ctx.currentTime;
  // A smaller piece, so it rings higher and shorter than a whole slab.
  knock(at, 470 + Math.random() * 140, 0.05 + 0.18 * strength, 0.75, { bright: 4200 });
}

export function playLand(strength = 0.5) {
  if (!ready()) return;
  const at = ctx.currentTime;
  const level = 0.14 + 0.22 * strength;
  burst(at, { level, decay: 0.05, attack: 0.003, type: "lowpass", freq: 320, q: 0.7, kind: "brown" });
  // The wood, muffled: the sand stops it ringing.
  const muffle = ctx.createBiquadFilter();
  muffle.type = "lowpass";
  muffle.frequency.value = 1400;
  muffle.connect(master);
  knock(at, 260 + Math.random() * 40, level * 0.6, 0.35, { bright: 1800, dest: muffle });
  // Sand thrown up and pattering back.
  for (let i = 0; i < 5; i++) {
    const t = at + 0.01 + Math.random() * 0.09;
    burst(t, { level: 0.05 * level * Math.random(), decay: 0.002, type: "highpass", freq: 3500, q: 0.5 });
  }
}

// gap: how many layers below the one being built it hit the water.
export function playSplash(strength = 0.6, gap = 0) {
  if (!ready()) return;
  // Even a slow piece makes a splash worth hearing.
  const size = 0.6 + 0.4 * strength;
  const dest = distant(gap);
  // A bigger splash a little lower, and no two quite the same.
  if (playRecorded("splash", size, (1.12 - 0.22 * strength) * jitter(0.06), dest)) return;
  synthSplash(size, dest);
}

function synthSplash(size, dest) {
  const at = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = 0.4;
  out.connect(dest);

  // The slap as it hits the surface.
  burst(at, { level: 0.5 * size, decay: 0.012, attack: 0.001, type: "highpass", freq: 700, q: 0.5, dest: out });

  // The crown thrown up: a hiss that darkens as it falls back.
  const crown = burst(at + 0.004, { level: 0.32 * size, decay: 0.08 + 0.12 * size, attack: 0.012, type: "lowpass", freq: 5200, q: 0.6, dest: out });
  crown.frequency.setValueAtTime(5200, at + 0.004);
  crown.frequency.exponentialRampToValueAtTime(700, at + 0.35 * size + 0.12);

  // The cavity pinching off: one big low bubble, the plunk. The bigger
  // the splash, the bigger the bubble and the lower it rings.
  const plunkAt = at + 0.045 + 0.04 * size + Math.random() * 0.015;
  ring(plunkAt, (170 + (1 - size) * 300) * jitter(0.15), 0.38 * size, 0.055, out, 1.5);

  // Smaller bubbles shaken loose, most of them early.
  const bubbles = 4 + Math.round(8 * size);
  for (let i = 0; i < bubbles; i++) {
    const t = at + 0.03 + Math.random() ** 1.6 * (0.25 + 0.2 * size);
    const freq = 650 + Math.random() ** 2 * 2400;
    bubble(t, freq, (0.05 + 0.07 * Math.random()) * size * Math.sqrt(900 / freq), out);
  }

  // Drops falling back onto the water.
  const drops = 2 + Math.round(4 * size);
  for (let i = 0; i < drops; i++) {
    const t = at + 0.18 + Math.random() * 0.45 * size;
    burst(t, { level: 0.03 * size, decay: 0.0015, type: "highpass", freq: 2500, q: 0.5, dest: out });
    bubble(t + 0.002, 1600 + Math.random() * 2600, 0.035 * size, out);
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

// The recording fades in and out at its ends, so those are cut, and the
// end is crossfaded into the start so it loops without a seam: a wave
// washing in and back out every seven seconds or so.
const SLOSH_URL = "/sounds/haishui.wav";
const SLOSH_TRIM = [0.75, 9.25];
const SLOSH_FADE = 1.5;
const SLOSH_GAIN = 1.3;
const SLOSH_LOUD = 0.9;

function startSlosh() {
  const level = ctx.createGain();
  level.gain.value = 0;
  const dull = ctx.createBiquadFilter();
  dull.type = "lowpass";
  dull.connect(level).connect(master);
  slosh = { level, dull };
  setSlosh(sloshGap, sloshHeld);
  loadSound(SLOSH_URL)
    .then((buffer) => {
      const src = ctx.createBufferSource();
      src.buffer = seamless(buffer);
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = SLOSH_GAIN;
      src.connect(gain).connect(dull);
      src.start();
    })
    // No recording, say offline before the first visit finished caching:
    // the water makes do with filtered noise.
    .catch(() => synthSlosh(dull));
}

function seamless(buffer) {
  const rate = buffer.sampleRate;
  const from = Math.round(SLOSH_TRIM[0] * rate);
  const to = Math.min(buffer.length, Math.round(SLOSH_TRIM[1] * rate));
  const fade = Math.round(SLOSH_FADE * rate);
  const length = to - from - fade;
  const out = ctx.createBuffer(buffer.numberOfChannels, length, rate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    dst.set(src.subarray(from, from + length));
    // The start fades in under the end fading out, at equal power, so the
    // last sample runs straight on into the first.
    for (let i = 0; i < fade; i++) {
      const k = (i / fade) * (Math.PI / 2);
      dst[i] = src[from + i] * Math.sin(k) + src[to - fade + i] * Math.cos(k);
    }
  }
  return out;
}

function synthSlosh(dest) {
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
  src.connect(low).connect(swell).connect(dest);
  src.start();
  lfo.start();
  lfo2.start();
}

// gap: how many layers the water is below the one being built. Held at
// silence, whatever the gap, while the game is paused or over.
export function setSlosh(gap, held = false) {
  sloshGap = gap;
  sloshHeld = held;
  if (!slosh) return;
  const { gain, cutoff } = far(gap);
  const at = ctx.currentTime;
  slosh.level.gain.setTargetAtTime(held ? 0 : SLOSH_LOUD * gain, at, 0.25);
  slosh.dull.frequency.setTargetAtTime(cutoff, at, 0.25);
}

// Silence the loop when the page is hidden, and bring it back after.
export function suspend(hidden) {
  if (!ctx) return;
  if (hidden) ctx.suspend().catch(() => {});
  else ctx.resume().catch(() => {});
}
