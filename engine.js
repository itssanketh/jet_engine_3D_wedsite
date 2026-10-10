// R-4360 model + kinematics. Units ≈ decimetres-ish, engine axis = Z (prop at +Z).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const D = Math.PI / 180;
export const ROWS = ['A', 'B', 'C', 'D'];
export const ROW_Z = [2.7, 0.9, -0.9, -2.7];
export const CYL_STEP = 360 / 7;           // 51.43°
export const ROW_STAGGER = 360 / 28;       // 12.86° corncob helix
export const FIRE_STEP = 720 / 28;         // 25.71°
export const RATIO = { prop: 0.375, cam: -1 / 6, blower: 6.375 };
const RC = 0.6, L_MASTER = 2.25, R_KNUCKLE = 0.62, L_LINK = 1.65;
const MASTER_K = 0;                        // cylinder 1 of each row carries the master rod
const HEAD_FLOOR = 3.62;

export const cylinders = [];
for (let r = 0; r < 4; r++) for (let k = 0; k < 7; k++) {
  cylinders.push({
    i: r * 7 + k, r, k, name: ROWS[r] + (k + 1),
    theta: k * CYL_STEP + r * ROW_STAGGER,
    fire: k * CYL_STEP + (k % 2 ? 360 : 0) + r * FIRE_STEP,   // firing TDC, 0..720
  });
}
export const firingOrder = [...cylinders].sort((a, b) => a.fire - b.fire);
const throwAngle = r => -r * ROW_STAGGER;

export const mod = (a, m) => ((a % m) + m) % m;
export const cyclePos = (c, phi) => mod(phi - c.fire, 720);
export function stroke(psi) {
  return psi < 180 ? 'power' : psi < 360 ? 'exhaust' : psi < 540 ? 'intake' : 'compression';
}
function window01(psi, open, close) {
  if (psi < open || psi > close) return 0;
  return Math.pow(Math.sin(Math.PI * (psi - open) / (close - open)), 1.4);
}
export const VALVE = { inOpen: 340, inClose: 590, exOpen: 130, exClose: 380 };
export const intakeLift = psi => window01(psi, VALVE.inOpen, VALVE.inClose);
export const exhaustLift = psi => window01(psi, VALVE.exOpen, VALVE.exClose);
// normalised piston height for a plain slider crank (1 = TDC)
export function pistonHeight(psi) {
  const a = psi * D, x = RC * Math.cos(a) + Math.sqrt(L_MASTER ** 2 - (RC * Math.sin(a)) ** 2);
  return (x - (L_MASTER - RC)) / (2 * RC);
}
// Illustrative chamber pressure (bar) – schematic, not measured data.
export function illustrativePressure(psi) {
  const CR = 6.7, boost = 1.4, x = pistonHeight(psi);
  const V = 1 / (CR - 1) + (1 - x), Vb = 1 / (CR - 1) + 1, Vt = 1 / (CR - 1);
  if (psi >= 540) return boost * Math.pow(Vb / V, 1.32);
  if (psi < 130) {
    const burn = Math.min(1, psi / 28);
    const pc = boost * Math.pow(Vb / Vt, 1.32);
    return pc * Math.pow(Vt / V, 1.28) * (1 + 2.4 * (1 - Math.cos(Math.PI * burn)) / 2);
  }
  if (psi < 180) { const p0 = illustrativePressure(129.9); return 1.2 + (p0 - 1.2) * Math.exp(-(psi - 130) / 9); }
  if (psi < 360) return 1.2;
  return 1.2 + (boost - 1.2) * Math.min(1, (psi - 360) / 60);
}

const dir = a => [Math.sin(a * D), Math.cos(a * D)];
// Master-and-articulating rod geometry for one row, in the row plane.
export function rowLinkage(r, phi) {
  const pa = phi + throwAngle(r);
  const C = dir(pa).map(v => v * RC);
  const thM = cylinders[r * 7 + MASTER_K].theta;
  const um = dir(thM);
  const cu = C[0] * um[0] + C[1] * um[1];
  const dm = cu + Math.sqrt(L_MASTER ** 2 - (C[0] ** 2 + C[1] ** 2) + cu * cu);
  const P = [um[0] * dm, um[1] * dm];
  const beta = Math.atan2(P[0] - C[0], P[1] - C[1]) / D;
  const out = { crankAngle: pa, C, beta, d: [], K: [], pin: [] };
  for (let k = 0; k < 7; k++) {
    const th = cylinders[r * 7 + k].theta, u = dir(th);
    if (k === MASTER_K) { out.d[k] = dm; out.K[k] = C; out.pin[k] = P; continue; }
    const kd = dir(beta + (th - thM));
    const K = [C[0] + R_KNUCKLE * kd[0], C[1] + R_KNUCKLE * kd[1]];
    const ku = K[0] * u[0] + K[1] * u[1];
    const d = ku + Math.sqrt(L_LINK ** 2 - (K[0] ** 2 + K[1] ** 2) + ku * ku);
    out.d[k] = d; out.K[k] = K; out.pin[k] = [u[0] * d, u[1] * d];
  }
  return out;
}
export const LINK = { RC, L_MASTER, L_LINK, R_KNUCKLE, MASTER_K };

/* ---------------------------------------------------------------- materials */
const cutUniforms = { uCut: { value: 0 }, uCutColor: { value: new THREE.Color('#c8292f') } };
const sectionPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
function mat(p, shell = false) {
  const m = new THREE.MeshStandardMaterial(p);
  if (shell) {
    m.side = THREE.DoubleSide;
    m.userData.shell = true;
    m.userData.base = { opacity: 1 };
    m.onBeforeCompile = s => {
      Object.assign(s.uniforms, cutUniforms);
      s.fragmentShader = 'uniform float uCut; uniform vec3 uCutColor;\n' + s.fragmentShader.replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\n if (uCut > 0.5 && !gl_FrontFacing) gl_FragColor = vec4(uCutColor * 0.92, 1.0);');
    };
  }
  return m;
}
export const M = {
  cast: mat({ color: '#83878c', metalness: 0.55, roughness: 0.58 }, true),
  barrel: mat({ color: '#75797e', metalness: 0.75, roughness: 0.38 }, true),
  head: mat({ color: '#8f9398', metalness: 0.5, roughness: 0.5 }, true),
  pipe: mat({ color: '#8e9196', metalness: 0.6, roughness: 0.45 }, true),
  exhaust: mat({ color: '#6b625b', metalness: 0.7, roughness: 0.5 }, true),
  steel: mat({ color: '#b9bec4', metalness: 1, roughness: 0.2 }),
  piston: mat({ color: '#bfc2c5', metalness: 0.85, roughness: 0.3 }),
  brass: mat({ color: '#c09443', metalness: 1, roughness: 0.28 }),
  ceramic: mat({ color: '#f1efe7', metalness: 0, roughness: 0.22 }),
  paint: mat({ color: '#3d444d', metalness: 0.15, roughness: 0.62 }),
  prop: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.2, roughness: 0.5 }),
  dark: mat({ color: '#2b2e33', metalness: 0.6, roughness: 0.4 }),
};
const shellMats = Object.values(M).filter(m => m.userData.shell);
for (const m of shellMats) m.clippingPlanes = [];

export function setShellMode(mode) {
  cutUniforms.uCut.value = mode === 'section' ? 1 : 0;
  for (const m of shellMats) {
    const glass = mode === 'glass';
    m.transparent = glass; m.opacity = glass ? 0.13 : 1; m.depthWrite = !glass;
    m.clippingPlanes = mode === 'section' ? [sectionPlane] : [];
    m.needsUpdate = true;
  }
}

/* ---------------------------------------------------------------- geometry helpers */
const v2 = (r, y) => new THREE.Vector2(r, y);
const lathe = (pts, seg = 48) => new THREE.LatheGeometry(pts.map(([r, y]) => v2(r, y)), seg);
const aroundZ = g => g.rotateX(Math.PI / 2);      // lathe Y → engine Z
function merge(geos) {
  return mergeGeometries(geos.map(g => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
    return n;
  }));
}
function shellProfile(outer, t) {   // closed wall from an outer (r, y) polyline
  return [...outer, ...outer.slice().reverse().map(([r, y]) => [Math.max(0.02, r - t), y]), outer[0]];
}
function beamBetween(a, b, w, h = w) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, len, h);
  const m = new THREE.Mesh(g, M.paint);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}
function gearShape(teeth, pitchR, internal = false) {
  const add = pitchR * 2 / teeth * 0.95, pts = [];
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2, s = Math.PI * 2 / teeth;
    const rOut = internal ? pitchR - add : pitchR + add, rIn = internal ? pitchR + add : pitchR - add;
    for (const [f, rr] of [[0, rIn], [0.18, rIn], [0.32, rOut], [0.68, rOut], [0.82, rIn]])
      pts.push(new THREE.Vector2(Math.cos(a0 + f * s) * rr, Math.sin(a0 + f * s) * rr));
  }
  return pts;
}
function gear(teeth, pitchR, depth, bore) {
  const sh = new THREE.Shape(gearShape(teeth, pitchR));
  if (bore) sh.holes.push(new THREE.Path().absarc(0, 0, bore, 0, Math.PI * 2, true));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1, curveSegments: 6 });
  return g.translate(0, 0, -depth / 2);
}

/* ---------------------------------------------------------------- per-cylinder part geometry (local: +Y radial, +Z forward) */
function barrelGeo() {
  const p = [[0.58, 2.28], [0.76, 2.28], [0.76, 2.36], [0.64, 2.4]];
  for (let y = 2.5; y < 3.5; y += 0.085) p.push([0.64, y], [0.83, y + 0.008], [0.83, y + 0.03], [0.64, y + 0.038]);
  p.push([0.64, 3.58], [0.58, 3.58], [0.58, 2.28]);
  return lathe(p, 40);
}
function headGeo() {
  const p = [[0.56, 3.56], [0.7, 3.56]];
  for (let y = 3.62, i = 0; y < 4.18; y += 0.07, i++) {
    const R = 0.95 - i * 0.035;
    p.push([0.7 - i * 0.02, y], [R, y + 0.006], [R, y + 0.026], [0.7 - i * 0.02, y + 0.032]);
  }
  p.push([0.5, 4.28], [0.2, 4.34], [0.0, 4.35]);
  const g = [lathe(p, 40)];
  for (const s of [-1, 1]) {   // rocker boxes, intake aft / exhaust fore
    g.push(new THREE.BoxGeometry(0.42, 0.34, 0.74).translate(0, 4.56, s * 0.66));
    g.push(new THREE.CylinderGeometry(0.11, 0.13, 0.3, 16).rotateX(Math.PI / 2).translate(0, 3.95, s * 0.68)); // port
  }
  g.push(new THREE.CylinderGeometry(0.1, 0.1, 0.18, 12).rotateZ(Math.PI / 2).translate(0.82, 3.88, 0));
  g.push(new THREE.CylinderGeometry(0.1, 0.1, 0.18, 12).rotateZ(Math.PI / 2).translate(-0.82, 3.88, 0));
  return merge(g);
}
function pistonGeo() {
  const p = [[0, 0.36], [0.5, 0.36], [0.56, 0.32], [0.56, 0.27], [0.53, 0.27], [0.53, 0.24], [0.56, 0.24],
    [0.56, 0.2], [0.53, 0.2], [0.53, 0.17], [0.56, 0.17], [0.56, -0.24], [0.52, -0.26], [0.46, -0.26]];
  return merge([lathe(p, 32), new THREE.CylinderGeometry(0.09, 0.09, 0.9, 12).rotateZ(Math.PI / 2)]);
}
function rodGeo(len, bigR) {
  const g = [new THREE.BoxGeometry(0.15, len - 0.2, 0.09).translate(0, len / 2, 0),
    new THREE.BoxGeometry(0.06, len - 0.2, 0.17).translate(0, len / 2, 0),
    new THREE.CylinderGeometry(0.15, 0.15, 0.17, 20).rotateX(Math.PI / 2).translate(0, len, 0)];
  if (bigR) {
    // two lobed flanges carry the knuckle pins; link-rod eyes sit between them
    const sh = new THREE.Shape();
    for (let i = 0; i <= 140; i++) {
      const a = (i / 140) * Math.PI * 2, r = 0.44 + (bigR - 0.44) * Math.pow(Math.abs(Math.cos(3.5 * a)), 5);
      const x = Math.sin(a) * r, y = Math.cos(a) * r;
      i ? sh.lineTo(x, y) : sh.moveTo(x, y);
    }
    sh.holes.push(new THREE.Path().absarc(0, 0, 0.29, 0, Math.PI * 2, true));
    for (const z of [-0.13, 0.13]) g.push(new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1 }).translate(0, 0, z - 0.025));
    g.push(new THREE.CylinderGeometry(0.42, 0.42, 0.22, 40, 1, true).rotateX(Math.PI / 2));
    for (let i = 1; i < 7; i++) {
      const a = i * CYL_STEP * D;
      g.push(new THREE.CylinderGeometry(0.15, 0.15, 0.34, 16).rotateX(Math.PI / 2)
        .translate(Math.sin(a) * R_KNUCKLE, Math.cos(a) * R_KNUCKLE, 0));
    }
  } else g.push(new THREE.CylinderGeometry(0.13, 0.13, 0.15, 16).rotateX(Math.PI / 2));
  return merge(g);
}
const valveGeo = () => merge([lathe([[0, 0], [0.19, 0], [0.19, 0.03], [0.05, 0.1], [0.035, 0.18], [0.035, 0.92], [0, 0.92]], 20)]);
function springGeo() {
  const pts = [];
  for (let i = 0; i <= 120; i++) { const t = i / 120, a = t * Math.PI * 2 * 6; pts.push(new THREE.Vector3(Math.cos(a) * 0.1, t, Math.sin(a) * 0.1)); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.016, 6, false);
}
const rockerGeo = () => merge([new THREE.BoxGeometry(0.1, 0.07, 0.56).translate(0, -0.05, 0),
  new THREE.CylinderGeometry(0.05, 0.05, 0.2, 12).rotateZ(Math.PI / 2)]);
const pushrodGeo = len => new THREE.CylinderGeometry(0.035, 0.035, len, 8).translate(0, len / 2, 0);
const plugBodyGeo = () => merge([new THREE.CylinderGeometry(0.09, 0.09, 0.08, 6).translate(0, 0.04, 0),
  new THREE.CylinderGeometry(0.035, 0.035, 0.12, 8).translate(0, 0.32, 0)]);
const plugCeramicGeo = () => lathe([[0, 0.08], [0.07, 0.08], [0.06, 0.12], [0.07, 0.15], [0.055, 0.2], [0.062, 0.22], [0.045, 0.27], [0, 0.27]], 16);
function arrowGeo() {
  return merge([new THREE.CylinderGeometry(0.035, 0.035, 0.42, 8).translate(0, 0.21, 0),
    new THREE.ConeGeometry(0.1, 0.2, 12).translate(0, 0.5, 0)]);
}

/* ---------------------------------------------------------------- build */
export function buildEngine() {
  const root = new THREE.Group();
  const groups = {};
  const add = (name, obj) => { (groups[name] ||= new THREE.Group()).add(obj); return obj; };
  const shadow = o => { o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); return o; };

  // crankcase
  const cc = [[2.1, -3.75], [2.25, -3.75], [2.32, -3.68]];
  for (let r = 3; r >= 0; r--) {
    const z = ROW_Z[r];
    cc.push([2.36, z - 0.86], [2.36, z + 0.86]);
    if (r) cc.push([2.24, z + 0.88], [2.24, z + 0.9], [2.44, z + 0.9], [2.44, z + 0.98], [2.24, z + 0.98]);
  }
  cc.push([2.32, 3.68], [2.25, 3.75], [2.1, 3.75]);
  add('case', new THREE.Mesh(aroundZ(lathe([...cc, [2.1, -3.75]], 84)), M.cast));
  // nose / reduction housing
  const nose = [[2.3, 3.72], [2.3, 3.9], [2.16, 4.0], [2.08, 4.7], [1.9, 5.05], [1.45, 5.32], [1.0, 5.5], [0.62, 5.6], [0.44, 5.62]];
  add('nose', new THREE.Mesh(aroundZ(lathe(shellProfile(nose, 0.07), 72)), M.cast));
  // supercharger housing, accessory case
  const blower = [[2.3, -3.72], [2.62, -3.8], [2.86, -3.98], [2.9, -4.2], [2.9, -4.5], [2.78, -4.72], [2.3, -4.88], [1.8, -4.95], [1.72, -5.0]];
  add('case', new THREE.Mesh(aroundZ(lathe(shellProfile(blower, 0.07), 84)), M.cast));
  const acc = [[1.72, -4.98], [1.72, -5.7], [1.62, -5.9], [1.52, -6.2], [0.4, -6.25]];
  add('case', new THREE.Mesh(aroundZ(lathe(shellProfile(acc, 0.06), 64)), M.cast));
  for (const [x, y] of [[-0.85, 0.55], [0.85, 0.55], [0, -0.85]]) {
    add('case', new THREE.Mesh(aroundZ(lathe([[0, -6.2], [0.36, -6.2], [0.38, -6.3], [0.38, -6.85], [0.33, -6.92], [0, -6.92]], 28)), M.dark)).position.set(x, y, 0);
  }
  const carb = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 1.1, 2, 2, 2), M.cast);
  carb.position.set(0, 2.15, -5.45); add('case', carb);
  const carbTop = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.18, 32), M.dark);
  carbTop.position.set(0, 2.62, -5.45); add('case', carbTop);
  // engine mount ring
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.08, 0.11, 12, 96), M.paint);
  ring.position.z = -4.3; add('stand', ring);

  // crankshaft (rotates as one)
  const crank = new THREE.Group();
  crank.add(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 9.6, 32).rotateX(Math.PI / 2).translate(0, 0, 0.2), M.steel));
  for (let r = 0; r < 4; r++) {
    const g = new THREE.Group(); g.rotation.z = -throwAngle(r) * D; g.position.z = ROW_Z[r];
    for (const s of [-1, 1]) {
      const cheek = new THREE.Mesh(merge([new THREE.BoxGeometry(0.8, 1.15, 0.16).translate(0, 0.2, 0),
        new THREE.CylinderGeometry(0.95, 0.95, 0.16, 32, 1, false, Math.PI * 0.6, Math.PI * 0.8).rotateX(Math.PI / 2).translate(0, -0.05, 0)]), M.steel);
      cheek.position.z = s * 0.25; g.add(cheek);
    }
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.4, 24).rotateX(Math.PI / 2).translate(0, RC, 0), M.brass));
    crank.add(g);
  }
  add('crank', crank);

  // cam rings (one per row, counter-rotating at 1/6)
  const camRings = [];
  for (let r = 0; r < 4; r++) {
    const sh = new THREE.Shape();
    const N = 180;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2, lobe = Math.pow(Math.max(0, Math.cos(a * 3)), 8);
      const rr = 1.55 + 0.09 * lobe;
      i ? sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    sh.holes.push(new THREE.Path().absarc(0, 0, 1.25, 0, Math.PI * 2, true));
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1, curveSegments: 4 });
    const m = new THREE.Mesh(g, M.dark); m.position.z = ROW_Z[r] - 0.62;
    camRings.push(m); add('cams', m);
  }

  // planetary reduction: sun 27T, planets 9T, fixed ring 45T → carrier 27/72 = 0.375
  const gearbox = new THREE.Group(); gearbox.position.z = 4.55;
  const ringSh = new THREE.Shape().absarc(0, 0, 1.78, 0, Math.PI * 2, false);
  ringSh.holes.push(new THREE.Path(gearShape(45, 1.5, true).reverse()));
  gearbox.add(new THREE.Mesh(new THREE.ExtrudeGeometry(ringSh, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1 }).translate(0, 0, -0.15), M.brass));
  const sun = new THREE.Mesh(gear(27, 0.9, 0.3, 0.2), M.brass); gearbox.add(sun);
  const carrier = new THREE.Group(); gearbox.add(carrier);
  carrier.add(new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.42, 0.08, 48).rotateX(Math.PI / 2).translate(0, 0, 0.24), M.steel));
  carrier.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.9, 24).rotateX(Math.PI / 2).translate(0, 0, 1.15), M.steel));
  const planets = [];
  for (let i = 0; i < 6; i++) {
    const a = i * 60 * D, p = new THREE.Mesh(gear(9, 0.3, 0.28, 0.07), M.brass);
    p.position.set(Math.sin(a) * 1.2, Math.cos(a) * 1.2, 0); carrier.add(p); planets.push(p);
  }
  add('gearbox', gearbox);

  // propeller: hub + 4 lofted, twisted blades
  const prop = new THREE.Group(); prop.position.z = 6.25;
  prop.add(new THREE.Mesh(aroundZ(lathe([[0, -0.55], [0.72, -0.55], [0.78, -0.4], [0.78, 0.25], [0.66, 0.5], [0.42, 0.85], [0.16, 1.05], [0, 1.08]], 48)), M.dark));
  const bladeG = bladeGeo();
  for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(bladeG, M.prop); b.rotation.z = -i * Math.PI / 2; prop.add(b); }
  add('prop', prop);

  // supercharger impeller
  const blowerRotor = new THREE.Group(); blowerRotor.position.z = -4.3;
  const vanes = [aroundZ(lathe([[0, -0.2], [0.55, -0.2], [0.45, 0.12], [0.2, 0.2], [0, 0.2]], 32))];
  for (let i = 0; i < 18; i++) vanes.push(new THREE.BoxGeometry(0.04, 1.6, 0.32).translate(0, 1.15, 0).rotateZ(i * 20 * D));
  blowerRotor.add(new THREE.Mesh(merge(vanes), M.brass));
  add('blower', blowerRotor);

  // stand
  const P = (x, y, z) => new THREE.Vector3(x, y, z), G = -6.3;
  for (const s of [-1, 1]) {
    add('stand', beamBetween(P(s * 3.1, G + 0.15, -7.4), P(s * 3.1, G + 0.15, 3.6), 0.34, 0.3));
    const lug = P(s * 2.52, -1.78, -4.3);
    add('stand', beamBetween(P(s * 3.1, G + 0.3, -4.3), lug, 0.24));
    add('stand', beamBetween(P(s * 3.1, G + 0.3, -1.4), lug, 0.16));
    add('stand', beamBetween(P(s * 3.1, G + 0.3, -7.1), lug, 0.16));
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.42), M.paint); pad.position.copy(lug); add('stand', pad);
  }
  for (const z of [-7.1, -4.3, 3.3]) add('stand', beamBetween(P(-3.1, G + 0.15, z), P(3.1, G + 0.15, z), 0.26, 0.26));
  add('stand', beamBetween(P(0, G + 0.3, 4.4), P(0, -2.45, 4.4), 0.26));
  add('stand', beamBetween(P(-3.1, G + 0.3, 3.3), P(0, -3.6, 4.4), 0.14));
  add('stand', beamBetween(P(3.1, G + 0.3, 3.3), P(0, -3.6, 4.4), 0.14));
  const saddle = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.1, 10, 40, 70 * D), M.paint);
  saddle.position.z = 4.4; saddle.rotation.z = -125 * D; add('stand', saddle);

  /* ---- instanced per-cylinder parts */
  const inst = (geo, material, count, name) => {
    const m = new THREE.InstancedMesh(geo, material, count);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = m.receiveShadow = true; m.name = name;
    root.add(m); return m;
  };
  const I = {
    barrel: inst(barrelGeo(), M.barrel, 28, 'barrel'),
    head: inst(headGeo(), M.head, 28, 'head'),
    piston: inst(pistonGeo(), M.piston, 28, 'piston'),
    master: inst(rodGeo(L_MASTER, 0.82), M.steel, 4, 'master'),
    link: inst(rodGeo(L_LINK, 0), M.steel, 24, 'link'),
    valve: inst(valveGeo(), M.steel, 56, 'valve'),
    spring: inst(springGeo(), M.steel, 56, 'spring'),
    rocker: inst(rockerGeo(), M.steel, 56, 'rocker'),
    pushrod: inst(pushrodGeo(2.1), M.steel, 56, 'pushrod'),
    plugBody: inst(plugBodyGeo(), M.steel, 56, 'plug'),
    plugCeramic: inst(plugCeramicGeo(), M.ceramic, 56, 'plug'),
    bolts: inst(new THREE.CylinderGeometry(0.045, 0.045, 0.07, 6).translate(0, 2.4, 0), M.dark, 28 * 10, 'bolts'),
    charge: inst(new THREE.CylinderGeometry(0.53, 0.53, 1, 24).translate(0, 0.5, 0),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.62, depthWrite: false }), 28, 'charge'),
    ring: inst(new THREE.TorusGeometry(1, 0.016, 6, 64).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#f07a1a', transparent: true, opacity: 0.95 }), 28, 'ring'),
    arrowIn: inst(arrowGeo(), new THREE.MeshBasicMaterial({ color: '#1f5fbf' }), 28, 'arrow'),
    arrowEx: inst(arrowGeo(), new THREE.MeshBasicMaterial({ color: '#7d8187' }), 28, 'arrow'),
  };
  I.charge.castShadow = I.ring.castShadow = I.arrowIn.castShadow = I.arrowEx.castShadow = false;
  I.charge.renderOrder = 2;
  const white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < 24; i++) I.link.setColorAt(i, white);
  for (let i = 0; i < 4; i++) I.master.setColorAt(i, white);
  for (let i = 0; i < 28; i++) { I.barrel.setColorAt(i, white); I.head.setColorAt(i, white); I.charge.setColorAt(i, white); }

  // static per-cylinder frames + manifolds
  const tmp = new THREE.Matrix4();
  const frames = cylinders.map(c => new THREE.Matrix4().makeTranslation(0, 0, ROW_Z[c.r]).multiply(new THREE.Matrix4().makeRotationZ(-c.theta * D)));
  const toWorld = (c, x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(frames[c.i]);
  const pipes = [];
  for (const c of cylinders) {
    // intake runs from the blower diffuser forward along the corncob gap helix, then turns into the port
    const zr = ROW_Z[c.r];
    const at = (rad, ang, z) => new THREE.Vector3(Math.sin(ang * D) * rad, Math.cos(ang * D) * rad, z);
    const gapAng = z => c.theta + 25.71 + ((zr - z) / 1.8) * 12.86;
    const run = [2.5, 2.75, 3.0, 3.2][c.r];
    const pts = [at(2.62, gapAng(-3.95), -3.95)];
    for (let z = -3.5; z < zr - 1.0; z += 0.45) pts.push(at(run, gapAng(z), z));
    pts.push(at(run + 0.5, c.theta + 26, zr - 1.02), at(3.6, c.theta + 8, zr - 0.98), toWorld(c, 0, 3.95, -0.88));
    const intake = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.12, 10), M.pipe);
    const exPts = [toWorld(c, 0, 3.95, 0.8), toWorld(c, 0, 4.15, 0.95), toWorld(c, 0, 4.55, 1.0), toWorld(c, 0, 4.85, 1.02)];
    const exhaust = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(exPts), 16, 0.12, 10), M.exhaust);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 6, 20).rotateX(Math.PI / 2), M.exhaust);
    lip.applyMatrix4(frames[c.i]); lip.position.copy(exPts[3]);
    for (const m of [intake, exhaust, lip]) { m.userData.cyl = c.i; root.add(m); shadow(m); }
    pipes.push(intake, exhaust, lip);
    // statics
    I.barrel.setMatrixAt(c.i, frames[c.i]); I.head.setMatrixAt(c.i, frames[c.i]);
    for (let b = 0; b < 10; b++) {
      const a = b * 36 * D;
      I.bolts.setMatrixAt(c.i * 10 + b, tmp.copy(frames[c.i]).multiply(new THREE.Matrix4().makeTranslation(Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7)));
    }
    for (const s of [0, 1]) {
      const side = s ? 1 : -1;
      const m = tmp.copy(frames[c.i]).multiply(new THREE.Matrix4().makeTranslation(side * 0.9, 3.88, 0))
        .multiply(new THREE.Matrix4().makeRotationZ(-side * Math.PI / 2));
      I.plugBody.setMatrixAt(c.i * 2 + s, m); I.plugCeramic.setMatrixAt(c.i * 2 + s, m);
    }
  }
  for (const k of Object.keys(groups)) { root.add(shadow(groups[k])); }

  return {
    root, groups, I, frames, pipes, crank, camRings, sun, carrier, planets, prop, blowerRotor, toWorld,
    selected: 0, isolate: false, hideFront: false, showCharge: true, showArrows: false,
  };
}

function bladeGeo() {
  const S = 26, A = 18, pos = [], col = [], idx = [];
  const black = new THREE.Color('#1d1f22'), tip = new THREE.Color('#d6a32a');
  for (let i = 0; i <= S; i++) {
    const s = i / S, y = 0.62 + s * 5.05;
    const chord = s < 0.12 ? 0.3 + s * 2.2 : 0.56 + 0.22 * Math.sin(Math.PI * Math.min(1, (s - 0.12) / 0.95)) - (s > 0.9 ? (s - 0.9) * 2.4 : 0);
    const thick = s < 0.12 ? chord * 0.9 : chord * (0.22 - 0.12 * s);
    const twist = (48 - 36 * s) * D;
    for (let j = 0; j < A; j++) {
      const a = (j / A) * Math.PI * 2;
      let x = Math.cos(a) * chord * 0.5, z = Math.sin(a) * thick * 0.5 * (Math.cos(a) > 0 ? 0.7 : 1);
      if (s < 0.12) z = Math.sin(a) * thick * 0.5;
      pos.push(x * Math.cos(twist) - z * Math.sin(twist), y, x * Math.sin(twist) + z * Math.cos(twist));
      const c = s > 0.93 ? tip : black; col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < S; i++) for (let j = 0; j < A; j++) {
    const a = i * A + j, b = i * A + (j + 1) % A, c2 = a + A, d = b + A;
    idx.push(a, c2, b, b, c2, d);
  }
  const tipC = pos.length / 3; pos.push(0, 0.62 + 5.08, 0); col.push(tip.r, tip.g, tip.b);
  for (let j = 0; j < A; j++) idx.push(S * A + j, tipC, S * A + (j + 1) % A);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/* ---------------------------------------------------------------- per-frame update */
const CHARGE = { intake: new THREE.Color('#2f6fd6'), compression: new THREE.Color('#3a3d42'), power: new THREE.Color('#f07a1a'), exhaust: new THREE.Color('#a7aaae') };
const RED = new THREE.Color('#f2c4c2'), WHITE = new THREE.Color(1, 1, 1), ROD_SEL = new THREE.Color('#e0393f');
const _m = new THREE.Matrix4(), _a = new THREE.Matrix4(), _b = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
// valve geometry in cylinder-local YZ: seat, axis tilt, rocker pivot, pushrod ends
const VG = [-1, 1].map(side => {
  const t = side * 20 * D, a = new THREE.Vector3(0, Math.cos(t), Math.sin(t));
  const S = new THREE.Vector3(0, HEAD_FLOOR, side * 0.24);
  const tipV = S.clone().addScaledVector(a, 0.9);
  const B = new THREE.Vector3(0, 2.32, side * 0.98), T = new THREE.Vector3(0, 4.42, side * 1.0);
  return { side, t, a, S, tip: tipV, pivot: new THREE.Vector3(0, 4.6, side * 0.78), B, T, pt: Math.atan2(T.z - B.z, T.y - B.y), plen: B.distanceTo(T) };
});

export function updateEngine(E, phi, mode) {
  const { I, frames } = E;
  const sel = cylinders[E.selected];
  const visCyl = i => !E.isolate || i === E.selected;
  E.crank.rotation.z = -phi * D;
  for (const ring of E.camRings) ring.rotation.z = -phi * RATIO.cam * D;   // ratio < 0 → opposite sense
  E.prop.rotation.z = -phi * RATIO.prop * D;
  E.blowerRotor.rotation.z = -phi * RATIO.blower * D;
  E.sun.rotation.z = -phi * D;
  E.carrier.rotation.z = -phi * RATIO.prop * D;
  // planet spin relative to carrier: (sun − carrier) · Zs/Zp, opposite sense
  for (const p of E.planets) p.rotation.z = phi * (1 - RATIO.prop) * (27 / 9) * D;

  const linkages = [0, 1, 2, 3].map(r => rowLinkage(r, phi));
  const fires = [];
  for (let r = 0; r < 4; r++) {
    const lk = linkages[r], z = ROW_Z[r];
    const rowVis = !E.isolate || sel.r === r;
    _m.makeRotationZ(-lk.beta * D).setPosition(lk.C[0], lk.C[1], z);
    I.master.setMatrixAt(r, rowVis ? _m : ZERO);
    I.master.setColorAt(r, sel.r === r && sel.k === MASTER_K ? ROD_SEL : WHITE);
    let li = 0;
    for (let k = 0; k < 7; k++) {
      if (k === MASTER_K) continue;
      const K = lk.K[k], P = lk.pin[k];
      const ang = Math.atan2(P[0] - K[0], P[1] - K[1]);
      _m.makeRotationZ(-ang).setPosition(K[0], K[1], z);
      I.link.setColorAt(r * 6 + li, r * 7 + k === E.selected ? ROD_SEL : WHITE);
      I.link.setMatrixAt(r * 6 + li++, rowVis && visCyl(r * 7 + k) ? _m : ZERO);
    }
  }
  for (const c of cylinders) {
    const i = c.i, F = frames[i], vis = visCyl(i);
    const d = linkages[c.r].d[c.k];
    const psi = cyclePos(c, phi), st = stroke(psi);
    if (!vis) {
      for (const [mesh, n] of [[I.barrel, 1], [I.head, 1], [I.piston, 1], [I.charge, 1], [I.ring, 1], [I.arrowIn, 1], [I.arrowEx, 1]]) mesh.setMatrixAt(i * n, ZERO);
      for (const mesh of [I.valve, I.spring, I.rocker, I.pushrod, I.plugBody, I.plugCeramic]) { mesh.setMatrixAt(i * 2, ZERO); mesh.setMatrixAt(i * 2 + 1, ZERO); }
      for (let b = 0; b < 10; b++) I.bolts.setMatrixAt(i * 10 + b, ZERO);
      continue;
    }
    I.barrel.setMatrixAt(i, F); I.head.setMatrixAt(i, F);
    const tint = i === E.selected ? RED : WHITE;
    I.barrel.setColorAt(i, tint); I.head.setColorAt(i, tint);
    I.piston.setMatrixAt(i, _m.copy(F).multiply(_a.makeTranslation(0, d, 0)));
    const crown = d + 0.36;
    if (E.showCharge) {
      I.charge.setMatrixAt(i, _m.copy(F).multiply(_a.makeTranslation(0, crown, 0)).multiply(_b.makeScale(1, HEAD_FLOOR + 0.02 - crown, 1)));
      const col = CHARGE[st].clone();
      if (st === 'power') col.lerp(new THREE.Color('#ffd28a'), Math.max(0, 1 - psi / 40));
      I.charge.setColorAt(i, col);
    } else I.charge.setMatrixAt(i, ZERO);
    // firing ring + glow
    if (psi < 60) {
      const t = psi / 60, s = 0.98 + t * 0.32;
      I.ring.setMatrixAt(i, _m.copy(F).multiply(_a.makeTranslation(0, 3.92, 0)).multiply(_b.makeScale(s, 1, s)));
      fires.push({ i, t });
    } else I.ring.setMatrixAt(i, ZERO);
    // valvetrain
    const lifts = [intakeLift(psi), exhaustLift(psi)];
    VG.forEach((g, s) => {
      const L = lifts[s], j = i * 2 + s;
      _v.copy(g.S).addScaledVector(g.a, -L * 0.16);
      I.valve.setMatrixAt(j, _m.copy(F).multiply(_a.makeRotationX(g.t).setPosition(_v)));
      _v.copy(g.S).addScaledVector(g.a, 0.5);
      I.spring.setMatrixAt(j, _m.copy(F).multiply(_a.makeRotationX(g.t).setPosition(_v)).multiply(_b.makeScale(1, 0.38 - L * 0.16, 1)));
      I.rocker.setMatrixAt(j, _m.copy(F).multiply(_a.makeRotationX(g.side * (0.1 - L * 0.22)).setPosition(g.pivot)));
      _v.copy(g.B).add(new THREE.Vector3(0, Math.cos(g.pt), Math.sin(g.pt)).multiplyScalar(L * 0.09));
      I.pushrod.setMatrixAt(j, _m.copy(F).multiply(_a.makeRotationX(g.pt).setPosition(_v)));
    });
    for (const s of [0, 1]) { I.plugBody.setMatrixAt(i * 2 + s, plugM(F, s)); I.plugCeramic.setMatrixAt(i * 2 + s, plugM(F, s)); }
    for (let b = 0; b < 10; b++) {
      const a = b * 36 * D;
      I.bolts.setMatrixAt(i * 10 + b, _m.copy(F).multiply(_a.makeTranslation(Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7)));
    }
    // airflow arrows
    if (E.showArrows && lifts[0] > 0.05) {
      const k = 0.35 + lifts[0] * 0.45;
      _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -0.55, 1).normalize());
      _a.compose(new THREE.Vector3(0, 4.6, -1.55), _q, _s.set(k, k, k));
      I.arrowIn.setMatrixAt(i, _m.copy(F).multiply(_a));
    } else I.arrowIn.setMatrixAt(i, ZERO);
    if (E.showArrows && lifts[1] > 0.05) {
      const k = 0.35 + lifts[1] * 0.45;
      _a.compose(new THREE.Vector3(0, 4.95, 1.02), _q.identity(), _s.set(k, k, k));
      I.arrowEx.setMatrixAt(i, _m.copy(F).multiply(_a));
    } else I.arrowEx.setMatrixAt(i, ZERO);
  }
  for (const m of Object.values(I)) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  for (const p of E.pipes) p.visible = !E.isolate || p.userData.cyl === E.selected;
  for (const k of ['case', 'prop', 'gearbox', 'nose', 'blower', 'stand']) E.groups[k].visible = !E.isolate;
  // linkage close-up: prop, nose case and gearbox removed for clarity
  if (E.hideFront) for (const k of ['prop', 'gearbox', 'nose']) E.groups[k].visible = false;
  E.camRings.forEach((m, r) => (m.visible = !E.isolate || r === sel.r));
  return { linkages, fires };
}
const _pm = new THREE.Matrix4();
function plugM(F, s) {
  const side = s ? 1 : -1;
  return _pm.copy(F).multiply(new THREE.Matrix4().makeTranslation(side * 0.9, 3.88, 0)).multiply(new THREE.Matrix4().makeRotationZ(-side * Math.PI / 2));
}
