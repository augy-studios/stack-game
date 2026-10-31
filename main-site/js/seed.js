// Seeds, and the integer random numbers everything in a game draws from.
//
// Pure: no DOM and no clock. The API imports this file too, so a seed means
// the same game on the server as in a browser. Every number comes from
// Math.imul and shifts, never Math.random or floating point, so no two
// JavaScript engines can disagree about one.
//
// A seed looks like "BXK4-M9TR". It picks which way each growing slab grows,
// and the colours of the tower and the sky.

const ALPHABET = "BCDFGHJKLMNPQRSTVWXYZ23456789";
const LENGTH = 8;

// A fresh seed. crypto.getRandomValues exists in browsers and in Node 19+.
export function newSeed() {
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < LENGTH) {
    const [byte] = globalThis.crypto.getRandomValues(new Uint8Array(1));
    if (byte < limit) out += ALPHABET[byte % ALPHABET.length];
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

// The canonical form of a typed or linked seed, or null.
export function cleanSeed(value) {
  const raw = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== LENGTH || ![...raw].every((c) => ALPHABET.includes(c))) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

// FNV-1a over the seed's characters: one 32-bit number per seed.
export function seedNumber(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Two numbers in, one well mixed unsigned 32-bit number out (murmur3's
// finaliser over a golden ratio step).
export function mix(a, b) {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// 0 to n - 1, the same for the same seed, layer and purpose.
export function draw(seedNum, layer, salt, n) {
  return mix(mix(seedNum, layer), salt) % n;
}
