// Rebuilds everything in assets/ from the game, for a Unity project:
//
//   node scripts/unity-export/export.mjs
//
// 1. meshes.mjs builds the scene's meshes as glTF, and Blender turns them
//    into FBX (set BLENDER to blender.exe if it is not in the usual place)
// 2. browser-assets.mjs draws the textures and icons, renders the
//    synthesised sounds, and builds the water's and the rain's loops and
//    the thunder takes, in a headless Chromium (set CHROME if needed)
// 3. ffmpeg copies the recordings and trims each to where the game
//    starts playing it
// 4. unity-meta.mjs writes the materials and the .meta files that wire it
//    all together
//
// The shaders, scripts and README in assets/ are written by hand, not
// generated: change them there.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const ASSETS = path.join(ROOT, "assets");
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

function findBlender() {
  if (process.env.BLENDER) return process.env.BLENDER;
  const base = "C:/Program Files/Blender Foundation";
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).sort().reverse() : [];
  for (const d of dirs) {
    const exe = path.join(base, d, "blender.exe");
    if (fs.existsSync(exe)) return exe;
  }
  return "blender";
}

// 1. Meshes.
const glb = fs.mkdtempSync(path.join(os.tmpdir(), "uwustack-glb-"));
run(process.execPath, [path.join(HERE, "meshes.mjs"), glb]);
run(findBlender(), ["--background", "--factory-startup", "--python", path.join(HERE, "blender-fbx.py"), "--", glb, path.join(ASSETS, "Meshes")]);
fs.rmSync(glb, { recursive: true, force: true });

// 2. Textures, icons and the synthesised sounds.
run(process.execPath, [path.join(HERE, "browser-assets.mjs"), ASSETS]);

// 3. The recordings: the originals untouched, and each trimmed to the point
// js/audio.js starts it from, so a plain PlayOneShot() lands on the moment.
// Levels and pitch stay in Scripts/GameAudio.cs: baking the splash's
// level in would clip.
const sounds = path.join(ROOT, "main-site/sounds");
const originals = path.join(ASSETS, "Audio/Originals");
fs.mkdirSync(originals, { recursive: true });
for (const f of fs.readdirSync(sounds).filter((f) => /\.(wav|mp3)$/.test(f))) fs.copyFileSync(path.join(sounds, f), path.join(originals, f));
for (const [from, start, to] of [
  ["SoccerKick.wav", 0.04, "Hit.wav"],
  ["waterSplash.wav", 0.26, "Splash.wav"],
  ["PlateSliding.wav", 0.08, "Grow.wav"],
]) {
  run("ffmpeg", ["-v", "error", "-y", "-i", path.join(originals, from), "-af", `atrim=start=${start},asetpts=PTS-STARTPTS`, "-c:a", "pcm_s16le", path.join(ASSETS, "Audio", to)]);
}

// The app's icons.
fs.mkdirSync(path.join(ASSETS, "Icons/App"), { recursive: true });
for (const f of ["RST-192.png", "RST-512.png", "RST-main.png"]) fs.copyFileSync(path.join(ROOT, "main-site", f), path.join(ASSETS, "Icons/App", f));

// 4. Materials and .meta files.
run(process.execPath, [path.join(HERE, "unity-meta.mjs"), ASSETS]);
