// Writes assets/Materials/*.mat and the .meta files Unity needs to wire the
// assets together on import: each material points at its shader and
// textures, each FBX swaps its embedded materials for the ones in
// Materials/, the UI icons come in as sprites, and the clouds and stars as
// textures that do not wrap.
//
//   node scripts/unity-export/unity-meta.mjs [assets-dir]
//
// GUIDs come from each file's path, so running this again gives the same
// ones and nothing in a Unity project that uses them breaks.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.resolve(process.argv[2] ?? path.join(ROOT, "assets"));

const guid = (rel) => crypto.createHash("md5").update(`uwustack:${rel}`).digest("hex");

function write(rel, text) {
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.replace(/\r?\n/g, "\n"));
}

const meta = (rel, body) => write(`${rel}.meta`, `fileFormatVersion: 2\nguid: ${guid(rel)}\n${body}`);

/* ---- colours, as Scripts/Palette.cs has them for the light theme ---- */

const hex = (n) => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
function hsl(h, s, l) {
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
    return p;
  };
  const p = l <= 0.5 ? l * (1 + s) : l + s - l * s;
  const q = 2 * l - p;
  return [hue(q, p, h + 1 / 3), hue(q, p, h), hue(q, p, h - 1 / 3)];
}
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const mix = (a, b, t) => a.map((x, i) => toSrgb(toLinear(x) + (toLinear(b[i]) - toLinear(x)) * t));

// A tower starting at hue 0, in the light theme.
const hh = (x) => (((0 + x) % 360) + 360) % 360 / 360;
const SKY_TOP = hsl(hh(55), 0.55, 0.72);
const SKY_HORIZON = mix(hsl(hh(20), 0.7, 0.86), hex(0xccffcc), 0.2);
const SKY_BOTTOM = hsl(hh(0), 0.55, 0.8);
const WATER_DEEP = hsl(0.55, 0.5, 0.55);
const WATER_SHALLOW = hsl(0.49, 0.5, 0.7);
const WATER_FOAM = mix([1, 1, 1], SKY_HORIZON, 0.12);
const DROP = mix(WATER_SHALLOW, WATER_FOAM, 0.75);
const CLOUD_LIT = mix([1, 1, 1], SKY_HORIZON, 0.08);
const CLOUD_SHADE = mix(SKY_TOP, [1, 1, 1], 0.3).map((x) => toSrgb(toLinear(x) * 0.9));
const CLOUD_TINT = mix([1, 1, 1], SKY_HORIZON, 0.1);

/* ---- shaders ---- */

const SHADERS = ["Lambert", "Foliage", "UnlitTransparent", "Water", "Sky", "Rain", "Lightning"];
for (const name of SHADERS) {
  meta(`Shaders/${name}.shader`, `ShaderImporter:
  externalObjects: {}
  defaultTextures: []
  nonModifiableTextures: []
  userData:
  assetBundleName:
  assetBundleVariant:
`);
}
const shader = (name) => `{fileID: 4800000, guid: ${guid(`Shaders/${name}.shader`)}, type: 3}`;

/* ---- textures ---- */

function textureMeta(rel, { sprite = false, wrap = 1, mipmaps = 1 } = {}) {
  meta(rel, `TextureImporter:
  internalIDToNameTable: []
  externalObjects: {}
  serializedVersion: 13
  mipmaps:
    mipMapMode: 0
    enableMipMap: ${sprite ? 0 : mipmaps}
    sRGBTexture: 1
  textureSettings:
    serializedVersion: 2
    filterMode: 1
    aniso: 1
    mipBias: 0
    wrapU: ${wrap}
    wrapV: ${wrap}
    wrapW: ${wrap}
  alphaUsage: 1
  alphaIsTransparency: 1
  textureType: ${sprite ? 8 : 0}
  textureShape: 1
  spriteMode: ${sprite ? 1 : 0}
  spritePixelsToUnits: 100
  spriteMeshType: 1
  alignment: 0
  spritePivot: {x: 0.5, y: 0.5}
  userData:
  assetBundleName:
  assetBundleVariant:
`);
}
textureMeta("Textures/Cloud.png");
for (const dir of ["Icons/UI", "Icons/App"]) {
  for (const f of fs.readdirSync(path.join(out, dir)).filter((f) => f.endsWith(".png"))) textureMeta(`${dir}/${f}`, { sprite: true });
}
const texture = (rel) => `{fileID: 2800000, guid: ${guid(rel)}, type: 3}`;

/* ---- materials ---- */

const colour = ([r, g, b], a = 1) => `{r: ${r.toFixed(6)}, g: ${g.toFixed(6)}, b: ${b.toFixed(6)}, a: ${a}}`;

function material(name, shaderName, { colours = {}, floats = {}, textures = {}, keywords = [], queue = -1 } = {}) {
  const rel = `Materials/${name}.mat`;
  const texEnvs = Object.entries(textures)
    .map(([k, t]) => `    - ${k}:\n        m_Texture: ${t}\n        m_Scale: {x: 1, y: 1}\n        m_Offset: {x: 0, y: 0}`)
    .join("\n");
  const list = (o, f) => Object.entries(o).map(([k, v]) => `    - ${k}: ${f(v)}`).join("\n");
  write(rel, `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!21 &2100000
Material:
  serializedVersion: 8
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_Name: ${name}
  m_Shader: ${shader(shaderName)}
  m_Parent: {fileID: 0}
  m_ModifiedSerializedProperties: 0
  m_ValidKeywords:${keywords.length ? "\n" + keywords.map((k) => `  - ${k}`).join("\n") : " []"}
  m_InvalidKeywords: []
  m_LightmapFlags: 4
  m_EnableInstancingVariants: 0
  m_DoubleSidedGI: 0
  m_CustomRenderQueue: ${queue}
  stringTagMap: {}
  disabledShaderPasses: []
  m_LockedProperties:
  m_SavedProperties:
    serializedVersion: 3
    m_TexEnvs:${texEnvs ? "\n" + texEnvs : " []"}
    m_Ints: []
    m_Floats:${Object.keys(floats).length ? "\n" + list(floats, (v) => v) : " []"}
    m_Colors:${Object.keys(colours).length ? "\n" + list(colours, (v) => v) : " []"}
  m_BuildTextureStacks: []
  m_AllowLocking: 1
`);
  meta(rel, `NativeFormatImporter:
  externalObjects: {}
  mainObjectFileID: 2100000
  userData:
  assetBundleName:
  assetBundleVariant:
`);
}

material("Block", "Lambert", { colours: { _BaseColor: colour([1, 1, 1]) } });
material("Sand", "Lambert", { colours: { _BaseColor: colour(hex(0xe9d7a8)) } });
material("Grass", "Lambert", { colours: { _BaseColor: colour(hex(0x9fcf8f)) } });
material("Rock", "Lambert", { colours: { _BaseColor: colour(hex(0xb9b4ad)) } });
material("Foliage", "Foliage", { colours: { _BaseColor: colour([1, 1, 1]) }, floats: { _BakedSway: 0, _SwaySpeed: 1 } });
material("FoliageIsland", "Foliage", {
  colours: { _BaseColor: colour([1, 1, 1]) },
  floats: { _BakedSway: 1, _SwaySpeed: 1 },
  keywords: ["_BAKED_SWAY"],
});
material("Water", "Water", {
  colours: {
    _DeepColor: colour(WATER_DEEP),
    _ShallowColor: colour(WATER_SHALLOW),
    _HorizonColor: colour(SKY_HORIZON),
    _TopColor: colour(SKY_TOP),
    _FoamColor: colour(WATER_FOAM),
    _SunDir: "{r: 1, g: 0.36, b: -1, a: 0}",
    _Column: "{r: 0, g: 0, b: -1, a: -1}",
  },
  floats: { _Glint: 1, _Near: 14, _Far: 70, _Level: -1.6, _Shore: -1, _LowQuality: 0 },
});
material("Sky", "Sky", {
  colours: { _TopColor: colour(SKY_TOP), _HorizonColor: colour(SKY_HORIZON), _BottomColor: colour(SKY_BOTTOM), _CloudLit: colour(CLOUD_LIT), _CloudShade: colour(CLOUD_SHADE) },
  floats: { _Glow: 0.35, _StarsOpacity: 0.6, _Meteors: 0, _Cumulus: 0.85, _Cirrus: 0.55, _Pan: 0, _Overcast: 0, _Flash: 0, _FlashX: 0.5, _LowQuality: 0 },
});
// The weather (Scripts/Rain.cs sets the rest each frame).
material("RainDrops", "Rain", { colours: { _Colour: colour([0.62, 0.68, 0.76]) }, floats: { _Opacity: 0.75, _Splash: 0 } });
material("RainSplashes", "Rain", { colours: { _Colour: colour([0.93, 0.96, 1]) }, floats: { _Opacity: 0.6, _Splash: 1 }, keywords: ["_SPLASH"] });
material("Lightning", "Lightning", { colours: { _Core: colour([1, 1, 1]), _Glow: colour([0.55, 0.65, 1]) }, floats: { _Bright: 0 } });
const unlit = (name, { colour: c = [1, 1, 1], alpha = 1, cull = 0, zwrite = 0, vertexColours = false, map = null }) =>
  material(name, "UnlitTransparent", {
    colours: { _BaseColor: colour(c, alpha) },
    floats: { _VertexColors: vertexColours ? 1 : 0, _Cull: cull, _ZWrite: zwrite },
    textures: map ? { _BaseMap: texture(map) } : {},
    keywords: vertexColours ? ["_VERTEX_COLORS"] : [],
  });
unlit("SplashCrown", { colour: WATER_FOAM, alpha: 0.8, vertexColours: true });
unlit("SplashDrop", { colour: DROP, alpha: 0.9, cull: 2, zwrite: 1 });
unlit("PerfectRingFrame", { alpha: 0.95 });
unlit("PerfectRingPlate", { alpha: 0.32 });
unlit("Cloud", { colour: CLOUD_TINT, alpha: 0.85, map: "Textures/Cloud.png" });

/* ---- meshes: their embedded materials swapped for Materials/ ---- */

const mat = (name) => `{fileID: 2100000, guid: ${guid(`Materials/${name}.mat`)}, type: 2}`;
// The material names meshes.mjs gives each mesh.
const MESH_MATERIALS = {
  "Block.fbx": ["Block"],
  "IslandSand.fbx": ["Sand"],
  "IslandGrass.fbx": ["Grass"],
  "Rock.fbx": ["Rock"],
  "GrassTuft.fbx": ["Foliage"],
  "FlowerPink.fbx": ["Foliage"],
  "FlowerWhite.fbx": ["Foliage"],
  "FlowerLilac.fbx": ["Foliage"],
  "FlowerYellow.fbx": ["Foliage"],
  "FlowerPeach.fbx": ["Foliage"],
  "Island.fbx": ["Block", "Sand", "Grass", "Rock", "FoliageIsland"],
  "SplashCrown.fbx": ["SplashCrown"],
  "SplashDrop.fbx": ["SplashDrop"],
  "PerfectRingFrame.fbx": ["PerfectRingFrame"],
  "PerfectRingPlate.fbx": ["PerfectRingPlate"],
  "WaterLow.fbx": ["Water"],
  "WaterHigh.fbx": ["Water"],
};
for (const [file, names] of Object.entries(MESH_MATERIALS)) {
  if (!fs.existsSync(path.join(out, "Meshes", file))) throw new Error(`Meshes/${file} is missing`);
  const remaps = names
    .map((n) => `  - first:
      type: UnityEngine:Material
      assembly: UnityEngine.CoreModule
      name: ${n}
    second: ${mat(n)}`)
    .join("\n");
  meta(`Meshes/${file}`, `ModelImporter:
  serializedVersion: 22200
  internalIDToNameTable: []
  externalObjects:
${remaps}
  materials:
    materialImportMode: 2
    materialName: 0
    materialSearch: 1
    materialLocation: 1
  animations:
    importAnimation: 0
  meshes:
    globalScale: 1
    useFileScale: 1
    importBlendShapes: 0
    importVisibility: 0
    importCameras: 0
    importLights: 0
    addColliders: 0
    indexFormat: 0
  tangentSpace:
    normalImportMode: 0
  importAnimation: 0
  userData:
  assetBundleName:
  assetBundleVariant:
`);
}

console.log(`wrote ${SHADERS.length} shader metas, materials and their metas, texture and mesh metas into ${out}`);
