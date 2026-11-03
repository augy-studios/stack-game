// Rain and lightning, for js/scene.js.
//
// Rain the way 3D games draw it: every drop a streak, as long as the
// distance it falls in the moment the eye takes it in, thin and faint,
// lit by the sky, and gone the instant it lands, where a splash takes its
// place. Here every drop has its own splash: a few droplets thrown up in a
// tiny crown that fall back at once, and on the water a ring spreading
// from where it went in, riding the waves. Nothing is worked out on the
// CPU: each drop's whole life, where it falls, where it lands (the water,
// the island's grass and sand, or the top of the tower) and its splash, is
// a function of the clock in the vertex shaders, so thousands cost almost
// nothing. The drops fill a box round where the camera looks, wrapping
// round its edges in the world, so they hold still as the camera moves.
// Low quality draws the drops but not their splashes. Now and then a
// gust of wind slants them, easing in and dying away.
//
// Lightning the way 3D games draw it: a jagged bolt made by halving its
// line again and again and pushing each middle sideways, less each time,
// with now and then a fork. A thin, white-hot core inside a soft blue
// glow, far brighter than white so the bloom spreads it, and it flickers:
// two to four return strokes down the same channel, a few tens of
// milliseconds apart, each lighting the clouds and the scene. Only on high
// quality's half float picture does it bloom; on low it is plain white.

import * as THREE from "three";

// Drops: how far one may fall before it is let go unseen, how long its
// splash lasts, in seconds, how fast it falls, in world units a second,
// and the length of its streak.
const FALL = 12;
const SPLASH = 0.55;
const SPEED = 7.5;
const STREAK = 0.26;
const WIDTH = 0.0065;
const RANGE = 7;
const DROPS = { high: 6000, low: 2000 };

const DROP_GLSL = (waves, island) => `
  uniform float uTime;
  uniform vec3 uCentre;
  uniform float uRange;
  uniform float uSpeed;
  uniform vec2 uWind;
  uniform float uLevel;
  uniform vec4 uTower;
  uniform float uTowerTop;
  uniform float uAmount;
  attribute vec4 aSeed;
  ${waves}
  ${island}

  const float FALL = ${FALL.toFixed(1)};
  const float SPLASH = ${SPLASH.toFixed(3)};

  // A drop's life this time round:
  //   p        where it set off, across
  //   age      seconds since it set off
  //   hit      the height it lands at
  //   fallT    seconds it takes to get there
  //   onWater  1 into the water, 0 onto something solid, -1 let go unseen
  void dropState(out vec2 p, out float age, out float hit, out float fallT, out float onWater) {
    float period = FALL / uSpeed + SPLASH;
    float local = uTime + aSeed.z * period;
    float cycle = floor(local / period);
    age = local - cycle * period;
    // Somewhere new every time round.
    vec2 r = fract(aSeed.xy + cycle * vec2(0.6180340, 0.7548777));
    float span = 2.0 * uRange;
    vec2 corner = uCentre.xz - uRange;
    p = corner + mod(r * span - corner, span);

    float top = uCentre.y;
    float guess = clamp((top - uLevel) / uSpeed, 0.0, FALL / uSpeed);
    vec2 q = p + uWind * guess;
    vec3 n;
    float water = uLevel + swell(q, uTime, n).y;
    float solid = -1000.0;
    float rr = islandRadius(q);
    if (rr < SAND_TOP_R) solid = ground(rr);
    vec2 inside = abs(q - uTower.xy) - uTower.zw;
    if (max(inside.x, inside.y) < 0.0) solid = max(solid, uTowerTop);
    onWater = solid > water ? 0.0 : 1.0;
    hit = max(water, solid);
    if (hit < top - FALL) {
      hit = top - FALL;
      onWater = -1.0;
    }
    fallT = (top - hit) / uSpeed;
  }
`;

const STREAK_VERTEX = (common) => `
  ${common}
  uniform float uLength;
  uniform float uWidth;
  uniform float uPixel;
  varying float vAcross;
  varying float vAlong;
  varying float vAlpha;
  void main() {
    vec2 p;
    float age, hit, fallT, onWater;
    dropState(p, age, hit, fallT, onWater);
    vec3 vel = vec3(uWind.x, -uSpeed, uWind.y);
    vec3 dir = normalize(vel);
    vec2 xz = p + uWind * age;
    vec3 head = vec3(xz.x, uCentre.y - uSpeed * age, xz.y);
    vec3 tail = head - dir * uLength;
    // Cut off where it lands: the tail follows the head in and is gone.
    head.y = max(head.y, hit);
    tail.y = max(tail.y, hit);
    vec3 mid = mix(head, tail, position.y);
    vec3 toCam = cameraPosition - mid;
    float dist = length(toCam);
    vec3 side = normalize(cross(dir, toCam));
    // Never thinner than a pixel and a bit; past that it fades instead,
    // as a far drop does.
    float w = max(uWidth, dist * uPixel * 1.7);
    float shown = step(aSeed.w, uAmount);
    // Faded at the box's sides, and right by the camera.
    vec2 off = abs(xz - uCentre.xz) / uRange;
    float edge = 1.0 - smoothstep(0.7, 1.0, max(off.x, off.y));
    float near = smoothstep(0.4, 1.4, dist);
    vAlpha = shown * edge * near * (uWidth / w) * (0.7 + 0.6 * fract(aSeed.w * 31.7));
    vAcross = position.x * 2.0;
    vAlong = position.y;
    vec3 at = mid + side * position.x * w;
    gl_Position = projectionMatrix * viewMatrix * vec4(at, 1.0);
  }
`;

const STREAK_FRAGMENT = `
  uniform vec3 uColour;
  uniform float uOpacity;
  uniform float uFlash;
  varying float vAcross;
  varying float vAlong;
  varying float vAlpha;
  void main() {
    float a = (1.0 - vAcross * vAcross) * (1.0 - 0.75 * vAlong) * vAlpha * uOpacity;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColour * (1.0 + uFlash * 0.5), a);
    #include <colorspace_fragment>
  }
`;

const SPLASH_VERTEX = (common) => `
  ${common}
  attribute float aPart;
  attribute vec2 aCorner;
  varying vec2 vUv;
  varying float vS;
  varying float vPart;
  varying float vRand;
  void main() {
    vec2 p;
    float age, hit, fallT, onWater;
    dropState(p, age, hit, fallT, onWater);
    float s = (age - fallT) / SPLASH;
    float on = step(0.0, s) * step(s, 1.0) * step(aSeed.w, uAmount) * step(0.0, onWater);
    vec2 at = p + uWind * fallT;
    float y = hit;
    // Into the water: on the waves as they are now, not as they were.
    if (onWater > 0.5) {
      vec3 n;
      y = uLevel + swell(at, uTime, n).y;
    }
    float size = 0.7 + 0.6 * fract(aSeed.w * 13.7);
    vec3 pos;
    if (aPart < 0.5) {
      // The ring, on the water only.
      on *= onWater;
      float r = (0.02 + 0.15 * sqrt(max(s, 0.0))) * size;
      pos = vec3(at.x + aCorner.x * r, y + 0.004, at.y + aCorner.y * r);
    } else {
      // The crown, stood up to face the camera.
      on *= step(s * 2.6, 1.0);
      vec3 base = vec3(at.x, y, at.y);
      vec2 h = normalize(cameraPosition.xz - base.xz + 1e-4);
      vec3 side = vec3(-h.y, 0.0, h.x);
      pos = base + side * aCorner.x * 0.05 * size + vec3(0.0, aCorner.y * 0.07 * size, 0.0);
    }
    vUv = aCorner;
    vS = s;
    vPart = aPart;
    vRand = aSeed.w;
    gl_Position = on > 0.5 ? projectionMatrix * viewMatrix * vec4(pos, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const SPLASH_FRAGMENT = `
  uniform vec3 uColour;
  uniform float uOpacity;
  uniform float uFlash;
  varying vec2 vUv;
  varying float vS;
  varying float vPart;
  varying float vRand;
  float rnd(float x) {
    return fract(sin(x * 12.9898 + vRand * 78.233) * 43758.5453);
  }
  void main() {
    float a = 0.0;
    if (vPart < 0.5) {
      // A ring, and a fainter one inside it once it has spread.
      float d = length(vUv);
      // Squared by hand: pow() of a negative number is undefined.
      float ro = (d - 0.8) * 9.0;
      float ri = (d - 0.42) * 12.0;
      float ring = exp(-ro * ro);
      float inner = exp(-ri * ri) * smoothstep(0.25, 0.6, vS) * 0.5;
      a = (ring + inner) * (1.0 - vS) * (1.0 - vS) * 0.5;
    } else {
      // Droplets thrown up and out on arcs, falling back as they go, and
      // the drop's own rebound, a little column, at the start.
      float k = clamp(vS * 2.6, 0.0, 1.0);
      for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float r = rnd(fi + 1.0);
        float out_ = (fi - 2.0) * 0.5 * (0.55 + 0.4 * r);
        float up = 0.7 + 0.3 * rnd(fi + 7.0);
        vec2 c = vec2(out_ * k * 0.9, up * 2.2 * k - 2.0 * k * k);
        float rad = 0.11 * (1.0 - 0.45 * k);
        a = max(a, 1.0 - smoothstep(rad * 0.5, rad, length((vUv - c) * vec2(1.0, 1.4))));
      }
      float column = (1.0 - smoothstep(0.03, 0.12, abs(vUv.x))) * (1.0 - smoothstep(0.0, 0.08, vUv.y - 0.7 * k * (1.0 - k) * 4.0 * 0.5));
      a = max(a, column * (1.0 - k));
      a *= (1.0 - k) * 0.8;
    }
    a *= uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColour * (1.0 + uFlash * 0.3), a);
    #include <colorspace_fragment>
  }
`;

const BOLT_VERTEX = `
  attribute float aAcross;
  attribute float aLevel;
  varying float vAcross;
  varying float vLevel;
  void main() {
    vAcross = aAcross;
    vLevel = aLevel;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The core is about a fifth of the ribbon's width; the rest is glow.
const BOLT_FRAGMENT = `
  uniform vec3 uCore;
  uniform vec3 uGlow;
  uniform float uBright;
  varying float vAcross;
  varying float vLevel;
  void main() {
    float x = abs(vAcross);
    float core = exp(-x * x * 60.0);
    float glow = exp(-x * x * 4.0);
    vec3 c = (uCore * core * 4.0 + uGlow * glow * 0.3) * vLevel * min(uBright, 0.75);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;

// A repeatable random sequence from a 32-bit seed.
function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// A bolt from the clouds, height high, down to 0, in its own x and y.
function boltGeometry(seed, height) {
  const rand = lcg(seed);
  let segs = [{
    a: [(rand() - 0.5) * height * 0.12, height],
    b: [(rand() - 0.5) * height * 0.3, 0],
    level: 1,
    width: 1,
  }];
  let offset = height * 0.16;
  for (let gen = 0; gen < 8; gen++) {
    const next = [];
    for (const s of segs) {
      const dx = s.b[0] - s.a[0];
      const dy = s.b[1] - s.a[1];
      const len = Math.hypot(dx, dy) || 1;
      const push = (rand() * 2 - 1) * offset * Math.sqrt(s.width);
      const mid = [(s.a[0] + s.b[0]) / 2 + (-dy / len) * push, (s.a[1] + s.b[1]) / 2 + (dx / len) * push];
      next.push({ ...s, b: mid }, { ...s, a: mid });
      // Now and then a fork, off at an angle, dimmer and thinner.
      if (gen >= 1 && gen < 6 && rand() < 0.2 * s.width) {
        const turn = (rand() < 0.5 ? -1 : 1) * (0.35 + rand() * 0.55);
        const mx = mid[0] - s.a[0];
        const my = mid[1] - s.a[1];
        const k = 0.8 + rand() * 0.9;
        const end = [
          mid[0] + (mx * Math.cos(turn) - my * Math.sin(turn)) * k,
          mid[1] + (mx * Math.sin(turn) + my * Math.cos(turn)) * k,
        ];
        next.push({ a: mid, b: end, level: s.level * 0.45, width: s.width * 0.5 });
      }
    }
    segs = next;
    offset *= 0.55;
  }

  const core = 0.045;
  const positions = [];
  const across = [];
  const levels = [];
  const index = [];
  for (const s of segs) {
    const dx = s.b[0] - s.a[0];
    const dy = s.b[1] - s.a[1];
    const len = Math.hypot(dx, dy) || 1;
    const half = core * 6 * Math.max(0.45, s.width);
    const nx = (-dy / len) * half;
    const ny = (dx / len) * half;
    // Stretched a little each way so the joints meet.
    const ex = (dx / len) * half * 0.15;
    const ey = (dy / len) * half * 0.15;
    const i = positions.length / 3;
    positions.push(
      s.a[0] - ex + nx, s.a[1] - ey + ny, 0,
      s.a[0] - ex - nx, s.a[1] - ey - ny, 0,
      s.b[0] + ex + nx, s.b[1] + ey + ny, 0,
      s.b[0] + ex - nx, s.b[1] + ey - ny, 0
    );
    across.push(1, -1, 1, -1);
    levels.push(s.level, s.level, s.level, s.level);
    index.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("aAcross", new THREE.Float32BufferAttribute(across, 1));
  geo.setAttribute("aLevel", new THREE.Float32BufferAttribute(levels, 1));
  geo.setIndex(index);
  return geo;
}

// How bright a strike is, age ms in: its return strokes, each a sharp
// flash that dies in a few tens of milliseconds, the later ones weaker.
export function flashOf(strike) {
  if (!strike) return 0;
  const rand = lcg(strike.seed);
  const strokes = 2 + Math.floor(rand() * 3);
  let at = 0;
  let level = 1;
  let f = 0;
  for (let i = 0; i < strokes; i++) {
    const u = strike.age - at;
    if (u >= 0) f += level * Math.exp(-u / (i === 0 ? 55 : 40));
    at += 55 + rand() * 110;
    level *= 0.55 + rand() * 0.35;
  }
  // The channel glows faintly between strokes, and fades out at the end.
  const fadeOut = 1 - THREE.MathUtils.smoothstep(strike.age, 420, 650);
  return Math.min(1.4, f + 0.12 * fadeOut) * fadeOut;
}

export function createRain(scene, { waves, island }) {
  const common = DROP_GLSL(waves, island);
  const uniforms = {
    uTime: { value: 0 },
    uCentre: { value: new THREE.Vector3() },
    uRange: { value: RANGE },
    uSpeed: { value: SPEED },
    uWind: { value: CALM.clone() },
    uLevel: { value: 0 },
    uTower: { value: new THREE.Vector4() },
    uTowerTop: { value: 0 },
    uAmount: { value: 0 },
    uLength: { value: STREAK },
    uWidth: { value: WIDTH },
    uPixel: { value: 0.001 },
    uColour: { value: new THREE.Color(0xdfe8f2) },
    uOpacity: { value: 0.75 },
    uFlash: { value: 0 },
  };
  const splashUniforms = { ...uniforms, uOpacity: { value: 0.6 }, uColour: { value: new THREE.Color(0xeef6ff) } };

  const seeds = new Float32Array(DROPS.high * 4);
  {
    const rand = lcg(20261103);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
  }
  const seedAttr = new THREE.InstancedBufferAttribute(seeds, 4);

  // A streak: a strip one unit long, its head at y = 0.
  const streakGeo = new THREE.InstancedBufferGeometry();
  streakGeo.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
  streakGeo.setIndex([0, 1, 2, 1, 3, 2]);
  streakGeo.setAttribute("aSeed", seedAttr);
  const streakMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: STREAK_VERTEX(common),
    fragmentShader: STREAK_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const streaks = new THREE.Mesh(streakGeo, streakMat);

  // A splash: a flat square for its ring and a standing one for its crown.
  const splashGeo = new THREE.InstancedBufferGeometry();
  splashGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Array(24).fill(0), 3));
  splashGeo.setAttribute("aCorner", new THREE.Float32BufferAttribute([-1, -1, 1, -1, -1, 1, 1, 1, -1, 0, 1, 0, -1, 1, 1, 1], 2));
  splashGeo.setAttribute("aPart", new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 1, 1, 1], 1));
  splashGeo.setIndex([0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6]);
  splashGeo.setAttribute("aSeed", seedAttr);
  const splashMat = new THREE.ShaderMaterial({
    uniforms: splashUniforms,
    vertexShader: SPLASH_VERTEX(common),
    fragmentShader: SPLASH_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const splashes = new THREE.Mesh(splashGeo, splashMat);

  for (const m of [streaks, splashes]) {
    m.frustumCulled = false;
    m.renderOrder = 4;
    m.visible = false;
    scene.add(m);
  }

  // The bolt, built afresh for each strike.
  const boltMat = new THREE.ShaderMaterial({
    uniforms: {
      uCore: { value: new THREE.Color(1, 1, 1) },
      uGlow: { value: new THREE.Color(0.55, 0.65, 1.0) },
      uBright: { value: 0 },
    },
    vertexShader: BOLT_VERTEX,
    fragmentShader: BOLT_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const bolt = new THREE.Mesh(new THREE.BufferGeometry(), boltMat);
  bolt.frustumCulled = false;
  bolt.renderOrder = 1;
  bolt.visible = false;
  scene.add(bolt);
  let boltSeed = null;
  const boltAway = new THREE.Vector2();
  // Short enough that the whole of it, forks and all, fits in the band
  // of sky and far sea the camera sees past the tower.
  const BOLT_HEIGHT = 13;

  let quality = "high";
  function setQuality(value) {
    quality = value === "low" ? "low" : "high";
  }

  // Each frame:
  //   wet       0 for dry, up to 1 for a storm
  //   clock     real seconds
  //   camera    the camera, placed
  //   target    the point it looks at
  //   level     the water's height
  //   footprint the top layer: x, z, half its width and depth
  //   top       the top of the tower
  //   colour    the sky's horizon colour, which the drops are tinted by
  //   strike    the lightning strike, or null; flash, how bright it is
  //   pixel     how wide one pixel is at a unit's distance
  //   dark      the theme is dark
  //   wind      the gust blowing, { strength, angle }, or null
  //   dt        real seconds since the last frame, 0 to snap
  const windNow = CALM.clone();
  const windWant = new THREE.Vector2();
  function update({ wet, clock, camera, target, level, footprint, top, colour, strike, flash, pixel, dark = false, wind = null, dt = 0.016 }) {
    const raining = wet > 0.005;
    streaks.visible = raining;
    // Low quality has the rain but not the splashes.
    splashes.visible = raining && quality === "high";
    // A gust, eased into and out of, so a jump in the replay does not
    // swing every drop at once.
    windWant.copy(CALM);
    if (wind?.strength) windWant.add(new THREE.Vector2(Math.cos(wind.angle), Math.sin(wind.angle)).multiplyScalar(GUST * wind.strength));
    windNow.lerp(windWant, dt > 0 ? 1 - Math.exp(-dt * 2.5) : 1);
    uniforms.uWind.value.copy(windNow);
    if (raining) {
      const n = DROPS[quality];
      streakGeo.instanceCount = splashGeo.instanceCount = n;
      uniforms.uTime.value = clock;
      uniforms.uAmount.value = wet;
      uniforms.uLevel.value = level;
      uniforms.uPixel.value = pixel;
      uniforms.uTower.value.copy(footprint);
      uniforms.uTowerTop.value = top;
      // A little towards the camera from what it looks at, where the
      // drops show most.
      const c = uniforms.uCentre.value;
      c.set(target.x + (camera.position.x - target.x) * 0.35, target.y + 4.5, target.z + (camera.position.z - target.z) * 0.35);
      // A cool grey a shade off the sky's: against a pale sky and sea a
      // drop shows darker, as rain does against a bright sky, and against
      // the tower lighter.
      uniforms.uColour.value.copy(colour).lerp(RAIN_GREY, 0.5).multiplyScalar(dark ? 1.25 : 0.8);
      splashUniforms.uColour.value.copy(colour).lerp(WHITE, 0.75);
      uniforms.uFlash.value = flash;
      // Low quality's drops are a pixel wide on a screen with no
      // post-processing, so they need more to show.
      uniforms.uOpacity.value = quality === "low" ? 1 : 0.75;
    }

    bolt.visible = Boolean(strike) && flash > 0.001;
    if (!bolt.visible) return;
    if (strike.seed !== boltSeed) {
      boltSeed = strike.seed;
      bolt.geometry.dispose();
      bolt.geometry = boltGeometry(strike.seed, BOLT_HEIGHT);
      // Out past the tower, the way the camera looks, off to one side.
      boltAway.set(target.x - camera.position.x, target.z - camera.position.z).normalize();
    }
    // The camera looks down on the tower, so the sky past it is out of
    // the picture: the bolt comes down into the far sea, where it fades
    // into the haze at the top of the view.
    const far = 16 + 10 * (1 - strike.near);
    const side = strike.side * 8 + Math.sign(strike.side || 1) * 4;
    bolt.position.set(
      target.x + boltAway.x * far - boltAway.y * side,
      level - 1,
      target.z + boltAway.y * far + boltAway.x * side
    );
    bolt.lookAt(camera.position.x, bolt.position.y, camera.position.z);
    boltMat.uniforms.uBright.value = flash * (0.55 + 0.45 * strike.near);
  }

  return { update, setQuality, bolt };
}

const WHITE = new THREE.Color(1, 1, 1);
// The wind the rain falls in when no gust blows, and how fast a full gust
// pushes it across, in world units a second: about a fifth of the speed it
// falls, so the drops slant by up to about a quarter turn of a right angle.
const CALM = new THREE.Vector2(0.38, 0.14);
const GUST = 2.3;
const RAIN_GREY = new THREE.Color(0.62, 0.68, 0.76);
