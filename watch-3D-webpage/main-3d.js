import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEBUG = new URLSearchParams(location.search).has('debug');

/* ---------- renderer ---------- */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setClearColor('#060606');
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 200);
camera.position.set(0, 0, 16);

/* ---------- photo studio: softboxes baked into an environment map ----------
   Black metal only looks real when it has something bright to reflect. */
function studio() {
  const room = new THREE.Scene();
  const box = (w, h, color, intensity, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); room.add(m);
  };
  box(14, 3, '#ffffff', 6, [0, 12, 4]);          // overhead strip
  box(3, 16, '#fff6ea', 4, [-12, 2, 6]);         // tall warm key, left
  box(2, 16, '#e8f0ff', 3.2, [12, 0, -4]);       // cool rim, right-back
  box(10, 1.2, '#ffffff', 2.5, [0, -9, 8]);      // low kicker
  box(6, 6, '#ffffff', 1.2, [0, 2, 16]);         // soft front fill
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(room, 0.02).texture;
  pm.dispose();
  return tex;
}
scene.environment = studio();
const key = new THREE.DirectionalLight('#fff3e2', 2.2); key.position.set(-6, 8, 7); scene.add(key);
const rim = new THREE.DirectionalLight('#cfdcff', 3.0); rim.position.set(7, 3, -8); scene.add(rim);

/* ---------- post: gentle bloom on speculars, film grain + vignette ---------- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.28, 0.55, 0.82);
composer.addPass(bloom);
const film = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.035 }, uVig: { value: 0.9 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVig; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - .5;
      c.rgb *= mix(1., smoothstep(.85, .2, length(d * vec2(1.1, 1.))), uVig);
      c.rgb += (h(vUv * 1000.) - .5) * uGrain;
      gl_FragColor = c;
    }`,
});
composer.addPass(new OutputPass());
composer.addPass(film);

/* ---------- scene graph: rig (pose) > center (recentre) > model ---------- */
const rig = new THREE.Group(); rig.rotation.order = 'YXZ';
const center = new THREE.Group();
rig.add(center); scene.add(rig);

const parts = [];    // { obj, base, off, delay }
const callouts = []; // { part, el, line, dot }
let secondsHand = null;

const HIDE_BRAND = new Set(['ROGER DUBUIS', 'RD', 'Geneve']);
const STRAPS = new Set(['Cube004', 'Cube006']);
// object names come from the Blender file (the loader strips the dots)
const LABELS = {
  Cube005: ['Bezel', 'Engraved minute track'],
  Plane004: ['Hands', 'Skeleton, lumed tips'],
  Circle007: ['Flange', 'Signed rehaut'],
  Cube001: ['Star bridge', 'Skeletonised to the bone'],
  Plane002: ['Movement', 'Hand-finished plates'],
  Circle009: ['Crown', 'Screw-down'],
  Cube003: ['Case', 'Integrated lugs'],
};

function prepareMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m, i) => {
      if (m.map) m.map.anisotropy = 8;
      m.envMapIntensity = 1.5;
      if (HIDE_BRAND.has(m.name)) { m.map = null; m.color.set('#0c0c0d'); m.roughness = 0.5; m.metalness = 0.6; }
      if (m.name === 'CIR' || m.name === 'KLMR') { m.color.set('#141414'); m.roughness = 0.62; m.metalness = 0; }
      if (m.name === 'MECHA') { m.color.set('#2a2b2d'); m.roughness = 0.35; m.metalness = 1; }
      if (m.name === 'TR VER BL') {
        const glass = new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 0, roughness: 0.02, transparent: true, opacity: 0.12, envMapIntensity: 2.2, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide });
        if (Array.isArray(o.material)) o.material[i] = glass; else o.material = glass;
      }
    });
  });
}

function buildExplode(model) {
  const watch = model.getObjectByName('WATCH') || model;
  model.updateMatrixWorld(true);
  const hasMesh = (o) => { let m = false; o.traverse((c) => { m ||= c.isMesh; }); return m; };
  const list = watch.children.filter(hasMesh);
  const box = (o) => new THREE.Box3().setFromObject(o);
  const body = new THREE.Box3();
  list.forEach((c) => { if (!STRAPS.has(c.name)) body.union(box(c)); });
  const mid = body.getCenter(new THREE.Vector3());
  const bodySize = body.getSize(new THREE.Vector3());
  // normalise: case body ~2.8 units across, dial facing +Z
  const sf = 2.8 / Math.max(bodySize.x, bodySize.y);
  center.scale.setScalar(sf);
  center.position.copy(mid).multiplyScalar(-sf);
  center.add(model);
  const D = Math.max(bodySize.x, bodySize.y);

  const info = list.map((c) => {
    const b = box(c);
    return { obj: c, ctr: b.getCenter(new THREE.Vector3()).sub(mid), size: b.getSize(new THREE.Vector3()) };
  });
  const stack = info.filter((p) => !STRAPS.has(p.obj.name)).sort((a, b) => a.ctr.z - b.ctr.z);
  const n = stack.length;
  let z = 0;
  const slots = stack.map((p, i) => {
    if (i) z += Math.max(p.size.x, p.size.y) > D * 0.6 || Math.max(stack[i - 1].size.x, stack[i - 1].size.y) > D * 0.6 ? D * 0.34 : D * 0.11;
    return z;
  });
  const SP = z / n;
  stack.forEach((p, i) => {
    const off = new THREE.Vector3(0, 0, slots[i] - z / 2 - p.ctr.z);
    // small off-centre pieces drift outward a little, like a real exploded diagram
    if (Math.max(p.size.x, p.size.y) < D * 0.45 && Math.hypot(p.ctr.x, p.ctr.y) > D * 0.08) {
      off.add(new THREE.Vector3(p.ctr.x, p.ctr.y, 0).normalize().multiplyScalar(D * 0.3));
    }
    p.off = off;
    p.delay = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2);
  });
  info.filter((p) => STRAPS.has(p.obj.name)).forEach((p) => {
    p.off = new THREE.Vector3(0, Math.sign(p.ctr.y) * D * 0.9, -(n / 2) * SP - D * 0.2);
    p.delay = 1;
  });
  info.forEach((p) => { p.base = p.obj.position.clone(); parts.push(p); });

  // the long yellow hand sweeps like a running chronograph seconds hand
  const sh = watch.getObjectByName('Plane005');
  const part = parts.find((q) => q.obj === sh);
  if (sh && part) {
    const pivot = new THREE.Group();
    watch.add(pivot);
    pivot.position.copy(watch.worldToLocal(model.localToWorld(mid.clone())));
    pivot.attach(sh);
    secondsHand = pivot;
    part.obj = pivot; part.base = pivot.position.clone();
  }
}

function buildCallouts() {
  const ol = document.getElementById('callouts');
  const svg = document.getElementById('leaders');
  const NS = 'http://www.w3.org/2000/svg';
  const entries = DEBUG
    ? parts.map((p) => [p, [p.obj.name || p.obj.children[0]?.name, '']])
    : parts.filter((p) => LABELS[p.obj.name]).map((p) => [p, LABELS[p.obj.name]]);
  for (const [part, [title, note]] of entries) {
    const li = document.createElement('li');
    li.textContent = title;
    if (note) { const s = document.createElement('small'); s.textContent = note; li.append(s); }
    ol.append(li);
    const line = document.createElementNS(NS, 'line');
    const dot = document.createElementNS(NS, 'circle'); dot.setAttribute('r', '2.5');
    svg.append(line, dot);
    callouts.push({ part, el: li, line, dot });
  }
}

/* ---------- story keyframes (g = page progress 0..1) ----------
   e explode, rx/ry pose, s scale, x/y screen offset as a fraction of the half-view */
const BASE = { e: 0, rx: 0, ry: 0, s: 1, x: 0, y: 0 };
const KF = [
  { g: 0.0, ...BASE, rx: -0.2, ry: 0.42, s: 1.0, x: 0.1, y: 0.02 },
  { g: 0.1, ...BASE, rx: -0.28, ry: 0.22, s: 1.0, x: 0.1, y: 0.02 },
  { g: 0.22, ...BASE, rx: -0.75, ry: -0.35, s: 0.82, x: 0.22 },
  { g: 0.42, ...BASE, e: 1, rx: -0.95, ry: -0.25, s: 0.5, x: -0.04, y: -0.14 },
  { g: 0.56, ...BASE, e: 1, rx: -0.88, ry: 0.4, s: 0.5, x: -0.04, y: -0.14 },
  { g: 0.64, ...BASE, rx: -0.08, ry: -0.12, s: 2.5, x: 0.3, y: 0.05 },
  { g: 0.75, ...BASE, rx: -0.14, ry: 0.1, s: 2.7, x: 0.3, y: 0.05 },
  { g: 0.82, ...BASE, rx: 0.05, ry: 1.45, s: 1.2, x: -0.22 },
  { g: 0.9, ...BASE, rx: -0.12, ry: 1.85, s: 1.2, x: -0.22 },
  { g: 0.97, ...BASE, rx: -0.32, ry: 0.4, s: 0.78, x: 0.42, y: 0.1 },
  { g: 1.01, ...BASE, rx: -0.32, ry: 0.4, s: 0.78, x: 0.42, y: 0.1 },
];
const KEYS = Object.keys(BASE);
function sample(g) {
  let i = 0;
  while (i < KF.length - 2 && g > KF[i + 1].g) i++;
  const a = KF[i], b = KF[i + 1], t = smooth(a.g, b.g, g), o = {};
  for (const k of KEYS) o[k] = a[k] + (b[k] - a[k]) * t;
  return o;
}

/* ---------- overlays ---------- */
const overlays = [...document.querySelectorAll('.ov')].map((el) => ({ el, from: +el.dataset.from, to: +el.dataset.to }));
const bar = document.getElementById('bar');
function updateOverlays(g) {
  for (const { el, from, to } of overlays) {
    const fi = from === 0 ? 1 : smooth(from, from + 0.04, g);
    const fo = to > 1 ? 0 : smooth(to - 0.035, to, g);
    const o = fi * (1 - fo);
    el.style.opacity = o.toFixed(3);
    el.style.transform = `translateY(${((1 - fi) * 24 - fo * 24).toFixed(1)}px)`;
    el.style.filter = o > 0.98 ? 'none' : `blur(${((1 - o) * 6).toFixed(1)}px)`;
    el.classList.toggle('live', o > 0.5);
  }
  bar.style.transform = `scaleY(${g.toFixed(4)})`;
}
document.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
}));

/* ---------- sizing ---------- */
let halfW = 1, halfH = 1, narrow = false;
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h);
  camera.aspect = w / h; narrow = camera.aspect < 0.9;
  camera.position.z = narrow ? (16 / camera.aspect) * 0.62 : 16;
  camera.updateProjectionMatrix();
  halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
  halfW = halfH * camera.aspect;
}
addEventListener('resize', resize); resize();

const mouse = { x: 0, y: 0 }, sm = { x: 0, y: 0 };
addEventListener('pointermove', (e) => { mouse.x = e.clientX / innerWidth - 0.5; mouse.y = e.clientY / innerHeight - 0.5; });

/* ---------- frame ---------- */
const cur = sample(0), v = new THREE.Vector3(), bb = new THREE.Box3(), clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  const max = document.documentElement.scrollHeight - innerHeight;
  const g = max > 0 ? scrollY / max : 0;
  const target = sample(g);
  const k = reduceMotion ? 1 : 1 - Math.exp(-dt * 4.5);
  for (const key of KEYS) cur[key] += (target[key] - cur[key]) * k;
  sm.x += (mouse.x - sm.x) * k; sm.y += (mouse.y - sm.y) * k;

  // staggered explode: outer pieces leave first, the core follows
  for (const p of parts) {
    const e = smooth(p.delay * 0.45, p.delay * 0.45 + 0.55, cur.e);
    p.obj.position.copy(p.base).addScaledVector(p.off, e);
  }
  if (secondsHand) secondsHand.rotation.z = -(((Date.now() / 1000) % 60) / 60) * Math.PI * 2;

  rig.scale.setScalar(cur.s * (narrow ? 0.9 : 1));
  rig.position.set(narrow ? 0 : cur.x * halfW, cur.y * halfH - (narrow ? halfH * 0.22 : 0) + Math.sin(t * 0.7) * 0.03, 0);
  rig.rotation.set(cur.rx + sm.y * 0.1, cur.ry + sm.x * 0.18, 0);

  film.uniforms.uTime.value = t % 100;
  updateOverlays(g);
  updateCallouts(DEBUG ? 1 : narrow ? 0 : smooth(0.4, 0.44, g) * (1 - smooth(0.555, 0.59, g)));
  composer.render();
}

function updateCallouts(o) {
  const w = innerWidth, h = innerHeight;
  if (o < 0.01 && !DEBUG) { for (const c of callouts) c.el.style.opacity = c.line.style.opacity = c.dot.style.opacity = 0; return; }
  const pts = callouts.map((c) => {
    bb.setFromObject(c.part.obj).getCenter(v).project(camera);
    return { c, x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }).sort((a, b) => a.y - b.y);
  const colX = w * 0.7;
  pts.forEach(({ c, x, y }, i) => {
    const ly = DEBUG ? y : h * 0.16 + (i / Math.max(1, pts.length - 1)) * h * 0.68;
    const lx = DEBUG ? x : colX;
    c.el.style.opacity = o;
    c.el.style.transform = `translate(${lx + 12}px, ${ly - 9}px)`;
    c.line.setAttribute('x1', x); c.line.setAttribute('y1', y); c.line.setAttribute('x2', lx); c.line.setAttribute('y2', ly);
    c.dot.setAttribute('cx', x); c.dot.setAttribute('cy', y);
    c.line.style.opacity = c.dot.style.opacity = o;
  });
}

/* ---------- load ---------- */
const loadText = document.getElementById('load-text'), retry = document.getElementById('retry');
function load() {
  loadText.innerHTML = 'Setting the movement <span id="load-pct">0</span>%';
  retry.hidden = true;
  new GLTFLoader().load('assets/watch.glb', (gltf) => {
    prepareMaterials(gltf.scene);
    buildExplode(gltf.scene);
    document.getElementById('part-count').textContent = String(parts.length);
    buildCallouts();
    renderer.compile(scene, camera);
    document.body.classList.remove('loading');
    renderer.setAnimationLoop(frame);
  }, (e) => {
    const el = document.getElementById('load-pct');
    if (el && e.total) el.textContent = Math.round((e.loaded / e.total) * 100);
  }, () => {
    loadText.textContent = 'The watch could not load. Check your connection and try again.';
    retry.hidden = false;
  });
}
retry.addEventListener('click', load);
load();
