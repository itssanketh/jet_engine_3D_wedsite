import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  buildEngine, updateEngine, setShellMode, cylinders, firingOrder, cyclePos, stroke, mod, rowLinkage,
  intakeLift, exhaustLift, pistonHeight, illustrativePressure, RATIO, ROW_Z, ROWS, LINK, FIRE_STEP,
} from './engine.js';

const $ = id => document.getElementById(id);
const D = Math.PI / 180;
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const C = { ink: css('--ink'), ink2: css('--ink-2'), ink3: css('--ink-3'), hair: css('--hair'), red: css('--red'), blue: css('--blue'),
  orange: css('--orange'), charcoal: css('--charcoal'), gray: css('--gray'), sheet: css('--sheet-solid'), brass: '#b08a3e' };
const STROKE_COL = { power: C.orange, exhaust: C.gray, intake: C.blue, compression: C.charcoal };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ state */
const S = {
  phi: 0, running: true, rpm: 1200, play: 1 / 20, view: 'hero', shell: 'solid',
  labels: true, charts: true, scrubbing: false,
};
const PLAY = [[1, '1×'], [1 / 4, '¼'], [1 / 10, '1/10'], [1 / 20, '1/20'], [1 / 50, '1/50']];

/* ------------------------------------------------------------------ renderer + scene */
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.03).texture;
scene.environmentIntensity = 0.7;
const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
const key = new THREE.DirectionalLight('#fff7ee', 2.0);
key.position.set(-6, 16, 9);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.radius = 6; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
Object.assign(key.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 40 });
scene.add(key, new THREE.HemisphereLight('#f4f6f8', '#9a9a96', 0.55));
const rim = new THREE.DirectionalLight('#dfe8ff', 0.8); rim.position.set(8, 4, -10); scene.add(rim);

// ground: real shadows + a soft painted contact blot under the stand
const GROUND = -6.3;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.16 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = GROUND; ground.receiveShadow = true; scene.add(ground);
{
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(20,22,26,.38)'); gr.addColorStop(0.55, 'rgba(20,22,26,.12)'); gr.addColorStop(1, 'rgba(20,22,26,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const blot = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 15), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  blot.rotation.x = -Math.PI / 2; blot.position.set(0, GROUND + 0.01, -1.6); scene.add(blot);
}

const E = buildEngine();
scene.add(E.root);
E.selected = cylinders.findIndex(c => c.name === 'A7');

// restrained firing glow: camera-facing points, alpha per cylinder
const glowGeo = new THREE.BufferGeometry();
glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(28 * 3), 3));
glowGeo.setAttribute('alpha', new THREE.Float32BufferAttribute(new Float32Array(28), 1));
const glow = new THREE.Points(glowGeo, new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, depthTest: false,
  uniforms: { uScale: { value: 1 }, uColor: { value: new THREE.Color('#ff8a2a') } },
  vertexShader: `attribute float alpha; varying float vA; uniform float uScale;
    void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * mv; gl_PointSize = uScale * 2.6 / -mv.z; }`,
  fragmentShader: `varying float vA; uniform vec3 uColor;
    void main(){ float d = length(gl_PointCoord - .5) * 2.; float a = smoothstep(1., 0., d); a *= a; if (vA * a < .003) discard; gl_FragColor = vec4(uColor, vA * a * .55); }`,
}));
glow.frustumCulled = false; glow.renderOrder = 5; scene.add(glow);
for (const c of cylinders) {
  const p = E.toWorld(c, 0, 3.9, 0);
  glowGeo.attributes.position.setXYZ(c.i, p.x, p.y, p.z);
}

/* ------------------------------------------------------------------ camera framing */
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 5; controls.maxDistance = 90; controls.rotateSpeed = 0.7;
controls.maxPolarAngle = Math.PI * 0.62;

let free = { x: 0, y: 0, w: 1, h: 1 }, cam = free, W = 1, H = 1;
const stacked = () => matchMedia('(max-width: 1180px), (max-height: 700px)').matches;
function measureFree() {
  const r = stage.getBoundingClientRect();
  W = r.width; H = r.height;
  let L = 12, R = W - 12, T = 44, B = H - 12;
  if (!stacked()) {
    if (S.charts) {
      L = document.querySelector('.col.left').getBoundingClientRect().right + 16;
      R = document.querySelector('.col.right').getBoundingClientRect().left - 16;
    } else { L = 24; R = W - 24; T = 200; }
    B = document.querySelector('.strip').getBoundingClientRect().top - 8;
  }
  free = { x: L, y: T, w: Math.max(80, R - L), h: Math.max(80, B - T) };
  // reserve a gutter for leader-line labels so text never sits on the engine
  const g = S.labels && free.w > 560 ? Math.min(160, free.w * 0.19) : 0;
  cam = { x: free.x + g, y: free.y, w: free.w - g * 2, h: free.h };
}
function applyOffset() {
  camera.aspect = W / H;
  const cx = cam.x + cam.w / 2 - W / 2, cy = cam.y + cam.h / 2 - H / 2;
  camera.setViewOffset(W, H, -cx, -cy, W, H);
  camera.updateProjectionMatrix();
}
function fitDistance(radius) {
  return radius / (Math.tan(camera.fov * D / 2) * Math.min(cam.h, cam.w) / H);
}
function viewPose(name) {
  const c = cylinders[E.selected];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  if (name === 'front') return { target: V(0, -0.5, 0), dir: V(0.0, 0.08, 1), dist: fitDistance(6.6) };
  if (name === 'side') return { target: V(0, -0.5, -0.1), dir: V(-1, 0.1, 0.02), dist: fitDistance(7.6) };
  if (name === 'rod') {
    const z = ROW_Z[c.r];
    return { target: V(0, 0.3, z), dir: V(-0.2, 0.16, 1), dist: fitDistance(2.7) };
  }
  if (name === 'cyl') {
    const n = V(Math.sin(c.theta * D), Math.cos(c.theta * D), 0), t = V(Math.cos(c.theta * D), -Math.sin(c.theta * D), 0);
    const target = E.toWorld(c, 0, 3.35, 0);
    return { target, dir: n.multiplyScalar(1).addScaledVector(t, 0.75).add(V(0, 0, 0.7)), dist: fitDistance(2.3) };
  }
  return { target: V(0, -0.6, 0.3), dir: V(-0.66, 0.36, 0.66), dist: fitDistance(6.9) };
}
let tween = null;
function goView(name, instant = false) {
  const p = viewPose(name);
  const pos = p.target.clone().addScaledVector(p.dir.normalize(), p.dist);
  if (instant || reduceMotion) { camera.position.copy(pos); controls.target.copy(p.target); controls.update(); tween = null; return; }
  tween = { t0: performance.now(), dur: 1300, fp: camera.position.clone(), ft: controls.target.clone(), tp: pos, tt: p.target };
}
const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function stepTween(now) {
  if (!tween) return;
  const k = easeInOut(Math.min(1, (now - tween.t0) / tween.dur));
  // swing through an arc around the target instead of cutting straight through the engine
  const tgt = tween.ft.clone().lerp(tween.tt, k);
  const a = tween.fp.clone().sub(tween.ft), b = tween.tp.clone().sub(tween.tt);
  const len = THREE.MathUtils.lerp(a.length(), b.length(), k);
  const dir = a.normalize().lerp(b.normalize(), k);
  if (dir.lengthSq() < 1e-4) dir.set(0, 0.3, 1);
  camera.position.copy(tgt).addScaledVector(dir.normalize(), len);
  controls.target.copy(tgt);
  if (k >= 1) tween = null;
}
controls.addEventListener('start', () => { tween = null; });

function resize() {
  const r = stage.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  measureFree(); applyOffset();
  glow.material.uniforms.uScale.value = r.height * renderer.getPixelRatio() * 0.9;
  for (const c of document.querySelectorAll('canvas.chart')) sizeCanvas(c);
}
let resizeView = null;
new ResizeObserver(() => { resize(); clearTimeout(resizeView); resizeView = setTimeout(() => goView(S.view, true), 60); }).observe(stage);

/* ------------------------------------------------------------------ labels with leader lines */
const svg = document.querySelector('#labels svg');
const labelLayer = $('labels');
const sel = () => cylinders[E.selected];
const LABELS = [
  { title: 'Propeller', sub: '4 blades · 0.375× crank', at: () => new THREE.Vector3(0, 1.0, 7.0) },
  { title: 'Planetary reduction', sub: '27T sun · 45T ring', at: () => new THREE.Vector3(-1.45, 1.3, 4.95) },
  { title: () => `Cylinder ${sel().name}`, sub: () => `${stroke(cyclePos(sel(), S.phi))} stroke · tracked`, at: () => E.toWorld(sel(), 0, 4.32, 0), cyl: true },
  { title: 'Rocker box', sub: 'rocker · valve · spring', at: () => E.toWorld(sel(), 0, 4.68, -0.66), cyl: true },
  { title: 'Spark plugs', sub: '2 per cylinder · 56 total', at: () => E.toWorld(sel(), -1.14, 3.88, 0), cyl: true },
  { title: 'Intake pipe', sub: 'from blower diffuser', at: () => E.toWorld(sel(), 0, 3.9, -1.25), cyl: true },
  { title: 'Exhaust stack', sub: 'ejector outlet', at: () => E.toWorld(sel(), 0, 4.85, 1.02), cyl: true },
  { title: 'Pushrod', sub: 'cam follower → rocker', at: () => E.toWorld(sel(), 0, 3.0, 0.99), cyl: true },
  { title: 'Supercharger', sub: 'impeller 6.375× crank', at: () => new THREE.Vector3(-2.2, 1.6, -4.4) },
  { title: () => `Cam ring · row ${ROWS[sel().r]}`, sub: '3 lobes · −1/6× crank', at: () => new THREE.Vector3(-1.1, 1.1, ROW_Z[sel().r] - 0.54), inside: true },
  { title: 'Master rod', sub: 'carries 6 link rods', at: () => { const lk = rowLinkage(sel().r, S.phi); return new THREE.Vector3((lk.C[0] + lk.pin[0][0]) / 2, (lk.C[1] + lk.pin[0][1]) / 2, ROW_Z[sel().r]); }, inside: true },
  { title: 'Crankshaft', sub: '1× · four throws', at: () => new THREE.Vector3(0, 0.34, -3.3), inside: true },
  { title: 'Display stand', sub: 'mount ring + cradle', at: () => new THREE.Vector3(-3.1, -4.6, -4.3) },
];
const NS = 'http://www.w3.org/2000/svg';
for (const l of LABELS) {
  l.el = document.createElement('div'); l.el.className = 'lbl';
  l.el.innerHTML = '<b></b><span></span>'; labelLayer.appendChild(l.el);
  l.path = document.createElementNS(NS, 'path'); l.path.setAttribute('fill', 'none'); l.path.setAttribute('stroke', C.ink); l.path.setAttribute('stroke-width', '0.8');
  l.dot = document.createElementNS(NS, 'circle'); l.dot.setAttribute('r', '2.6'); l.dot.setAttribute('fill', C.red);
  l.dot2 = document.createElementNS(NS, 'circle'); l.dot2.setAttribute('r', '5'); l.dot2.setAttribute('fill', 'none'); l.dot2.setAttribute('stroke', C.red); l.dot2.setAttribute('stroke-width', '0.7');
  svg.append(l.path, l.dot2, l.dot);
}
// silhouette samples (prop excluded — it sweeps through everything)
const SIL = [...cylinders.map(c => E.toWorld(c, 0, 4.75, 0)),
  ...[-1, 1].flatMap(s => [-7.4, 3.6].map(z => new THREE.Vector3(s * 3.1, -6.3, z))),
  new THREE.Vector3(0, 0, -6.9), new THREE.Vector3(0, 0, 6.9), new THREE.Vector3(0, 2.6, -5.4)];
const _p = new THREE.Vector3();
function project(v) {
  _p.copy(v).project(camera);
  return { x: (_p.x + 1) / 2 * W, y: (1 - _p.y) / 2 * H, z: _p.z };
}
function layoutLabels() {
  const show = S.labels && !E.isolate;
  labelLayer.style.opacity = show ? 1 : 0;
  if (!show) return;
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (const v of SIL) {
    const q = project(v);
    bx0 = Math.min(bx0, q.x); bx1 = Math.max(bx1, q.x); by0 = Math.min(by0, q.y); by1 = Math.max(by1, q.y);
  }
  const cx = (bx0 + bx1) / 2, LW = 150, GAP = 37;
  const sides = { l: [], r: [] };
  const zoomed = S.view === 'cyl' || S.view === 'rod';
  for (const l of LABELS) {
    const p = project(l.at());
    let ok = p.z < 1 && p.x > free.x - 40 && p.x < free.x + free.w + 40 && p.y > free.y && p.y < free.y + free.h;
    if (l.inside && S.shell === 'solid') ok = false;
    if (zoomed && !l.cyl && !l.inside) ok = false;
    if (S.view === 'rod' && l.cyl) ok = false;
    l.vis = ok; l.p = p;
    if (ok) (p.x < cx ? sides.l : sides.r).push(l);
  }
  const place = (arr, side) => {
    arr.sort((a, b) => a.p.y - b.p.y);
    const top = free.y + 8, bot = free.y + free.h - 30;
    arr.forEach(l => (l.y = Math.min(Math.max(l.p.y - 14, top), bot)));
    for (let i = 1; i < arr.length; i++) arr[i].y = Math.max(arr[i].y, arr[i - 1].y + GAP);
    for (let i = arr.length - 1; i >= 0; i--) {
      const lim = i === arr.length - 1 ? bot : arr[i + 1].y - GAP;
      arr[i].y = Math.min(arr[i].y, lim);
    }
    let edge = side === 'l' ? Math.max(free.x + 6 + LW, Math.min(bx0 - 18, cx - 60)) : Math.min(free.x + free.w - 6 - LW, Math.max(bx1 + 18, cx + 60));
    if (zoomed) edge = side === 'l' ? free.x + 6 + LW : free.x + free.w - 6 - LW;
    for (const l of arr) { l.side = side; l.edge = edge; }
  };
  place(sides.l, 'l'); place(sides.r, 'r');
  for (const l of LABELS) {
    const vis = l.vis;
    l.el.style.display = l.path.style.display = l.dot.style.display = l.dot2.style.display = vis ? '' : 'none';
    if (!vis) continue;
    const t = typeof l.title === 'function' ? l.title() : l.title, s = typeof l.sub === 'function' ? l.sub() : l.sub;
    if (l.el.firstChild.textContent !== t) l.el.firstChild.textContent = t;
    if (l.el.lastChild.textContent !== s) l.el.lastChild.textContent = s;
    l.el.className = 'lbl ' + l.side;
    const ly = l.y + 15;
    if (l.side === 'l') { l.el.style.transform = `translate(${l.edge - LW}px, ${l.y}px)`; l.el.style.width = LW + 'px'; }
    else { l.el.style.transform = `translate(${l.edge}px, ${l.y}px)`; l.el.style.width = LW + 'px'; }
    const ex = l.side === 'l' ? l.edge : l.edge, kx = l.side === 'l' ? ex + 14 : ex - 14;
    l.path.setAttribute('d', `M${ex},${ly}H${kx}L${l.p.x.toFixed(1)},${l.p.y.toFixed(1)}`);
    l.dot.setAttribute('cx', l.p.x); l.dot.setAttribute('cy', l.p.y);
    l.dot2.setAttribute('cx', l.p.x); l.dot2.setAttribute('cy', l.p.y);
  }
}

/* ------------------------------------------------------------------ 2D charts */
function sizeCanvas(c) {
  const r = c.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2);
  if (!r.width) return;
  const h = +c.getAttribute('height');
  c.width = Math.round(r.width * dpr); c.height = Math.round(h * dpr); c.style.height = h + 'px';
  c.ctx = c.getContext('2d'); c.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); c.w = r.width; c.h = h;
}
const ctxOf = c => { if (!c.ctx) sizeCanvas(c); if (c.ctx) c.ctx.clearRect(0, 0, c.w, c.h); return c.ctx; };
const font = (px, w = 400, fam = 'IBM Plex Mono') => `${w} ${px}px "${fam}", monospace`;
const sansF = (px, w = 500) => `${w} ${px}px "IBM Plex Sans Condensed", sans-serif`;

function drawRod(phi) {
  const cv = $('cRod'), g = ctxOf(cv); if (!g) return;
  const c = sel(), lk = rowLinkage(c.r, phi);
  const ox = cv.w / 2, oy = cv.h / 2 + 2, s = Math.min(cv.w, cv.h) / 2 / 4.05;
  const P = (x, y) => [ox + x * s, oy - y * s];
  g.lineCap = 'round';
  g.setLineDash([3, 3]); g.strokeStyle = C.hair; g.lineWidth = 1;
  for (const rad of [2.36, LINK.RC]) { g.beginPath(); g.arc(ox, oy, rad * s, 0, Math.PI * 2); g.stroke(); }
  g.setLineDash([]);
  for (let k = 0; k < 7; k++) {
    const cy = cylinders[c.r * 7 + k], a = cy.theta * D, u = [Math.sin(a), Math.cos(a)], t = [u[1], -u[0]];
    const isSel = cy.i === c.i, psi = cyclePos(cy, phi);
    // bore outline
    g.strokeStyle = isSel ? C.red : '#9ea2a6'; g.lineWidth = isSel ? 1.2 : 0.8;
    g.beginPath();
    for (const sgn of [-1, 1]) { const a0 = P(u[0] * 2.3 + t[0] * 0.58 * sgn, u[1] * 2.3 + t[1] * 0.58 * sgn), a1 = P(u[0] * 3.62 + t[0] * 0.58 * sgn, u[1] * 3.62 + t[1] * 0.58 * sgn); g.moveTo(...a0); g.lineTo(...a1); }
    const h0 = P(u[0] * 3.62 + t[0] * 0.58, u[1] * 3.62 + t[1] * 0.58), h1 = P(u[0] * 3.62 - t[0] * 0.58, u[1] * 3.62 - t[1] * 0.58);
    g.moveTo(...h0); g.lineTo(...h1); g.stroke();
    // charge column
    const d = lk.d[k], crown = d + 0.36;
    g.fillStyle = STROKE_COL[stroke(psi)]; g.globalAlpha = 0.55;
    g.beginPath();
    for (const [rr, sg] of [[crown, 1], [3.6, 1], [3.6, -1], [crown, -1]]) g.lineTo(...P(u[0] * rr + t[0] * 0.55 * sg, u[1] * rr + t[1] * 0.55 * sg));
    g.fill(); g.globalAlpha = 1;
    // piston
    g.fillStyle = isSel ? C.red : C.ink;
    g.beginPath();
    for (const [rr, sg] of [[d + 0.36, 1], [d - 0.24, 1], [d - 0.24, -1], [d + 0.36, -1]]) g.lineTo(...P(u[0] * rr + t[0] * 0.55 * sg, u[1] * rr + t[1] * 0.55 * sg));
    g.fill();
    // rod
    const K = lk.K[k], pin = lk.pin[k];
    g.strokeStyle = k === LINK.MASTER_K ? C.ink : (isSel ? C.red : C.blue); g.lineWidth = k === LINK.MASTER_K ? 3 : 1.5;
    g.beginPath(); g.moveTo(...P(K[0], K[1])); g.lineTo(...P(pin[0], pin[1])); g.stroke();
    g.fillStyle = C.brass; g.beginPath(); g.arc(...P(K[0], K[1]), 2.4, 0, Math.PI * 2); g.fill();
    g.fillStyle = C.ink3; g.font = font(9.5, 500);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(cy.name + (k === LINK.MASTER_K ? 'M' : ''), ...P(u[0] * 3.93, u[1] * 3.93));
  }
  // master big end + crank throw
  g.strokeStyle = C.ink; g.lineWidth = 1.2;
  g.beginPath(); g.arc(...P(lk.C[0], lk.C[1]), LINK.R_KNUCKLE * s, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = C.red; g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(ox, oy); g.lineTo(...P(lk.C[0], lk.C[1])); g.stroke();
  g.fillStyle = C.red; g.beginPath(); g.arc(...P(lk.C[0], lk.C[1]), 3.2, 0, Math.PI * 2); g.fill();
  g.fillStyle = C.ink; g.beginPath(); g.arc(ox, oy, 2.4, 0, Math.PI * 2); g.fill();
  $('rodMeta').textContent = `Row ${ROWS[c.r]} · ${String(Math.round(mod(lk.crankAngle, 360))).padStart(3, '0')}°`;
}

const gearPts = (teeth, pr, internal) => {
  const add = pr * 2 / teeth * 0.95, pts = [];
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2, st = Math.PI * 2 / teeth;
    const ro = internal ? pr - add : pr + add, ri = internal ? pr + add : pr - add;
    for (const [f, rr] of [[0, ri], [0.18, ri], [0.32, ro], [0.68, ro], [0.82, ri]]) pts.push([Math.cos(a0 + f * st) * rr, Math.sin(a0 + f * st) * rr]);
  }
  return pts;
};
const GP = { ring: gearPts(45, 1.5, true), sun: gearPts(27, 0.9), planet: gearPts(9, 0.3) };
function drawGear(phi) {
  const cv = $('cGear'), g = ctxOf(cv); if (!g) return;
  const ox = cv.w * 0.36, oy = cv.h / 2, s = (cv.h / 2 - 6) / 1.62;
  const poly = (pts, cx, cy, rot, fill, stroke) => {
    g.beginPath();
    pts.forEach(([x, y], i) => { const X = x * Math.cos(rot) - y * Math.sin(rot), Y = x * Math.sin(rot) + y * Math.cos(rot); g[i ? 'lineTo' : 'moveTo'](cx + X * s, cy + Y * s); });
    g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.stroke(); }
  };
  g.lineWidth = 1;
  g.beginPath(); g.arc(ox, oy, 1.6 * s, 0, Math.PI * 2); g.fillStyle = '#e9e2d2'; g.fill();
  poly(GP.ring, ox, oy, 0, C.sheet, '#8b6c2e');
  const sunA = phi * D, carA = phi * RATIO.prop * D;
  poly(GP.sun, ox, oy, sunA, '#d9c08b', '#8b6c2e');
  for (let i = 0; i < 6; i++) {
    const a = carA + i * Math.PI / 3, px = ox + Math.sin(a) * 1.2 * s, py = oy - Math.cos(a) * 1.2 * s;
    poly(GP.planet, px, py, -phi * (1 - RATIO.prop) * 3 * D, '#e3cf9f', '#8b6c2e');
    g.strokeStyle = C.red; g.lineWidth = 2; g.beginPath(); g.moveTo(ox, oy); g.lineTo(px, py); g.stroke(); g.lineWidth = 1;
    g.fillStyle = C.red; g.beginPath(); g.arc(px, py, 2.2, 0, Math.PI * 2); g.fill();
  }
  // sun index mark
  g.strokeStyle = C.ink; g.lineWidth = 1.6; g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox + Math.sin(sunA) * 0.75 * s, oy - Math.cos(sunA) * 0.75 * s); g.stroke();
  g.fillStyle = C.ink; g.beginPath(); g.arc(ox, oy, 3, 0, Math.PI * 2); g.fill();
  const tx = cv.w * 0.7; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  [['Sun · crank', '1.000×', C.ink], ['Carrier · prop', '0.375×', C.red], ['Ring', 'fixed', '#8b6c2e']].forEach(([a, b, col], i) => {
    g.fillStyle = C.ink3; g.font = sansF(10, 500); g.fillText(a.toUpperCase(), tx, 24 + i * 36);
    g.fillStyle = col; g.font = font(14, 500); g.fillText(b, tx, 40 + i * 36);
  });
}

const hp = n => 3500 * (n / 2700) * (1.35 - 0.35 * (n / 2700));
function drawPower() {
  const cv = $('cPower'), g = ctxOf(cv); if (!g) return;
  const L = 34, R = cv.w - 8, T = 8, B = cv.h - 18;
  const X = n => L + (n / 3000) * (R - L), Y = p => B - (p / 4000) * (B - T);
  g.strokeStyle = C.hair; g.lineWidth = 1; g.fillStyle = C.ink3; g.font = font(9);
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const p of [0, 2000, 4000]) { g.beginPath(); g.moveTo(L, Y(p)); g.lineTo(R, Y(p)); g.stroke(); g.fillText(p ? p / 1000 + 'k' : '0', L - 5, Y(p)); }
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (const n of [0, 1000, 2000, 3000]) { g.textAlign = n === 3000 ? 'right' : 'center'; g.fillText(n, X(n), B + 5); }
  g.beginPath(); g.moveTo(X(200), B);
  for (let n = 200; n <= S.rpm; n += 20) g.lineTo(X(n), Y(hp(n)));
  g.lineTo(X(S.rpm), B); g.fillStyle = 'rgba(200,41,47,.08)'; g.fill();
  g.beginPath(); for (let n = 200; n <= 3000; n += 20) g[n === 200 ? 'moveTo' : 'lineTo'](X(n), Y(hp(n)));
  g.strokeStyle = C.ink; g.lineWidth = 1.4; g.stroke();
  const x = X(S.rpm), y = Y(hp(S.rpm));
  g.setLineDash([2, 3]); g.strokeStyle = C.red; g.lineWidth = 1; g.beginPath(); g.moveTo(x, B); g.lineTo(x, y); g.stroke(); g.setLineDash([]);
  g.fillStyle = C.red; g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill();
  g.font = font(11, 500); g.textAlign = x > cv.w * 0.6 ? 'right' : 'left'; g.textBaseline = 'bottom';
  g.fillText(`≈${Math.round(hp(S.rpm) / 10) * 10} hp`, x + (x > cv.w * 0.6 ? -7 : 7), y - 4);
  g.fillStyle = C.ink3; g.font = font(9); g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText('hp', 2, T - 2);
}

function drawFire(phi) {
  const cv = $('cFire'), g = ctxOf(cv); if (!g) return;
  const ox = cv.w / 2, oy = cv.h / 2, R0 = Math.min(cv.w, cv.h) / 2 - 12;
  const radii = [R0, R0 - 19, R0 - 38, R0 - 57];
  g.strokeStyle = C.hair; g.lineWidth = 1;
  for (const r of radii) { g.beginPath(); g.arc(ox, oy, r, 0, Math.PI * 2); g.stroke(); }
  // power-stroke sector of the tracked cylinder's cycle span, and crank pointer
  const pa = (phi / 720) * Math.PI * 2 - Math.PI / 2;
  g.fillStyle = 'rgba(229,115,27,.08)'; g.beginPath(); g.moveTo(ox, oy); g.arc(ox, oy, R0 + 6, pa - Math.PI / 4, pa); g.closePath(); g.fill();
  g.strokeStyle = C.red; g.lineWidth = 1.5; g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox + Math.cos(pa) * (R0 + 8), oy + Math.sin(pa) * (R0 + 8)); g.stroke();
  cv.nodes = [];
  for (const c of cylinders) {
    const a = (c.fire / 720) * Math.PI * 2 - Math.PI / 2, r = radii[c.r];
    const x = ox + Math.cos(a) * r, y = oy + Math.sin(a) * r, psi = cyclePos(c, phi), st = stroke(psi);
    cv.nodes.push({ x, y, i: c.i });
    const firing = psi < 60;
    g.fillStyle = firing ? C.orange : C.sheet; g.strokeStyle = firing ? C.orange : STROKE_COL[st]; g.lineWidth = 1.2;
    g.beginPath(); g.arc(x, y, 8.5, 0, Math.PI * 2); g.fill(); g.stroke();
    if (c.i === E.selected) { g.strokeStyle = C.red; g.lineWidth = 1.6; g.beginPath(); g.arc(x, y, 11.5, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = firing ? '#fff' : C.ink; g.font = font(7.5, 500); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(c.name, x, y + 0.5);
  }
  g.fillStyle = C.ink3; g.font = font(9); g.fillText(`${Math.round(phi)}°`, ox, oy);
}
$('cFire').addEventListener('click', e => {
  const cv = e.currentTarget, r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const n = (cv.nodes || []).find(n => Math.hypot(n.x - x, n.y - y) < 11);
  if (n) select(n.i);
});

const SPEEDS = [['Crankshaft', 1, '1×'], ['Propeller', RATIO.prop, '0.375×'], ['Cam rings', RATIO.cam, '−1/6×'], ['Supercharger', RATIO.blower, '6.375×']];
$('speeds').innerHTML = SPEEDS.map(([n, , r], i) => `<div><span>${n}</span><canvas id="sp${i}" class="chart" height="26"></canvas><b>${r}</b><output id="spo${i}"></output></div>`).join('');
function drawSpeeds(phi) {
  SPEEDS.forEach(([, k], i) => {
    const cv = $('sp' + i), g = ctxOf(cv); if (!g) return;
    const o = 13, a = phi * k * D;
    g.strokeStyle = C.hair; g.lineWidth = 1; g.beginPath(); g.arc(o, o, 11, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = i === 3 ? C.red : C.ink; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(o, o); g.lineTo(o + Math.sin(a) * 10, o - Math.cos(a) * 10); g.stroke();
    $('spo' + i).textContent = `${Math.round(S.rpm * k).toLocaleString('en-US')} rpm`;
  });
}

function drawValve(phi) {
  const cv = $('cValve'), g = ctxOf(cv); if (!g) return;
  const c = sel(), psi = cyclePos(c, phi);
  const L = 8, R = cv.w - 8, T = 18, B = cv.h - 16;
  const X = a => L + (a / 720) * (R - L), Y = v => B - v * (B - T);
  const bands = [['Power', 0, C.orange], ['Exhaust', 180, C.gray], ['Intake', 360, C.blue], ['Compr.', 540, C.charcoal]];
  for (const [n, a0, col] of bands) {
    const on = psi >= a0 && psi < a0 + 180;
    g.fillStyle = on ? col : 'transparent'; g.globalAlpha = 0.09; g.fillRect(X(a0), T, X(180) - L, B - T); g.globalAlpha = 1;
    g.fillStyle = on ? C.ink : C.ink3; g.font = sansF(9.5, 600); g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillText(n.toUpperCase(), X(a0 + 90), 2);
    g.fillStyle = col; g.fillRect(X(a0) + 1, 13, X(180) - L - 2, 2);
  }
  g.strokeStyle = C.hair; g.lineWidth = 1; g.beginPath(); g.moveTo(L, B); g.lineTo(R, B); g.stroke();
  g.fillStyle = C.ink3; g.font = font(9); g.textBaseline = 'top';
  for (const a of [0, 180, 360, 540, 720]) { g.textAlign = a === 0 ? 'left' : a === 720 ? 'right' : 'center'; g.fillText(a + '°', X(a), B + 4); }
  const curve = (f, col, w, dash) => {
    g.beginPath(); for (let a = 0; a <= 720; a += 3) g[a ? 'lineTo' : 'moveTo'](X(a), Y(f(a)));
    g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]);
  };
  const pMax = illustrativePressure(14);
  curve(a => illustrativePressure(a) / pMax * 0.95, C.orange, 1, [3, 3]);
  curve(a => pistonHeight(a) * 0.95, C.ink, 1.4);
  curve(a => intakeLift(a) * 0.7, C.blue, 1.6);
  curve(a => exhaustLift(a) * 0.7, C.red, 1.6);
  const x = X(psi);
  g.strokeStyle = C.red; g.lineWidth = 1; g.beginPath(); g.moveTo(x, T - 2); g.lineTo(x, B); g.stroke();
  g.fillStyle = C.red; g.beginPath(); g.moveTo(x - 4, T - 4); g.lineTo(x + 4, T - 4); g.lineTo(x, T + 1); g.fill();
  g.fillStyle = C.ink; g.beginPath(); g.arc(x, Y(pistonHeight(psi) * 0.95), 3, 0, Math.PI * 2); g.fill();
  $('vtMeta').textContent = `${c.name} · ψ ${Math.round(psi)}° · drag to scrub`;
}
{
  const cv = $('cValve');
  let wasRunning = false;
  const scrub = e => {
    const r = cv.getBoundingClientRect(), a = Math.min(719, Math.max(0, ((e.clientX - r.left - 8) / (r.width - 16)) * 720));
    S.phi = mod(sel().fire + a, 720);
  };
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); wasRunning = S.running; setRunning(false); S.scrubbing = true; scrub(e); });
  cv.addEventListener('pointermove', e => { if (S.scrubbing) scrub(e); });
  const end = () => { if (!S.scrubbing) return; S.scrubbing = false; setRunning(wasRunning); };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
}

/* ------------------------------------------------------------------ DOM panels */
$('chips').innerHTML = firingOrder.map(c => `<button class="chip" data-i="${c.i}" title="Track cylinder ${c.name}">${c.name}</button>`).join('');
const chips = [...document.querySelectorAll('.chip')];
$('chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) select(+b.dataset.i); });

function updatePanels(phi) {
  const c = sel(), psi = cyclePos(c, phi), st = stroke(psi);
  $('cylName').textContent = c.name;
  const se = $('cylStroke'); se.textContent = st; se.style.color = st === 'exhaust' ? C.ink3 : STROKE_COL[st];
  $('cylMeta').textContent = `ψ ${String(Math.round(psi)).padStart(3, '0')}° · fires at ${Math.round(c.fire)}°`;
  [...$('strokeBar').children].forEach((d, i) => { d.firstChild.style.width = Math.max(0, Math.min(1, (psi - i * 180) / 180)) * 100 + '%'; });
  [...$('strokeLbl').children].forEach((s, i) => s.classList.toggle('on', Math.floor(psi / 180) === i));
  $('roPiston').textContent = Math.round(pistonHeight(psi) * 100) + '%';
  $('roIn').textContent = intakeLift(psi).toFixed(2);
  $('roEx').textContent = exhaustLift(psi).toFixed(2);
  $('roP').textContent = illustrativePressure(psi).toFixed(1);
  let firing = null;
  chips.forEach(ch => {
    const cy = cylinders[+ch.dataset.i], p = cyclePos(cy, phi), f = p < FIRE_STEP;
    ch.classList.toggle('fire', f); ch.classList.toggle('sel', cy.i === E.selected);
    if (f) firing = cy;
  });
  $('fireMeta').textContent = firing ? `${firing.name} firing` : '';
  $('cycleLine').textContent = `Crank ${String(Math.round(phi)).padStart(3, '0')}° / 720° · fires every 25.7°`;
  $('oScrub').textContent = Math.round(phi) + '°';
  const sc = $('sScrub'); if (!S.scrubbing) sc.value = Math.round(phi) % 720;
  sc.style.setProperty('--p', (phi / 720) * 100 + '%');
}

/* ------------------------------------------------------------------ controls */
function setRunning(v) {
  S.running = v;
  $('runTxt').textContent = v ? 'Pause' : 'Run';
  $('runIcon').setAttribute('d', v ? 'M3 2h2v8H3zM7 2h2v8H7z' : 'M3 1.5v9l7.5-4.5z');
}
$('bRun').onclick = () => setRunning(!S.running);
const step = d => { setRunning(false); S.phi = mod(Math.round((S.phi + d) / 15) * 15, 720); };
$('bBack').onclick = () => step(-15); $('bFwd').onclick = () => step(15);
const rpmIn = $('sRpm');
const setRpm = v => {
  S.rpm = +v; rpmIn.value = v;
  $('oRpm').textContent = `${S.rpm} rpm`; $('rpmBig').textContent = S.rpm;
  const p = (S.rpm - 200) / 2800 * 100;
  rpmIn.style.setProperty('--p', p + '%'); $('rpmBar').style.width = (S.rpm / 3000 * 100) + '%';
};
rpmIn.oninput = () => setRpm(rpmIn.value);
$('segPlay').innerHTML = PLAY.map(([v, l]) => `<button class="btn" data-p="${v}">${l}</button>`).join('');
const setPlay = v => { S.play = v; document.querySelectorAll('#segPlay .btn').forEach(b => b.classList.toggle('on', +b.dataset.p === v)); };
$('segPlay').onclick = e => { const b = e.target.closest('.btn'); if (b) setPlay(+b.dataset.p); };
const sc = $('sScrub');
let scrubWas = false;
sc.addEventListener('pointerdown', () => { scrubWas = S.running; setRunning(false); S.scrubbing = true; });
sc.addEventListener('input', () => { S.phi = +sc.value; });
const scEnd = () => { if (S.scrubbing) { S.scrubbing = false; setRunning(scrubWas); } };
sc.addEventListener('pointerup', scEnd); sc.addEventListener('change', scEnd);

let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }

function setView(v) {
  S.view = v;
  E.hideFront = v === 'rod';
  document.querySelectorAll('#segView .btn').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (v === 'rod') {
    if (S.shell === 'solid') setShell('glass');
    if (S.play > 1 / 50) { setPlay(1 / 50); toast('Linkage close-up · playback slowed to 1/50'); }
  }
  goView(v);
}
$('segView').onclick = e => { const b = e.target.closest('.btn'); if (b) setView(b.dataset.v); };
function setShell(m) {
  S.shell = m; setShellMode(m);
  document.querySelectorAll('#segShell .btn').forEach(b => b.classList.toggle('on', b.dataset.m === m));
}
$('segShell').onclick = e => { const b = e.target.closest('.btn'); if (b) setShell(b.dataset.m); };

function setToggle(t, v) {
  document.querySelectorAll(`[data-t="${t}"]`).forEach(b => b.setAttribute('aria-pressed', v));
  if (t === 'labels') { S.labels = v; resize(); goView(S.view); }
  if (t === 'charge') E.showCharge = v;
  if (t === 'arrows') E.showArrows = v;
  if (t === 'isolate') { E.isolate = v; $('bIsolate2').setAttribute('aria-pressed', v); }
  if (t === 'charts') { S.charts = v; document.body.classList.toggle('no-charts', !v); resize(); goView(S.view); }
}
document.querySelector('.tog').onclick = e => { const b = e.target.closest('[data-t]'); if (b) setToggle(b.dataset.t, b.getAttribute('aria-pressed') !== 'true'); };
$('bIsolate2').onclick = () => setToggle('isolate', !E.isolate);
$('bClose').onclick = () => { S.view = 'cyl'; E.hideFront = false; document.querySelectorAll('#segView .btn').forEach(b => b.classList.remove('on')); goView('cyl'); };

function select(i) {
  E.selected = i;
  if (S.view === 'cyl' || S.view === 'rod') goView(S.view);
}

// click a cylinder on the model (ignore drags)
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let down = null;
renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects([E.I.barrel, E.I.head, E.I.piston], false)
    .find(h => S.shell !== 'section' || h.point.x >= 0 || h.object === E.I.piston);
  if (hit) select(hit.instanceId);
});

addEventListener('keydown', e => {
  if (e.target.closest('input, button') && e.key === ' ') return;
  if (e.key === ' ') { e.preventDefault(); setRunning(!S.running); }
  else if (e.key === 'ArrowRight') step(15);
  else if (e.key === 'ArrowLeft') step(-15);
  else if ('1234'.includes(e.key) && e.key.length === 1) setView(['hero', 'front', 'side', 'rod'][+e.key - 1]);
  else if (e.key === 'h' || e.key === 'H') setToggle('charts', !S.charts);
  else if (e.key === 'Escape' && E.isolate) setToggle('isolate', false);
});

/* ------------------------------------------------------------------ loop */
setRpm(S.rpm); setPlay(S.play); setShell('solid'); setRunning(!reduceMotion);
if (innerWidth < 700) setToggle('labels', false);   // too little room for leader lines on phones
resize(); goView('hero', true);
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (S.running) S.phi = mod(S.phi + (S.rpm / 60) * 360 * S.play * dt, 720);
  stepTween(now);
  controls.update();
  const { fires } = updateEngine(E, S.phi, S.shell);
  const al = glowGeo.attributes.alpha;
  al.array.fill(0);
  for (const f of fires) al.array[f.i] = (E.isolate && f.i !== E.selected) ? 0 : Math.pow(1 - f.t, 2);
  al.needsUpdate = true;
  renderer.render(scene, camera);
  layoutLabels();
  if (S.charts) { drawRod(S.phi); drawGear(S.phi); drawPower(); drawFire(S.phi); drawSpeeds(S.phi); drawValve(S.phi); }
  updatePanels(S.phi);
  requestAnimationFrame(frame);
}
document.fonts.ready.then(() => { for (const c of document.querySelectorAll('canvas.chart')) sizeCanvas(c); });
requestAnimationFrame(t => { last = t; frame(t); $('loading').classList.add('done'); });
