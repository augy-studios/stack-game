// Post-processing for high quality: the scene is drawn into an offscreen,
// multisampled, half-float picture with its depth, then finished on its way
// to the screen.
//
//   occlusion  soft contact shadows where surfaces meet: under each slab's
//              lip, where the tower stands on the grass, round the rocks.
//              Worked out from the depth at half size, a hemisphere of
//              samples round each point, then blurred.
//   god rays   light shafts. Whatever bright sky and water shows past the
//              tower and the island is smeared towards the sun, so beams
//              fan out round their silhouettes. A quarter-size radial blur.
//   lens flare when the sun is in view, or just past the edge, and not
//              hidden behind the tower or a cloud: glare and a starburst
//              round it, a streak across, a faint halo ring, and ghosts
//              strung through the middle of the screen. How much of the
//              sun shows is measured each frame into a single pixel, eased
//              so it fades as the tower slides across it.
//   bloom      whatever is brighter than white, mostly the sun's path on the
//              water, the foam and the sunlit tops, glows softly into what
//              is round it. A bright pass at half size, blurred down a chain
//              of smaller and smaller copies and added back up again.
//   grade      a touch more colour and contrast, kept pastel.
//   vignette   the corners a shade darker, so the eye goes to the tower.
//   dither     a speck of noise, under one step of the screen's colour, so
//              the sky's long gradient shows no bands.
//
// The picture is drawn linear and only turned to sRGB at the end, so the
// light adds the way light adds. Low quality never makes one of these and
// draws straight to the screen.

import * as THREE from "three";

const LEVELS = 5;
const THRESHOLD = 0.92;
const KNEE = 0.45;
const BLOOM = 0.4;
const CEILING = 1.6;
const SATURATION = 1.06;
const CONTRAST = 1.04;
const VIGNETTE = 0.25;

// Occlusion: how far round a point it looks, in world units (a layer is
// 0.2 tall), how dark a fully hidden corner goes, and how many samples.
const AO_RADIUS = 0.32;
const AO_STRENGTH = 0.85;
const AO_SAMPLES = 12;

// God rays: how far each pixel looks back towards the sun, as a share of
// the way there, how fast each step fades, and how bright the beams.
const RAY_SAMPLES = 48;
const RAY_DENSITY = 0.95;
const RAY_DECAY = 0.968;
const RAYS = 0.75;

// Lens flare: how bright, and the sun's radius on screen, as a share of
// the screen's height, that is looked at to see how much of it shows.
const FLARE = 1.0;
const SUN_RADIUS = 0.022;
const RAY_TINT = new THREE.Color(1.0, 0.96, 0.86);

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// The bright parts, at half size: four taps, each weighed down by its own
// brightness so one hot pixel of glint does not flicker as a blob.
const BRIGHT = /* glsl */ `
  uniform sampler2D uSource;
  uniform vec2 uTexel;
  uniform float uThreshold;
  uniform float uKnee;
  uniform float uCeiling;
  varying vec2 vUv;

  // How far past the threshold, eased in over the knee, and no further
  // than the ceiling, so the sun's glint glows rather than flares.
  vec3 bright(vec3 c) {
    c = min(c, vec3(uCeiling));
    float l = max(c.r, max(c.g, c.b));
    float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-4);
    float keep = max(soft, l - uThreshold) / max(l, 1e-4);
    return c * keep;
  }

  vec3 tap(vec2 at) {
    vec3 c = bright(texture2D(uSource, at).rgb);
    return c / (1.0 + max(c.r, max(c.g, c.b)));
  }

  void main() {
    vec2 d = uTexel * 0.5;
    vec3 c = tap(vUv + vec2(-d.x, -d.y)) + tap(vUv + vec2(d.x, -d.y))
           + tap(vUv + vec2(-d.x, d.y)) + tap(vUv + vec2(d.x, d.y));
    c *= 0.25;
    gl_FragColor = vec4(c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-3), 1.0);
  }
`;

// Down a level: the dual filter's five taps, the middle weighed four times.
const DOWN = /* glsl */ `
  uniform sampler2D uSource;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec2 d = uTexel;
    vec3 c = texture2D(uSource, vUv).rgb * 4.0;
    c += texture2D(uSource, vUv + vec2(-d.x, -d.y)).rgb;
    c += texture2D(uSource, vUv + vec2(d.x, -d.y)).rgb;
    c += texture2D(uSource, vUv + vec2(-d.x, d.y)).rgb;
    c += texture2D(uSource, vUv + vec2(d.x, d.y)).rgb;
    gl_FragColor = vec4(c / 8.0, 1.0);
  }
`;

// Up a level, added onto the bigger copy: a tent of eight taps.
const UP = /* glsl */ `
  uniform sampler2D uSource;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec2 d = uTexel;
    vec3 c = texture2D(uSource, vUv + vec2(-2.0 * d.x, 0.0)).rgb;
    c += texture2D(uSource, vUv + vec2(2.0 * d.x, 0.0)).rgb;
    c += texture2D(uSource, vUv + vec2(0.0, -2.0 * d.y)).rgb;
    c += texture2D(uSource, vUv + vec2(0.0, 2.0 * d.y)).rgb;
    c += texture2D(uSource, vUv + vec2(-d.x, -d.y)).rgb * 2.0;
    c += texture2D(uSource, vUv + vec2(d.x, -d.y)).rgb * 2.0;
    c += texture2D(uSource, vUv + vec2(-d.x, d.y)).rgb * 2.0;
    c += texture2D(uSource, vUv + vec2(d.x, d.y)).rgb * 2.0;
    gl_FragColor = vec4(c / 12.0, 1.0);
  }
`;

// Occlusion at half size. Each point's place in view space comes back out
// of the depth; its normal from the nearer of its neighbours on each side,
// so edges do not smear. Samples in a hemisphere round that normal, turned
// a little differently per pixel, count as hidden where the scene in front
// of them is nearer the camera, unless it is far nearer, which is another
// object altogether.
const AO = /* glsl */ `
  #define SAMPLES ${AO_SAMPLES}
  uniform sampler2D uDepth;
  uniform mat4 uProjection;
  uniform mat4 uInverseProjection;
  uniform vec2 uTexel;
  uniform float uRadius;
  uniform float uFar;
  varying vec2 vUv;

  vec3 viewAt(vec2 uv, float depth) {
    vec4 p = uInverseProjection * vec4(vec3(uv, depth) * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
  }

  vec3 viewAt(vec2 uv) {
    return viewAt(uv, texture2D(uDepth, uv).r);
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    float depth = texture2D(uDepth, vUv).r;
    if (depth >= 0.99999) {
      gl_FragColor = vec4(1.0);
      return;
    }
    vec3 p = viewAt(vUv, depth);

    vec3 l = viewAt(vUv - vec2(uTexel.x, 0.0));
    vec3 r = viewAt(vUv + vec2(uTexel.x, 0.0));
    vec3 b = viewAt(vUv - vec2(0.0, uTexel.y));
    vec3 t = viewAt(vUv + vec2(0.0, uTexel.y));
    vec3 dx = abs(p.z - l.z) < abs(r.z - p.z) ? p - l : r - p;
    vec3 dy = abs(p.z - b.z) < abs(t.z - p.z) ? p - b : t - p;
    vec3 n = normalize(cross(dx, dy));

    float spin = hash(gl_FragCoord.xy) * 6.2831853;
    vec3 seed = normalize(vec3(cos(spin), sin(spin), 0.3));
    vec3 tangent = normalize(seed - n * dot(seed, n));
    vec3 bitangent = cross(n, tangent);

    float hidden = 0.0;
    for (int i = 0; i < SAMPLES; i++) {
      float fi = float(i);
      // A spiral through the hemisphere, denser near the middle.
      float a = fi * 2.3999632;
      float rr = (fi + 0.5) / float(SAMPLES);
      float up = sqrt(1.0 - rr);
      vec3 dir = tangent * cos(a) * sqrt(rr) + bitangent * sin(a) * sqrt(rr) + n * up;
      vec3 s = p + dir * uRadius * mix(0.2, 1.0, rr * rr);

      vec4 clip = uProjection * vec4(s, 1.0);
      vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
      if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
      float sceneZ = viewAt(suv).z;
      float near = smoothstep(0.0, 1.0, uRadius / abs(p.z - sceneZ));
      hidden += (sceneZ >= s.z + 0.01 ? 1.0 : 0.0) * near;
    }
    float ao = 1.0 - hidden / float(SAMPLES);
    // Fades with distance, where it would only be noise.
    ao = mix(ao, 1.0, smoothstep(uFar * 0.5, uFar, -p.z));
    gl_FragColor = vec4(vec3(ao), 1.0);
  }
`;

// Blurs the occlusion over a few texels, keeping to samples at much the
// same depth so it does not bleed over an edge into the sky.
const AO_BLUR = /* glsl */ `
  uniform sampler2D uSource;
  uniform sampler2D uDepth;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    float d0 = texture2D(uDepth, vUv).r;
    float sum = 0.0;
    float weight = 0.0;
    for (int x = -2; x <= 2; x++) {
      for (int y = -2; y <= 2; y++) {
        vec2 at = vUv + vec2(float(x), float(y)) * uTexel;
        float w = 1.0 - smoothstep(0.0, 0.002, abs(texture2D(uDepth, at).r - d0));
        sum += texture2D(uSource, at).r * w;
        weight += w;
      }
    }
    gl_FragColor = vec4(vec3(sum / max(weight, 1e-4)), 1.0);
  }
`;

// God rays at quarter size. What lights them: the sky and the water (the
// water writes no depth, so it reads as far off), as bright as they are
// past a threshold; nothing solid does. Each pixel then walks back towards
// the sun, adding up what lights them on the way, each step fainter.
const RAY_SOURCE = /* glsl */ `
  uniform sampler2D uScene;
  uniform sampler2D uDepth;
  varying vec2 vUv;
  void main() {
    float open = step(0.99999, texture2D(uDepth, vUv).r);
    vec3 c = min(texture2D(uScene, vUv).rgb, vec3(1.3));
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(c * smoothstep(0.85, 1.3, l) * open, 1.0);
  }
`;

const RAY_BLUR = /* glsl */ `
  #define SAMPLES ${RAY_SAMPLES}
  uniform sampler2D uSource;
  uniform vec2 uSun;
  uniform float uDensity;
  uniform float uDecay;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 stride = (vUv - uSun) * uDensity / float(SAMPLES);
    vec2 at = vUv - stride * hash(gl_FragCoord.xy);
    float fade = 1.0;
    vec3 sum = vec3(0.0);
    for (int i = 0; i < SAMPLES; i++) {
      at -= stride;
      sum += texture2D(uSource, clamp(at, 0.0, 1.0)).rgb * fade;
      fade *= uDecay;
    }
    gl_FragColor = vec4(sum / float(SAMPLES), 1.0);
  }
`;

// How much of the sun shows: a grid of taps over its disc, each counting
// where it is open sky (no depth) and still bright (no cloud over it).
// Taps past the screen's edge count as showing, so the flare fades by
// how far off the screen the sun is rather than by a guess. Drawn into
// one pixel with blending, so it eases from frame to frame.
const SUN_VISIBLE = /* glsl */ `
  uniform sampler2D uScene;
  uniform sampler2D uDepth;
  uniform vec2 uSun;
  uniform vec2 uRadius;
  uniform vec2 uLit;
  varying vec2 vUv;
  void main() {
    float seen = 0.0;
    for (int x = -2; x <= 2; x++) {
      for (int y = -2; y <= 2; y++) {
        vec2 at = uSun + vec2(float(x), float(y)) * 0.5 * uRadius;
        if (at.x < 0.0 || at.x > 1.0 || at.y < 0.0 || at.y > 1.0) {
          seen += 1.0;
          continue;
        }
        float open = step(0.99999, texture2D(uDepth, at).r);
        float l = dot(texture2D(uScene, at).rgb, vec3(0.2126, 0.7152, 0.0722));
        seen += open * smoothstep(uLit.x, uLit.y, l);
      }
    }
    gl_FragColor = vec4(vec3(seen / 25.0), 0.18);
  }
`;

// The finish, onto the screen.
const FINISH = /* glsl */ `
  uniform sampler2D uScene;
  uniform sampler2D uBloom;
  uniform sampler2D uAO;
  uniform sampler2D uRays;
  uniform sampler2D uDepth;
  uniform sampler2D uVisible;
  uniform vec2 uSun;
  uniform float uFlare;
  uniform float uBloomStrength;
  uniform float uAOStrength;
  uniform float uRayStrength;
  uniform vec3 uRayTint;
  uniform float uSaturation;
  uniform float uContrast;
  uniform float uVignette;
  uniform vec2 uSize;
  uniform float uTime;
  varying vec2 vUv;

  float noise(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  // A soft disc for a ghost, brighter at its rim, as the lens's iris
  // makes them.
  float ghost(vec2 at, vec2 centre, float r, float aspect) {
    float d = length((at - centre) * vec2(aspect, 1.0));
    float body = 1.0 - smoothstep(r * 0.7, r, d);
    float rim = exp(-pow((d - r * 0.9) / (r * 0.12), 2.0));
    return body * 0.6 + rim * 0.5;
  }

  // The flare at a point, for the sun at uSun, before its strength.
  vec3 flare(vec2 at, float aspect) {
    vec2 p = (at - uSun) * vec2(aspect, 1.0);
    float r = length(p);
    vec3 warm = vec3(1.0, 0.93, 0.8);

    // Glare round the sun, and a starburst of six spikes, the second set
    // finer and turned.
    vec3 c = warm * exp(-r * 30.0) * 0.25;
    float a = atan(p.y, p.x);
    float spikes = pow(abs(cos(a * 3.0 + 0.3)), 60.0) + 0.5 * pow(abs(cos(a * 3.0 + 0.82)), 120.0);
    c += warm * spikes * exp(-r * 6.0) * 0.35;

    // A thin streak across, blue-white.
    c += vec3(0.75, 0.85, 1.0) * exp(-abs(p.y) * 160.0) * exp(-abs(p.x) * 2.2) * 0.22;

    // A faint ring round it, each colour at its own radius.
    vec3 ring = vec3(
      exp(-pow((r - 0.36) * 34.0, 2.0)),
      exp(-pow((r - 0.345) * 34.0, 2.0)),
      exp(-pow((r - 0.33) * 34.0, 2.0)));
    c += ring * 0.05;

    // Ghosts along the line from the sun through the middle of the screen.
    vec2 axis = vec2(0.5) - uSun;
    c += vec3(0.65, 0.9, 1.0) * ghost(at, uSun + axis * 0.45, 0.035, aspect) * 0.12;
    c += vec3(1.0, 0.8, 0.55) * ghost(at, uSun + axis * 0.8, 0.07, aspect) * 0.06;
    c += vec3(0.7, 1.0, 0.75) * ghost(at, uSun + axis * 1.25, 0.025, aspect) * 0.14;
    c += vec3(0.85, 0.7, 1.0) * ghost(at, uSun + axis * 1.55, 0.11, aspect) * 0.045;
    c += vec3(1.0, 0.75, 0.7) * ghost(at, uSun + axis * 2.1, 0.05, aspect) * 0.09;
    c += vec3(0.7, 0.85, 1.0) * ghost(at, uSun + axis * 2.45, 0.16, aspect) * 0.03;
    return c;
  }

  void main() {
    // Clipped as the screen would have clipped it without all this, so the
    // scene keeps its colours, then shaded and lit on top.
    vec3 c = min(texture2D(uScene, vUv).rgb, vec3(1.0));
    c *= mix(1.0, texture2D(uAO, vUv).r, uAOStrength);
    // The beams show in the air over the sky and the water; over something
    // solid only faintly, so they do not streak down the tower.
    float open = step(0.99999, texture2D(uDepth, vUv).r);
    c += texture2D(uRays, vUv).rgb * uRayTint * uRayStrength * mix(0.45, 1.0, open);
    c += texture2D(uBloom, vUv).rgb * uBloomStrength;

    float seen = uFlare * texture2D(uVisible, vec2(0.5)).r;
    if (seen > 0.002) c += flare(vUv, uSize.x / uSize.y) * seen;

    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSaturation);
    c = (c - 0.18) * uContrast + 0.18;

    vec2 v = (vUv - 0.5) * vec2(uSize.x / uSize.y, 1.0);
    c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(v));

    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    #include <colorspace_fragment>

    float n = noise(vUv * uSize + fract(uTime) * 61.0) + noise(vUv * uSize * 1.37 - fract(uTime) * 17.0) - 1.0;
    gl_FragColor.rgb += n / 255.0;
  }
`;

// One triangle over the whole screen.
function screenTriangle() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return geo;
}

function pass(fragmentShader, uniforms, extra = {}) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    ...extra,
  });
}

export function createPost(renderer) {
  // Half float where the device can draw into it, so brighter than white
  // survives to the bloom; plain bytes otherwise, where the bloom still
  // picks up what is close to white.
  const gl = renderer.getContext();
  const half = !!(renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float"));
  const type = half ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
  const linear = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };

  const sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type, samples, depthBuffer: true });
  sceneTarget.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  const depth = sceneTarget.depthTexture;
  const levels = Array.from({ length: LEVELS }, () => new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: false, ...linear }));
  const aoTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, ...linear });
  const aoBlurred = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, ...linear });
  const raySource = new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: false, ...linear });
  const rays = new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: false, ...linear });
  const visible = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });

  const texel = () => ({ value: new THREE.Vector2() });
  const brightMat = pass(BRIGHT, {
    uSource: { value: sceneTarget.texture },
    uTexel: texel(),
    uThreshold: { value: half ? THRESHOLD : THRESHOLD * 0.85 },
    uKnee: { value: KNEE },
    uCeiling: { value: CEILING },
  });
  const downMat = pass(DOWN, { uSource: { value: null }, uTexel: texel() });
  const upMat = pass(UP, { uSource: { value: null }, uTexel: texel() }, {
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
  const aoMat = pass(AO, {
    uDepth: { value: depth },
    uProjection: { value: new THREE.Matrix4() },
    uInverseProjection: { value: new THREE.Matrix4() },
    uTexel: texel(),
    uRadius: { value: AO_RADIUS },
    uFar: { value: 40 },
  });
  const aoBlurMat = pass(AO_BLUR, { uSource: { value: aoTarget.texture }, uDepth: { value: depth }, uTexel: texel() });
  const raySourceMat = pass(RAY_SOURCE, { uScene: { value: sceneTarget.texture }, uDepth: { value: depth } });
  const rayBlurMat = pass(RAY_BLUR, {
    uSource: { value: raySource.texture },
    uSun: { value: new THREE.Vector2(0.5, 1.5) },
    uDensity: { value: RAY_DENSITY },
    uDecay: { value: RAY_DECAY },
  });
  // With half float the sun stands out brighter than anything round it,
  // so a cloud over it shows; in plain bytes everything stops at white,
  // and only the tower and the island hide it.
  const sunVisibleMat = pass(SUN_VISIBLE, {
    uScene: { value: sceneTarget.texture },
    uDepth: { value: depth },
    uSun: { value: new THREE.Vector2(0.5, 0.7) },
    uRadius: { value: new THREE.Vector2(SUN_RADIUS, SUN_RADIUS) },
    uLit: { value: half ? new THREE.Vector2(1.02, 1.3) : new THREE.Vector2(-1, 0) },
  }, { transparent: true, blending: THREE.NormalBlending });
  const finishMat = pass(FINISH, {
    uScene: { value: sceneTarget.texture },
    uBloom: { value: levels[0].texture },
    uAO: { value: aoBlurred.texture },
    uRays: { value: rays.texture },
    uDepth: { value: depth },
    uVisible: { value: visible.texture },
    uSun: { value: new THREE.Vector2(0.5, 0.7) },
    uFlare: { value: 0 },
    uBloomStrength: { value: BLOOM },
    uAOStrength: { value: AO_STRENGTH },
    uRayStrength: { value: 0 },
    uRayTint: { value: RAY_TINT },
    uSaturation: { value: SATURATION },
    uContrast: { value: CONTRAST },
    uVignette: { value: VIGNETTE },
    uSize: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
  });

  const quad = new THREE.Mesh(screenTriangle(), brightMat);
  quad.frustumCulled = false;
  const screen = new THREE.Scene();
  screen.add(quad);
  const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const size = new THREE.Vector2();
  let w = 0;
  let h = 0;

  // Matches the targets to the canvas's drawing buffer, pixel ratio and all.
  function fit() {
    renderer.getDrawingBufferSize(size);
    if (size.x === w && size.y === h) return;
    w = size.x;
    h = size.y;
    sceneTarget.setSize(w, h);
    let lw = w;
    let lh = h;
    for (const level of levels) {
      lw = Math.max(1, Math.floor(lw / 2));
      lh = Math.max(1, Math.floor(lh / 2));
      level.setSize(lw, lh);
    }
    const hw = Math.max(1, Math.floor(w / 2));
    const hh = Math.max(1, Math.floor(h / 2));
    aoTarget.setSize(hw, hh);
    aoBlurred.setSize(hw, hh);
    const qw = Math.max(1, Math.floor(w / 4));
    const qh = Math.max(1, Math.floor(h / 4));
    raySource.setSize(qw, qh);
    rays.setSize(qw, qh);
    finishMat.uniforms.uSize.value.set(w, h);
  }

  function run(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(screen, flat);
  }

  // Draws whatever draw() draws into the offscreen picture, then finishes
  // it onto the screen.
  //   camera     the camera draw() drew with
  //   sun        where the sun is on the screen, 0 to 1 across and up,
  //              which may be off it
  //   facing     0 to 1, how much the camera faces the sun: 0 once it
  //              is behind
  //   rays       how bright the rays are, 0 to 1, for the theme
  //   flare      how bright the lens flare is, 0 to 1, for the theme and
  //              the weather
  //   time       seconds, for the dither
  //   flash      0 to about 1.4, a lightning strike: the bloom lets more
  //              of the brightest through, so the bolt glows, but not so
  //              much that its jagged core is lost in it
  function render(draw, { camera, sun, facing = 1, rays: rayLevel = 1, flare = 1, time = 0, flash = 0 }) {
    fit();
    renderer.setRenderTarget(sceneTarget);
    draw();

    // Occlusion.
    aoMat.uniforms.uProjection.value.copy(camera.projectionMatrix);
    aoMat.uniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse);
    aoMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    aoMat.uniforms.uFar.value = camera.position.length() + 20;
    run(aoMat, aoTarget);
    aoBlurMat.uniforms.uTexel.value.set(1 / aoTarget.width, 1 / aoTarget.height);
    run(aoBlurMat, aoBlurred);

    // God rays, from wherever the sun lands on the screen, on or off it.
    // Fading out as the camera turns away from it, and off once it is
    // behind.
    const strength = rayLevel * facing;
    finishMat.uniforms.uRayStrength.value = strength * RAYS;
    if (strength > 0.001) {
      rayBlurMat.uniforms.uSun.value.copy(sun);
      run(raySourceMat, raySource);
      run(rayBlurMat, rays);
    }

    // Lens flare: how much of the sun shows, eased into its one pixel,
    // and how far off the screen it is.
    const outside = Math.max(0, -sun.x, sun.x - 1, -sun.y, sun.y - 1);
    const flareStrength = flare * facing * (1 - THREE.MathUtils.smoothstep(outside, 0, 0.3)) * FLARE;
    finishMat.uniforms.uFlare.value = flareStrength;
    finishMat.uniforms.uSun.value.copy(sun);
    sunVisibleMat.uniforms.uSun.value.copy(sun);
    sunVisibleMat.uniforms.uRadius.value.set(SUN_RADIUS * h / w, SUN_RADIUS);
    run(sunVisibleMat, visible);

    // Bloom.
    brightMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    brightMat.uniforms.uCeiling.value = CEILING + flash * 0.9;
    run(brightMat, levels[0]);
    for (let i = 1; i < LEVELS; i++) {
      downMat.uniforms.uSource.value = levels[i - 1].texture;
      downMat.uniforms.uTexel.value.set(1 / levels[i - 1].width, 1 / levels[i - 1].height);
      run(downMat, levels[i]);
    }
    for (let i = LEVELS - 1; i > 0; i--) {
      upMat.uniforms.uSource.value = levels[i].texture;
      upMat.uniforms.uTexel.value.set(1 / levels[i].width, 1 / levels[i].height);
      run(upMat, levels[i - 1]);
    }

    finishMat.uniforms.uTime.value = time;
    run(finishMat, null);
  }

  function dispose() {
    [sceneTarget, aoTarget, aoBlurred, raySource, rays, visible, ...levels].forEach((t) => t.dispose());
    depth.dispose();
    [brightMat, downMat, upMat, aoMat, aoBlurMat, raySourceMat, rayBlurMat, sunVisibleMat, finishMat].forEach((m) => m.dispose());
    quad.geometry.dispose();
  }

  return { render, dispose };
}
