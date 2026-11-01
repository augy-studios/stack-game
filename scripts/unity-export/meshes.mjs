// Builds the game's meshes the way js/scene.js does, and writes each as a
// glTF binary (.glb) into the folder given, for blender-fbx.py to turn into
// FBX for Unity.
//
//   node scripts/unity-export/meshes.mjs <out-dir>
//
// js/scene.js keeps these inside createScene() and needs a browser, so the
// geometry is repeated here: tuftGeometry, flowerGeometry, crownGeometry,
// frameGeometry, the island and the scatter of foliage on it. If the scene
// changes, change this to match.
//
// Units are the scene's: the tower's base is one unit across, the top of
// the base column is y = 0, and +y is up. three.js is right handed; the FBX
// step converts to Unity's left handed axes.

import fs from "node:fs";
import path from "node:path";
import * as THREE from "../../main-site/vendor/three/build/three.module.js";

const out = process.argv[2];
if (!out) throw new Error("usage: node meshes.mjs <out-dir>");
fs.mkdirSync(out, { recursive: true });

/* ---- the scene's numbers, from js/rules.js and js/scene.js ---- */

const S = 1 / 1000;
const ISLAND_TOP = -1000;
const ISLAND_Y = ISLAND_TOP * S;
const SAND_TOP_R = 2.3;
const SAND_BOTTOM_R = 3.2;
const SAND_HEIGHT = 3;
const SAND_TOP_Y = ISLAND_Y - 0.06;
const GRASS_R = 2.05;
const GRASS_TOP_Y = ISLAND_Y + 0.05;

const FLOWERS = [
  ["Pink", "#f6a9c8", "#ffcf4a"],
  ["White", "#fbf6ee", "#ffcf4a"],
  ["Lilac", "#c7b2f0", "#ffd75e"],
  ["Yellow", "#ffe08a", "#f0a040"],
  ["Peach", "#ffb79a", "#ffe08a"],
];

const ROCKS = [[1.9, 0.6, 0.22], [-1.4, 1.5, 0.3], [0.4, -2.0, 0.18], [-2.0, -0.9, 0.26], [1.3, -1.5, 0.2]];

/* ---- geometry, as in js/scene.js ---- */

function frameGeometry(inner) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.5);
  shape.lineTo(0.5, -0.5);
  shape.lineTo(0.5, 0.5);
  shape.lineTo(-0.5, 0.5);
  shape.closePath();
  const hole = new THREE.Path();
  const h = inner / 2;
  hole.moveTo(-h, -h);
  hole.lineTo(-h, h);
  hole.lineTo(h, h);
  hole.lineTo(h, -h);
  hole.closePath();
  shape.holes.push(hole);
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function joinParts(parts) {
  const position = [];
  const colour = [];
  const c = new THREE.Color();
  for (const { geo, base, tip = base, y0 = 0, y1 = 1 } of parts) {
    const p = (geo.index ? geo.toNonIndexed() : geo).attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      position.push(p.getX(i), y, p.getZ(i));
      c.copy(base).lerp(tip, THREE.MathUtils.clamp((y - y0) / (y1 - y0), 0, 1));
      colour.push(c.r, c.g, c.b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colour, 3));
  geo.computeVertexNormals();
  return geo;
}

const place = (geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 }) =>
  geo.scale(sx, sy, sz).rotateX(rx).rotateZ(rz).rotateY(ry).translate(x, y, z);

function tuftGeometry(rand) {
  const base = new THREE.Color("#5f9a52");
  const tip = new THREE.Color("#cdeaa2");
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const h = 0.09 + rand() * 0.07;
    const geo = new THREE.ConeGeometry(0.011, h, 3, 1).translate(0, h / 2, 0);
    const a = (i / 5) * Math.PI * 2 + rand();
    place(geo, { x: Math.cos(a) * 0.012, z: Math.sin(a) * 0.012, rx: (rand() - 0.5) * 0.7, rz: (rand() - 0.5) * 0.7, ry: rand() * Math.PI });
    parts.push({ geo, base, tip, y0: 0, y1: 0.16 });
  }
  return joinParts(parts);
}

function flowerGeometry(petal, middle) {
  const stemBase = new THREE.Color("#5a9150");
  const stemTip = new THREE.Color("#8cc277");
  const h = 0.13;
  const parts = [
    { geo: new THREE.CylinderGeometry(0.005, 0.007, h, 4).translate(0, h / 2, 0), base: stemBase, tip: stemTip, y1: h },
    { geo: place(new THREE.IcosahedronGeometry(0.018, 0), { x: 0.016, y: 0.045, sx: 1.6, sy: 0.3, sz: 0.8, rz: 0.5 }), base: stemTip },
  ];
  const colour = new THREE.Color(petal);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const geo = place(new THREE.IcosahedronGeometry(0.02, 0), { x: 0.022, sx: 1.3, sy: 0.35, sz: 0.8, rz: 0.15 });
    parts.push({ geo: geo.rotateY(a).translate(0, h, 0), base: colour });
  }
  parts.push({ geo: place(new THREE.IcosahedronGeometry(0.014, 0), { y: h + 0.006, sy: 0.6 }), base: new THREE.Color(middle) });
  return joinParts(parts);
}

function crownGeometry() {
  const geo = new THREE.CylinderGeometry(1, 0.75, 1, 36, 1, true).translate(0, 0.5, 0);
  const p = geo.attributes.position;
  const colour = [];
  for (let i = 0; i < p.count; i++) {
    const rim = p.getY(i) > 0.5;
    if (rim) {
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const spike = Math.abs(Math.sin(a * 7)) ** 3 * (0.7 + 0.3 * Math.sin(a * 3 + 1));
      const h = 0.45 + 0.55 * spike;
      p.setXYZ(i, p.getX(i) * (1 + 0.3 * h), h, p.getZ(i) * (1 + 0.3 * h));
    }
    colour.push(1, 1, 1, rim ? 0.95 : 0.08);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colour, 4));
  return geo;
}

// The scene draws these with flatShading, which takes each face's own
// normal; a mesh file needs that split out into the vertices.
function flat(geo) {
  const out = geo.index ? geo.toNonIndexed() : geo;
  out.deleteAttribute("normal");
  out.computeVertexNormals();
  return out;
}

/* ---- the island's foliage, scattered as createScene() scatters it ---- */

// Every tuft and flower merged into one mesh, in the island's space. The
// scene sways each instance in its own space, so the merged mesh keeps
// what the sway needs per vertex: uv0 is the instance's root (x, z) and
// uv1 is how far that vertex moves in x and z at full sway, which is the
// scene's (0.12, 0.072) times the vertex's height, turned and scaled by the
// instance. See Shaders/Foliage.shader.
function islandFoliage() {
  let seed = 20261101;
  const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const spot = () => {
    for (;;) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(0.62 ** 2 + rand() * (1.55 ** 2 - 0.62 ** 2));
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.max(Math.abs(x), Math.abs(z)) > 0.62) return [x, z];
    }
  };
  const o = new THREE.Object3D();
  // The order rand() is called in matters: the size is an argument, so it
  // is drawn before the spot and the turn, as in the scene.
  const set = (size) => {
    const [x, z] = spot();
    o.position.set(x, GRASS_TOP_Y, z);
    o.rotation.set((rand() - 0.5) * 0.2, rand() * Math.PI * 2, (rand() - 0.5) * 0.2);
    o.scale.setScalar(size);
    o.updateMatrix();
    return o.matrix.clone();
  };

  const placed = [];
  const tuft = tuftGeometry(rand);
  for (let i = 0; i < 110; i++) {
    const matrix = set(0.75 + rand() * 0.6);
    const shade = 0.85 + rand() * 0.15;
    placed.push({ geo: tuft, matrix, shade });
  }
  for (const [, petal, middle] of FLOWERS) {
    const flower = flowerGeometry(petal, middle);
    for (let i = 0; i < 7; i++) placed.push({ geo: flower, matrix: set(1 + rand() * 0.5), shade: 1 });
  }

  const position = [];
  const normal = [];
  const colour = [];
  const root = [];
  const sway = [];
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  for (const { geo, matrix, shade } of placed) {
    normalMatrix.getNormalMatrix(matrix);
    const p = geo.attributes.position;
    const nn = geo.attributes.normal;
    const c = geo.attributes.color;
    const rx = matrix.elements[12];
    const rz = matrix.elements[14];
    const scale = new THREE.Vector3().setFromMatrixScale(matrix).x;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const h = Math.max(v.y, 0);
      v.applyMatrix4(matrix);
      position.push(v.x, v.y, v.z);
      n.fromBufferAttribute(nn, i).applyMatrix3(normalMatrix).normalize();
      normal.push(n.x, n.y, n.z);
      colour.push(c.getX(i) * shade, c.getY(i) * shade, c.getZ(i) * shade);
      // Stored as Unity will want them: on the way there Blender flips v
      // (v' = 1 - v) and Unity mirrors x, so both are flipped here first
      // and arrive as Unity's own world (x, z).
      root.push(-rx, 1 - rz);
      // transformDirection normalises, so the length goes back on after,
      // times the instance's scale.
      dir.set(0.12 * h, 0, 0.072 * h);
      const len = dir.length() * scale;
      if (len > 0) dir.transformDirection(matrix).multiplyScalar(len);
      sway.push(-dir.x, 1 - dir.z);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normal, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colour, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(root, 2));
  geo.setAttribute("uv1", new THREE.Float32BufferAttribute(sway, 2));
  return geo;
}

/* ---- a minimal glTF binary writer ---- */

// nodes: [{ name, geo, material, position?, rotation? (Euler xyz), children? }]
function writeGlb(file, nodes) {
  const json = {
    asset: { version: "2.0", generator: "stack-game scripts/unity-export/meshes.mjs" },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
  };
  const chunks = [];
  let byteLength = 0;
  const materialIndex = new Map();

  function addView(typed, target) {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      byteLength += pad;
    }
    json.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes);
    byteLength += bytes.length;
    return json.bufferViews.length - 1;
  }

  function addAccessor(attr, withBounds) {
    const size = attr.itemSize;
    const array = new Float32Array(attr.count * size);
    for (let i = 0; i < attr.count; i++) for (let k = 0; k < size; k++) array[i * size + k] = attr.array[i * size + k];
    const acc = {
      bufferView: addView(array, 34962),
      componentType: 5126,
      count: attr.count,
      type: ["", "SCALAR", "VEC2", "VEC3", "VEC4"][size],
    };
    if (withBounds) {
      acc.min = Array(size).fill(Infinity);
      acc.max = Array(size).fill(-Infinity);
      for (let i = 0; i < attr.count; i++) {
        for (let k = 0; k < size; k++) {
          acc.min[k] = Math.min(acc.min[k], array[i * size + k]);
          acc.max[k] = Math.max(acc.max[k], array[i * size + k]);
        }
      }
    }
    json.accessors.push(acc);
    return json.accessors.length - 1;
  }

  function material(name) {
    if (!materialIndex.has(name)) {
      json.materials.push({ name, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } });
      materialIndex.set(name, json.materials.length - 1);
    }
    return materialIndex.get(name);
  }

  function addNode(node) {
    const out = { name: node.name };
    if (node.geo) {
      const geo = node.geo;
      const attributes = { POSITION: addAccessor(geo.attributes.position, true) };
      if (geo.attributes.normal) attributes.NORMAL = addAccessor(geo.attributes.normal);
      if (geo.attributes.uv) attributes.TEXCOORD_0 = addAccessor(geo.attributes.uv);
      if (geo.attributes.uv1) attributes.TEXCOORD_1 = addAccessor(geo.attributes.uv1);
      if (geo.attributes.color) attributes.COLOR_0 = addAccessor(geo.attributes.color);
      const primitive = { attributes, mode: 4, material: material(node.material) };
      const count = geo.attributes.position.count;
      const index = geo.index ? Uint32Array.from(geo.index.array) : Uint32Array.from({ length: count }, (_, i) => i);
      json.accessors.push({ bufferView: addView(index, 34963), componentType: 5125, count: index.length, type: "SCALAR" });
      primitive.indices = json.accessors.length - 1;
      json.meshes.push({ name: node.name, primitives: [primitive] });
      out.mesh = json.meshes.length - 1;
    }
    if (node.position) out.translation = node.position;
    if (node.rotation) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...node.rotation, "XYZ"));
      out.rotation = [q.x, q.y, q.z, q.w];
    }
    json.nodes.push(out);
    const index = json.nodes.length - 1;
    if (node.children) out.children = node.children.map(addNode);
    return index;
  }

  json.scenes[0].nodes = nodes.map(addNode);
  json.buffers.push({ byteLength });

  let jsonBytes = Buffer.from(JSON.stringify(json));
  jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
  let bin = Buffer.concat(chunks);
  bin = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + bin.length, 8);
  const chunk = (type, data) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  fs.writeFileSync(path.join(out, file), Buffer.concat([header, chunk(0x4e4f534a, jsonBytes), chunk(0x004e4942, bin)]));
  console.log(`${file}: ${json.meshes.length} meshes, ${json.accessors.filter((a) => a.min).reduce((s, a) => s + a.count, 0)} vertices`);
}

/* ---- the files ---- */

const box = () => new THREE.BoxGeometry(1, 1, 1);
const sand = () => flat(new THREE.CylinderGeometry(SAND_TOP_R, SAND_BOTTOM_R, SAND_HEIGHT, 10, 1));
const grass = () => flat(new THREE.CylinderGeometry(1.75, GRASS_R, 0.14, 10, 1));
const water = (segments) => new THREE.PlaneGeometry(260, 260, segments, segments).rotateX(-Math.PI / 2);

// One unit cube: a tower layer, the swinging slab, a cut-off piece and the
// base column are all this, scaled. A layer is 0.2 tall.
writeGlb("Block.glb", [{ name: "Block", geo: box(), material: "Block" }]);

// The island's parts on their own, centred on their own origins.
writeGlb("IslandSand.glb", [{ name: "IslandSand", geo: sand(), material: "Sand" }]);
writeGlb("IslandGrass.glb", [{ name: "IslandGrass", geo: grass(), material: "Grass" }]);
writeGlb("Rock.glb", [{ name: "Rock", geo: flat(new THREE.DodecahedronGeometry(1, 0)), material: "Rock" }]);

// The foliage, one plant each, with their root at the origin.
{
  let seed = 20261101;
  const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  writeGlb("GrassTuft.glb", [{ name: "GrassTuft", geo: tuftGeometry(rand), material: "Foliage" }]);
}
for (const [name, petal, middle] of FLOWERS) {
  writeGlb(`Flower${name}.glb`, [{ name: `Flower${name}`, geo: flowerGeometry(petal, middle), material: "Foliage" }]);
}

// The whole island as the game lays it out, in world space: base column,
// sand, grass, rocks and every tuft and flower.
writeGlb("Island.glb", [
  {
    name: "Island",
    children: [
      // The base: one unit cube from the island's top, y = -1, to y = 0.
      { name: "BaseColumn", geo: box(), material: "Block", position: [0, ISLAND_Y / 2, 0] },
      { name: "Sand", geo: sand(), material: "Sand", position: [0, SAND_TOP_Y - SAND_HEIGHT / 2, 0] },
      { name: "Grass", geo: grass(), material: "Grass", position: [0, GRASS_TOP_Y - 0.07, 0] },
      ...ROCKS.map(([x, z, r], i) => ({
        name: `Rock${i + 1}`,
        geo: flat(new THREE.DodecahedronGeometry(r, 0)),
        material: "Rock",
        position: [x, ISLAND_Y - 0.05, z],
        rotation: [x, z, r * 10],
      })),
      { name: "Foliage", geo: islandFoliage(), material: "FoliageIsland" },
    ],
  },
]);

// Effects.
writeGlb("SplashCrown.glb", [{ name: "SplashCrown", geo: crownGeometry(), material: "SplashCrown" }]);
writeGlb("SplashDrop.glb", [{ name: "SplashDrop", geo: flat(new THREE.IcosahedronGeometry(1, 0)), material: "SplashDrop" }]);
writeGlb("PerfectRingFrame.glb", [{ name: "PerfectRingFrame", geo: frameGeometry(0.9), material: "PerfectRingFrame" }]);
writeGlb("PerfectRingPlate.glb", [{ name: "PerfectRingPlate", geo: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material: "PerfectRingPlate" }]);

// The sea: 260 units square, at low quality's 96 segments and high's 256.
writeGlb("WaterLow.glb", [{ name: "WaterLow", geo: water(96), material: "Water" }]);
writeGlb("WaterHigh.glb", [{ name: "WaterHigh", geo: water(256), material: "Water" }]);
