// Post-processing for high quality: the scene is drawn into an offscreen,
// multisampled, half-float picture, then finished on its way to the screen
// with a soft bloom, a gentle grade, a vignette and a little dither.
//
//   bloom     whatever is brighter than white, mostly the sun's path on the
//             water, the foam and the sunlit tops, glows softly into what is
//             round it. A bright pass at half size, blurred down a chain of
//             smaller and smaller copies and added back up again.
//   grade     a touch more colour and contrast, kept pastel.
//   vignette  the corners a shade darker, so the eye goes to the tower.
//   dither    a speck of noise, under one step of the screen's colour, so the
//             sky's long gradient shows no bands.
//
// The picture is drawn linear and only turned to sRGB at the end, so the
// bloom adds light the way light adds. Low quality never makes one of these
// and draws straight to the screen as before.

import * as THREE from "three";

const LEVELS = 5;
const THRESHOLD = 0.92;
const KNEE = 0.45;
const BLOOM = 0.4;
const CEILING = 3;
const SATURATION = 1.06;
const CONTRAST = 1.04;
const VIGNETTE = 0.25;

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

// The finish, onto the screen.
const FINISH = /* glsl */ `
  uniform sampler2D uScene;
  uniform sampler2D uBloom;
  uniform float uBloomStrength;
  uniform float uSaturation;
  uniform float uContrast;
  uniform float uVignette;
  uniform vec2 uSize;
  uniform float uTime;
  varying vec2 vUv;

  float noise(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    // Clipped as the screen would have clipped it without all this, so the
    // scene keeps its colours, then the glow on top.
    vec3 c = min(texture2D(uScene, vUv).rgb, vec3(1.0));
    c += texture2D(uBloom, vUv).rgb * uBloomStrength;

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

  const sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type, samples, depthBuffer: true });
  const levels = Array.from({ length: LEVELS }, () =>
    new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })
  );

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
  const finishMat = pass(FINISH, {
    uScene: { value: sceneTarget.texture },
    uBloom: { value: levels[0].texture },
    uBloomStrength: { value: BLOOM },
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
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

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
    finishMat.uniforms.uSize.value.set(w, h);
  }

  function run(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(screen, camera);
  }

  // Draws whatever draw() draws into the offscreen picture, then finishes
  // it onto the screen.
  function render(draw, time = 0) {
    fit();
    renderer.setRenderTarget(sceneTarget);
    draw();

    brightMat.uniforms.uTexel.value.set(1 / w, 1 / h);
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
    sceneTarget.dispose();
    levels.forEach((l) => l.dispose());
    [brightMat, downMat, upMat, finishMat].forEach((m) => m.dispose());
    quad.geometry.dispose();
  }

  return { render, dispose };
}
