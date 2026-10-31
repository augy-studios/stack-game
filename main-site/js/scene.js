// The 3D world: sky, water, the island, the tower, the swinging slab, the
// pieces falling off it, and the ring a perfect drop leaves.
//
// It draws whatever it is handed and keeps no game state of its own, so the
// live game and the replay drive it the same way, through draw(). Units in
// are the game's (js/rules.js); the world is a thousandth of that, so the
// base is one world unit across.
//
// The sky is the one place in the app with a gradient. It is the game's
// scenery, inside the canvas, and shifts colour as the tower climbs.

import * as THREE from "three";
import { LAYER, ISLAND_TOP } from "./rules.js";
import { fallAt } from "./fall.js";

const S = 1 / 1000;
const FOV = 40;
const DIR = new THREE.Vector3(1, 0.62, 1).normalize();
const RING_MS = 650;

// A layer's colour: the seed picks where on the wheel the tower starts, and
// every layer turns it a little, so the tower fades through the colours as
// it climbs. Pastel, like everything else in the app.
export function hueOf(seedNum, n) {
  return (((seedNum % 360) - n * 6) % 360 + 360) % 360;
}

function layerColour(seedNum, n, out = new THREE.Color()) {
  return out.setHSL(hueOf(seedNum, n) / 360, 0.52, 0.64);
}

/* ---- textures and geometry made here, so nothing has to be fetched ---- */

function cloudTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const g = c.getContext("2d");
  const blob = (x, y, r) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.9)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  blob(40, 38, 26);
  blob(66, 30, 30);
  blob(92, 38, 24);
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

// The sky is drawn flat across the screen behind the world, top to bottom,
// so the whole gradient shows whichever way the camera looks, with a soft
// glow low in the middle where the light is.
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
  uniform float uAspect;
  varying vec2 vUv;
  void main() {
    float y = vUv.y;
    vec3 c = y > 0.45
      ? mix(uHorizon, uTop, smoothstep(0.45, 1.0, y))
      : mix(uBottom, uHorizon, smoothstep(0.0, 0.45, y));
    vec2 d = vec2((vUv.x - 0.5) * uAspect, y - 0.52);
    c = mix(c, vec3(1.0), uGlow * exp(-dot(d, d) * 5.0));
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;

const WATER_VERTEX = `
  uniform float uTime;
  varying vec3 vWorld;
  varying float vWave;
  void main() {
    vec3 p = position;
    float w = sin(p.x * 1.6 + uTime * 1.1) * 0.025 + sin(p.y * 2.1 - uTime * 1.4) * 0.02
            + sin((p.x + p.y) * 3.3 + uTime * 2.0) * 0.008;
    p.z += w;
    vWave = w;
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const WATER_FRAGMENT = `
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uHorizon;
  uniform float uNear;
  uniform float uFar;
  uniform float uOpacity;
  varying vec3 vWorld;
  varying float vWave;
  void main() {
    // The sea is a wide pool round the island that fades into the sky, so
    // the sky shows past it the way the tower floats in it.
    float r = length(vWorld.xz);
    vec3 c = mix(uShallow, uDeep, smoothstep(0.0, 6.0, r));
    float edge = smoothstep(uNear, uFar, r);
    // Wave shading only up close; far off it would read as blotches.
    c += vec3(vWave * 1.6 * (1.0 - smoothstep(0.0, uNear, r)));
    c = mix(c, uHorizon, edge);
    gl_FragColor = vec4(c, uOpacity * (1.0 - edge));
    #include <colorspace_fragment>
  }
`;

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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

  /* ---- sky: its own flat scene, drawn first ---- */
  const back = new THREE.Scene();
  const backCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const skyUniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uBottom: { value: new THREE.Color() },
    uGlow: { value: 0.3 },
    uAspect: { value: 1 },
  };
  back.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: skyUniforms,
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        depthWrite: false,
        depthTest: false,
      })
    )
  );

  // Stars, scattered across the screen and fewer towards the bottom.
  const starGeo = new THREE.BufferGeometry();
  {
    const pts = [];
    let s = 12345;
    const rand = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
    for (let i = 0; i < 220; i++) pts.push(rand() * 2 - 1, 1 - 2 * rand() ** 1.6, 0);
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  }
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.6, depthWrite: false, depthTest: false });
  back.add(new THREE.Points(starGeo, starMat));

  const cloudMat = new THREE.SpriteMaterial({ map: cloudTexture(), transparent: true, opacity: 0.4, depthWrite: false, fog: false });
  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const sprite = new THREE.Sprite(cloudMat);
    const angle = (i / 9) * Math.PI * 2 + 0.4;
    sprite.userData = { angle, radius: 7 + (i % 3) * 3.5, rise: ((i * 37) % 11) - 5, speed: 0.012 + (i % 4) * 0.004 };
    sprite.scale.set(5 + (i % 3) * 1.5, 2.5 + (i % 3) * 0.75, 1);
    clouds.push(sprite);
    scene.add(sprite);
  }

  /* ---- water ---- */
  const waterUniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color() },
    uShallow: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uNear: { value: 14 },
    uFar: { value: 70 },
    uOpacity: { value: 0.86 },
  };
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 260, 160, 160),
    new THREE.ShaderMaterial({
      uniforms: waterUniforms,
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      transparent: true,
      depthWrite: false,
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.renderOrder = 2;
  scene.add(water);

  /* ---- the island and the base ---- */
  const island = new THREE.Group();
  const islandTop = ISLAND_TOP * S;
  const sandMat = new THREE.MeshLambertMaterial({ color: 0xe9d7a8, flatShading: true });
  const sand = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 3.2, 3, 10, 1), sandMat);
  sand.position.y = islandTop - 1.5 - 0.06;
  island.add(sand);
  const grassMat = new THREE.MeshLambertMaterial({ color: 0x9fcf8f, flatShading: true });
  const grass = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 2.05, 0.14, 10, 1), grassMat);
  grass.position.y = islandTop - 0.02;
  island.add(grass);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0xb9b4ad, flatShading: true });
  [[1.9, 0.6, 0.22], [-1.4, 1.5, 0.3], [0.4, -2.0, 0.18], [-2.0, -0.9, 0.26], [1.3, -1.5, 0.2]].forEach(([x, z, r]) => {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rockMat);
    rock.position.set(x, islandTop - 0.05, z);
    rock.rotation.set(x, z, r * 10);
    island.add(rock);
  });
  scene.add(island);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const baseMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const base = new THREE.Mesh(boxGeo, baseMat);
  base.scale.set(1, -islandTop, 1);
  base.position.y = islandTop / 2;
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

  /* ---- the slab, the pieces and the rings ---- */
  const slabMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const slab = new THREE.Mesh(boxGeo, slabMat);
  scene.add(slab);

  const piecePool = [];
  function pieceMesh(i) {
    while (piecePool.length <= i) {
      const m = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }));
      m.visible = false;
      scene.add(m);
      piecePool.push(m);
    }
    return piecePool[i];
  }

  const frameGeo = frameGeometry(0.9);
  const plateGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
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

  /* ---- colours from the theme ---- */
  const look = {
    dark: false,
    brand: new THREE.Color("#ccffcc"),
    hue: -1,
    top: new THREE.Color(),
    horizon: new THREE.Color(),
    bottom: new THREE.Color(),
  };

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
  }

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
    if (look.dark) {
      waterUniforms.uDeep.value.setHSL(0.58, 0.45, 0.15);
      waterUniforms.uShallow.value.setHSL(0.52, 0.42, 0.24);
      skyUniforms.uGlow.value = 0.08;
      hemi.intensity = 1.0;
      sun.intensity = 1.2;
      starMat.opacity = 0.9;
      cloudMat.opacity = 0.12;
      sandMat.color.setHex(0xa89a78);
      grassMat.color.setHex(0x6f9a62);
    } else {
      waterUniforms.uDeep.value.setHSL(0.55, 0.5, 0.55);
      waterUniforms.uShallow.value.setHSL(0.49, 0.5, 0.7);
      skyUniforms.uGlow.value = 0.35;
      hemi.intensity = 1.5;
      sun.intensity = 1.7;
      starMat.opacity = 0.7;
      cloudMat.opacity = 0.42;
      sandMat.color.setHex(0xe9d7a8);
      grassMat.color.setHex(0x9fcf8f);
    }
    hemi.color.copy(look.top).lerp(new THREE.Color(0xffffff), 0.6);
  }

  /* ---- camera ---- */
  const cam = { y: 0.4, dist: 8, cover: 0, ready: false };
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
  function draw(view) {
    resize();
    const { t, seedNum, layers, count, overview = 0, cover = 0, dt = 0.016, clock = 0 } = view;

    syncTower(layers, count, seedNum);

    const top = (count - 1) * LAYER * S;
    const h = hueOf(seedNum, count - 1);
    if (look.hue < 0) {
      skyTargets(h);
      look.top.copy(targetTop);
      look.horizon.copy(targetHorizon);
      look.bottom.copy(targetBottom);
    }
    look.hue = h;
    applyLook(h, Math.min(1, dt * 1.5));

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
    water.position.y = view.water * S;
    waterUniforms.uTime.value = clock;

    // Camera: follow the top, or pull back to show the whole tower in the
    // part of the screen no panel covers.
    const fit = fitDistance();
    const tall = top - Math.max(view.water * S, islandTop) + 2.4;
    const backFor = (tall / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)))) * 1.1;
    const free = 1 - Math.min(0.7, cover);
    const wantDist = (fit + (Math.max(fit, backFor) - fit) * overview) * (1 + overview * (1 / free - 1));
    const wantY = top + 0.55 - (top / 2 + 0.2) * overview;
    if (!cam.ready) {
      cam.y = wantY;
      cam.dist = wantDist;
      cam.cover = cover;
      cam.ready = true;
    }
    const ease = 1 - Math.exp(-dt * 4);
    cam.y += (wantY - cam.y) * ease;
    cam.dist += (wantDist - cam.dist) * ease;
    cam.cover += (Math.min(0.7, cover) - cam.cover) * (1 - Math.exp(-dt * 6));

    const target = new THREE.Vector3(0, cam.y, 0);
    camera.position.copy(target).addScaledVector(DIR, cam.dist);
    camera.lookAt(target);
    if (cam.cover > 0.002) camera.setViewOffset(width, height, 0, (height * cam.cover) / 2, width, height);
    else camera.clearViewOffset();

    scene.fog.near = cam.dist * 2.5;
    scene.fog.far = cam.dist * 9 + 30;
    waterUniforms.uNear.value = 5 + cam.dist * 0.4;
    waterUniforms.uFar.value = 14 + cam.dist * 1.1;

    sun.position.set(target.x - 2.2, target.y + 5, target.z + 3.4);
    sun.target.position.copy(target);

    clouds.forEach((c) => {
      const u = c.userData;
      const a = u.angle + clock * u.speed;
      c.position.set(Math.cos(a) * u.radius, cam.y + u.rise * 0.6 - 1.5, Math.sin(a) * u.radius);
    });

    skyUniforms.uAspect.value = camera.aspect;
    renderer.clear();
    renderer.render(back, backCamera);
    renderer.render(scene, camera);
  }

  // Snaps the camera to wherever it is going on the next frame, for a jump
  // in the replay or a new game.
  function snapCamera() {
    cam.ready = false;
  }

  readTheme();

  return { draw, readTheme, snapCamera, resize: () => { width = 0; resize(); } };
}
