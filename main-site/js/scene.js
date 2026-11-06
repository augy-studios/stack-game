// The 3D world: sky, water, the island, the tower, the swinging slab, the
// pieces falling off it, and the ring a perfect drop leaves.
//
// It draws whatever it is handed and keeps no game state of its own, so the
// live game and the replay drive it the same way, through draw(). Units in
// are the game's (js/rules.js); the world is a thousandth of that, so the
// full-size base (Medium's) is one world unit across.
//
// The sky is the one place in the app with a gradient. It is the game's
// scenery, inside the canvas, and shifts colour as the tower climbs.

import * as THREE from "three";
import { LAYER, ISLAND_TOP, MAX_START } from "./rules.js";
import { fallAt } from "./fall.js";
import { drawCloud, CLOUD_VARIANTS } from "./clouds.js";
import { createPost } from "./post.js";
import { createRain, flashOf } from "./rain.js";

const S = 1 / 1000;
const FOV = 40;
const DIR = new THREE.Vector3(1, 0.62, 1).normalize();
const RING_MS = 650;

// The island: a ten-sided cone of sand under a disc of grass. The water
// works out its depth and its shoreline from the same numbers.
const ISLAND_Y = ISLAND_TOP * S;
const SAND_TOP_R = 2.3;
const SAND_BOTTOM_R = 3.2;
const SAND_HEIGHT = 3;
const SAND_TOP_Y = ISLAND_Y - 0.06;
const GRASS_R = 2.05;
const GRASS_TOP_Y = ISLAND_Y + 0.05;

// Where pieces went into the water, for the rings that spread from there.
const RIPPLES = 4;
const RIPPLE_MS = 2500;

// The splash itself, on high quality: drops thrown up per piece, and how
// long the crown of water stands and the drops fly, in seconds.
const DROPS = 16;
const CROWN_S = 0.6;
const SPLASH_S = 1.1;

// A repeatable number in [0, 1) from two integers, so a replay throws the
// same drops.
function hash(a, b) {
  let x = Math.imul(a ^ Math.imul(b + 1, 0x9e3779b1), 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return x / 4294967296;
}

// The sun the water glints with: low behind the tower, where the sky's
// glow is, so its path runs across the water towards the camera. Each game
// turns it round and raises or lowers it a little, by its seed, and it
// wanders slowly while the game goes on, by the game's own clock, so a
// replay sees the same sky. The key light that lights the tower and casts
// its shadows turns round with it.
const GLINT_BASE = new THREE.Vector3(-1, 0, -1).normalize();
const SUN_FROM_BASE = new THREE.Vector3(-2.2, 5, 3.4).normalize();
const SUN_TURN = 0.3;       // radians either side of straight behind, by seed
const SUN_WANDER = 0.12;    // radians more either side, over SUN_PERIOD
const SUN_PERIOD = 300;     // seconds
const UP = new THREE.Vector3(0, 1, 0);

// The camera's usual direction from the tower, as an angle up from level
// and an angle round, which the replay's free camera turns from.
const BASE_RISE = Math.asin(DIR.y);
const BASE_ROUND = Math.atan2(DIR.x, DIR.z);
const NO_ORBIT = Object.freeze({ yaw: 0, pitch: 0, zoom: 1, lift: 0 });
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const sunHeading = new THREE.Vector3();
const sunSide = new THREE.Vector3();

// A layer's colour: the seed picks where on the wheel the tower starts, and
// every layer turns it a little, so the tower fades through the colours as
// it climbs. Pastel, like everything else in the app.
export function hueOf(seedNum, n) {
  return (((seedNum % 360) - n * 6) % 360 + 360) % 360;
}

function layerColour(seedNum, n, out = new THREE.Color()) {
  return out.setHSL(hueOf(seedNum, n) / 360, 0.52, 0.64);
}

// The sun, in the same flat sky, but drawn after the water, whose far haze
// would otherwise hide it, and behind anything solid: a square of the
// screen round it, at the far end of the depth, added on. Brighter than
// white, so it blooms and lights the god rays, with a soft halo.
const SUN_VERTEX = `
  uniform vec2 uSun;
  uniform float uAspect;
  varying vec2 vAt;
  void main() {
    vAt = position.xy * 0.25;
    vec2 centre = uSun * 2.0 - 1.0;
    gl_Position = vec4(centre + position.xy * 0.5 * vec2(1.0 / uAspect, 1.0), 0.99999, 1.0);
  }
`;
const SUN_FRAGMENT = `
  uniform float uSunDisc;
  varying vec2 vAt;
  void main() {
    float r = length(vAt);
    float disc = 1.0 - smoothstep(0.018, 0.023, r);
    float halo = exp(-r * r * 1500.0) * 0.25 + exp(-r * 30.0) * 0.05;
    halo *= 1.0 - smoothstep(0.15, 0.25, r);
    gl_FragColor = vec4(vec3(1.0, 0.95, 0.84) * (disc * 1.5 + halo) * uSunDisc, 1.0);
  }
`;

/* ---- textures and geometry made here, so nothing has to be fetched ---- */

// A cloud sprite's texture, drawn by js/clouds.js.
function cloudTexture(variant) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  drawCloud(c.getContext("2d"), variant, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

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

// Joins parts into one geometry with a colour per vertex, each part shaded
// from its base colour at y0 to its tip colour at y1, so a whole plant is
// one piece to draw.
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
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(colour, 3));
  out.computeVertexNormals();
  return out;
}

const place = (geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 }) =>
  geo.scale(sx, sy, sz).rotateX(rx).rotateZ(rz).rotateY(ry).translate(x, y, z);

// A tuft: five thin blades leaning out from one root, dark at the base and
// light at the tips, as stylised grass is drawn.
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

// A flower: a stem with one leaf, five petals round a centre.
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

// Pastel, like the rest of the app, each with the centre that suits it.
const FLOWERS = [
  ["#f6a9c8", "#ffcf4a"],
  ["#fbf6ee", "#ffcf4a"],
  ["#c7b2f0", "#ffd75e"],
  ["#ffe08a", "#f0a040"],
  ["#ffb79a", "#ffe08a"],
];

// A crown splash: a wall of water open at both ends, flaring out to a
// ragged rim of spikes. White and solid at the rim, fading to clear at the
// waterline, through the alpha of its vertex colours.
function crownGeometry() {
  const geo = new THREE.CylinderGeometry(1, 0.75, 1, 36, 1, true).translate(0, 0.5, 0);
  const p = geo.attributes.position;
  const colour = [];
  for (let i = 0; i < p.count; i++) {
    const rim = p.getY(i) > 0.5;
    if (rim) {
      // Spikes from the angle alone, so the seam's two copies agree.
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

// The sky is drawn flat across the screen behind the world, top to bottom,
// so the whole gradient shows whichever way the camera looks, with a soft
// glow low in the middle where the light is.
//
// Over it, everything is worked out per pixel so nothing has to be fetched:
//   stars    one or none in each cell of a grid, twinkling
//   meteors  now and then a shooting star, at night
//   cirrus   thin, unshaded streaks of high cloud, like combed hair
//   cumulus  heaped clouds lower down, lit on top and shaded underneath
// The two cloud layers are laid on flat planes overhead, seen in
// perspective, so they bunch up and thin out towards the horizon and the
// wind carries them towards and across the camera. Turning the camera pans
// them, and the stars, round with it.
const SKY_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
const SKY_FRAGMENT = `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform float uGlow;
  uniform vec2 uSun;
  uniform float uSunDisc;
  uniform float uAspect;
  uniform float uTime;
  uniform float uPan;
  uniform float uPanPx;
  uniform float uPixel;
  uniform float uStars;
  uniform float uMeteors;
  uniform vec3 uCloudLit;
  uniform vec3 uCloudShade;
  uniform float uCumulus;
  uniform float uCirrus;
  uniform float uOvercast;
  uniform float uFlash;
  uniform float uFlashX;
  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < OCTAVES; i++) {
      v += a * noise(p);
      p = turn * p * 2.03 + 17.1;
      a *= 0.5;
    }
    return v;
  }

  // Two octaves, for the broad, slow fields that only steer the detail.
  float fbm2(vec2 p) {
    return 0.5 * noise(p) + 0.25 * noise(mat2(0.8, 0.6, -0.6, 0.8) * p * 2.03 + 17.1);
  }

  // How much cumulus there is at a point on its plane: big slow shapes for
  // where the clouds are, and finer billows that churn as they go.
  float cumulus(vec2 p) {
    float shape = fbm2(p * 0.55) * 1.33;
    float billow = fbm(p * 1.7 + vec2(uTime * 0.02, -uTime * 0.015));
    return shape * 0.75 + billow * 0.35;
  }

  // The distance from p to the segment a to b.
  float segment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }

  void main() {
    float y = vUv.y;
    vec3 c = y > 0.45
      ? mix(uHorizon, uTop, smoothstep(0.45, 1.0, y))
      : mix(uBottom, uHorizon, smoothstep(0.0, 0.45, y));
    // The glow low over the horizon, under the sun, which is drawn over
    // the far water (SUN_FRAGMENT).
    vec2 d = vec2((vUv.x - uSun.x) * uAspect, y - 0.52);
    float glow = exp(-dot(d, d) * 5.0);
    c = mix(c, vec3(1.0), uGlow * glow);

    // Stars: a grid of cells in screen pixels, a star in some of them,
    // fewer towards the horizon, each twinkling at its own pace.
    vec2 px = gl_FragCoord.xy / uPixel + vec2(uPanPx, 0.0);
    vec2 cell = floor(px / 26.0);
    float pick = hash(cell);
    float above = smoothstep(0.3, 1.0, y);
    if (pick < 0.32 * above) {
      vec2 at = (cell + 0.2 + 0.6 * vec2(hash(cell + 3.1), hash(cell + 7.7))) * 26.0;
      float size = 0.7 + 0.8 * hash(cell + 11.3);
      float twinkle = 0.55 + 0.45 * sin(uTime * (1.2 + 2.5 * hash(cell + 5.9)) + pick * 60.0);
      float star = 1.0 - smoothstep(size * 0.5, size + 0.6, length(px - at));
      c = mix(c, vec3(1.0), star * twinkle * uStars);
    }

    // Meteors: two slots, each now and then streaking a short way down
    // across the upper sky and fading as it goes.
    vec2 sp = vec2(vUv.x * uAspect, y);
    for (int i = 0; i < 2; i++) {
      float period = 7.0 + float(i) * 4.0;
      float k = floor(uTime / period + float(i) * 0.5);
      float age = uTime - (k - float(i) * 0.5) * period;
      float life = 0.9;
      if (age < life && hash(vec2(k, float(i))) < 0.7) {
        vec2 start = vec2((0.15 + 0.7 * hash(vec2(k, 2.0 + float(i)))) * uAspect, 0.72 + 0.25 * hash(vec2(k, 9.0)));
        vec2 dir = normalize(vec2(hash(vec2(k, 4.0)) < 0.5 ? -1.0 : 1.0, -0.55));
        float run = age / life;
        vec2 head = start + dir * run * 0.45;
        vec2 tail = head - dir * 0.12 * min(1.0, run * 4.0);
        float dist = segment(sp, tail, head);
        float along = clamp(dot(sp - tail, dir) / 0.12, 0.0, 1.0);
        float m = (1.0 - smoothstep(0.0, 0.0025, dist)) * along * (1.0 - run);
        c = mix(c, vec3(1.0), m * uMeteors);
      }
    }

    float h = y - 0.4;
    float cloudy = 0.0;
    if (h > 0.0) {
      // Cirrus, on a high plane: streaks drawn out along the wind, combed
      // by a slower noise, in patches that come and go.
      float far = 1.0 / (h + 0.25);
      vec2 q = vec2((vUv.x - 0.5 + uPan) * uAspect * far * 1.2, far * 2.0);
      q += vec2(uTime * 0.012, uTime * 0.02);
      vec2 comb = vec2(fbm2(q * 0.6), fbm2(q * 0.6 + 5.2)) * 1.33;
      float streak = fbm(vec2(q.x * 0.9, q.y * 5.0) + comb * 1.6);
      float patches = smoothstep(0.35, 0.65, fbm2(q * 0.35 - 3.0) * 1.33);
      float cirrus = smoothstep(0.5, 0.8, streak) * patches * smoothstep(0.02, 0.25, h);
      c = mix(c, uCloudLit, cirrus * uCirrus);

      // Cumulus, on a lower plane: the wind brings them in from the
      // distance. Shaded where there is more cloud just above (their
      // undersides) and lit where there is less (their tops).
      float near = 1.0 / (h + 0.08);
      vec2 p = vec2((vUv.x - 0.5 + uPan) * uAspect * near * 0.9, near * 1.4);
      p += vec2(uTime * 0.03, uTime * 0.05);
      // Rain thickens the cloud.
      float dens = cumulus(p) + uOvercast * 0.24;
      float body = smoothstep(0.5, 0.6, dens);
      cloudy = body * smoothstep(0.0, 0.18, h);
      if (body > 0.0) {
        float upper = cumulus(p + vec2(0.0, 0.35));
        float under = smoothstep(-0.02, 0.12, upper - dens) * smoothstep(0.03, 0.3, h);
        vec3 cloud = mix(uCloudLit, uCloudShade, clamp(under + (1.0 - body) * 0.3, 0.0, 1.0));
        // Thin edges let the sun through, near the glow.
        cloud = mix(cloud, vec3(1.0), glow * uGlow * (1.0 - body) * 1.5);
        float haze = smoothstep(0.0, 0.18, h);
        c = mix(c, cloud, body * haze * uCumulus);
      }
    }

    // Lightning: the whole sky lit for an instant, most round the bolt,
    // the clouds from inside, brighter than white so it blooms.
    if (uFlash > 0.0) {
      float x = (vUv.x - uFlashX) * uAspect;
      float near = exp(-x * x * 3.0);
      float lit = uFlash * (0.25 + 0.75 * near) * (0.35 + 0.65 * smoothstep(0.3, 0.8, y)) * (0.6 + 0.9 * cloudy);
      c += vec3(0.82, 0.86, 1.0) * lit;
    }

    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;

const num = (x) => x.toFixed(4);

// Gerstner waves, as in GPU Gems, chapter 1: each moves the surface round in
// circles, so the crests come out sharp and the troughs broad, as water's
// do. Deep water's dispersion sets their speed, so longer waves run faster.
// Shared by both shaders: the vertex one moves the mesh, the fragment one
// takes the exact normal at every pixel.
const WAVES = `
  const float STEEP = 0.5;

  void gerstner(vec2 p, vec2 dir, float len, float amp, float t, inout vec3 disp, inout vec3 nrm) {
    float k = 6.2831853 / len;
    float w = sqrt(9.8 * k) * 0.6;
    vec2 d = normalize(dir);
    float f = k * dot(d, p) - w * t;
    float q = STEEP / (k * amp * 3.0);
    float s = sin(f);
    float c = cos(f);
    disp.xz += q * amp * d * c;
    disp.y += amp * s;
    nrm.xz -= d * (k * amp * c);
    nrm.y -= q * k * amp * s;
  }

  // Calmer close in, so the waterline on the tower stays where the game has
  // it: the waves are only for show.
  vec3 swell(vec2 p, float t, out vec3 nrm) {
    vec3 disp = vec3(0.0);
    nrm = vec3(0.0, 1.0, 0.0);
    gerstner(p, vec2(1.0, 0.35), 7.5, 0.045, t, disp, nrm);
    gerstner(p, vec2(0.55, -0.85), 4.9, 0.028, t, disp, nrm);
    gerstner(p, vec2(-0.3, 1.0), 3.6, 0.018, t, disp, nrm);
    float calm = mix(0.35, 1.0, smoothstep(0.8, 3.0, length(p)));
    nrm = vec3(nrm.x * calm, 1.0 - (1.0 - nrm.y) * calm, nrm.z * calm);
    return disp * calm;
  }
`;

// The island's shape, for the water's depth and for where rain lands.
const ISLAND = `
  const float SAND_TOP_R = ${num(SAND_TOP_R)};

  // How far out p is on the island's ten-sided outline: its distance to
  // the side facing it, scaled to the corners' radius.
  float islandRadius(vec2 p) {
    float a = mod(atan(p.x, p.y), 0.6283185) - 0.3141593;
    return length(p) * cos(a) / 0.9510565;
  }

  // The bottom under the water at that radius: grass, the sand's top, its
  // slope, then a drop away into deep water.
  float ground(float r) {
    if (r < ${num(GRASS_R)}) return ${num(GRASS_TOP_Y)};
    if (r < ${num(SAND_TOP_R)}) return ${num(SAND_TOP_Y)};
    if (r < ${num(SAND_BOTTOM_R)}) return ${num(SAND_TOP_Y)} - (r - ${num(SAND_TOP_R)}) * ${num(SAND_HEIGHT / (SAND_BOTTOM_R - SAND_TOP_R))};
    return ${num(SAND_TOP_Y - SAND_HEIGHT)} - (r - ${num(SAND_BOTTOM_R)}) * 2.0;
  }
`;

const WATER_VERTEX = `
  #include <common>
  #include <shadowmap_pars_vertex>
  uniform float uTime;
  varying vec3 vWorld;
  varying vec2 vFlat;
  varying float vHeight;
  varying vec3 vWaveNormal;
  ${WAVES}
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 n;
    vec3 disp = swell(world.xz, uTime, n);
    vFlat = world.xz;
    vHeight = disp.y;
    vWaveNormal = n;
    world.xyz += disp;
    vWorld = world.xyz;
    // Where it is in the sun's shadow map, on high quality.
    #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
      vDirectionalShadowCoord[0] = directionalShadowMatrix[0] * vec4(world.xyz + n * directionalLightShadows[0].shadowNormalBias, 1.0);
    #endif
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const WATER_FRAGMENT = `
  #include <common>
  #include <bsdfs>
  #include <lights_pars_begin>
  #include <shadowmap_pars_fragment>
  #include <shadowmask_pars_fragment>
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uHorizon;
  uniform vec3 uTop;
  uniform vec3 uFoam;
  uniform vec3 uSun;
  uniform float uGlint;
  uniform float uNear;
  uniform float uFar;
  uniform float uLevel;
  uniform float uShore;
  uniform vec4 uColumn;
  uniform vec4 uRipples[${RIPPLES}];
  varying vec3 vWorld;
  varying vec2 vFlat;
  varying float vHeight;
  varying vec3 vWaveNormal;
  ${WAVES}

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  ${ISLAND}

  // Ripples riding on the swell, too fine for the mesh, so only in the
  // shading. Each fades out before it is too small on screen to draw
  // cleanly.
  void chop(vec2 p, vec2 dir, float len, float t, float dist, inout vec3 nrm) {
    float k = 6.2831853 / len;
    float w = sqrt(9.8 * k) * 0.6;
    vec2 d = normalize(dir);
    float fade = 1.0 - smoothstep(len * 30.0, len * 90.0, dist);
    nrm.xz -= d * cos(k * dot(d, p) - w * t) * 0.035 * fade;
  }

  void main() {
    vec2 p = vFlat;
    float churn = 0.0;
    float grain = 0.5;
  #ifdef LOW
    // Low quality: the mesh's own normal, no ripples, plain foam.
    vec3 n = normalize(vWaveNormal);
  #else
    float dist = length(cameraPosition - vWorld);
    vec3 n;
    swell(p, uTime, n);
    chop(p, vec2(0.8, 0.6), 1.7, uTime, dist, n);
    chop(p, vec2(-0.6, 0.9), 1.1, uTime, dist, n);
    chop(p, vec2(0.95, -0.3), 0.73, uTime, dist, n);
    chop(p, vec2(-0.2, -1.0), 0.47, uTime, dist, n);
    chop(p, vec2(0.4, 0.9), 0.31, uTime, dist, n);

    // Rings spreading from where pieces went in, white water where they did.
    for (int i = 0; i < ${RIPPLES}; i++) {
      vec4 ring = uRipples[i];
      if (ring.z < 0.0) continue;
      vec2 d = p - ring.xy;
      float rr = length(d) + 0.0001;
      float front = 0.12 + ring.z * 0.9;
      float env = exp(-pow((rr - front) * 5.0, 2.0)) * ring.w * exp(-ring.z * 1.2);
      n.xz += (d / rr) * sin((rr - front) * 30.0) * env * 0.5;
      churn += ring.w * exp(-ring.z * 3.0) * (1.0 - smoothstep(0.05, 0.3 + ring.z * 0.4, rr));
    }
    n = normalize(n);
    grain = noise(p * 7.0 + vec2(uTime * 0.3, 0.0)) * 0.6 + noise(p * 19.0 - vec2(0.0, uTime * 0.5)) * 0.4;
  #endif

    // Fresnel: looking down, the water's own colour; towards the horizon,
    // more and more the sky it mirrors.
    vec3 v = normalize(cameraPosition - vWorld);
    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    vec3 sky = mix(uHorizon, uTop, smoothstep(0.0, 0.6, reflect(-v, n).y));

    // Its colour comes from its depth: clear over the sand, bluer as the
    // bottom falls away, and a little light through the thin crests.
    float r = islandRadius(p);
    float depth = max(uLevel - ground(r), 0.0);
    float deep = 1.0 - exp(-depth * 1.1);
    vec3 body = mix(uShallow, uDeep, deep);
    body += uShallow * 0.18 * clamp(vHeight / 0.04, 0.0, 1.0);
    vec3 c = mix(body, sky, fresnel);

    // In the shadow of the tower or the island, on high quality: darker,
    // and no glint.
    float lit = getShadowMask();
    c *= mix(0.72, 1.0, lit);

    // The sun: a hard glint off facets turned just right, a sheen round it.
    float nh = max(dot(n, normalize(uSun + v)), 0.0);
    c += uGlint * (pow(nh, 900.0) * 2.2 + pow(nh, 80.0) * 0.12) * lit;

    // Foam where the water meets the island or the tower, on the highest
    // crests, and where something went in, broken up so it reads as foam.
    float foam = 0.0;
    if (uShore > 0.0) {
      float s = r - uShore;
      float surge = smoothstep(0.6, 1.0, sin(s * 26.0 - uTime * 2.4)) * (1.0 - smoothstep(0.03, 0.3, s));
      foam = max(1.0 - smoothstep(0.0, 0.08, s), surge * 0.45);
    }
    if (uColumn.z > 0.0) {
      float s = length(max(abs(p - uColumn.xy) - uColumn.zw, 0.0));
      foam = max(foam, 1.0 - smoothstep(0.0, 0.07, s));
    }
    foam *= smoothstep(0.35, 0.75, grain + foam * 0.2);
    foam = max(foam, smoothstep(0.045, 0.07, vHeight) * smoothstep(0.62, 0.8, grain) * 0.8);
    foam = max(foam, clamp(churn, 0.0, 1.0) * smoothstep(0.2, 0.5, grain));
    foam = clamp(foam, 0.0, 1.0);
    c = mix(c, uFoam, foam * 0.75);

    // The sea is a wide pool round the island that fades into the sky, so
    // the sky shows past it the way the tower floats in it.
    float edge = smoothstep(uNear, uFar, length(vWorld.xz));
    c = mix(c, uHorizon, edge);
    float alpha = max(mix(0.6, 0.95, deep), max(fresnel, foam));
    gl_FragColor = vec4(c, alpha * (1.0 - edge));
    #include <colorspace_fragment>
  }
`;

// quality: "high", or "low" for a slower device: one pixel per CSS pixel,
// no antialiasing, no post-processing, and plainer water on a coarser mesh.
// High draws into js/post.js's multisampled picture, which does its
// antialiasing, so the canvas itself never needs any.
export function createScene(canvas, { quality = "high" } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff, 12, 60);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 400);

  /* ---- light ---- */
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8a9a, 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(-2.2, 5, 3.4);
  scene.add(sun);
  scene.add(sun.target);

  // Its shadows, on high quality: soft, from a square of the world round
  // where the camera looks, sized to how far back it is. setQuality()
  // turns them on and off; draw() moves the square.
  const SUN_FROM = SUN_FROM_BASE.clone();
  const SHADOW_MAP = 2048;
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.015;
  sun.shadow.radius = 2.5;
  sun.shadow.intensity = 0.9;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 90;
  // The light's own right and up, to snap the square to whole shadow-map
  // texels so its edges hold still as the camera eases.
  const sunRight = new THREE.Vector3();
  const sunUp = new THREE.Vector3();

  // Where the sun is: glint, the way to it for the water and the rays;
  // sunSky, how high it stands in the flat sky, 0 to 1 up the screen.
  const glint = new THREE.Vector3(-1, 0.36, -1).normalize();
  const sunSky = { y: 0.7, turn: 0 };
  function placeSun(seedNum, t) {
    // hash() gives [-0.5, 0.5); these want [0, 1).
    const seed = (seedNum | 0) >>> 0;
    const u = (k) => hash(seed, k) + 0.5;
    const s = (t || 0) / 1000;
    const turn = (u(1) * 2 - 1) * SUN_TURN
      + SUN_WANDER * Math.sin((s / SUN_PERIOD) * Math.PI * 2 + u(2) * Math.PI * 2);
    const high = THREE.MathUtils.clamp(
      u(3) * 0.85 + 0.15 * Math.sin((s / (SUN_PERIOD * 1.4)) * Math.PI * 2 + u(4) * Math.PI * 2),
      0, 1
    );
    sunSky.turn = turn;
    sunSky.y = 0.78 + 0.14 * high;
    glint.copy(GLINT_BASE).applyAxisAngle(UP, turn);
    glint.y = Math.tan(0.2 + 0.25 * high);
    glint.normalize();
    SUN_FROM.copy(SUN_FROM_BASE).applyAxisAngle(UP, turn);
    sunRight.crossVectors(SUN_FROM, UP).normalize();
    sunUp.crossVectors(sunRight, SUN_FROM).normalize();
  }
  placeSun(0, 0);
  const shadowAt = new THREE.Vector3();
  const shadowed = (o) => { o.castShadow = true; o.receiveShadow = true; };

  /* ---- sky: its own flat scene, drawn first ---- */
  const back = new THREE.Scene();
  const backCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const skyUniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uBottom: { value: new THREE.Color() },
    uGlow: { value: 0.3 },
    uSun: { value: new THREE.Vector2(0.5, 0.7) },
    uSunDisc: { value: 1 },
    uAspect: { value: 1 },
    uTime: { value: 0 },
    uPan: { value: 0 },
    uPanPx: { value: 0 },
    uPixel: { value: 1 },
    uStars: { value: 0.6 },
    uMeteors: { value: 0 },
    uCloudLit: { value: new THREE.Color(1, 1, 1) },
    uCloudShade: { value: new THREE.Color(0.8, 0.84, 0.92) },
    uCumulus: { value: 0.8 },
    uCirrus: { value: 0.5 },
    uOvercast: { value: 0 },
    uFlash: { value: 0 },
    uFlashX: { value: 0.5 },
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    defines: { OCTAVES: 5 },
    depthWrite: false,
    depthTest: false,
  });
  back.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMat));

  // Cumulus nearer by, in the world: sprites the wind carries across, at a
  // few heights round the camera's, fading in as they come over the far
  // edge and out as they go, and out of the way of the tower and the
  // camera. Each billows a little as it goes.
  const WIND = new THREE.Vector2(0.94, 0.34);
  const ACROSS = new THREE.Vector2(-WIND.y, WIND.x);
  const SPAN = 26;
  const cloudMaps = Array.from({ length: CLOUD_VARIANTS }, (_, i) => cloudTexture(i));
  const cloudTint = new THREE.Color(1, 1, 1);
  let cloudOpacity = 0.85;
  const clouds = [];
  for (let i = 0; i < 16; i++) {
    let r = 1013 * (i + 1);
    const rand = () => ((r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 4294967296);
    rand();
    const mat = new THREE.SpriteMaterial({ map: cloudMaps[i % cloudMaps.length], transparent: true, depthWrite: false, fog: false });
    const sprite = new THREE.Sprite(mat);
    const size = 4 + rand() * 4;
    sprite.userData = {
      along: rand() * SPAN * 2 - SPAN,
      across: (rand() * 2 - 1) * SPAN * 0.9,
      rise: 0.5 + rand() * 5,
      speed: 0.25 + rand() * 0.35,
      w: size,
      h: size * 0.5,
      phase: rand() * 6.28,
    };
    clouds.push(sprite);
    scene.add(sprite);
  }

  /* ---- water ---- */
  const waterUniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color() },
    uShallow: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uTop: { value: new THREE.Color() },
    uFoam: { value: new THREE.Color() },
    uSun: { value: glint },
    uGlint: { value: 1 },
    uNear: { value: 14 },
    uFar: { value: 70 },
    uLevel: { value: 0 },
    uShore: { value: -1 },
    uColumn: { value: new THREE.Vector4(0, 0, -1, -1) },
    uRipples: { value: Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -1, 0)) },
    // The scene's lights, for the sun's shadow on high quality.
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
  };
  // About a unit between vertices, enough for the long waves; the short
  // ones are only in the shading. setQuality() makes it.
  const water = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.ShaderMaterial({
      uniforms: waterUniforms,
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      transparent: true,
      depthWrite: false,
      lights: true,
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.receiveShadow = true;
  water.renderOrder = 2;
  scene.add(water);

  const sunDisc = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: { uSun: skyUniforms.uSun, uSunDisc: skyUniforms.uSunDisc, uAspect: skyUniforms.uAspect },
      vertexShader: SUN_VERTEX,
      fragmentShader: SUN_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  sunDisc.frustumCulled = false;
  sunDisc.renderOrder = 2.5;
  scene.add(sunDisc);

  /* ---- the island and the base ---- */
  const island = new THREE.Group();
  const islandTop = ISLAND_Y;
  const sandMat = new THREE.MeshLambertMaterial({ color: 0xe9d7a8, flatShading: true });
  const sand = new THREE.Mesh(new THREE.CylinderGeometry(SAND_TOP_R, SAND_BOTTOM_R, SAND_HEIGHT, 10, 1), sandMat);
  sand.position.y = SAND_TOP_Y - SAND_HEIGHT / 2;
  island.add(sand);
  const grassMat = new THREE.MeshLambertMaterial({ color: 0x9fcf8f, flatShading: true });
  const grass = new THREE.Mesh(new THREE.CylinderGeometry(1.75, GRASS_R, 0.14, 10, 1), grassMat);
  grass.position.y = GRASS_TOP_Y - 0.07;
  island.add(grass);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0xb9b4ad, flatShading: true });
  [[1.9, 0.6, 0.22], [-1.4, 1.5, 0.3], [0.4, -2.0, 0.18], [-2.0, -0.9, 0.26], [1.3, -1.5, 0.2]].forEach(([x, z, r]) => {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rockMat);
    rock.position.set(x, islandTop - 0.05, z);
    rock.rotation.set(x, z, r * 10);
    island.add(rock);
  });

  // Grass tufts and flowers on the grass, scattered the same way every
  // time and clear of the base column, each turned, sized and shaded a
  // little differently. They sway in the wind, more at the tips, each a
  // little out of step with the next.
  const swayTime = { value: 0 };
  const foliageMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  foliageMat.onBeforeCompile = (shader) => {
    shader.uniforms.uSwayTime = swayTime;
    shader.vertexShader = `uniform float uSwayTime;\n${shader.vertexShader}`.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 root = instanceMatrix[3].xz;
      #else
        vec2 root = vec2(0.0);
      #endif
      float sway = sin(uSwayTime * 1.7 + root.x * 3.1 + root.y * 2.3) * 0.12 * max(position.y, 0.0);
      transformed.x += sway;
      transformed.z += sway * 0.6;`
    );
  };
  {
    let seed = 20261101;
    const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
    // Anywhere on the ring of grass round the base, evenly spread, clear of
    // the biggest base any difficulty starts with.
    const clear = (MAX_START * S) / 2 + 0.12;
    const spot = () => {
      for (;;) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(clear ** 2 + rand() * (1.55 ** 2 - clear ** 2));
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (Math.max(Math.abs(x), Math.abs(z)) > clear) return [x, z];
      }
    };
    const o = new THREE.Object3D();
    const set = (mesh, i, size) => {
      const [x, z] = spot();
      o.position.set(x, GRASS_TOP_Y, z);
      o.rotation.set((rand() - 0.5) * 0.2, rand() * Math.PI * 2, (rand() - 0.5) * 0.2);
      o.scale.setScalar(size);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    };

    const TUFTS = 110;
    const tufts = new THREE.InstancedMesh(tuftGeometry(rand), foliageMat, TUFTS);
    const shade = new THREE.Color();
    for (let i = 0; i < TUFTS; i++) {
      set(tufts, i, 0.75 + rand() * 0.6);
      tufts.setColorAt(i, shade.setHSL(0, 0, 0.85 + rand() * 0.15));
    }
    island.add(tufts);

    const EACH = 7;
    FLOWERS.forEach(([petal, middle]) => {
      const flowers = new THREE.InstancedMesh(flowerGeometry(petal, middle), foliageMat, EACH);
      for (let i = 0; i < EACH; i++) set(flowers, i, 1 + rand() * 0.5);
      island.add(flowers);
    });
  }
  island.traverse(shadowed);
  scene.add(island);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const baseMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const base = new THREE.Mesh(boxGeo, baseMat);
  base.scale.set(1, -islandTop, 1);
  base.position.y = islandTop / 2;
  shadowed(base);
  scene.add(base);

  /* ---- the tower ---- */
  let capacity = 0;
  let tower = null;
  let towerLayers = null;
  let towerShown = 0;
  const towerMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const tmp = new THREE.Object3D();
  const tmpColour = new THREE.Color();

  function ensureCapacity(n) {
    if (tower && n <= capacity) return;
    capacity = Math.max(256, 2 ** Math.ceil(Math.log2(n + 1)));
    if (tower) {
      scene.remove(tower);
      tower.dispose();
    }
    tower = new THREE.InstancedMesh(boxGeo, towerMat, capacity);
    tower.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    tower.count = 0;
    tower.frustumCulled = false;
    shadowed(tower);
    scene.add(tower);
    towerShown = 0;
  }

  function setLayer(i, layer, seedNum) {
    tmp.position.set(layer.x * S, (layer.n * LAYER - LAYER / 2) * S, layer.z * S);
    tmp.scale.set(layer.sx * S, LAYER * S, layer.sz * S);
    tmp.rotation.set(0, 0, 0);
    tmp.updateMatrix();
    tower.setMatrixAt(i, tmp.matrix);
    tower.setColorAt(i, layerColour(seedNum, layer.n, tmpColour));
  }

  // Layers 1 and up, as instances; layer 0 is the base column.
  function syncTower(layers, count, seedNum) {
    ensureCapacity(count);
    if (layers !== towerLayers) {
      towerLayers = layers;
      towerShown = 0;
      baseMat.color.copy(layerColour(seedNum, 0, tmpColour));
      // The base column is as wide as the difficulty's starting slab.
      base.scale.set(layers[0].sx * S, -islandTop, layers[0].sz * S);
    }
    const want = Math.max(0, count - 1);
    if (want > towerShown) {
      for (let i = towerShown; i < want; i++) setLayer(i, layers[i + 1], seedNum);
      tower.instanceMatrix.needsUpdate = true;
      if (tower.instanceColor) tower.instanceColor.needsUpdate = true;
    }
    towerShown = Math.max(towerShown, want);
    tower.count = want;
  }

  // A layer a run of perfects grew pushes its new side out, easing to a
  // stop, rather than appearing full size. Once done it is put back as
  // it is.
  const growingNow = new Set();
  function growLayers(growing, layers, count, seedNum, t) {
    const done = new Set(growingNow);
    growingNow.clear();
    for (const g of growing) {
      const layer = layers[g.n];
      if (!layer || g.n >= count) continue;
      const p = THREE.MathUtils.clamp((t - g.t) / g.ms, 0, 1);
      const missing = g.amount * (1 - p) ** 3;
      const shown = { ...layer };
      if (g.axis === "x") {
        shown.sx -= missing;
        shown.x -= (g.side * missing) / 2;
      } else {
        shown.sz -= missing;
        shown.z -= (g.side * missing) / 2;
      }
      setLayer(g.n - 1, shown, seedNum);
      growingNow.add(g.n);
      done.delete(g.n);
    }
    for (const n of done) if (layers[n] && n < count) setLayer(n - 1, layers[n], seedNum);
    if (growingNow.size || done.size) {
      tower.instanceMatrix.needsUpdate = true;
      if (tower.instanceColor) tower.instanceColor.needsUpdate = true;
    }
  }

  /* ---- the slab, the pieces and the rings ---- */
  const slabMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const slab = new THREE.Mesh(boxGeo, slabMat);
  shadowed(slab);
  scene.add(slab);

  const piecePool = [];
  function pieceMesh(i) {
    while (piecePool.length <= i) {
      const m = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }));
      m.visible = false;
      shadowed(m);
      scene.add(m);
      piecePool.push(m);
    }
    return piecePool[i];
  }

  const frameGeo = frameGeometry(0.9);
  const plateGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  // Splashes: a crown of water thrown up round where a piece went in, and
  // drops flying out of it, drawn only on high quality.
  // Unlit, so drops read as bright water rather than grey beads.
  const dropMat = new THREE.MeshBasicMaterial({ color: 0xeaf8ff, transparent: true, opacity: 0.9, fog: false });
  const splashDrops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), dropMat, RIPPLES * DROPS);
  splashDrops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  splashDrops.frustumCulled = false;
  splashDrops.count = 0;
  splashDrops.renderOrder = 3;
  scene.add(splashDrops);
  const crownGeo = crownGeometry();
  const crowns = Array.from({ length: RIPPLES }, () => {
    const crown = new THREE.Mesh(
      crownGeo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false })
    );
    crown.visible = false;
    crown.renderOrder = 3;
    scene.add(crown);
    return crown;
  });

  const ringPool = [];
  function ringMeshes(i) {
    while (ringPool.length <= i) {
      const frame = new THREE.Mesh(
        frameGeo,
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false })
      );
      const plate = new THREE.Mesh(
        plateGeo,
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false })
      );
      frame.renderOrder = 3;
      plate.renderOrder = 3;
      frame.visible = plate.visible = false;
      scene.add(frame, plate);
      ringPool.push({ frame, plate });
    }
    return ringPool[i];
  }

  /* ---- the weather ---- */
  const rain = createRain(scene, { waves: WAVES, island: ISLAND });
  // How wet it is as drawn, easing towards the weather's: 0 dry, up to 1
  // for a storm. The sky greys and the light dims with it.
  let wet = 0;
  let wetReady = false;
  const FLASH = new THREE.Color(0.85, 0.88, 1.0);
  const GREY = new THREE.Color();
  const footprint = new THREE.Vector4();
  const flashPoint = new THREE.Vector3();
  // How far into its rain the scene is: light rain is wet 0.6 and a
  // storm 1, and the rain clouds come in full by light rain's.
  const rainy = () => Math.min(1, wet / 0.6);
  const stormy = () => THREE.MathUtils.clamp((wet - 0.6) / 0.4, 0, 1);
  // Rain clouds' lit tops and dark undersides, slate grey.
  const RAIN_LIT = new THREE.Color(0.56, 0.58, 0.63);
  const RAIN_SHADE = new THREE.Color(0.3, 0.32, 0.37);
  const TMP_A = new THREE.Color();
  // Towards its own grey by k, and darker by dim.
  const overcast = (c, k, dim) => {
    const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
    return c.lerp(GREY.setRGB(l, l, l), k).multiplyScalar(1 - dim);
  };

  /* ---- colours from the theme ---- */
  const look = {
    dark: false,
    brand: new THREE.Color("#ccffcc"),
    hue: -1,
    top: new THREE.Color(),
    horizon: new THREE.Color(),
    bottom: new THREE.Color(),
  };

  // How bright the god rays are: full by day, faint by night.
  let raysLevel = 1;

  function readTheme() {
    const root = document.documentElement;
    look.dark = root.getAttribute("data-mode") === "dark";
    const brand = getComputedStyle(root).getPropertyValue("--brand").trim() || "#ccffcc";
    try {
      look.brand.set(brand);
    } catch {
      look.brand.set("#ccffcc");
    }
    look.hue = -1;
  }

  // Sky colours for a tower whose top layer has hue h, eased towards each
  // frame so the sky drifts rather than jumps.
  const targetTop = new THREE.Color();
  const targetHorizon = new THREE.Color();
  const targetBottom = new THREE.Color();
  function skyTargets(h) {
    const hh = (x) => (((h + x) % 360) + 360) % 360 / 360;
    if (look.dark) {
      targetTop.setHSL(hh(50), 0.5, 0.08);
      targetHorizon.setHSL(hh(15), 0.38, 0.2).lerp(look.brand, 0.08);
      targetBottom.setHSL(hh(0), 0.32, 0.13);
    } else {
      targetTop.setHSL(hh(55), 0.55, 0.72);
      targetHorizon.setHSL(hh(20), 0.7, 0.86).lerp(look.brand, 0.2);
      targetBottom.setHSL(hh(0), 0.55, 0.8);
    }
    if (wet > 0) {
      const r = rainy();
      const storm = stormy();
      overcast(targetTop, 0.7 * r, 0.3 * r + 0.15 * storm);
      overcast(targetHorizon, 0.65 * r, 0.32 * r + 0.12 * storm);
      overcast(targetBottom, 0.55 * r, 0.22 * r + 0.12 * storm);
    }
  }

  const WHITE = new THREE.Color(0xffffff);
  function applyLook(h, ease) {
    skyTargets(h);
    look.top.lerp(targetTop, ease);
    look.horizon.lerp(targetHorizon, ease);
    look.bottom.lerp(targetBottom, ease);
    skyUniforms.uTop.value.copy(look.top);
    skyUniforms.uHorizon.value.copy(look.horizon);
    skyUniforms.uBottom.value.copy(look.bottom);
    scene.fog.color.copy(look.horizon);
    waterUniforms.uHorizon.value.copy(look.horizon);
    waterUniforms.uTop.value.copy(look.top);
    if (look.dark) {
      waterUniforms.uDeep.value.setHSL(0.58, 0.45, 0.15);
      waterUniforms.uShallow.value.setHSL(0.52, 0.42, 0.24);
      waterUniforms.uFoam.value.setHSL(0.55, 0.2, 0.5);
      waterUniforms.uGlint.value = 0.35;
      skyUniforms.uGlow.value = 0.08;
      skyUniforms.uSunDisc.value = 0.3;
      hemi.intensity = 1.0;
      sun.intensity = 1.2;
      skyUniforms.uStars.value = 0.9;
      skyUniforms.uMeteors.value = 0.9;
      skyUniforms.uCloudLit.value.copy(look.horizon).lerp(WHITE, 0.22);
      skyUniforms.uCloudShade.value.copy(look.top).lerp(look.horizon, 0.45);
      skyUniforms.uCumulus.value = 0.7;
      skyUniforms.uCirrus.value = 0.3;
      cloudTint.copy(look.horizon).lerp(WHITE, 0.3);
      cloudOpacity = 0.7;
      sandMat.color.setHex(0xa89a78);
      grassMat.color.setHex(0x6f9a62);
      foliageMat.color.setScalar(0.7);
      raysLevel = 0.35;
    } else {
      waterUniforms.uDeep.value.setHSL(0.55, 0.5, 0.55);
      waterUniforms.uShallow.value.setHSL(0.49, 0.5, 0.7);
      waterUniforms.uFoam.value.setRGB(1, 1, 1).lerp(look.horizon, 0.12);
      waterUniforms.uGlint.value = 1;
      skyUniforms.uGlow.value = 0.35;
      skyUniforms.uSunDisc.value = 1;
      hemi.intensity = 1.5;
      sun.intensity = 1.7;
      skyUniforms.uStars.value = 0.6;
      skyUniforms.uMeteors.value = 0;
      skyUniforms.uCloudLit.value.copy(WHITE).lerp(look.horizon, 0.08);
      skyUniforms.uCloudShade.value.copy(look.top).lerp(WHITE, 0.3).multiplyScalar(0.9);
      skyUniforms.uCumulus.value = 0.85;
      skyUniforms.uCirrus.value = 0.55;
      cloudTint.copy(WHITE).lerp(look.horizon, 0.1);
      cloudOpacity = 0.85;
      sandMat.color.setHex(0xe9d7a8);
      grassMat.color.setHex(0x9fcf8f);
      foliageMat.color.setScalar(1);
      raysLevel = 1;
    }
    hemi.color.copy(look.top).lerp(WHITE, 0.6);

    // Rain: an overcast sky, thicker greyer cloud, no stars, a dimmer sun
    // with softer shadows, less glint and no god rays.
    const dry = 1 - wet;
    const r = rainy();
    const storm = stormy();
    skyUniforms.uOvercast.value = Math.max(wet, 0.8 * r);
    skyUniforms.uGlow.value *= 1 - 0.85 * r;
    skyUniforms.uSunDisc.value *= 1 - Math.min(1, 1.2 * r);
    skyUniforms.uStars.value *= dry;
    skyUniforms.uMeteors.value *= dry;
    skyUniforms.uCumulus.value = Math.min(1, skyUniforms.uCumulus.value + 0.15 * r);
    // Any rain brings dark rain clouds, a storm's darker still.
    const deep = (look.dark ? 0.45 : 1) * (1 - 0.3 * storm);
    skyUniforms.uCloudLit.value.lerp(TMP_A.copy(RAIN_LIT).multiplyScalar(deep), r);
    skyUniforms.uCloudShade.value.lerp(TMP_A.copy(RAIN_SHADE).multiplyScalar(deep), r);
    cloudTint.lerp(TMP_A.copy(RAIN_LIT).multiplyScalar(deep * 0.95), r);
    cloudOpacity = Math.min(0.95, cloudOpacity + 0.12 * r);
    waterUniforms.uGlint.value *= 1 - 0.8 * r - 0.1 * storm;
    overcast(waterUniforms.uDeep.value, 0.3 * wet, 0.08 * wet);
    overcast(waterUniforms.uShallow.value, 0.3 * wet, 0.08 * wet);
    sun.intensity *= 1 - 0.4 * r - 0.15 * storm;
    sun.shadow.intensity = 0.9 * (1 - 0.45 * wet);
    hemi.intensity *= 1 - 0.1 * wet;
    raysLevel *= 1 - 0.85 * wet;
  }

  /* ---- quality ---- */
  let drawnAs = null;
  let post = null;

  function setQuality(value) {
    const low = value === "low";
    if (drawnAs === (low ? "low" : "high")) return;
    drawnAs = low ? "low" : "high";
    rain.setQuality(drawnAs);
    renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    water.geometry.dispose();
    water.geometry = new THREE.PlaneGeometry(260, 260, low ? 96 : 256, low ? 96 : 256);
    water.material.defines = low ? { LOW: 1 } : {};
    water.material.needsUpdate = true;
    skyMat.defines.OCTAVES = low ? 3 : 5;
    skyMat.needsUpdate = true;
    clouds.forEach((c, i) => { c.userData.shown = !low || i % 2 === 0; });
    // Shadows: every lit material is built again with or without them.
    renderer.shadowMap.enabled = !low;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    sun.castShadow = !low;
    scene.traverse((o) => {
      if (o.material && !o.isSprite) o.material.needsUpdate = true;
    });
    // Made the first time it is wanted, and let go on low to free its memory.
    if (low) {
      post?.dispose();
      post = null;
    } else {
      post ??= createPost(renderer);
    }
  }

  /* ---- where the water meets things ---- */

  // The island's waterline, as a radius of its ten-sided outline, or -1
  // once the grass is under.
  function shoreRadius(level) {
    if (level >= GRASS_TOP_Y) return -1;
    if (level >= SAND_TOP_Y) return GRASS_R;
    const down = Math.min(SAND_HEIGHT, SAND_TOP_Y - level);
    return SAND_TOP_R + ((SAND_BOTTOM_R - SAND_TOP_R) * down) / SAND_HEIGHT;
  }

  // The footprint of the tower at the waterline, for the foam round it:
  // the base column, or the layer the water has reached.
  function waterline(layers, count, level, out) {
    out.set(0, 0, -1, -1);
    if (level < GRASS_TOP_Y) return;
    if (level < 0) {
      out.set(0, 0, (layers[0].sx * S) / 2, (layers[0].sz * S) / 2);
      return;
    }
    const n = Math.floor(level / (LAYER * S)) + 1;
    const layer = layers[n];
    if (n < count && layer) out.set(layer.x * S, layer.z * S, (layer.sx * S) / 2, (layer.sz * S) / 2);
  }

  // The latest few places pieces went in: where, how long ago in seconds,
  // how hard, how big the piece, and its time in the game, which seeds
  // its drops.
  const hits = Array.from({ length: RIPPLES }, () => ({ x: 0, z: 0, age: 0, strength: 0, size: 0, seed: 0 }));
  function impacts(view) {
    let used = 0;
    for (const p of view.pieces ?? []) {
      for (const hit of p.fall.impacts) {
        if (used === RIPPLES) break;
        if (hit.kind !== "water") continue;
        const age = view.t - hit.t;
        if (age < 0 || age >= RIPPLE_MS) continue;
        const at = fallAt(p.fall, hit.t, view.water);
        if (!at) continue;
        Object.assign(hits[used++], {
          x: at.x * S,
          z: at.z * S,
          age: age / 1000,
          strength: hit.strength,
          size: Math.sqrt(p.sx * p.sz) * S,
          seed: Math.floor(hit.t),
        });
      }
    }
    return used;
  }

  // The rings in the water's shading, for every quality.
  function ripples(used) {
    const out = waterUniforms.uRipples.value;
    for (let i = 0; i < RIPPLES; i++) {
      const h = hits[i];
      if (i < used) out[i].set(h.x, h.z, h.age, 0.4 + 0.6 * h.strength);
      else out[i].set(0, 0, -1, 0);
    }
  }

  // The crowns and the drops, on high quality only. A crown spreads and
  // rises, then falls back; each drop flies out and up and falls back in
  // under gravity, the bigger and harder the piece the higher.
  function splashes(used, level) {
    const high = drawnAs === "high";
    let n = 0;
    dropMat.color.copy(waterUniforms.uShallow.value).lerp(waterUniforms.uFoam.value, 0.75);
    for (let i = 0; i < RIPPLES; i++) {
      const h = hits[i];
      const crown = crowns[i];
      const on = high && i < used && h.age < SPLASH_S;
      crown.visible = on && h.age < CROWN_S;
      if (!on) continue;
      const big = (0.5 + 0.5 * h.strength) * Math.min(1.4, 0.5 + h.size);
      if (crown.visible) {
        const k = h.age / CROWN_S;
        const r = h.size * 0.45 + k * 0.5 * big;
        crown.position.set(h.x, level, h.z);
        crown.scale.set(r, 0.55 * big * Math.sin(Math.PI * Math.min(1, k * 1.3)) + 0.001, r);
        crown.material.color.copy(waterUniforms.uFoam.value);
        crown.material.opacity = 0.8 * (1 - k);
      }
      for (let j = 0; j < DROPS; j++) {
        const up = (1.9 + 1.4 * hash(h.seed, j * 4 + 2)) * big;
        const y = up * h.age - 4.9 * h.age * h.age;
        if (y < -0.02) continue;
        const a = (j / DROPS) * Math.PI * 2 + hash(h.seed, j * 4) * 0.5;
        const out = h.size * 0.4 + (0.35 + 0.5 * hash(h.seed, j * 4 + 1)) * big * h.age;
        tmp.position.set(h.x + Math.cos(a) * out, level + y, h.z + Math.sin(a) * out);
        tmp.rotation.set(0, 0, 0);
        tmp.scale.setScalar((0.022 + 0.026 * hash(h.seed, j * 4 + 3)) * big);
        tmp.updateMatrix();
        splashDrops.setMatrixAt(n++, tmp.matrix);
      }
    }
    splashDrops.count = n;
    splashDrops.instanceMatrix.needsUpdate = true;
  }

  /* ---- camera ---- */
  const cam = { x: 0, y: 0.4, z: 0, dist: 8, cover: 0, ready: false };
  // The free camera's offsets as drawn, easing towards the ones asked for.
  const orb = { ...NO_ORBIT };
  const look3 = new THREE.Vector3();
  let width = 1;
  let height = 1;

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (w === width && h === height) return;
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // How far back the camera sits to show a column about four units wide
  // and five and a half tall, whatever the screen's shape.
  function fitDistance() {
    const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    return Math.max(5.4 / (2 * t), 4.0 / (2 * t * camera.aspect));
  }

  /* ---- drawing ---- */

  // view:
  //   t          game ms being shown
  //   seedNum    the game's seed number
  //   layers     the tower's layers; count of them are shown
  //   count
  //   slab       the swinging slab, or null
  //   water      the water's height, in units
  //   pieces     [{ fall, sx, sz, n }] falling or fallen pieces
  //   rings      [{ t, x, z, sx, sz, n, big }] perfect drops
  //   overview   0 to 1, how far the camera has pulled back to show the
  //              whole tower
  //   cover      0 to 1, how much of the screen's height a panel along the
  //              bottom covers: the picture centres on what is left, and
  //              pulls back so the whole tower fits there
  //   dt         real seconds since the last frame
  //   clock      real seconds, for the waves and the clouds
  //   orbit      the replay's free camera, js/freecam.js, or null
  //   shot       a saved picture, { band }: the share of its height along
  //              the bottom that a caption covers. It shows all of what
  //              the player could see, the screen less any panel along
  //              the bottom, zoomed out just enough to fit above the band,
  //              with more of the scene round it
  function draw(view) {
    resize();
    const { t, seedNum, layers, count, overview = 0, cover = 0, dt = 0.016, clock = 0 } = view;

    syncTower(layers, count, seedNum);
    growLayers(view.growing ?? [], layers, count, seedNum, t);
    placeSun(seedNum, t);

    const top = (count - 1) * LAYER * S;
    const weather = view.weather;
    const wantWet = weather?.rain ? (weather.storm ? 1 : 0.6) : 0;
    const fresh = !wetReady;
    wet = wetReady ? wet + (wantWet - wet) * (1 - Math.exp(-dt * 0.7)) : wantWet;
    if (Math.abs(wet - wantWet) < 0.001) wet = wantWet;
    wetReady = true;
    const strike = weather?.strike ?? null;
    const flash = flashOf(strike);
    const h = hueOf(seedNum, count - 1);
    if (look.hue < 0) {
      skyTargets(h);
      look.top.copy(targetTop);
      look.horizon.copy(targetHorizon);
      look.bottom.copy(targetBottom);
    }
    look.hue = h;
    applyLook(h, Math.min(1, dt * 1.5));

    // A strike lights the scene and the sky it mirrors.
    if (flash > 0) {
      const lit = flash * (0.5 + 0.5 * strike.near);
      hemi.intensity += 0.8 * lit;
      hemi.color.lerp(FLASH, Math.min(1, 0.6 * lit));
      waterUniforms.uHorizon.value.lerp(FLASH, Math.min(1, 0.25 * lit));
      waterUniforms.uTop.value.lerp(FLASH, Math.min(1, 0.25 * lit));
    }

    // The slab.
    if (view.slab) {
      const s = view.slab;
      slab.visible = true;
      slab.position.set(s.x * S, (s.n * LAYER - LAYER / 2) * S, s.z * S);
      slab.scale.set(s.sx * S, LAYER * S, s.sz * S);
      slabMat.color.copy(layerColour(seedNum, s.n, tmpColour));
    } else {
      slab.visible = false;
    }

    // Pieces.
    let used = 0;
    for (const p of view.pieces ?? []) {
      const at = fallAt(p.fall, t, view.water);
      if (!at) continue;
      const m = pieceMesh(used++);
      m.visible = true;
      m.position.set(at.x * S, at.y * S, at.z * S);
      m.rotation.set(at.rx, 0, at.rz);
      m.scale.set(p.sx * S, LAYER * S, p.sz * S);
      m.material.color.copy(layerColour(seedNum, p.n, tmpColour));
    }
    for (let i = used; i < piecePool.length; i++) piecePool[i].visible = false;

    // Rings: a white frame and a tinted plate that spread and fade.
    let rings = 0;
    for (const r of view.rings ?? []) {
      const age = (t - r.t) / RING_MS;
      if (age < 0 || age >= 1) continue;
      const { frame, plate } = ringMeshes(rings++);
      const grow = 1.08 + age * (r.big ? 0.55 : 0.35);
      const y = (r.n * LAYER) * S + 0.002;
      frame.visible = plate.visible = true;
      frame.position.set(r.x * S, y, r.z * S);
      plate.position.set(r.x * S, y - 0.001, r.z * S);
      frame.scale.set(r.sx * S * grow, 1, r.sz * S * grow);
      plate.scale.set(r.sx * S * (grow + 0.12), 1, r.sz * S * (grow + 0.12));
      frame.material.opacity = 0.95 * (1 - age);
      plate.material.opacity = 0.32 * (1 - age);
      plate.material.color.copy(layerColour(seedNum, r.n, tmpColour)).lerp(new THREE.Color(0xffffff), 0.35);
    }
    for (let i = rings; i < ringPool.length; i++) ringPool[i].frame.visible = ringPool[i].plate.visible = false;

    // Water.
    const level = view.water * S;
    water.position.y = level;
    waterUniforms.uTime.value = clock;
    swayTime.value = clock;
    waterUniforms.uLevel.value = level;
    waterUniforms.uShore.value = shoreRadius(level);
    waterline(layers, count, level, waterUniforms.uColumn.value);
    const hitCount = impacts(view);
    ripples(hitCount);
    splashes(hitCount, level);

    // Camera: follow the top, or pull back to show the whole tower in the
    // part of the screen no panel covers.
    const fit = fitDistance();
    const tall = top - Math.max(view.water * S, islandTop) + 2.4;
    const backFor = (tall / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)))) * 1.1;
    const free = 1 - Math.min(0.7, cover);
    const wantDist = (fit + (Math.max(fit, backFor) - fit) * overview) * (1 + overview * (1 / free - 1));
    const wantY = top + 0.55 - (top / 2 + 0.2) * overview;
    // Cut after cut, the tower wanders off the middle of the island, so the
    // camera follows the top layer's centre rather than the island's.
    const topLayer = layers[count - 1];
    const wantX = (topLayer?.x ?? 0) * S;
    const wantZ = (topLayer?.z ?? 0) * S;
    if (!cam.ready) {
      cam.y = wantY;
      cam.x = wantX;
      cam.z = wantZ;
      cam.dist = wantDist;
      cam.cover = cover;
      cam.ready = true;
    }
    const ease = 1 - Math.exp(-dt * 4);
    cam.y += (wantY - cam.y) * ease;
    cam.x += (wantX - cam.x) * ease;
    cam.z += (wantZ - cam.z) * ease;
    cam.dist += (wantDist - cam.dist) * ease;
    cam.cover += (Math.min(0.7, cover) - cam.cover) * (1 - Math.exp(-dt * 6));

    // The replay's free camera turns, tilts, zooms and lifts that, eased,
    // and eases back to it when it is let go.
    const want = view.orbit ?? NO_ORBIT;
    const glide = 1 - Math.exp(-dt * 12);
    orb.yaw += wrapAngle(want.yaw - orb.yaw) * glide;
    orb.pitch += (want.pitch - orb.pitch) * glide;
    orb.zoom += (want.zoom - orb.zoom) * glide;
    orb.lift += (want.lift - orb.lift) * glide;

    const dist = cam.dist * orb.zoom;
    const screen = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * dist;
    // Lifted no further than from the island to just over the top. The
    // clamped lift goes back into the orbit, so dragging back from past an
    // end moves the camera at once.
    const lo = islandTop - 0.5;
    const hi = Math.max(lo, top + 1);
    const ty = Math.min(hi, Math.max(lo, cam.y + orb.lift * screen));
    if (view.orbit && ty !== cam.y + orb.lift * screen) {
      orb.lift = (ty - cam.y) / screen;
      view.orbit.lift = orb.lift;
    }
    const rise = BASE_RISE + orb.pitch;
    const round = BASE_ROUND + orb.yaw;
    look3.set(Math.cos(rise) * Math.sin(round), Math.sin(rise), Math.cos(rise) * Math.cos(round));

    // Lower down the tower, nearer the base's centre: by the top's share of
    // the height, so the whole tower in view sits in the middle too.
    const along = top > 0 ? THREE.MathUtils.clamp(ty / top, 0, 1) : 0;
    const target = new THREE.Vector3(cam.x * along, ty, cam.z * along);
    camera.position.copy(target).addScaledVector(look3, dist);
    camera.lookAt(target);
    const covered = cam.cover > 0.002 ? cam.cover : 0;
    if (view.shot) {
      // On screen the picture sits a panel's half height down the view, so
      // the part no panel covers is the middle (1 - cover) of the view's
      // height, all of its width. The picture fits that above its band,
      // centred there, and zooms out (draws a bigger view) only if it has
      // to; whatever is round it is simply more of the scene.
      const band = Math.min(0.5, view.shot.band ?? 0);
      const tall = height * Math.max(1, (1 - covered) / (1 - band));
      const wide = (tall * width) / height;
      camera.setViewOffset(width, height, (width - wide) / 2, height / 2 - ((1 - band) * tall) / 2, wide, tall);
    } else if (covered) camera.setViewOffset(width, height, 0, (height * covered) / 2, width, height);
    else camera.clearViewOffset();

    scene.fog.near = dist * 2.5;
    scene.fog.far = dist * 9 + 30;
    waterUniforms.uNear.value = 5 + dist * 0.4;
    waterUniforms.uFar.value = 14 + dist * 1.1;

    // The sun's shadow square: round the target, big enough for the view,
    // in steps so it does not swim, its centre snapped to whole texels.
    const half = Math.ceil(THREE.MathUtils.clamp(dist * 0.55, 4, 18) / 2) * 2;
    const texel = (2 * half) / SHADOW_MAP;
    const onRight = target.dot(sunRight);
    const onUp = target.dot(sunUp);
    shadowAt.copy(target)
      .addScaledVector(sunRight, Math.round(onRight / texel) * texel - onRight)
      .addScaledVector(sunUp, Math.round(onUp / texel) * texel - onUp);
    const sc = sun.shadow.camera;
    if (sc.right !== half) {
      sc.left = sc.bottom = -half;
      sc.right = sc.top = half;
      sc.updateProjectionMatrix();
    }
    sun.position.copy(shadowAt).addScaledVector(SUN_FROM, 40);
    sun.target.position.copy(shadowAt);

    // Rain round where the camera looks, landing on the water, the island
    // and the top of the tower; the bolt out past the tower.
    const fp = topLayer ?? layers[0];
    footprint.set(fp.x * S, fp.z * S, (fp.sx * S) / 2, (fp.sz * S) / 2);
    // How much of the full view the picture shows, for a picture bigger
    // than the screen.
    const shown = camera.view?.enabled ? camera.view.height / camera.view.fullHeight : 1;
    rain.update({
      wet,
      clock,
      camera,
      target,
      level,
      footprint,
      top,
      colour: look.horizon,
      dark: look.dark,
      wind: weather?.wind ?? null,
      dt: fresh ? 0 : dt,
      strike,
      flash,
      pixel: (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * shown) / canvas.height,
    });
    skyUniforms.uFlash.value = flash * (0.5 + 0.5 * (strike?.near ?? 0)) * 0.7;
    if (flash > 0) {
      flashPoint.copy(rain.bolt.position).project(camera);
      skyUniforms.uFlashX.value = flashPoint.x * 0.5 + 0.5;
    }

    const fx = cam.x;
    const fz = cam.z;
    for (const c of clouds) {
      const u = c.userData;
      c.visible = u.shown;
      if (!u.shown) continue;
      // Along the wind, wrapping round past the far edge.
      const a = (((u.along + clock * u.speed + SPAN) % (2 * SPAN)) + 2 * SPAN) % (2 * SPAN) - SPAN;
      const x = fx + WIND.x * a + ACROSS.x * u.across;
      const z = fz + WIND.y * a + ACROSS.y * u.across;
      const bob = Math.sin(clock * 0.2 + u.phase) * 0.15;
      c.position.set(x, cam.y + u.rise + bob, z);
      const breathe = 1 + Math.sin(clock * 0.13 + u.phase * 2) * 0.05;
      c.scale.set(u.w * breathe, u.h * (2 - breathe), 1);
      const edge = 1 - THREE.MathUtils.smoothstep(Math.abs(a), SPAN * 0.7, SPAN);
      const fromTower = Math.hypot(x - fx, z - fz);
      const fromCamera = c.position.distanceTo(camera.position);
      const clear = THREE.MathUtils.smoothstep(fromTower, 3, 6) * THREE.MathUtils.smoothstep(fromCamera, u.w, u.w * 2);
      c.material.opacity = cloudOpacity * edge * clear;
      c.material.color.copy(cloudTint);
    }

    // The sky's own clouds and stars pan as the camera turns: a turn the
    // width of the view moves them a screen across.
    const across = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * camera.aspect);
    skyUniforms.uPan.value = -orb.yaw / across;
    skyUniforms.uPanPx.value = skyUniforms.uPan.value * width;
    skyUniforms.uTime.value = clock;
    skyUniforms.uPixel.value = renderer.getPixelRatio();
    skyUniforms.uAspect.value = camera.aspect;

    // The sun in the flat sky: across by how far round from the camera's
    // heading it is, a view's width a screen across as the clouds pan; up
    // by its own height. Behind the camera, no rays and no flare.
    camera.getWorldDirection(sunHeading);
    sunHeading.y = 0;
    sunHeading.normalize();
    sunSide.crossVectors(sunHeading, UP);
    const off = Math.atan2(glint.x * sunSide.x + glint.z * sunSide.z, glint.x * sunHeading.x + glint.z * sunHeading.z);
    skyUniforms.uSun.value.set(0.5 + off / across, sunSky.y);
    const facing = THREE.MathUtils.smoothstep(Math.cos(off), 0, 0.6);
    const paint = () => {
      renderer.clear();
      renderer.render(back, backCamera);
      renderer.render(scene, camera);
    };
    if (post) post.render(paint, { camera, sun: skyUniforms.uSun.value, facing, rays: raysLevel, flare: skyUniforms.uSunDisc.value, time: clock, flash });
    else paint();
  }

  // A picture bigger than the screen: the canvas's drawing buffer is
  // enlarged for one draw, copied onto a 2D canvas, and put back. The
  // post-processing targets follow the drawing buffer by themselves.
  // Whoever calls this draws the next frame straight after, in the same
  // task, so the enlarged picture never reaches the screen.
  //   long       pixels wanted along the picture's longer side
  //   maxPixels  no more pixels than this in all, to spare GPU memory
  // Returns the 2D canvas, or null if the picture could not be drawn.
  //   band(w, h) the height in pixels of the caption along the bottom of a
  //              w x h picture, which the scene is framed above
  function capture(view, { long, maxPixels }, band = () => 0) {
    resize();
    const gl = renderer.getContext();
    const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    const biggest = Math.min(
      gl.getParameter(gl.MAX_TEXTURE_SIZE),
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      viewport[0],
      viewport[1]
    );
    const before = renderer.getPixelRatio();
    const side = Math.max(width, height);
    const ratio = Math.max(
      before,
      Math.min(long / side, Math.sqrt(maxPixels / (width * height)), biggest / side)
    );
    try {
      renderer.setPixelRatio(ratio);
      draw({ ...view, shot: { band: band(canvas.width, canvas.height) / canvas.height } });
      const copy = document.createElement("canvas");
      copy.width = canvas.width;
      copy.height = canvas.height;
      copy.getContext("2d").drawImage(canvas, 0, 0);
      return copy;
    } catch (err) {
      console.error(err);
      return null;
    } finally {
      renderer.setPixelRatio(before);
    }
  }

  // Snaps the camera to wherever it is going on the next frame, for a jump
  // in the replay or a new game.
  function snapCamera() {
    cam.ready = false;
    wetReady = false;
  }

  readTheme();
  setQuality(quality);

  return { draw, capture, readTheme, snapCamera, setQuality, resize: () => { width = 0; resize(); } };
}
