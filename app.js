// RAGE WALL · live prototype
// Stage coordinates are a fixed 1440x900 "wall" that is cover-fitted to the window.
const SW = 1440, SH = 900;
const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const now = () => performance.now();

// ---------------------------------------------------------------- settings
const S = { sens: 1, fistOnly: true, sound: true, debug: false, calibEvery: true };
try { Object.assign(S, JSON.parse(localStorage.getItem('rw-settings') || '{}')); } catch (e) {}
function saveSettings() { try { localStorage.setItem('rw-settings', JSON.stringify(S)); } catch (e) {} }

// ---------------------------------------------------------------- assets
const IMG = {};
function load(key, src) {
  return new Promise((res) => { const i = new Image(); i.onload = () => { IMG[key] = i; res(i); }; i.onerror = () => { console.warn('missing', src); res(null); }; i.src = src; });
}
let ARM = null;
async function loadAssets() {
  ARM = window.RW_ARM || await (await fetch('arms_meta.json')).json();
  const jobs = [load('wall', 'wall.webp'), load('back', 'fx_back_wall.webp'), load('hole', 'fx_brick_hole.webp'), load('holeMask', 'fx_hole_mask.png'),
    load('cracksMid', 'fx_cracks_mid.webp'), load('cracksNear', 'fx_cracks_near.webp'),
    load('reveal1', 'fx_reveal1.webp'), load('reveal2', 'fx_reveal2.webp')];
  for (const t of ['light', 'medium', 'heavy']) for (let v = 1; v <= 6; v++) jobs.push(load(`${t}${v}`, `marks_${t}${v}.webp`));
  for (let i = 0; i < 14; i++) jobs.push(load(`chunk${i}`, `fx_chunk${i}.webp`));
  for (let t = 1; t <= 5; t++) for (const k of ['L_guard', 'R_guard', 'L_punch', 'R_punch']) jobs.push(load(`${k}_t${t}`, `arms_${k}_t${t}.webp`));
  await Promise.all(jobs);
}

// ---------------------------------------------------------------- canvas + view
const cv = $('#stage'), ctx = cv.getContext('2d');
let DPR = 1, VW = 0, VH = 0, sc = 1, ox = 0, oy = 0;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  VW = innerWidth; VH = innerHeight;
  cv.width = Math.round(VW * DPR); cv.height = Math.round(VH * DPR);
  sc = Math.max(VW / SW, VH / SH); ox = (VW - SW * sc) / 2; oy = (VH - SH * sc) / 2;
}
addEventListener('resize', resize); resize();
const visRect = () => ({ x: -ox / sc, y: -oy / sc, w: VW / sc, h: VH / sc });
const winToStage = (x, y) => ({ x: (x - ox) / sc, y: (y - oy) / sc });
const stageToWin = (x, y) => ({ x: x * sc + ox, y: y * sc + oy });

// damage layer (1.5x res)
const DS = 1.5;
const dmg = document.createElement('canvas'); dmg.width = SW * DS; dmg.height = SH * DS;
const dctx = dmg.getContext('2d');
// wall composite layer (used during the break)
const wallLayer = document.createElement('canvas'); wallLayer.width = SW; wallLayer.height = SH;
const wctx = wallLayer.getContext('2d');
// grain
const grain = document.createElement('canvas'); grain.width = grain.height = 256;
{ const g = grain.getContext('2d'), d = g.createImageData(256, 256); for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } g.putImageData(d, 0, 0); }

// ---------------------------------------------------------------- audio
let AC = null;
function audio() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (AC && AC.state === 'suspended') AC.resume(); return AC; }
function noiseBuf(sec) { const a = audio(); const b = a.createBuffer(1, a.sampleRate * sec, a.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
function thud(tier) {
  if (!S.sound) return; const a = audio(); if (!a) return; const t = a.currentTime;
  const amp = { light: .45, medium: .7, heavy: 1 }[tier];
  const o = a.createOscillator(), g = a.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(38, t + .2);
  g.gain.setValueAtTime(amp, t); g.gain.exponentialRampToValueAtTime(.001, t + .35);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + .4);
  const n = a.createBufferSource(); n.buffer = noiseBuf(.5);
  const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = tier === 'heavy' ? 500 : 900; f.Q.value = .8;
  const ng = a.createGain(); ng.gain.setValueAtTime(amp * .9, t); ng.gain.exponentialRampToValueAtTime(.001, t + (tier === 'heavy' ? .45 : .14));
  n.connect(f).connect(ng).connect(a.destination); n.start(t);
  if (tier !== 'light') { // crumble
    const c = a.createBufferSource(); c.buffer = noiseBuf(1); const cf = a.createBiquadFilter(); cf.type = 'highpass'; cf.frequency.value = 2500;
    const cg = a.createGain(); cg.gain.setValueAtTime(0, t + .05); cg.gain.linearRampToValueAtTime(amp * .12, t + .1); cg.gain.exponentialRampToValueAtTime(.001, t + .7);
    c.connect(cf).connect(cg).connect(a.destination); c.start(t);
  }
}
function boom() {
  if (!S.sound) return; const a = audio(); if (!a) return; const t = a.currentTime;
  const o = a.createOscillator(), g = a.createGain(); o.type = 'sine';
  o.frequency.setValueAtTime(80, t); o.frequency.exponentialRampToValueAtTime(26, t + 1.2);
  g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(.001, t + 1.4); o.connect(g).connect(a.destination); o.start(t); o.stop(t + 1.5);
  const n = a.createBufferSource(); n.buffer = noiseBuf(2.5); const f = a.createBiquadFilter(); f.type = 'lowpass';
  f.frequency.setValueAtTime(5000, t); f.frequency.exponentialRampToValueAtTime(300, t + 2.2);
  const ng = a.createGain(); ng.gain.setValueAtTime(.9, t); ng.gain.exponentialRampToValueAtTime(.001, t + 2.4);
  n.connect(f).connect(ng).connect(a.destination); n.start(t);
}

// ---------------------------------------------------------------- camera + hand tracking
const video = $('#cam');
let camOn = false, hands = null, trackerReady = false, trackerLoading = null, busy = false, stream = null;
let lastResults = null, lastResultsT = 0;
let lastHandT = 0, trackFps = 0, fpsN = 0, fpsT = 0, lightLevel = 1, lightT = 0;
const lightCv = document.createElement('canvas'); lightCv.width = 32; lightCv.height = 18;
function sampleLight() {
  if (!camOn || video.readyState < 2 || now() - lightT < 400) return; lightT = now();
  const g = lightCv.getContext('2d', { willReadFrequently: true }); g.drawImage(video, 0, 0, 32, 18);
  const d = g.getImageData(0, 0, 32, 18).data; let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11;
  lightLevel = sum / (d.length / 4) / 255;
}
// One plain-language problem at a time, most important first; null when tracking is fine
function trackIssue() {
  if (mouseMode || !camOn) return null;
  if (!trackerReady) return 'Loading hand tracking…';
  const t = now();
  if (lightLevel < .16) return 'Too dark · turn on a light in front of you';
  const seen = T.filter((k) => k.present && t - k.lastSeen < 400);
  if (!seen.length) return t - lastHandT > 1200 ? "Can't see your hands · hold your fists up in front of the camera" : null;
  const big = Math.max(...seen.map((k) => k.bh));
  if (big > .5) return 'Too close · step back a little';
  if (big < .09) return 'Too far · come a bit closer';
  if (seen.some((k) => k.edge)) return 'Your hand is leaving the frame · move toward the middle';
  if (trackFps && trackFps < 12) return 'Tracking is slow · close other tabs or apps';
  return null;
}
function distZone() { const seen = T.filter((k) => k.present && now() - k.lastSeen < 400); if (!seen.length) return -1; const big = Math.max(...seen.map((k) => k.bh)); return big > .5 ? 0 : big < .09 ? 2 : 1; }
// show a problem once it has lasted half a second; clear it once it has been gone for a moment
const warnState = { msg: null, since: 0, shown: null, clearT: 0 };
function updateWarn(el) {
  const m = trackIssue(), t = now();
  if (m !== warnState.msg) { warnState.msg = m; warnState.since = t; }
  if (m && t - warnState.since > (m.startsWith('Loading') ? 0 : 500)) { warnState.shown = m; warnState.clearT = 0; }
  else if (!m && warnState.shown) { if (!warnState.clearT) warnState.clearT = t; if (t - warnState.clearT > 700) warnState.shown = null; }
  el.textContent = warnState.shown || ''; el.hidden = !warnState.shown;
}
async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 60 }, facingMode: 'user' }, audio: false });
  video.srcObject = stream; await video.play(); camOn = true;
  video.onpause = () => { if (camOn) video.play().catch(() => {}); };
}
function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null; video.srcObject = null; camOn = false; lastResults = null;
  T.forEach((k) => { k.present = false; });
}
// Hand tracking loads from this site's vendor/hands folder; if those files are missing
// (e.g. the folder didn't upload) or blocked, fall back to the same version on jsDelivr.
const CDN_HANDS = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/';
function loadScript(src) {
  return new Promise((res, rej) => { const el = document.createElement('script'); el.src = src; el.crossOrigin = 'anonymous'; el.onload = res; el.onerror = () => rej(new Error('could not load ' + src)); document.head.appendChild(el); });
}
async function localHandsOk() {
  if (location.protocol === 'file:') return false;
  try { const r = await fetch('hands_solution_packed_assets.data', { method: 'HEAD', cache: 'no-store' }); return r.ok; } catch (e) { return false; }
}
async function makeHands(base) {
  const h = new window.Hands({ locateFile: (f) => base + f });
  h.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.5, selfieMode: false });
  h.onResults((r) => { lastResults = r; lastResultsT = now(); onHands(r); });
  await h.initialize();
  return h;
}
function startTracker() {
  if (trackerLoading) return trackerLoading;
  trackerLoading = (async () => {
    let base = (await localHandsOk()) ? '' : CDN_HANDS;
    if (!window.Hands) { await loadScript(CDN_HANDS + 'hands.js'); base = CDN_HANDS; }
    if (!window.Hands) throw new Error('hand tracking library could not load · check your connection and refresh');
    try { hands = await makeHands(base); }
    catch (e) {
      if (base === CDN_HANDS) throw e;
      console.warn('local hand model failed, using CDN', e);
      hands = await makeHands(CDN_HANDS);
    }
    trackerReady = true;
    pumpTracker();
  })();
  return trackerLoading;
}
let modelLevel = 1, slowSince = 0;
function adaptModel() {
  if (!hands || modelLevel === 0 || !trackFps) return;
  if (trackFps < 22) { if (!slowSince) slowSince = now(); else if (now() - slowSince > 2500) { modelLevel = 0; hands.setOptions({ modelComplexity: 0 }); } }
  else slowSince = 0;
}
function pumpTracker() {
  const step = async () => {
    if (camOn && !mouseMode && trackerReady && !busy && video.readyState >= 2 && STATE !== 'end' && STATE !== 'replay') {
      busy = true;
      try { await hands.send({ image: video }); } catch (e) { console.warn(e); }
      busy = false;
    }
    if ('requestVideoFrameCallback' in video && camOn) video.requestVideoFrameCallback(step); else requestAnimationFrame(step);
  };
  step();
}

// One-Euro filter: smooth when the hand is still, responsive when it moves fast.
function OneEuro(minCut, beta) {
  let x = null, dx = 0, lt = 0;
  const alpha = (cut, dt) => { const r = 2 * Math.PI * cut * dt; return r / (r + 1); };
  return {
    reset(v) { x = v; dx = 0; lt = 0; },
    f(v, t) {
      if (x === null || !lt) { x = v; lt = t; return v; }
      const dt = Math.max(.001, (t - lt) / 1000); lt = t;
      const d = (v - x) / dt; dx = dx + alpha(1, dt) * (d - dx);
      x = x + alpha(minCut + beta * Math.abs(dx), dt) * (v - x); return x;
    }
  };
}

// Per-hand state. Index 0 = left side of the (mirrored) screen, 1 = right side.
function mkTrack(side) {
  return { side, present: false, lastSeen: 0, x: SW * (side ? .66 : .34), y: SH * .62, rx: 0, s: 0, sPrev: 0, base: 0, rel: 0,
    curl: 2, fistT: 0, armed: true, pending: 0, peak: 0, hitX: 0, hitY: 0, lastFire: 0, calT: 0, calS: [], label: '',
    fx: OneEuro(1.8, .01), fy: OneEuro(1.8, .01), fs: OneEuro(3, 12), hist: [], bh: 0, edge: false, vx: 0, vy: 0, recentPeak: 0, recentPeakT: 0 };
}
const T = [mkTrack(0), mkTrack(1)];
// The player's own punch speed, measured with three test punches during calibration.
const PUNCH = { trig: .8, med: 2.0, heavy: 3.6, measured: false };
const labelSide = {}; // MediaPipe handedness label -> screen side, learned while the hands are apart
const d3 = (a, b, w, h) => Math.hypot((a.x - b.x) * w, (a.y - b.y) * h, (a.z - b.z) * w);
function handToStage(lx, ly) {
  // mirror + gain so the player can reach the whole wall without leaving the frame
  const v = visRect(), g = 1.35;
  const mx = 1 - lx;
  return { x: v.x + v.w * clamp(.5 + (mx - .5) * g, -.02, 1.02), y: v.y + v.h * clamp(.5 + (ly - .45) * g, -.02, 1.02) };
}
function onHands(r) {
  if (mouseMode) return;
  const t = now();
  fpsN++; if (t - fpsT > 1000) { trackFps = fpsN * 1000 / (t - fpsT); fpsN = 0; fpsT = t; adaptModel(); }
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const L = (r.multiHandLandmarks || []).map((lm, i) => {
    // palm size from the rigid part of the hand (wrist + knuckles), in 3D so turning the fist doesn't read as depth
    const s = (d3(lm[0], lm[5], vw, vh) + d3(lm[0], lm[17], vw, vh) + d3(lm[5], lm[17], vw, vh) + d3(lm[0], lm[9], vw, vh)) / vh;
    const palm = d3(lm[0], lm[9], vw, vh) || 1;
    const curl = [8, 12, 16, 20].reduce((a, j) => a + d3(lm[j], lm[0], vw, vh), 0) / 4 / palm;
    // a finger is curled when its middle joint bends past ~70 degrees
    const V = (a, b) => [(b.x - a.x) * vw, (b.y - a.y) * vh, (b.z - a.z) * vw];
    const bend = (m, p, t) => { const u = V(m, p), w = V(p, t); const c = (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (Math.hypot(...u) * Math.hypot(...w) + 1e-6); return Math.acos(clamp(c, -1, 1)); };
    const curled = [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]].filter(([m, q, tp]) => bend(lm[m], lm[q], lm[tp]) > 1.2).length;
    const cx = (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5, cy = (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5;
    const hd = r.multiHandedness && r.multiHandedness[i];
    let x0 = 1, x1 = 0, y0 = 1, y1 = 0; for (const q of lm) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    const bh = Math.max(y1 - y0, (x1 - x0) * vw / vh), edge = Math.min(x0, 1 - x1, y0, 1 - y1) < .012;
    return { lm, s, curl, curled, sx: 1 - cx, cx, cy, bh, edge, label: hd ? hd.label : '', score: hd ? hd.score : 0 };
  });
  let assign = [null, null];
  if (L.length >= 2) {
    const [a, b] = L[0].sx <= L[1].sx ? [L[0], L[1]] : [L[1], L[0]];
    // hands clearly apart: trust screen position and learn which label is which side
    if (b.sx - a.sx > .18 && a.label && b.label && a.label !== b.label) { labelSide[a.label] = 0; labelSide[b.label] = 1; assign = [a, b]; }
    // hands close or crossed mid-punch: keep identities by label so they don't swap
    else if (a.label !== b.label && a.label in labelSide && b.label in labelSide) { assign[labelSide[a.label]] = a; assign[labelSide[b.label]] = b; }
    else assign = [a, b];
  } else if (L.length === 1) {
    const h = L[0];
    let side;
    if (h.label in labelSide && h.score > .8) side = labelSide[h.label];
    else {
      const d0 = T[0].present ? Math.abs(T[0].rx - h.sx) : 9, d1 = T[1].present ? Math.abs(T[1].rx - h.sx) : 9;
      side = (d0 < 9 || d1 < 9) ? (d0 <= d1 ? 0 : 1) : (h.sx < .5 ? 0 : 1);
    }
    assign[side] = h;
  }
  if (L.length) lastHandT = t;
  for (let i = 0; i < 2; i++) updateTrack(T[i], assign[i], t);
  if (S.debug) debugOut();
}
function thresholds() { const k = S.sens; return [PUNCH.trig * k, PUNCH.med * k, PUNCH.heavy * k]; }
function detecting() { return STATE === 'play' || STATE === 'calibp'; }
function updateTrack(k, h, t) {
  let [T0] = thresholds();
  if (STATE === 'calibp') T0 = Math.min(T0, .9); // test punches: accept anything punch-like
  const fistOk = () => !S.fistOnly || t - k.fistT < 900;
  if (!h) {
    // Fast punches blur and the tracker drops the hand right at full extension.
    // If it was clearly moving toward the camera just before it vanished, that was a punch.
    if (detecting() && k.present && !k.pending && k.armed && fistOk() && t - k.lastSeen < 160 && (k.recentPeak > T0 * .6 && t - k.recentPeakT < 160)) {
      k.peak = Math.max(k.recentPeak, T0) * 1.15; k.hitX = k.x + k.vx * .06; k.hitY = k.y + k.vy * .06; firePunch(k, t);
    } else if (k.pending) firePunch(k, t);
    if (t - k.lastSeen > 600) k.present = false; // hold the arm where it was for a moment instead of snapping away
    return;
  }
  const p = handToStage(h.cx, h.cy);
  const dt = Math.max(.008, (t - k.lastSeen) / 1000);
  const fresh = !k.present || t - k.lastSeen > 400;
  k.present = true; k.rx = h.sx; k.curl = h.curl; k.label = h.label; k.bh = h.bh; k.edge = h.edge;
  if (h.curled >= 3 || h.curl < 1.55) k.fistT = t;
  if (fresh) {
    k.lastSeen = t; k.fx.reset(p.x); k.fy.reset(p.y); k.fs.reset(h.s); k.hist = [{ t, s: h.s, x: h.cx, y: h.cy }];
    k.x = p.x; k.y = p.y; k.vx = k.vy = 0; k.s = h.s; k.sPrev = h.s; k.rel = 0; k.recentPeak = 0; if (!k.base) k.base = h.s; return;
  }
  k.lastSeen = t;
  const px = k.x, py = k.y;
  k.x = k.fx.f(p.x, t); k.y = k.fy.f(p.y, t);
  k.vx = lerp(k.vx || 0, (k.x - px) / dt, .5); k.vy = lerp(k.vy || 0, (k.y - py) / dt, .5);
  k.sPrev = k.s; k.s = k.fs.f(h.s, t);
  if (!k.base) k.base = k.s;
  // speed from the RAW palm size over the last ~100 ms (least squares), so filtering adds no lag
  k.hist.push({ t, s: h.s, x: h.cx, y: h.cy }); while (k.hist.length > 3 && t - k.hist[0].t > 100) k.hist.shift();
  let grow = 0, planar = 0;
  const n = k.hist.length;
  if (n >= 3) {
    const mt = k.hist.reduce((a, q) => a + q.t, 0) / n, ms = k.hist.reduce((a, q) => a + q.s, 0) / n;
    const mx = k.hist.reduce((a, q) => a + q.x, 0) / n, my = k.hist.reduce((a, q) => a + q.y, 0) / n;
    let num = 0, nx = 0, ny = 0, den = 0;
    for (const q of k.hist) { const d = q.t - mt; num += d * (q.s - ms); nx += d * (q.x - mx); ny += d * (q.y - my); den += d * d; }
    if (den) { grow = (num / den) * 1000 / k.base; planar = Math.hypot(nx / den * 1000 * 16 / 9, ny / den * 1000); }
  } else grow = (h.s - k.hist[0].s) / (k.base * dt);
  // hooks and side swings barely change the palm size; count a fast sideways fist too
  const hook = Math.max(0, planar / Math.max(.2, k.base * 2.4) - .5);
  k.rel = lerp(k.rel, Math.max(grow, hook * .9), .9);
  if (k.rel > (k.recentPeak || 0) || t - k.recentPeakT > 160) { k.recentPeak = k.rel; k.recentPeakT = t; }
  // slowly follow the player's resting distance
  if (k.armed && !k.pending && Math.abs(k.rel) < .4) k.base = lerp(k.base, k.s, .015);
  if (!detecting()) return;
  if (k.pending) {
    k.peak = Math.max(k.peak, k.rel);
    if (k.s >= k.peakS) { k.peakS = k.s; k.hitX = k.x; k.hitY = k.y; }
    if (t - k.pending > 120 || k.rel < k.peak * .35) firePunch(k, t);
  } else if (k.armed && k.rel > T0 && (k.s > k.base * 1.04 || hook * .9 > T0) && fistOk() && t - k.lastFire > 140) {
    k.pending = t; k.peak = k.rel; k.peakS = k.s; k.hitX = k.x; k.hitY = k.y;
  } else if (!k.armed && t - k.lastFire > 110 && (k.rel < .3 || k.s < k.base * 1.08 || t - k.lastFire > 450)) {
    k.armed = true;
  }
}
function firePunch(k, t) {
  const [, T1, T2] = thresholds();
  const tier = k.peak < T1 ? 'light' : k.peak < T2 ? 'medium' : 'heavy';
  k.pending = 0; k.armed = false; k.lastFire = t;
  if (STATE === 'calibp') { testPunch(k.peak); return; }
  onPunch(k.side, k.hitX, k.hitY, tier);
}
function debugOut() {
  const [a, b, c] = thresholds();
  $('#debug').textContent = T.map((k) => `${k.side ? 'R' : 'L'} ${k.present ? 'seen' : '----'} ${k.label.padEnd(5)} s/base ${(k.s / (k.base || 1)).toFixed(2)}  rel ${k.rel.toFixed(2)}  curl ${k.curl.toFixed(2)} ${now() - k.fistT < 450 ? 'FIST' : 'open'}  ${k.armed ? 'armed' : 'reload'}`).join('\n') + `\n${PUNCH.measured ? 'your punch' : 'default'} thresholds ×${S.sens}  trigger ${a.toFixed(1)} · medium ${b.toFixed(1)} · heavy ${c.toFixed(1)}`;
}

// ---------------------------------------------------------------- game state
const WALL_HP = 200;   // a steady player breaks it in ~45 s
const ROUND = 45;      // seconds; no clock on screen, but the wall quietly weakens so rounds end near here
const DMG = { light: 5, medium: 9, heavy: 15 };
let STATE = 'intro', mouseMode = false, tone = 3, tonePicked = false;
const G = { hp: WALL_HP, hits: 0, start: 0, end: 0, stageMid: 0, stageNear: 0, shake: 0, particles: [], armPunch: [0, 0], armHit: [null, null], breakT: 0, hole: null, mouse: { x: SW * .66, y: SH * .55, down: 0 } };
function show(id) { document.querySelectorAll('.screen').forEach((e) => e.classList.toggle('on', e.id === id)); }
function setHud(on) { $('#hud').classList.toggle('on', on); }

// ---------------------------------------------------------------- intro (pick a mode; the two never mix)
$('#btn-cam').onclick = async () => {
  audio();
  $('#intro-err').hidden = true;
  mouseMode = false;
  try {
    if (!camOn) await startCamera();
  } catch (e) {
    $('#intro-err').hidden = false;
    $('#intro-err').textContent = '(camera blocked or unavailable · allow it in the address bar, or play with the mouse)';
    return;
  }
  document.body.classList.remove('mouse-mode');
  goChoose();
  if (!trackerReady) {
    $('#calib-loading').style.display = '';
    $('#calib-loading').textContent = '(loading hand tracking…)';
    startTracker().then(() => { $('#calib-loading').style.display = 'none'; }).catch((e) => { trackerLoading = null; $('#calib-loading').textContent = '(hand tracking failed to load · ' + e.message + ')'; });
  }
};
$('#btn-mouse').onclick = () => {
  audio(); mouseMode = true; stopCamera();
  document.body.classList.add('mouse-mode');
  goChoose();
};
function goIntro() {
  stopCamera(); mouseMode = false; STATE = 'intro'; setHud(false);
  $('#replay-ui').classList.remove('on'); freeze = null; replay = null;
  show('scr-intro');
}

// ---------------------------------------------------------------- calibrate: 1) both fists  2) three test punches
const ccv = $('#calib-canvas'), cctx = ccv.getContext('2d');
let calibDone = [false, false], testPeaks = [];
function goCalib() {
  STATE = 'calib'; show('scr-calib'); setHud(false);
  calibDone = [false, false]; testPeaks = [];
  T.forEach((k) => { k.calT = 0; k.calS = []; k.base = 0; k.armed = true; k.pending = 0; });
  $('#calib-step1').hidden = false; $('#calib-step2').hidden = true;
  $('#calib-steplabel').textContent = '(step 02 / 02 · calibrate fists)';
}
function calibFrame(dt) {
  const r = ccv.getBoundingClientRect();
  if (ccv.width !== Math.round(r.width * DPR)) { ccv.width = Math.round(r.width * DPR); ccv.height = Math.round(r.height * DPR); }
  const w = ccv.width, h = ccv.height;
  cctx.save(); cctx.translate(w, 0); cctx.scale(-1, 1);
  if (video.readyState >= 2) drawCover(cctx, video, w, h, video.videoWidth, video.videoHeight);
  cctx.restore();
  cctx.fillStyle = 'rgba(30,11,6,.25)'; cctx.fillRect(0, 0, w, h);
  const res = lastResults && now() - lastResultsT < 300 ? lastResults : null;
  if (res && res.multiHandLandmarks) {
    const vw = video.videoWidth, vh = video.videoHeight, s = Math.max(w / vw, h / vh), dx = (w - vw * s) / 2, dy = (h - vh * s) / 2;
    const P = (p) => [w - (p.x * vw * s + dx), p.y * vh * s + dy];
    const E = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
    cctx.lineWidth = 2 * DPR; cctx.strokeStyle = 'rgba(255,255,255,.85)'; cctx.fillStyle = '#F2B38A';
    for (const lm of res.multiHandLandmarks) {
      cctx.beginPath(); for (const [a, b] of E) { const A = P(lm[a]), B = P(lm[b]); cctx.moveTo(...A); cctx.lineTo(...B); } cctx.stroke();
      for (const p of lm) { const A = P(p); cctx.beginPath(); cctx.arc(A[0], A[1], 3 * DPR, 0, 7); cctx.fill(); }
    }
  }
  const zone = distZone();
  ['close', 'ok', 'far'].forEach((n, i) => { $('#m-' + n).classList.toggle('on', i === zone); $('#ml-' + n).classList.toggle('on', i === zone); });
  if (STATE !== 'calib') return;
  let done = 0;
  T.forEach((k, i) => {
    const good = k.present && now() - k.fistT < 300 && zone === 1 && !k.edge;
    if (!calibDone[i]) {
      if (good) { k.calT += dt; k.calS.push(k.s); } else k.calT = Math.max(0, k.calT - dt * .5);
      if (k.calT >= 1.1) { calibDone[i] = true; const a = k.calS.slice(-40).sort((x, y) => x - y); k.base = a[a.length >> 1]; }
    }
    $('#cb-' + 'LR'[i]).style.width = (calibDone[i] ? 100 : (k.calT / 1.1) * 100) + '%';
    $('#cl-' + 'LR'[i]).textContent = `(${'LR'[i]}) ` + (calibDone[i] ? 'locked' : !k.present ? 'not seen' : now() - k.fistT < 300 ? 'hold…' : 'make a fist');
    if (calibDone[i]) done++;
  });
  $('#calib-count').textContent = `${done} of 2 fists`;
  $('#btn-one').hidden = done !== 1;
  if (done === 2) startTestPunches();
}
function startTestPunches() {
  STATE = 'calibp'; testPeaks = [];
  T.forEach((k) => { k.armed = true; k.pending = 0; });
  $('#calib-step1').hidden = true; $('#calib-step2').hidden = false;
  $('#calib-steplabel').textContent = '(step 02 / 02 · test punches)';
  drawTestPips();
}
function drawTestPips() {
  $('#test-pips').innerHTML = [0, 1, 2].map((i) => `<i class="${i < testPeaks.length ? 'on' : ''}"></i>`).join('');
  $('#test-count').textContent = `${testPeaks.length} of 3 punches`;
}
function testPunch(peak) {
  testPeaks.push(peak); thud('medium'); drawTestPips();
  if (testPeaks.length >= 3) {
    const avg = testPeaks.reduce((a, b) => a + b, 0) / testPeaks.length;
    // light = well under your normal punch, heavy = clearly harder than it
    PUNCH.trig = clamp(avg * .25, .6, 1.6); PUNCH.med = Math.max(PUNCH.trig * 1.3, avg * .5); PUNCH.heavy = Math.max(PUNCH.med * 1.5, avg * 1.1); PUNCH.measured = true;
    STATE = 'calib-ok';
    setTimeout(finishCalib, 600);
  }
}
function finishCalib() { goPlay(); }
function startFromChoose() { if (mouseMode) goPlay(); else goCalib(); }
$('#btn-one').onclick = () => startTestPunches();
$('#btn-skiptest').onclick = () => { STATE = 'calib-ok'; finishCalib(); };

// ---------------------------------------------------------------- choose
const row = $('#fist-row');
for (let t = 1; t <= 5; t++) {
  const b = document.createElement('button'); b.className = 'fist'; b.dataset.t = t; b.setAttribute('aria-label', 'Fist tone ' + t);
  b.innerHTML = `<img src="fists_t${t}.webp" alt=""><span>(0${t})</span><div class="dwell"><i></i></div>`;
  b.onclick = () => { selectTone(t); };
  b.ondblclick = () => { selectTone(t); startFromChoose(); };
  row.appendChild(b);
}
function selectTone(t) { tone = t; row.querySelectorAll('.fist').forEach((b) => b.classList.toggle('sel', +b.dataset.t === t)); $('#btn-start').textContent = mouseMode ? `Start punching with (0${t})` : `Continue with (0${t}) · calibrate`; }
selectTone(3);
$('#btn-start').onclick = () => startFromChoose();
function goChoose() {
  STATE = 'choose'; show('scr-choose'); selectTone(tone);
  document.querySelectorAll('#scr-choose .pips i')[1].classList.toggle('on', mouseMode);
  $('#choose-step').textContent = mouseMode ? '(choose your fist)' : '(step 01 / 02 · choose)';
  $('#choose-hint').textContent = mouseMode ? '(click a fist · Enter to start)' : '(click a fist, or hold your fist over one)';
}
let hoverTone = 0, hoverT = 0;
function chooseFrame(dt) {
  const cur = $('#hand-cursor');
  const k = [...T].filter((x) => x.present).sort((a, b) => b.lastSeen - a.lastSeen)[0];
  if (!k || mouseMode) { cur.style.display = 'none'; return; }
  const p = stageToWin(k.x, k.y);
  cur.style.display = 'block'; cur.style.left = p.x + 'px'; cur.style.top = p.y + 'px';
  cur.classList.toggle('fist', now() - k.fistT < 300);
  let hit = 0;
  row.querySelectorAll('.fist').forEach((b) => { const r = b.getBoundingClientRect(); const on = p.x > r.left && p.x < r.right && p.y > r.top - 40 && p.y < r.bottom + 40; b.classList.toggle('hov', on); if (on) hit = +b.dataset.t; });
  if (hit && hit === hoverTone) hoverT += dt; else { hoverTone = hit; hoverT = 0; }
  row.querySelectorAll('.dwell i').forEach((i, n) => { i.style.width = (n + 1 === hoverTone ? clamp(hoverT / .7, 0, 1) * 100 : 0) + '%'; });
  if (hoverTone && hoverT > .7 && tone !== hoverTone) selectTone(hoverTone);
}

// ---------------------------------------------------------------- play
function resetWall() {
  dctx.clearRect(0, 0, dmg.width, dmg.height);
  Object.assign(G, { hp: WALL_HP, hits: 0, start: now(), end: 0, stageMid: 0, stageNear: 0, shake: 0, particles: [], armPunch: [0, 0], breakT: 0, hole: null });
  $('#integ').style.width = '100%';
}
function goPlay() {
  if (STATE === 'play') return;
  tonePicked = true;
  $('#hand-cursor').style.display = 'none';
  $('#replay-ui').classList.remove('on'); freeze = null; replay = null;
  STATE = 'play'; show('none'); setHud(true); resetWall(); rec.reset(); $('#warn').hidden = true;
  $('#hint').textContent = mouseMode ? '(click to punch · hold longer to hit harder)' : '(punch the wall · closed fists)';
  $('#btn-recal').hidden = mouseMode;
  T.forEach((k) => { k.armed = true; k.pending = 0; });
}
// Next wall: recalibrate first when that setting is on (camera only)
function again(forceCalib) {
  if (!mouseMode && (forceCalib || S.calibEvery)) { $('#replay-ui').classList.remove('on'); freeze = null; replay = null; goCalib(); }
  else { STATE = 'restart'; goPlay(); }
}
function onPunch(side, x, y, tier) {
  if (STATE !== 'play') return;
  const v = visRect();
  x = clamp(x, v.x + 60, v.x + v.w - 60); y = clamp(y, v.y + 60, v.y + v.h - 60);
  G.armPunch[side] = now(); G.armHit[side] = { x, y };
  G.hits++;
  G.hp -= DMG[tier];
  thud(tier);
  G.shake = Math.max(G.shake, { light: 5, medium: 11, heavy: 20 }[tier]);
  if (G.hp <= 0 || (now() - G.start) / 1000 >= ROUND) { breakWall(x, y); return; }
  stamp(x, y, tier);
  crumbs(x, y, tier);
  updateStages();
}
// Damage shows your punches, but the wall also weakens with the clock so every round lands near 45 s
function updateStages() {
  if (STATE !== 'play') return;
  const d = Math.max(1 - G.hp / WALL_HP, (now() - G.start) / 1000 / ROUND * .95);
  if (d >= .35 && !G.stageMid) G.stageMid = now();
  if (d >= .7 && !G.stageNear) G.stageNear = now();
  $('#integ').style.width = clamp((1 - d) * 100, 0, 100) + '%';
}
function stamp(x, y, tier) {
  const v = 1 + Math.floor(Math.random() * 6), im = IMG[tier + v]; if (!im) return;
  const sz = { light: 170, medium: 250, heavy: 340 }[tier] * rand(.9, 1.1);
  dctx.save(); dctx.scale(DS, DS); dctx.translate(x, y);
  // hairline cracks can point any way; marks that show brick stay level so the courses line up
  if (tier === 'light') dctx.rotate(rand(-Math.PI, Math.PI));
  if (Math.random() < .5) dctx.scale(-1, 1);
  dctx.drawImage(im, -sz / 2, -sz / 2, sz, sz); dctx.restore();
}
function crumbs(x, y, tier) {
  const n = { light: 5, medium: 10, heavy: 18 }[tier];
  for (let i = 0; i < n; i++) G.particles.push({ kind: 'crumb', img: IMG['chunk' + Math.floor(rand(0, 14))], x: x + rand(-20, 20), y: y + rand(-20, 20), vx: rand(-160, 160), vy: rand(-260, 40), r: rand(0, 6), vr: rand(-8, 8), s: rand(6, tier === 'heavy' ? 22 : 14), life: rand(.8, 1.4), t: 0 });
  const puffs = { light: 1, medium: 2, heavy: 4 }[tier];
  for (let i = 0; i < puffs; i++) G.particles.push({ kind: 'dust', x: x + rand(-25, 25), y: y + rand(-25, 25), vx: rand(-30, 30), vy: rand(-30, 10), s: rand(30, 60), grow: rand(60, 120), life: rand(.7, 1.2), t: 0, a: tier === 'light' ? .18 : .3 });
}

// ---------------------------------------------------------------- mouse mode only (ignored in camera mode)
addEventListener('mousemove', (e) => { if (!mouseMode) return; const p = winToStage(e.clientX, e.clientY); G.mouse.x = p.x; G.mouse.y = p.y; G.mouse.t = now(); });
cv.addEventListener('mousedown', (e) => { if (mouseMode && STATE === 'play') G.mouse.down = now(); });
addEventListener('mouseup', (e) => {
  if (mouseMode && STATE === 'play' && G.mouse.down) {
    const held = now() - G.mouse.down; G.mouse.down = 0;
    const p = winToStage(e.clientX, e.clientY);
    onPunch(p.x < SW / 2 ? 0 : 1, p.x, p.y, held < 160 ? 'light' : held < 480 ? 'medium' : 'heavy');
  }
});
addEventListener('pointerdown', () => { if (STATE === 'replay') finishReplay(); });
$('#btn-restart').onclick = () => again(false);
$('#btn-recal').onclick = () => again(true);
addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('dialog')) return;
  if (STATE === 'choose') {
    if (e.key === 'ArrowLeft') selectTone(clamp(tone - 1, 1, 5));
    if (e.key === 'ArrowRight') selectTone(clamp(tone + 1, 1, 5));
    if (e.key === 'Enter') startFromChoose();
  } else if (STATE === 'play') {
    if (mouseMode && (e.key === ' ' || e.key === 'f' || e.key === 'j')) { e.preventDefault(); onPunch(e.key === 'f' ? 0 : 1, G.mouse.x, G.mouse.y, e.shiftKey ? 'heavy' : 'medium'); }
    if (e.key === 'r' || e.key === 'R') again(false);
    if (e.key === 'c' || e.key === 'C') { if (!mouseMode) again(true); }
  } else if (STATE === 'replay') { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') finishReplay(); }
  else if (STATE === 'end') {
    if (e.key === 'Enter') again(false); if (e.key === 's' || e.key === 'S') saveFrame(); if (e.key === 'r' || e.key === 'R') startReplay();
    if ((e.key === 'c' || e.key === 'C') && !mouseMode) again(true);
  }
  if (e.key === 'd' && e.altKey) { S.debug = !S.debug; $('#debug').style.display = S.debug ? 'block' : 'none'; }
});

// ---------------------------------------------------------------- recorder (for the reveal replay)
const rec = {
  W: 640, H: 360, max: 120, frames: [], idx: 0, count: 0, lastT: 0, breakCount: -1, stopAt: 0,
  reset() { this.idx = 0; this.count = 0; this.breakCount = -1; this.stopAt = 0; this.lastT = 0; this.times = []; },
  grab() {
    if (!camOn || video.readyState < 2) return;
    const t = now(); if (t - this.lastT < 30) return; this.lastT = t;
    if (this.stopAt && t > this.stopAt) return;
    let c = this.frames[this.idx];
    if (!c) { c = document.createElement('canvas'); c.width = this.W; c.height = this.H; this.frames[this.idx] = c; }
    const g = c.getContext('2d'); g.save(); g.translate(this.W, 0); g.scale(-1, 1); drawCover(g, video, this.W, this.H, video.videoWidth, video.videoHeight); g.restore();
    this.times[this.idx] = t;
    this.idx = (this.idx + 1) % this.max; this.count++;
  },
  // ordered list of frames from `fromMs` before the break to the end of the recording
  clip(fromMs) {
    const n = Math.min(this.count, this.max), out = [];
    for (let i = 0; i < n; i++) { const j = (this.idx - n + i + this.max) % this.max; out.push({ c: this.frames[j], t: this.times[j] }); }
    return out.filter((f) => f.t >= G.breakT - fromMs);
  }
};

// ---------------------------------------------------------------- the break
function breakWall(x, y) {
  $('#warn').hidden = true;
  STATE = 'break'; G.breakT = now(); G.end = G.breakT;
  $('#integ').style.width = '0%';
  const v = visRect();
  const hw = 470, hh = 400; // hole half size in stage px
  G.hole = { x: clamp(x, v.x + hw * .7, v.x + v.w - hw * .7), y: clamp(y, v.y + hh * .7, v.y + v.h - hh * .7), w: hw * 2, h: hh * 2 };
  boom(); G.shake = 38;
  rec.stopAt = G.breakT + 2200;
  for (let i = 0; i < 46; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(200, 900);
    G.particles.push({ kind: 'fly', img: IMG['chunk' + Math.floor(rand(0, 14))], x: G.hole.x + Math.cos(a) * rand(40, 260), y: G.hole.y + Math.sin(a) * rand(40, 220), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, r: rand(0, 6), vr: rand(-6, 6), s: rand(24, 70), z: rand(0, .3), vz: rand(.5, 1.3), life: rand(.9, 1.6), t: 0 });
  }
  for (let i = 0; i < 10; i++) G.particles.push({ kind: 'dust', x: G.hole.x + rand(-300, 300), y: G.hole.y + rand(-250, 250), vx: rand(-80, 80), vy: rand(-60, 30), s: rand(80, 160), grow: rand(120, 260), life: rand(1.2, 2.2), t: 0, a: .45 });
  setHud(false);
  if (mouseMode || !camOn) setTimeout(() => { STATE = 'end'; showEnd(); }, 2600);
  else setTimeout(startReplay, 2400);
}
function composeWall() {
  wctx.globalCompositeOperation = 'source-over';
  wctx.clearRect(0, 0, SW, SH);
  wctx.drawImage(IMG.wall, 0, 0, SW, SH);
  wctx.drawImage(dmg, 0, 0, SW, SH);
  drawOverlays(wctx);
  if (G.hole) {
    const { x, y, w, h } = G.hole;
    wctx.globalCompositeOperation = 'destination-out';
    wctx.drawImage(IMG.holeMask, x - w / 2, y - h / 2, w, h);
    wctx.globalCompositeOperation = 'source-over';
    wctx.save(); wctx.shadowColor = 'rgba(20,8,4,.55)'; wctx.shadowBlur = 22; wctx.shadowOffsetX = 6; wctx.shadowOffsetY = 10;
    wctx.drawImage(IMG.hole, x - w / 2, y - h / 2, w, h); wctx.restore();
  }
}
function drawOverlays(g) {
  const t = now();
  if (G.stageMid) { g.globalAlpha = clamp((t - G.stageMid) / 500, 0, 1); if (!G.stageNear) g.drawImage(IMG.cracksMid, 0, 0, SW, SH); g.globalAlpha = 1; }
  if (G.stageNear) {
    g.globalAlpha = clamp((t - G.stageNear) / 500, 0, 1);
    g.drawImage(IMG.cracksNear, 0, 0, SW, SH);
    // real-photo openings (sizes keep bricks ~8 in on the 12 ft wall)
    g.drawImage(IMG.reveal1, -60, -110, 932, 836);
    g.drawImage(IMG.reveal2, 455, 160, 1145, 940);
    g.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- replay + end
let replay = null, freeze = null;
function startReplay() {
  const frames = rec.clip(500);
  if (!frames.length) { STATE = 'end'; showEnd(); return; }
  show('none'); $('#replay-ui').classList.add('on');
  replay = { frames, t0: now(), speed: .4 };
  STATE = 'replay';
}
function finishReplay() {
  if (!replay) return;
  const f = replay.frames; let fi = f.findIndex((x) => x.t >= G.breakT + 900); if (fi < 0) fi = f.length - 1;
  freeze = f[fi].c;
  replay = null; $('#replay-ui').classList.remove('on'); STATE = 'end'; showEnd();
}
function showEnd() {
  const s = Math.round((G.end - G.start) / 1000);
  $('#end-time').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  $('#end-hits').textContent = G.hits;
  $('#btn-save').hidden = mouseMode; $('#btn-rewatch').hidden = mouseMode; $('#btn-recal-end').hidden = mouseMode;
  $('#btn-again').textContent = !mouseMode && S.calibEvery ? 'Calibrate & break another' : 'Break another wall';
  $('#btn-mode').textContent = mouseMode ? 'Switch to camera' : 'Switch to mouse';
  show('scr-end');
}
$('#btn-again').onclick = () => again(false);
$('#btn-recal-end').onclick = () => again(true);
$('#btn-mode').onclick = () => goIntro();
$('#btn-rewatch').onclick = () => startReplay();
$('#btn-save').onclick = saveFrame;
function saveFrame() {
  if (!freeze) return;
  const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const g = c.getContext('2d');
  g.drawImage(freeze, 0, 0, 1280, 720);
  const gr = g.createLinearGradient(0, 360, 0, 720); gr.addColorStop(0, 'rgba(30,11,6,0)'); gr.addColorStop(1, 'rgba(30,11,6,.85)'); g.fillStyle = gr; g.fillRect(0, 0, 1280, 720);
  g.fillStyle = '#F4E8D6'; g.font = '900 92px Unbounded, Arial Black, sans-serif'; g.fillText('THE REAL YOU.', 56, 640);
  g.font = '500 18px "IBM Plex Mono", monospace'; g.fillText(`(rage wall · wall down in ${$('#end-time').textContent} · ${G.hits} punches)`, 60, 682);
  c.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'rage-wall.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }, 'image/png');
}

// ---------------------------------------------------------------- settings UI
const dlg = $('#settings');
$('#btn-gear').onclick = () => { $('#set-sens').value = String(S.sens); $('#set-fist').checked = S.fistOnly; $('#set-sound').checked = S.sound; $('#set-debug').checked = S.debug; $('#set-calib').checked = S.calibEvery; dlg.showModal(); };
dlg.addEventListener('close', () => { S.sens = +$('#set-sens').value; S.fistOnly = $('#set-fist').checked; S.sound = $('#set-sound').checked; S.debug = $('#set-debug').checked; S.calibEvery = $('#set-calib').checked; $('#debug').style.display = S.debug ? 'block' : 'none'; saveSettings(); });
$('#debug').style.display = S.debug ? 'block' : 'none';

// ---------------------------------------------------------------- drawing helpers
function drawCover(g, src, w, h, sw, sh) {
  if (!sw || !sh) return; const s = Math.max(w / sw, h / sh); const dw = sw * s, dh = sh * s; g.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
function drawArm(g, key, target, alpha = 1, depth = 1) {
  const m = ARM[key.replace(/_t\d$/, '')], im = IMG[key]; if (!m || !im) return;
  const [ax, ay] = m.anchor, [px, py] = m.pivot, [bx, by, bw, bh] = m.box;
  const ang = clamp(Math.atan2(target.y - py, target.x - px) - Math.atan2(ay - py, ax - px), -1.0, 1.0);
  const k = clamp(Math.hypot(target.x - px, target.y - py) / Math.hypot(ax - px, ay - py), .78, 1.25) * depth;
  // where the fist lands after rotate+scale; move the whole arm the rest of the way so the fist is on target
  const c = Math.cos(ang), s2 = Math.sin(ang), rx = px + ((ax - px) * c - (ay - py) * s2) * k, ry = py + ((ax - px) * s2 + (ay - py) * c) * k;
  const nx = clamp(target.x - rx, -320, 320), ny = clamp(target.y - ry, -200, 260);
  g.save(); g.globalAlpha = alpha; g.translate(nx, ny); g.translate(px, py); g.rotate(ang); g.scale(k, k); g.translate(-px, -py);
  g.shadowColor = 'rgba(59,24,16,.3)'; g.shadowBlur = 24 * depth; g.shadowOffsetX = 16 * depth; g.shadowOffsetY = 20 * depth;
  g.drawImage(im, bx, by, bw, bh); g.restore();
}
const armPos = [{ x: 547, y: 474 }, { x: 969, y: 551 }];
const PUNCH_MS = 200;
function drawArms(g, dt, alpha = 1) {
  const t = now();
  for (let i = 0; i < 2; i++) {
    const side = 'LR'[i], k = T[i];
    let tx, ty, follow = 1 - Math.pow(.0005, dt);
    if (mouseMode) {
      if (i === 1) { tx = G.mouse.x; ty = G.mouse.y; } else { tx = ARM.L_guard.anchor[0]; ty = ARM.L_guard.anchor[1] + Math.sin(t / 700) * 6; }
    } else if (k.present) {
      const ahead = clamp((t - k.lastSeen) / 1000 + .045, 0, .12); // predict ~45 ms ahead of the last tracker frame
      tx = k.x + k.vx * ahead; ty = k.y + k.vy * ahead; follow = 1 - Math.pow(1e-7, dt); // near-instant
    } else { const a = ARM[side + '_guard'].anchor; tx = a[0]; ty = a[1] + Math.sin(t / 700 + i) * 6 + 30; follow = 1 - Math.pow(.02, dt); }
    armPos[i].x = lerp(armPos[i].x, tx, follow); armPos[i].y = lerp(armPos[i].y, ty, follow);
    const pt = t - G.armPunch[i];
    if (pt < PUNCH_MS && G.armHit[i]) {
      // snap out to the impact point, shrink slightly as the fist goes "into" the wall, then ease back
      const out = pt < 70 ? pt / 70 : 1 - (pt - 70) / (PUNCH_MS - 70) * .6;
      const hit = G.armHit[i], tp = { x: lerp(armPos[i].x, hit.x, out), y: lerp(armPos[i].y, hit.y, out) };
      drawArm(g, `${side}_punch_t${tone}`, tp, alpha, 1 - .1 * out);
    } else drawArm(g, `${side}_guard_t${tone}`, armPos[i], alpha);
    // aim marker on the wall so you can see where each fist is tracked
    if (!mouseMode && k.present && STATE === 'play') {
      g.save(); g.globalAlpha = .55 * alpha; g.strokeStyle = t - k.fistT < 900 ? '#FFFFFF' : '#F2B38A'; g.lineWidth = 2;
      g.beginPath(); g.arc(tx, ty, 16, 0, 7); g.stroke(); g.beginPath(); g.arc(tx, ty, 3, 0, 7); g.fillStyle = g.strokeStyle; g.fill(); g.restore();
    }
  }
}
function updateParticles(g, dt) {
  const keep = [];
  for (const p of G.particles) {
    p.t += dt; if (p.t > p.life) continue; keep.push(p);
    const f = 1 - p.t / p.life;
    if (p.kind === 'crumb') {
      p.vy += 1400 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
      g.save(); g.globalAlpha = Math.min(1, f * 3); g.translate(p.x, p.y); g.rotate(p.r); if (p.img) g.drawImage(p.img, -p.s / 2, -p.s / 2, p.s, p.s); g.restore();
    } else if (p.kind === 'dust') {
      p.x += p.vx * dt; p.y += p.vy * dt; p.s += p.grow * dt;
      const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s); gr.addColorStop(0, `rgba(226,214,198,${p.a * f})`); gr.addColorStop(1, 'rgba(226,214,198,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.s, 0, 7); g.fill();
    } else if (p.kind === 'fly') { // debris flying at the lens
      p.z += p.vz * dt; p.vy += 500 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
      const s = p.s / Math.max(.08, 1 - p.z);
      if (p.z > .95) continue;
      g.save(); g.globalAlpha = Math.min(1, f * 2); g.translate(p.x, p.y); g.rotate(p.r);
      if (p.z > .55) g.filter = `blur(${((p.z - .55) * 18).toFixed(1)}px)`;
      if (p.img) g.drawImage(p.img, -s / 2, -s / 2, s, s); g.restore();
    }
  }
  G.particles = keep;
}

// ---------------------------------------------------------------- main loop
let lastT = now();
function frame() {
  const t = now(), dt = Math.min(.05, (t - lastT) / 1000); lastT = t;
  if (STATE === 'calib' || STATE === 'calibp' || STATE === 'calib-ok') calibFrame(dt);
  if (STATE === 'choose') chooseFrame(dt);
  if (STATE === 'play' || STATE === 'break') rec.grab();
  sampleLight();
  if (STATE === 'calib' || STATE === 'calibp') updateWarn($('#calib-warn'));
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#1E0B06'; ctx.fillRect(0, 0, VW, VH);
  if (STATE === 'play' || STATE === 'break' || STATE === 'choose' || STATE === 'intro') renderWall(dt);
  if (STATE === 'replay') renderReplay();
  if (STATE === 'end') renderFreeze();
  if (STATE === 'play') {
    if (!mouseMode) updateWarn($('#warn'));
    $('#dotL').className = 'dot' + (T[0].present ? (t - T[0].fistT < 450 ? ' closed' : ' on') : '');
    $('#dotR').className = 'dot' + (T[1].present ? (t - T[1].fistT < 450 ? ' closed' : ' on') : '');
  }
  requestAnimationFrame(frame);
}
function renderWall(dt) {
  if (!IMG.wall) return;
  G.shake *= Math.pow(.02, dt);
  const shx = (Math.random() - .5) * G.shake, shy = (Math.random() - .5) * G.shake;
  ctx.save(); ctx.translate(ox + shx, oy + shy); ctx.scale(sc, sc);
  if (STATE === 'break') {
    const bt = (now() - G.breakT) / 1000;
    // behind the wall: the live camera (that's you)
    if (camOn && video.readyState >= 2) {
      ctx.save(); const v = visRect(); ctx.translate(v.x + v.w, v.y); ctx.scale(-1, 1); drawCover(ctx, video, v.w, v.h, video.videoWidth, video.videoHeight); ctx.restore();
    } else { const v = visRect(); ctx.save(); ctx.translate(v.x, v.y); drawCover(ctx, IMG.back, v.w, v.h, IMG.back.width, IMG.back.height); ctx.restore(); ctx.fillStyle = 'rgba(20,8,4,.35)'; ctx.fillRect(-2000, -2000, 6000, 6000); }
    composeWall();
    // after a beat, fly through the hole
    const z = bt < .9 ? 0 : Math.pow(clamp((bt - .9) / 1.3, 0, 1), 2.2);
    const zs = 1 + z * 7;
    ctx.save(); ctx.translate(G.hole.x, G.hole.y); ctx.scale(zs, zs); ctx.translate(-G.hole.x, -G.hole.y);
    ctx.globalAlpha = 1 - clamp((z - .75) * 4, 0, 1);
    ctx.drawImage(wallLayer, 0, 0);
    ctx.restore();
    if (bt < 1.6) drawArms(ctx, dt, 1 - clamp((bt - .6) / .6, 0, 1));
    const fl = clamp(1 - bt / .18, 0, 1); if (fl > 0) { ctx.fillStyle = `rgba(255,241,220,${fl * .8})`; ctx.fillRect(-2000, -2000, 6000, 6000); }
    updateParticles(ctx, dt);
  } else {
    ctx.drawImage(IMG.wall, 0, 0, SW, SH);
    ctx.drawImage(dmg, 0, 0, SW, SH);
    drawOverlays(ctx);
    // near-break vignette
    if (G.stageNear) { const v = visRect(); const gr = ctx.createRadialGradient(SW / 2, SH * .44, SH * .3, SW / 2, SH * .44, SH * .95); gr.addColorStop(0, 'rgba(74,29,20,0)'); gr.addColorStop(1, 'rgba(74,29,20,.3)'); ctx.fillStyle = gr; ctx.fillRect(v.x, v.y, v.w, v.h); }
    updateParticles(ctx, dt);
    if (STATE === 'play') drawArms(ctx, dt);
    if (STATE === 'intro' || STATE === 'choose') { ctx.fillStyle = 'rgba(30,11,6,.2)'; ctx.fillRect(-2000, -2000, 6000, 6000); }
  }
  ctx.restore();
}
function renderReplay() {
  const r = replay; if (!r) return;
  const f = r.frames, span = f[f.length - 1].t - f[0].t;
  const el = (now() - r.t0) * r.speed;
  if (el > span + 250) { finishReplay(); return; }
  const target = f[0].t + el; let i = f.findIndex((x) => x.t >= target); if (i < 0) i = f.length - 1;
  drawGraded(f[i].c, clamp((el - 500) / 400, 0, 1));
  $('#replay-label').textContent = `(replay) ${r.speed}× · ${f[i].t < G.breakT ? 'before' : 'the moment it broke'}`;
}
function renderFreeze() { if (freeze) drawGraded(freeze, 1); else if (IMG.back) drawGraded(IMG.back, 1); }
function drawGraded(c, punchIn) {
  ctx.save();
  const zoom = 1 + .08 * punchIn;
  ctx.translate(VW / 2, VH / 2); ctx.scale(zoom, zoom); ctx.translate(-VW / 2, -VH / 2);
  ctx.filter = 'contrast(1.08) saturate(1.12) sepia(.14)';
  drawCover(ctx, c, VW, VH, c.width, c.height);
  ctx.restore();
  ctx.save(); ctx.globalAlpha = .07; ctx.globalCompositeOperation = 'overlay';
  const pat = ctx.createPattern(grain, 'repeat'); ctx.translate(Math.random() * 256, Math.random() * 256); ctx.fillStyle = pat; ctx.fillRect(-256, -256, VW + 512, VH + 512); ctx.restore();
  const gr = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * .35, VW / 2, VH / 2, Math.max(VW, VH) * .75);
  gr.addColorStop(0, 'rgba(30,11,6,0)'); gr.addColorStop(1, 'rgba(30,11,6,.6)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, VW, VH);
  const bar = VH * .07; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VW, bar); ctx.fillRect(0, VH - bar, VW, bar);
}

// ---------------------------------------------------------------- boot
loadAssets().then(() => { requestAnimationFrame(frame); });
if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('#btn-cam').disabled = true; $('#intro-err').hidden = false; $('#intro-err').textContent = '(this browser has no camera access · play with the mouse, or open in desktop Chrome)'; }

// Inside Claude's preview frame the camera is refused, so lead with the mouse there.
let EMBED = false; try { EMBED = window.top !== window; } catch (e) { EMBED = true; }
if (EMBED) {
  $('#btn-cam').hidden = true;
  $('#btn-mouse').textContent = 'Play with the mouse';
  $('#btn-mouse').className = 'btn btn-p';
  $('#intro-err').hidden = false;
  $('#intro-err').textContent = '(camera mode needs its own tab · deploy the folder to Vercel or run it on localhost)';
}
window.__rw = { T, G, S, PUNCH, onPunch, goPlay, goCalib, onHands, startTestPunches, get state() { return STATE; } };
