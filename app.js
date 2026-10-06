/* =========================================================
 * TCM 2026 芝公園 ARフォトフレーム
 *  - 東京タワー検知：GPS＋方位/傾きセンサー（主）＋カメラ映像の色（補助）
 *  - 出現：妖精（空を飛ぶ）／トナカイ（地面寄り）
 *  - 撮影：映像＋キャラ＋フレームを1枚に合成
 * ========================================================= */
(() => {
  'use strict';
  const C = window.TCM_CONFIG;
  const Q = new URLSearchParams(location.search);
  const TEST = C.ENV === 'test' || Q.has('test');
  const DEBUG = Q.has('debug');
  const $ = (s) => document.querySelector(s);
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const angDiff = (a, b) => ((a - b + 540) % 360) - 180; // a-b を -180..180 に

  // ---------- state ----------
  const S = {
    sessionId: Math.random().toString(36).slice(2) + Date.now().toString(36),
    liffReady: false, inClient: false, idToken: null,
    stream: null,
    pos: null, posAcc: null,
    heading: null, elev: null, hasOrientation: false,
    color: 0, prog: 0, found: false,
    anchor: null,            // 発見時の heading/elev
    view: { x: 0, y: 0 },    // 平滑化した視点オフセット(px)
    pose: 0, facing: 'environment',
    t0: performance.now(),
    lastPhoto: null, lastPhotoUrl: null
  };

  // キャラクター状態（中心座標・画面比率ベース）
  const chars = {
    fairy:    { el: $('#ch-fairy'),    imgs: ['fairy_front.webp', 'fairy_side.webp'],
                bx: 0.32, by: 0.40, hRatio: 0.16, drag: { x: 0, y: 0 }, scale: 1, x: 0, y: 0, w: 0, h: 0, rot: 0, flip: 1, alpha: 0, born: 0 },
    reindeer: { el: $('#ch-reindeer'), imgs: ['reindeer_front.webp', 'reindeer_side.webp'],
                bx: 0.64, by: 0.83, hRatio: 0.27, drag: { x: 0, y: 0 }, scale: 1, x: 0, y: 0, w: 0, h: 0, rot: 0, flip: 1, alpha: 0, born: 0, sy: 1 }
  };
  // 配置（画面比率）：自撮り時は顔を中央に空け、キャラを左右に寄せる
  const LAYOUT = {
    normal: { fairy: { bx: 0.32, by: 0.40, h: 0.16 }, reindeer: { bx: 0.64, by: 0.83, h: 0.27 } },
    selfie: { fairy: { bx: 0.20, by: 0.36, h: 0.13 }, reindeer: { bx: 0.75, by: 0.86, h: 0.21 } }
  };
  const imgCache = {};
  const loadImg = (src) => imgCache[src] || (imgCache[src] = new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src;
  }));
  Object.values(chars).forEach(c => c.imgs.forEach(loadImg));

  // ---------- copy ----------
  const T = (k) => (C.COPY && C.COPY[k]) || '';
  document.querySelectorAll('[data-copy]').forEach(el => {
    const v = C.COPY && C.COPY[el.dataset.copy]; if (v) el.innerHTML = v;
  });

  // ---------- util ----------
  const toastEl = $('#toast'); let toastTimer;
  function toast(msg, ms = 2600) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  }
  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  }

  // ---------- logging (GAS) ----------
  function log(event, extra = {}) {
    const body = {
      action: 'log', event, env: C.ENV, sessionId: S.sessionId, ts: new Date().toISOString(),
      inClient: S.inClient, ua: navigator.userAgent.slice(0, 180),
      lat: S.pos ? +S.pos.lat.toFixed(3) : null, lng: S.pos ? +S.pos.lng.toFixed(3) : null, // 約100m単位に丸める
      ...extra
    };
    if (DEBUG) console.log('[log]', body);
    if (!C.GAS_URL) return;
    try {
      fetch(C.GAS_URL, { method: 'POST', mode: 'no-cors', keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    } catch (e) { /* noop */ }
  }

  // ---------- LIFF ----------
  async function initLiff() {
    if (!C.LIFF_ID || !window.liff) return;
    try {
      await liff.init({ liffId: C.LIFF_ID });
      S.liffReady = true; S.inClient = liff.isInClient();
      if (liff.isLoggedIn()) S.idToken = liff.getIDToken();
    } catch (e) { console.warn('LIFF init failed', e); }
  }

  // ---------- sensors ----------
  async function requestMotionPermission() {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try { return (await DOE.requestPermission()) === 'granted'; } catch (e) { return false; }
    }
    return true;
  }
  function screenAngle() {
    return (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  }
  // 端末の背面カメラが向いている方位・仰角を算出
  function onOrientation(e) {
    if (e.alpha == null && e.webkitCompassHeading == null) return;
    const a = (e.alpha || 0) * D2R, b = (e.beta || 0) * D2R, g = (e.gamma || 0) * D2R;
    const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
    // カメラ方向ベクトル = R * (0,0,-1)
    const vx = -(cG * sA * sB + cA * sG);
    const vy = -(sA * sG - cA * cG * sB);
    const vz = -cB * cG;
    const elev = Math.asin(clamp(vz, -1, 1)) * R2D;
    let heading = null;
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) {
      heading = e.webkitCompassHeading; // iOS：真北基準
      heading = (heading + screenAngle() + 360) % 360;
    } else if (e.absolute === true || e.type === 'deviceorientationabsolute') {
      heading = (Math.atan2(vx, vy) * R2D + 360) % 360;
    }
    if (heading == null) return;
    S.hasOrientation = true;
    S.heading = S.heading == null ? heading : (S.heading + angDiff(heading, S.heading) * 0.25 + 360) % 360;
    S.elev = S.elev == null ? elev : lerp(S.elev, elev, 0.25);
  }
  function startSensors() {
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrientation, true);
    window.addEventListener('deviceorientation', onOrientation, true);
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition(p => {
        S.pos = { lat: p.coords.latitude, lng: p.coords.longitude }; S.posAcc = p.coords.accuracy;
      }, () => {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
    }
  }
  function towerGeometry() {
    const from = S.pos || C.FALLBACK_POS, to = C.TOWER;
    const φ1 = from.lat * D2R, φ2 = to.lat * D2R, Δλ = (to.lng - from.lng) * D2R, Δφ = φ2 - φ1;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const bearing = (Math.atan2(y, x) * R2D + 360) % 360;
    const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    const dist = 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    const elevTop = Math.atan2(to.height - 1.5, dist) * R2D;
    const elevMid = Math.atan2(to.height * 0.45, dist) * R2D;
    return { bearing, dist, elevTop, elevMid };
  }

  // ---------- camera ----------
  const video = $('#cam');
  async function startCamera(facing = S.facing) {
    if (S.stream) S.stream.getTracks().forEach(t => t.stop());
    const constraints = { audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } } };
    S.stream = await navigator.mediaDevices.getUserMedia(constraints);
    // 実際に使われたカメラの向き（端末によっては指定どおりにならない）
    const set = S.stream.getVideoTracks()[0].getSettings ? S.stream.getVideoTracks()[0].getSettings() : {};
    S.facing = set.facingMode || facing;
    video.srcObject = S.stream;
    video.classList.toggle('mirror', S.facing === 'user');
    await video.play().catch(() => {});
  }
  // インカメラ時はカメラが逆向き：方位+180°、仰角は反転
  const selfie = () => S.facing === 'user';
  function camHeading() { return S.heading == null ? null : selfie() ? (S.heading + 180) % 360 : S.heading; }
  function camElev() { return S.elev == null ? null : selfie() ? -S.elev : S.elev; }

  // 画像（色）による補助判定：画面上部中央の「タワーらしい暖色」の割合
  const sampleCv = document.createElement('canvas'); sampleCv.width = 48; sampleCv.height = 64;
  const sampleCtx = sampleCv.getContext('2d', { willReadFrequently: true });
  let lastSample = 0;
  function sampleColor(now) {
    if (now - lastSample < 160 || !video.videoWidth) return;
    lastSample = now;
    const vw = video.videoWidth, vh = video.videoHeight;
    // 縦長画面で見えている範囲の上側中央（x:25-75%, y:5-60%）
    sampleCtx.drawImage(video, vw * 0.25, vh * 0.05, vw * 0.5, vh * 0.55, 0, 0, 48, 64);
    const d = sampleCtx.getImageData(0, 0, 48, 64).data;
    let warm = 0, n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r > 140 && r > g * 1.25 && r > b * 1.6 && (r - b) > 60) warm++;
    }
    const ratio = warm / n;
    S.color = lerp(S.color, clamp(ratio / 0.035, 0, 1), 0.4);
  }

  // ---------- detection & HUD ----------
  const ringProg = $('#ring-prog'), arrowEl = $('#arrow'), hintEl = $('#hint'), hud = $('#hud'), shutter = $('#btn-shutter');
  const RING_LEN = 276.5;
  let lastHint = '';
  function setHint(k) { if (k !== lastHint) { lastHint = k; hintEl.textContent = T(k); } }

  function detect(dt) {
    const g = towerGeometry();
    let score, oriScore = 0, dh = 0, dv = 0;
    const H = camHeading(), E = camElev();
    if (S.hasOrientation && H != null) {
      dh = angDiff(g.bearing, H);                  // +:右に回す
      const lo = -C.DETECT.elevMargin * 0.5, hi = g.elevTop + C.DETECT.elevMargin;
      dv = E < lo ? (g.elevMid - E) : E > hi ? (g.elevMid - E) : 0; // +:上げる
      const tol = C.DETECT.headingTolerance, hs = clamp((tol - Math.abs(dh)) / (tol * 0.5), 0, 1);
      const vs = dv === 0 ? 1 : clamp(1 - Math.abs(dv) / 20, 0, 1);
      oriScore = hs * vs;
      score = oriScore * (1 - C.DETECT.colorWeight) + S.color * C.DETECT.colorWeight;
      // 方位がぴったりなら色に関係なく出せるようにする（夜間・逆光対策）
      if (oriScore > 0.8) score = Math.max(score, 0.75);
    } else {
      score = S.color;
    }
    const target = score > 0.6;
    S.prog = clamp(S.prog + (target ? dt / C.DETECT.holdSeconds : -dt / 0.8), 0, 1);

    // HUD
    ringProg.style.strokeDashoffset = RING_LEN * (1 - S.prog);
    if (S.hasOrientation) {
      const rot = Math.atan2(clamp(selfie() ? -dh : dh, -60, 60), clamp(dv, -60, 60) || 0.0001) * R2D;
      const onTarget = Math.abs(dh) < C.DETECT.headingTolerance * 0.5 && dv === 0;
      arrowEl.classList.toggle('target', onTarget);
      arrowEl.style.transform = onTarget ? '' : `rotate(${rot}deg)`;
    } else {
      arrowEl.style.opacity = 0.35;
    }
    if (g.dist > C.DETECT.maxDistance && S.pos) setHint('hintFar');
    else if (S.prog > 0.15) setHint('hintAlmost');
    else if (!S.hasOrientation) setHint(performance.now() - S.t0 > 3000 ? 'hintNoSensor' : 'hintSearch');
    else if (Math.abs(dh) > C.DETECT.headingTolerance) setHint(dh < 0 ? 'hintTurnLeft' : 'hintTurnRight');
    else if (dv > 0) setHint('hintUp');
    else if (dv < 0) setHint('hintDown');
    else setHint('hintSearch');

    if (DEBUG) {
      $('#debug').hidden = false;
      $('#debug').textContent =
        `pos ${S.pos ? S.pos.lat.toFixed(5) + ',' + S.pos.lng.toFixed(5) + ' ±' + Math.round(S.posAcc) + 'm' : 'fallback'}\n` +
        `dist ${Math.round(g.dist)}m bearing ${g.bearing.toFixed(1)} top ${g.elevTop.toFixed(1)}°\n` +
        `heading ${S.heading == null ? '-' : S.heading.toFixed(1)} elev ${S.elev == null ? '-' : S.elev.toFixed(1)}\n` +
        `dh ${dh.toFixed(1)} dv ${dv.toFixed(1)} ori ${oriScore.toFixed(2)} color ${S.color.toFixed(2)}\n` +
        `score ${score.toFixed(2)} prog ${S.prog.toFixed(2)}`;
    }
    if (S.prog >= 1) onFound(g);
  }

  function onFound(g) {
    if (S.found) return;
    S.found = true;
    S.anchor = { heading: camHeading(), elev: camElev(), facing: S.facing };
    S.view = { x: 0, y: 0 };
    const now = performance.now();
    chars.fairy.born = now; chars.reindeer.born = now + 450;
    Object.values(chars).forEach(c => { c.drag = { x: 0, y: 0 }; c.scale = 1; c.el.classList.add('on'); });
    burst();
    setHint('hintFound');
    toast(T('toastFound'));
    setTimeout(() => hud.classList.add('hidden'), 1600);
    shutter.disabled = false;
    if (navigator.vibrate) navigator.vibrate([30, 40, 60]);
    log('found', { dist: Math.round(g.dist), viaSensor: S.hasOrientation, color: +S.color.toFixed(2) });
  }
  function resetSearch() {
    S.found = false; S.prog = 0; S.anchor = null;
    Object.values(chars).forEach(c => { c.el.classList.remove('on'); c.alpha = 0; });
    hud.classList.remove('hidden'); shutter.disabled = true; setHint('hintSearch');
  }
  function burst() {
    const b = $('#burst'); b.innerHTML = '';
    for (let i = 0; i < 28; i++) {
      const s = document.createElement('i');
      const ang = Math.random() * Math.PI * 2, r = 80 + Math.random() * 140;
      s.style.setProperty('--dx', Math.cos(ang) * r + 'px'); s.style.setProperty('--dy', Math.sin(ang) * r + 'px');
      s.style.animationDelay = (Math.random() * 0.15) + 's';
      if (i % 3 === 0) s.style.background = '#F0A8C8';
      b.appendChild(s);
    }
  }

  // ---------- character animation ----------
  const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  function animateChars(now) {
    const vw = innerWidth, vh = innerHeight;
    // 疑似ワールド固定：発見時の向きからのズレだけキャラをずらす
    if (S.found && S.anchor && S.anchor.heading != null && S.heading != null) {
      const pxPerDeg = vw / 55, sgn = selfie() ? 1 : -1; // インカメラは鏡像表示なので左右の動きが逆
      const tx = clamp(sgn * angDiff(camHeading(), S.anchor.heading) * pxPerDeg, -vw * 0.7, vw * 0.7);
      const ty = clamp((camElev() - S.anchor.elev) * pxPerDeg, -vh * 0.5, vh * 0.5);
      S.view.x = lerp(S.view.x, tx, 0.2); S.view.y = lerp(S.view.y, ty, 0.2);
    }
    const t = now / 1000;

    // 妖精：空をふわふわ飛ぶ（8の字＋上下）
    const L = selfie() ? LAYOUT.selfie : LAYOUT.normal;
    const f = chars.fairy;
    f.bx = lerp(f.bx, L.fairy.bx, 0.08); f.by = lerp(f.by, L.fairy.by, 0.08); f.hRatio = lerp(f.hRatio, L.fairy.h, 0.08);
    const r0 = chars.reindeer;
    r0.bx = lerp(r0.bx, L.reindeer.bx, 0.08); r0.by = lerp(r0.by, L.reindeer.by, 0.08); r0.hRatio = lerp(r0.hRatio, L.reindeer.h, 0.08);
    f.h = vh * f.hRatio * f.scale; f.w = f.h * 0.96;
    {
      const k = clamp((now - f.born) / 1400, 0, 1), e = easeOutBack(k);
      const enterX = lerp(vw * 1.2, 0, e), enterY = lerp(-vh * 0.25, 0, e);
      const fx = Math.sin(t * 0.7) * vw * 0.10, fy = Math.sin(t * 1.4) * vh * 0.025 + Math.sin(t * 2.3) * vh * 0.008;
      f.x = vw * f.bx + fx + enterX + S.view.x + f.drag.x;
      f.y = vh * f.by + fy + enterY + S.view.y + f.drag.y;
      f.rot = Math.cos(t * 0.7) * 10 + (1 - k) * -25;
      f.flip = S.pose === 1 ? (Math.cos(t * 0.7) > 0 ? -1 : 1) : 1; // 横向き時は進行方向を向く
      f.alpha = S.found ? clamp(k * 2, 0, 1) : 0;
      if (S.found && Math.random() < 0.18) trail(f);
    }
    // トナカイ：地面寄り。ぴょこっと出て、ときどき小さく跳ねる
    const r = chars.reindeer;
    r.h = vh * r.hRatio * r.scale; r.w = r.h * (S.pose === 1 ? 0.567 : 0.974);
    {
      const k = clamp((now - r.born) / 900, 0, 1), e = easeOutBack(k);
      const cyc = (t % 3.2) / 3.2;
      let hop = 0, sq = 1;
      if (cyc > 0.70 && cyc < 0.78) sq = 1 - Math.sin((cyc - 0.70) / 0.08 * Math.PI) * 0.06;  // しゃがむ
      if (cyc >= 0.78 && cyc < 0.95) hop = Math.sin((cyc - 0.78) / 0.17 * Math.PI) * vh * 0.035; // 小ジャンプ
      r.sy = sq;
      r.x = vw * r.bx + S.view.x + r.drag.x;
      r.y = vh * r.by + (1 - e) * vh * 0.45 - hop + S.view.y + r.drag.y;
      r.rot = Math.sin(t * 1.6) * 2.5;
      r.flip = 1;
      r.alpha = S.found && now > r.born ? 1 : 0;
    }
    for (const c of [f, r]) {
      c.el.style.width = c.w + 'px'; c.el.style.height = c.h + 'px';
      c.el.style.opacity = c.alpha;
      const sy = c.sy || 1;
      // 基準点：妖精=中心、トナカイ=足元
      const oy = c === r ? -c.h : -c.h / 2;
      c.el.style.transformOrigin = c === r ? '50% 100%' : '50% 50%';
      c.el.style.transform = `translate(${c.x - c.w / 2}px, ${c.y + oy}px) rotate(${c.rot}deg) scale(${c.flip}, ${sy})`;
    }
  }
  let lastTrail = 0;
  function trail(f) {
    const now = performance.now(); if (now - lastTrail < 90) return; lastTrail = now;
    const s = document.createElement('i');
    s.className = 'sp';
    s.style.cssText = `position:absolute;left:${f.x - f.w * 0.1 + (Math.random() - .5) * f.w * .4}px;top:${f.y + f.h * 0.2}px;width:6px;height:6px;border-radius:50%;` +
      `background:${Math.random() < .5 ? '#F3DFA2' : '#F0A8C8'};box-shadow:0 0 8px #fff;pointer-events:none;transition:transform 1.2s ease-out,opacity 1.2s;`;
    $('#stage').appendChild(s);
    requestAnimationFrame(() => { s.style.transform = `translate(${(Math.random() - .5) * 30}px, ${20 + Math.random() * 30}px) scale(.3)`; s.style.opacity = 0; });
    setTimeout(() => s.remove(), 1300);
  }

  // ドラッグで移動・ピンチで拡大縮小
  function bindGestures(c) {
    const pts = new Map(); let start = null;
    c.el.addEventListener('pointerdown', (e) => {
      c.el.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      start = { drag: { ...c.drag }, scale: c.scale, pts: new Map(pts) };
    });
    c.el.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId) || !start) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const a = [...pts.values()], b = [...start.pts.values()];
      if (a.length === 1 && b.length >= 1) {
        c.drag.x = start.drag.x + (a[0].x - b[0].x); c.drag.y = start.drag.y + (a[0].y - b[0].y);
      } else if (a.length >= 2 && b.length >= 2) {
        const d0 = Math.hypot(b[0].x - b[1].x, b[0].y - b[1].y), d1 = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        c.scale = clamp(start.scale * d1 / d0, 0.5, 2.2);
      }
    });
    const end = (e) => { pts.delete(e.pointerId); start = { drag: { ...c.drag }, scale: c.scale, pts: new Map(pts) }; };
    c.el.addEventListener('pointerup', end); c.el.addEventListener('pointercancel', end);
  }
  Object.values(chars).forEach(bindGestures);

  // ---------- frame (live overlay & capture 共通) ----------
  const frameCv = $('#frame');
  function spacedText(ctx, text, cx, y, spacing) {
    const chars = [...text]; const widths = chars.map(ch => ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
    let x = cx - total / 2; const align = ctx.textAlign; ctx.textAlign = 'left';
    chars.forEach((ch, i) => { ctx.fillText(ch, x, y); x += widths[i] + spacing; });
    ctx.textAlign = align;
  }
  function star4(ctx, x, y, r, color) {
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = color; ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 - Math.PI / 2, rr = i % 2 ? r * 0.28 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function drawFrame(ctx, w, h) {
    const u = w / 100; // 1u = 幅の1%
    // 上下のグラデーション
    let gr = ctx.createLinearGradient(0, 0, 0, h * 0.24);
    gr.addColorStop(0, 'rgba(10,20,42,0.85)'); gr.addColorStop(1, 'rgba(10,20,42,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h * 0.24);
    gr = ctx.createLinearGradient(0, h * 0.82, 0, h);
    gr.addColorStop(0, 'rgba(10,20,42,0)'); gr.addColorStop(1, 'rgba(10,20,42,0.8)');
    ctx.fillStyle = gr; ctx.fillRect(0, h * 0.82, w, h * 0.18);

    // 金の二重罫
    const m = 3.2 * u;
    const gold = ctx.createLinearGradient(0, 0, w, h);
    gold.addColorStop(0, '#F3DFA2'); gold.addColorStop(0.5, '#C9A04E'); gold.addColorStop(1, '#F3DFA2');
    ctx.strokeStyle = gold; ctx.lineWidth = 0.45 * u; ctx.strokeRect(m, m, w - 2 * m, h - 2 * m);
    ctx.lineWidth = 0.18 * u; ctx.strokeRect(m + 1.1 * u, m + 1.1 * u, w - 2 * m - 2.2 * u, h - 2 * m - 2.2 * u);
    // 角の星
    [[m, m], [w - m, m], [m, h - m], [w - m, h - m]].forEach(([x, y]) => star4(ctx, x, y, 3 * u, '#F3DFA2'));

    // ガーランド（電球）
    const gy = m + 1.1 * u, sag = 5.5 * u, n = 15;
    ctx.strokeStyle = 'rgba(243,223,162,0.7)'; ctx.lineWidth = 0.25 * u; ctx.beginPath();
    for (let i = 0; i <= 40; i++) { const t = i / 40; const x = m + 1.1 * u + t * (w - 2 * m - 2.2 * u); const y = gy + Math.sin(t * Math.PI) * sag; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    const bulbColors = ['#F3DFA2', '#F0A8C8', '#FFFFFF', '#E9B55A'];
    for (let i = 1; i < n; i++) {
      const t = i / n; const x = m + 1.1 * u + t * (w - 2 * m - 2.2 * u); const y = gy + Math.sin(t * Math.PI) * sag + 1.2 * u;
      ctx.save(); ctx.shadowColor = bulbColors[i % 4]; ctx.shadowBlur = 2.2 * u;
      ctx.fillStyle = bulbColors[i % 4]; ctx.beginPath(); ctx.ellipse(x, y, 0.8 * u, 1.1 * u, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }

    // タイトル
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 1.5 * u;
    ctx.fillStyle = '#F3DFA2';
    ctx.font = `700 ${3.6 * u}px "Cormorant Garamond", serif`;
    spacedText(ctx, 'TOKYO', w / 2, 17 * u, 1.6 * u);
    ctx.font = `700 ${7.2 * u}px "Cormorant Garamond", serif`;
    spacedText(ctx, 'CHRISTMAS MARKET', w / 2, 24.5 * u, 0.35 * u);
    // 2026 in 芝公園
    const y3 = 31.5 * u;
    ctx.font = `700 ${4.6 * u}px "Cormorant Garamond", serif`; const p1 = '2026 ';
    ctx.font = `italic 600 ${4.6 * u}px "Cormorant Garamond", serif`; const p2 = 'in ';
    ctx.font = `700 ${4.2 * u}px "Zen Maru Gothic", sans-serif`; const p3 = '芝公園';
    const m1 = (() => { ctx.font = `700 ${4.6 * u}px "Cormorant Garamond", serif`; return ctx.measureText(p1).width; })();
    const m2 = (() => { ctx.font = `italic 600 ${4.6 * u}px "Cormorant Garamond", serif`; return ctx.measureText(p2).width; })();
    const m3 = (() => { ctx.font = `700 ${4.2 * u}px "Zen Maru Gothic", sans-serif`; return ctx.measureText(p3).width + 0.6 * u * 2; })();
    let x = w / 2 - (m1 + m2 + m3) / 2; ctx.textAlign = 'left';
    ctx.font = `700 ${4.6 * u}px "Cormorant Garamond", serif`; ctx.fillStyle = '#FDF3E3'; ctx.fillText(p1, x, y3); x += m1;
    ctx.font = `italic 600 ${4.6 * u}px "Cormorant Garamond", serif`; ctx.fillStyle = '#D8B66A'; ctx.fillText(p2, x, y3); x += m2;
    ctx.font = `700 ${4.2 * u}px "Zen Maru Gothic", sans-serif`; ctx.fillStyle = '#FDF3E3';
    for (const ch of p3) { ctx.fillText(ch, x, y3); x += ctx.measureText(ch).width + 0.6 * u; }
    // 区切り線
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(243,223,162,0.8)'; ctx.lineWidth = 0.2 * u;
    ctx.beginPath(); ctx.moveTo(w / 2 - 22 * u, 15.8 * u); ctx.lineTo(w / 2 - 9 * u, 15.8 * u); ctx.moveTo(w / 2 + 9 * u, 15.8 * u); ctx.lineTo(w / 2 + 22 * u, 15.8 * u); ctx.stroke();
    ctx.restore();

    // 下部ハッシュタグ
    ctx.save();
    ctx.fillStyle = '#F3DFA2'; ctx.font = `500 ${2.9 * u}px "Zen Maru Gothic", sans-serif`;
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = u;
    ctx.fillText('#東京クリスマスマーケット', w / 2, h - m - 3.2 * u);
    ctx.restore();

    // 雪の粒（固定配置）
    ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const seed = [[8, 36], [92, 40], [6, 60], [95, 66], [12, 84], [88, 86], [18, 44], [83, 52], [5, 74], [96, 78]];
    seed.forEach(([px, py], i) => { ctx.beginPath(); ctx.arc(px * u, py / 100 * h, (i % 3 + 1) * 0.35 * u, 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
  }
  function renderFrameOverlay() {
    const dpr = Math.min(devicePixelRatio || 1, 2), w = innerWidth, h = innerHeight;
    frameCv.width = w * dpr; frameCv.height = h * dpr;
    const ctx = frameCv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    drawFrame(ctx, w, h);
  }
  addEventListener('resize', () => { if ($('#screen-ar').classList.contains('active')) renderFrameOverlay(); });

  // ---------- capture ----------
  async function capture() {
    const vw = innerWidth, vh = innerHeight;
    const W = 1080, H = Math.round(W * vh / vw), k = W / vw;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    // 映像（object-fit: cover を再現）
    if (video.videoWidth) {
      const ar = video.videoWidth / video.videoHeight, tar = W / H;
      let sw, sh, sx, sy;
      if (ar > tar) { sh = video.videoHeight; sw = sh * tar; sx = (video.videoWidth - sw) / 2; sy = 0; }
      else { sw = video.videoWidth; sh = sw / tar; sx = 0; sy = (video.videoHeight - sh) / 2; }
      if (selfie()) { ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); }
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H);
      if (selfie()) ctx.restore();
    } else { ctx.fillStyle = '#223'; ctx.fillRect(0, 0, W, H); }
    // キャラクター
    for (const c of [chars.reindeer, chars.fairy]) {
      if (!c.alpha) continue;
      const img = await loadImg(c.el.getAttribute('src'));
      ctx.save(); ctx.globalAlpha = c.alpha;
      const isR = c === chars.reindeer;
      ctx.translate(c.x * k, c.y * k);
      ctx.rotate(c.rot * D2R); ctx.scale(c.flip, c.sy || 1);
      ctx.drawImage(img, -c.w * k / 2, isR ? -c.h * k : -c.h * k / 2, c.w * k, c.h * k);
      ctx.restore();
    }
    drawFrame(ctx, W, H);
    return cv.toDataURL('image/jpeg', 0.9);
  }

  // ---------- main loop ----------
  let last = performance.now(), running = false;
  function loop(now) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    sampleColor(now);
    if (!S.found) detect(dt);
    animateChars(now);
    requestAnimationFrame(loop);
  }

  // ---------- flows ----------
  async function start() {
    const btn = $('#btn-start'); btn.disabled = true;
    const motionOk = await requestMotionPermission();
    try { await startCamera(); }
    catch (e) { btn.disabled = false; toast('カメラを起動できませんでした（設定で許可してください）', 4000); log('camera_error', { msg: String(e && e.name) }); return; }
    startSensors();
    await Promise.all([
      document.fonts.load('700 40px "Cormorant Garamond"'), document.fonts.load('italic 600 40px "Cormorant Garamond"'),
      document.fonts.load('700 40px "Zen Maru Gothic"'), document.fonts.load('500 40px "Zen Maru Gothic"')
    ]).catch(() => {});
    show('screen-ar'); renderFrameOverlay();
    if (TEST) $('#btn-force').hidden = false;
    S.t0 = performance.now();
    running = true; last = performance.now(); requestAnimationFrame(loop);
    log('start', { motionOk });
  }

  $('#btn-start').addEventListener('click', start);
  $('#btn-force').addEventListener('click', () => { S.prog = 1; onFound(towerGeometry()); });
  $('#btn-reset').addEventListener('click', resetSearch);
  $('#btn-flip').addEventListener('click', async () => {
    const btn = $('#btn-flip'); btn.disabled = true;
    const next = S.facing === 'user' ? 'environment' : 'user';
    try {
      await startCamera(next);
      if (S.found && S.anchor) S.anchor = { heading: camHeading(), elev: camElev(), facing: S.facing }; // 向きの基準を取り直す
      S.view = { x: 0, y: 0 };
      toast(S.facing === 'user' ? T('toastSelfie') : T('toastBack'), 1800);
      log('flip', { facing: S.facing });
    } catch (e) { toast('カメラを切り替えられませんでした'); try { await startCamera(S.facing); } catch (_) {} }
    finally { btn.disabled = false; }
  });
  $('#btn-swap').addEventListener('click', () => {
    S.pose = 1 - S.pose;
    Object.values(chars).forEach(c => { c.el.src = c.imgs[S.pose]; });
  });
  shutter.addEventListener('click', async () => {
    shutter.disabled = true;
    const fl = document.createElement('div'); fl.className = 'flash'; $('#screen-ar').appendChild(fl); setTimeout(() => fl.remove(), 400);
    try {
      S.lastPhoto = await capture(); S.lastPhotoUrl = null;
      $('#result-img').src = S.lastPhoto; $('#result-msg').textContent = '';
      show('screen-result'); log('capture', { pose: S.pose });
    } finally { shutter.disabled = false; }
  });
  $('#btn-retake').addEventListener('click', () => { show('screen-ar'); renderFrameOverlay(); });

  async function dataUrlToFile(d) { const b = await (await fetch(d)).blob(); return new File([b], 'tcm2026_shiba.jpg', { type: 'image/jpeg' }); }
  $('#btn-share').addEventListener('click', async () => {
    log('share_tap');
    try {
      const file = await dataUrlToFile(S.lastPhoto);
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: '#東京クリスマスマーケット' }); log('share_done', { via: 'webshare' }); return;
      }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    if (S.liffReady && S.lastPhotoUrl && liff.isApiAvailable && liff.isApiAvailable('shareTargetPicker')) {
      try {
        await liff.shareTargetPicker([{ type: 'image', originalContentUrl: S.lastPhotoUrl, previewImageUrl: S.lastPhotoUrl }]);
        log('share_done', { via: 'shareTargetPicker' }); return;
      } catch (e) { /* fallthrough */ }
    }
    if (!S.inClient) { // 通常ブラウザならダウンロード
      const a = document.createElement('a'); a.href = S.lastPhoto; a.download = 'tcm2026_shiba.jpg'; a.click();
    }
    toast(T('shareFallback'));
  });

  $('#btn-send').addEventListener('click', async () => {
    const msg = $('#result-msg');
    if (!$('#chk-consent').checked) { toast(T('sendNeedConsent')); return; }
    if (!C.GAS_URL) { msg.textContent = '（テスト環境：GAS_URL未設定のため送信はスキップされました）'; return; }
    if (!S.liffReady) { msg.textContent = 'LINEアプリから開くと写真をトークに送れます'; return; }
    if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
    try {
      const fr = await liff.getFriendship();
      if (!fr.friendFlag) {
        msg.innerHTML = T('sendNeedFriend') + (C.OA_ADD_FRIEND_URL ? `<br><a href="${C.OA_ADD_FRIEND_URL}" style="color:#F3DFA2">友だち追加はこちら</a>` : '');
        return;
      }
    } catch (e) { /* 友だち状態が取れない場合はそのまま試行 */ }
    const btn = $('#btn-send'); btn.disabled = true; msg.textContent = '送信中…';
    try {
      const res = await fetch(C.GAS_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'upload', env: C.ENV, sessionId: S.sessionId, idToken: liff.getIDToken(), image: S.lastPhoto.split(',')[1] })
      });
      const j = await res.json();
      if (j.ok) { S.lastPhotoUrl = j.imageUrl || null; msg.textContent = T('sendOk'); toast(T('sendOk')); }
      else msg.textContent = '送信できませんでした：' + (j.error || 'unknown');
    } catch (e) { msg.textContent = '通信エラーが発生しました。電波の良い場所で再度お試しください。'; }
    finally { btn.disabled = false; }
  });

  initLiff().then(() => log('open'));
})();
