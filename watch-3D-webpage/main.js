// Scroll-scrubbed image sequence: the real product film, crossfading between frames for smooth scrub.
const N = 107;
const BG = '#050302';
const src = i => `assets/film/${String(i + 1).padStart(3, '0')}.webp`;
const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const bar = document.getElementById('bar');
const pct = document.getElementById('load-pct');
const ovs = [...document.querySelectorAll('.ov')];
const frames = new Array(N);
let loaded = 0, shown = -1, cur = 0;
// ambient light: a tiny copy of the frame, stretched full-screen, reads as a soft glow
const amb = Object.assign(document.createElement('canvas'), { width: 6, height: 4 });
const actx = amb.getContext('2d');

function size() {
  const d = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * d; canvas.height = innerHeight * d;
  shown = -1;
}
function rect(img) {
  const W = canvas.width, H = canvas.height;
  const wide = innerWidth / innerHeight > 1.2;
  // cover on portrait screens, full height on landscape (film is 9:16)
  const s = wide ? H / img.height : Math.max(W / img.width, H / img.height);
  const w = img.width * s, h = img.height * s;
  return [wide ? Math.min(W * 0.62 - w / 2, W - w) : (W - w) / 2, (H - h) / 2, w, h];
}
const film = document.createElement('canvas'), fctx = film.getContext('2d');
function draw(f) {
  const key = Math.round(f * 50);
  const i = Math.floor(f), t = f - i, a = frames[i], b = frames[Math.min(i + 1, N - 1)];
  if (key === shown || !a?.complete) return;
  shown = key;
  const W = canvas.width, H = canvas.height, [x, y, w, h] = rect(a);

  // 1. ambient light from the frame itself
  actx.drawImage(a, 0, 0, 6, 4);
  ctx.globalAlpha = 1; ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.5; ctx.drawImage(amb, -W * 0.25, -H * 0.25, W * 1.5, H * 1.5);
  ctx.globalAlpha = 1;
  const vg = ctx.createRadialGradient(x + w / 2, H / 2, 0, x + w / 2, H / 2, Math.max(W, H) * 0.8);
  vg.addColorStop(0, 'rgba(5,3,2,0)'); vg.addColorStop(1, 'rgba(5,3,2,.94)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

  // 2. sharp frame (crossfaded) with its side edges masked out
  if (film.width !== Math.ceil(w) || film.height !== Math.ceil(h)) { film.width = Math.ceil(w); film.height = Math.ceil(h); }
  fctx.globalCompositeOperation = 'source-over'; fctx.globalAlpha = 1;
  fctx.clearRect(0, 0, w, h);
  fctx.drawImage(a, 0, 0, w, h);
  if (t > 0.01 && b?.complete) { fctx.globalAlpha = t; fctx.drawImage(b, 0, 0, w, h); fctx.globalAlpha = 1; }
  if (x > 0 || x + w < W) {
    const m = fctx.createLinearGradient(0, 0, w, 0);
    m.addColorStop(0, 'rgba(0,0,0,0)'); m.addColorStop(0.28, '#000'); m.addColorStop(0.72, '#000'); m.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.globalCompositeOperation = 'destination-in'; fctx.fillStyle = m; fctx.fillRect(0, 0, w, h);
  }

  // 3. composite
  ctx.drawImage(film, x, y);
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function load(i) {
  return new Promise(res => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = img.onerror = () => { pct.textContent = Math.round(++loaded / N * 100); res(); };
    img.src = src(i);
    frames[i] = img;
  });
}

function tick() {
  const max = document.documentElement.scrollHeight - innerHeight;
  const g = max > 0 ? scrollY / max : 0;
  cur += (g - cur) * 0.14;                    // eased scrub
  draw(Math.min(N - 1, cur * (N - 1)));
  bar.style.transform = `scaleY(${g})`;
  for (const o of ovs) {
    const a = +o.dataset.from, b = +o.dataset.to, f = (b - a) * 0.22;
    const v = smooth(a, a + f, g) * (1 - smooth(b - f, b, g));
    o.style.opacity = v;
    o.style.transform = `translateY(${(1 - v) * 24}px)`;
    o.classList.toggle('live', v > 0.5);
  }
  requestAnimationFrame(tick);
}

document.querySelectorAll('[data-go]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); scrollTo({ top: 0, behavior: 'smooth' });
}));
addEventListener('resize', size);
size();

load(0).then(() => {
  draw(0);
  const rest = [];
  for (let i = 1; i < N; i++) rest.push(load(i));
  return Promise.all(rest);
}).then(() => { document.body.classList.remove('loading'); requestAnimationFrame(tick); });
