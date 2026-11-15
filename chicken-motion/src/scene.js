/* ============================================================================
 *  КУРИЦА КЛЮЁТ ЗЁРНА — motion study (8 s loop, 30 fps friendly)
 *  Один источник правды: сцена рисуется на canvas 2D и одинаково работает
 *  в браузере (интерактивный плеер) и в Node (@napi-rs/canvas → PNG → GIF/MP4).
 * ==========================================================================*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChickenScene = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------- константы сцены -------------------------------------------- */
  const W = 1280;
  const H = 720;
  const DURATION = 8;          // длина петли, сек
  const HORIZON = 540;         // начало земли
  const GROUND = 612;          // линия, на которой стоят лапы
  const CHICK_X = 500;
  const CHICK_SCALE = 1.1;

  const TAU = Math.PI * 2;
  const LP = TAU / DURATION; // угловая скорость одного цикла за петлю

  /* ---------- математика -------------------------------------------------- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  };
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInQuad = (t) => t * t;
  const easeOutBack = (t, s) => {
    s = s == null ? 1.6 : s;
    const p = t - 1;
    return 1 + (s + 1) * p * p * p + s * p * p;
  };
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- палитра ----------------------------------------------------- */
  const P = {
    skyTop: '#6d97cb',
    skyMid: '#ffc48d',
    skyLow: '#fff6e6',
    sun: '#fff5c8',
    cloud: '#fffdf7',
    hillFar: '#a2bd74',
    hillNear: '#7fa053',
    barnWall: '#c4704f',
    barnRoof: '#8b4a38',
    barnShade: '#a45a41',
    fence: '#7a4d31',
    fenceLight: '#a36f49',
    dirtTop: '#b07f52',
    dirtBottom: '#563a20',
    dirtDark: '#6f4c2d',
    grain: '#f6c65f',
    grainDark: '#bb852c',
    cream: '#fff3d8',
    bodyHi: '#ffe4b4',
    bodyLo: '#eab97f',
    wingHi: '#ffdda6',
    wingLo: '#dfa465',
    tailHi: '#f6c98e',
    tailLo: '#c1834a',
    beak: '#f7a838',
    beakDark: '#cd7c1d',
    red: '#e04a3f',
    redDark: '#ac2d26',
    leg: '#eab366',
    legDark: '#c08340',
    eye: '#33251c',
  };

  /* ---------- детерминированный «шум» ------------------------------------ */
  const rnd = mulberry32(20261115);

  const clouds = [
    { x: 200, y: 168, s: 1.05, a: 0.32, v: 4.2 },
    { x: 700, y: 128, s: 0.7, a: 0.24, v: 6.0 },
    { x: 1080, y: 250, s: 0.9, a: 0.2, v: 3.2 },
  ];

  const dirtSpeckles = (() => {
    const arr = [];
    for (let i = 0; i < 280; i++) {
      const y = HORIZON + rnd() * (H - HORIZON);
      const depth = (y - HORIZON) / (H - HORIZON);
      arr.push({
        x: -40 + rnd() * (W + 80),
        y,
        r: 0.7 + depth * 3.8 * rnd(),
        a: 0.06 + rnd() * 0.14,
        dark: rnd() > 0.42,
      });
    }
    return arr;
  })();

  const grassBack = (() => {
    const arr = [];
    for (let x = -20; x < W + 30; x += 16) {
      arr.push({ x: x + rnd() * 10, h: 10 + rnd() * 24, lean: (rnd() - 0.5) * 14, w: 1.5 + rnd() * 1.6 });
    }
    return arr;
  })();

  const motes = (() => {
    const arr = [];
    for (let i = 0; i < 46; i++) {
      arr.push({
        x: rnd() * W,
        y: 120 + rnd() * 520,
        r: 0.7 + rnd() * 2.2,
        sp: 4 + rnd() * 15,
        ph: rnd() * TAU,
        a: 0.08 + rnd() * 0.26,
      });
    }
    return arr;
  })();

  /* ---------- зёрна ------------------------------------------------------- */
  const GRAIN_ZONE = { x0: 150, x1: 1150, y0: 588, y1: 702 };
  const grains = (() => {
    const arr = [];
    const push = (x, y) => {
      const depth = clamp((y - GRAIN_ZONE.y0) / (GRAIN_ZONE.y1 - GRAIN_ZONE.y0), 0, 1);
      arr.push({
        x, y,
        r: 3.0 + depth * 3.8,
        rot: (rnd() - 0.5) * 1.1,
        tone: rnd(),
        eatenAt: Infinity,
      });
    };
    const clusters = [
      [646, 600], [690, 616], [606, 630], [726, 638], [668, 596], [590, 610],
    ];
    clusters.forEach(([cx, cy]) => {
      const n = 2 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) push(cx + (rnd() - 0.5) * 48, cy + (rnd() - 0.5) * 26);
    });
    for (let i = 0; i < 44; i++) {
      push(GRAIN_ZONE.x0 + rnd() * (GRAIN_ZONE.x1 - GRAIN_ZONE.x0), GRAIN_ZONE.y0 + rnd() * (GRAIN_ZONE.y1 - GRAIN_ZONE.y0));
    }
    return arr.sort((a, b) => a.y - b.y);
  })();

  /* ---------- тайминг клюющих движений ----------------------------------- */
  const PECKS = [
    { start: 1.42, power: 1.0, hold: 0.11 },
    { start: 3.10, power: 0.94, hold: 0.08 },
    { start: 3.74, power: 1.0, hold: 0.12 },
    { start: 5.44, power: 0.9, hold: 0.09 },
  ];
  const ANT = 0.34;   // замах
  const DIVE = 0.15;  // удар
  const RISE = 0.62;  // возврат

  PECKS.forEach((p) => {
    p.impact = p.start + ANT + DIVE;
    p.end = p.impact + p.hold + RISE;
  });

  function peckCurve(t, pk) {
    const u = t - pk.start;
    if (u < 0 || u > ANT + DIVE + pk.hold + RISE + 0.45) return 0;
    if (u < ANT) return -0.17 * pk.power * easeOutCubic(u / ANT);
    if (u < ANT + DIVE) return lerp(-0.17 * pk.power, 1, easeInQuad((u - ANT) / DIVE));
    if (u < ANT + DIVE + pk.hold) return 1;
    const k = (u - ANT - DIVE - pk.hold) / RISE;
    const back = 1 - easeOutBack(k, 1.15);
    const settle = Math.exp(-k * 5) * Math.sin(k * 11) * 0.05;
    return clamp(back + settle, -0.12, 1.2);
  }

  function impulses(t) {
    let s = 0;
    for (const pk of PECKS) {
      const d = t - pk.impact;
      if (d > 0 && d < 1.6) s += Math.exp(-d * 5.2) * Math.sin(d * 26) * pk.power;
    }
    return s;
  }

  /* ---------- геометрия курицы ------------------------------------------- */
  const G = {
    pivot: { x: 0, y: -132 },
    neckBase: { x: 70, y: -216 },
    headR: 35,
    beakLen: 56,                        // от центра головы до кончика клюва
    hipFront: { x: 20, y: -120 },
    hipBack: { x: -34, y: -116 },
    footFront: { x: 46, y: 0 },
    footBack: { x: -62, y: 0 },
  };
  const NECK_REST = { len: 110, ang: -0.58 };
  const NECK_PECK = { len: 150, ang: 1.18 };

  /* ---------- состояние курицы в момент t -------------------------------- */
  function beakWorld(st) {
    return { x: CHICK_X + st.beak.x * CHICK_SCALE, y: GROUND + st.beak.y * CHICK_SCALE };
  }

  function chickenState(t) {
    let p = 0;
    for (const pk of PECKS) p += peckCurve(t, pk);
    p = clamp(p, -0.22, 1.15);

    const pb = clamp(p, 0, 1);
    const pa = clamp(-p, 0, 1);
    const imp = impulses(t);

    const breathe = Math.sin(t * LP * 3) * 1.5;
    const lookWin = smooth((t - 6.35) / 0.45) * (1 - smooth((t - 7.45) / 0.4));
    const look = -0.16 * lookWin + 0.03 * Math.sin(t * LP * 4);

    const bodyPitch = 0.3 * pb - 0.06 * pa + 0.012 * Math.sin(t * LP * 1 + 0.6);
    const bodyBob = 9 * pb - 6 * pa + breathe * 0.5 + imp * 1.6;
    const bodyShiftX = 12 * pb + 2 * pa;

    const stepWin = smooth((t - 6.5) / 0.16) * (1 - smooth((t - 6.82) / 0.2));
    const footFront = { x: G.footFront.x + 16 * stepWin, y: -24 * Math.sin(Math.PI * stepWin) };
    const footBack = { x: G.footBack.x, y: 0 };

    const cb = Math.cos(bodyPitch), sb = Math.sin(bodyPitch);
    const rot = (pt) => ({
      x: G.pivot.x + (pt.x - G.pivot.x) * cb - (pt.y - G.pivot.y) * sb + bodyShiftX,
      y: G.pivot.y + (pt.x - G.pivot.x) * sb + (pt.y - G.pivot.y) * cb + bodyBob,
    });

    const neckBase = rot(G.neckBase);
    const headRot = -0.08 + 0.82 * pb - 0.1 * pa + look * 0.55;
    const neckLen = lerp(NECK_REST.len, NECK_PECK.len, p) + imp * 4;
    const neckAng = lerp(NECK_REST.ang, NECK_PECK.ang, p) + look * 0.42 + Math.sin(t * LP * 1 + 0.6) * 0.02;

    const head = {
      x: neckBase.x + Math.cos(neckAng) * neckLen,
      y: neckBase.y + Math.sin(neckAng) * neckLen,
    };
    const beak = {
      x: head.x + Math.cos(headRot) * G.beakLen,
      y: head.y + Math.sin(headRot) * G.beakLen,
    };

    const open = (() => {
      let v = 0;
      for (const pk of PECKS) {
        const d = t - pk.impact;
        if (d > -0.11 && d < 0.0) v = Math.max(v, smooth((d + 0.11) / 0.11));
        else if (d >= 0 && d < 0.24) v = Math.max(v, (1 - smooth((d - 0.02) / 0.22)) * 0.9);
      }
      return clamp(v, 0, 1);
    })();

    const blink = (() => {
      let v = 0;
      for (const bt of [0.72, 2.35, 4.62, 7.18]) {
        const d = Math.abs(t - bt);
        if (d < 0.11) v = Math.max(v, 1 - d / 0.11);
      }
      return v;
    })();

    return {
      t, p, pb, pa, imp, bodyPitch, bodyBob, bodyShiftX,
      neckBase, headRot, head, beak,
      neck: { x0: neckBase.x, y0: neckBase.y, len: neckLen, ang: neckAng, head },
      open, blink, look, stepWin, footFront, footBack,
      wings: 0.05 * pb + imp * 0.04 + 0.012 * Math.sin(t * LP * 2 + 1.2),
    };
  }

  /* ---------- распределение зёрен по клевкам ------------------------------ */
  (function assignGrains() {
    const taken = new Set();
    PECKS.forEach((pk) => {
      const st = chickenState(pk.impact);
      const bw = beakWorld(st);
      const bx = bw.x;
      const by = bw.y;
      let best = null, bestD = Infinity;
      grains.forEach((g, i) => {
        if (taken.has(i)) return;
        const d = Math.hypot(g.x - bx, (g.y - by) * 2.0);
        if (d < bestD) { bestD = d; best = i; }
      });
      if (best != null && bestD < 150) {
        taken.add(best);
        grains[best].eatenAt = pk.impact;
        pk.grain = grains[best];
      }
    });
  })();

  /* ---------- помощники рисования ---------------------------------------- */
  function ellipsePath(ctx, x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU);
  }

  function taperedCurve(ctx, pts, widths) {
    const left = [], right = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l;
      left.push({ x: pts[i].x + nx * widths[i], y: pts[i].y + ny * widths[i] });
      right.push({ x: pts[i].x - nx * widths[i], y: pts[i].y - ny * widths[i] });
    }
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
  }

  function quadPoint(p0, c, p1, t) {
    const mt = 1 - t;
    return {
      x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x,
      y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y,
    };
  }

  /* ---------- фон --------------------------------------------------------- */
  function drawSky(ctx, t) {
    const g = ctx.createLinearGradient(0, 0, 0, HORIZON + 60);
    g.addColorStop(0, P.skyTop);
    g.addColorStop(0.34, '#b9c6d8');
    g.addColorStop(0.62, P.skyMid);
    g.addColorStop(1, P.skyLow);
    ctx.fillStyle = g;
    ctx.fillRect(-500, -400, W + 1000, HORIZON + 460);

    const sunX = 1020, sunY = 246;
    const glow = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 360);
    glow.addColorStop(0, 'rgba(255,248,210,0.9)');
    glow.addColorStop(0.4, 'rgba(255,236,182,0.34)');
    glow.addColorStop(1, 'rgba(255,232,180,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(-500, -400, W + 1000, HORIZON + 460);

    // лучи
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 8; i++) {
      const a = -2.45 + i * 0.22 + Math.sin(t * LP * 1 + i * 0.7) * 0.018;
      ctx.save();
      ctx.translate(sunX, sunY);
      ctx.rotate(a);
      const lg = ctx.createLinearGradient(0, 0, 520, 0);
      lg.addColorStop(0, 'rgba(255,246,206,0.1)');
      lg.addColorStop(1, 'rgba(255,246,206,0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(560, -40 - (i % 3) * 10);
      ctx.lineTo(560, 40 + (i % 2) * 12);
      ctx.lineTo(0, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // солнце
    ctx.save();
    const pulse = 1 + Math.sin(t * LP * 1) * 0.012;
    ctx.fillStyle = P.sun;
    ctx.shadowColor = 'rgba(255,236,168,0.85)';
    ctx.shadowBlur = 55;
    ellipsePath(ctx, sunX, sunY, 58 * pulse, 58 * pulse);
    ctx.fill();
    ctx.restore();

    // облака
    clouds.forEach((c) => {
      const x = c.x + Math.sin(t * LP * 1 + c.x * 0.01) * 26 - 40;
      ctx.save();
      ctx.globalAlpha = c.a;
      ctx.fillStyle = P.cloud;
      ctx.translate(x, c.y);
      ctx.scale(c.s, c.s);
      ellipsePath(ctx, 0, 0, 118, 24); ctx.fill();
      ellipsePath(ctx, -56, 8, 70, 18); ctx.fill();
      ellipsePath(ctx, 64, 9, 78, 16); ctx.fill();
      ellipsePath(ctx, 10, -15, 62, 24); ctx.fill();
      ctx.restore();
    });
  }

  function drawHills(ctx) {
    ctx.fillStyle = P.hillFar;
    ctx.beginPath();
    ctx.moveTo(-100, HORIZON + 4);
    ctx.bezierCurveTo(120, HORIZON - 88, 320, HORIZON - 16, 520, HORIZON - 70);
    ctx.bezierCurveTo(700, HORIZON - 112, 880, HORIZON - 22, 1050, HORIZON - 80);
    ctx.bezierCurveTo(1180, HORIZON - 120, 1300, HORIZON - 46, 1400, HORIZON + 4);
    ctx.closePath();
    ctx.fill();

    const g = ctx.createLinearGradient(0, HORIZON - 84, 0, HORIZON + 10);
    g.addColorStop(0, '#95b268');
    g.addColorStop(1, '#7b9a51');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-100, HORIZON + 6);
    ctx.bezierCurveTo(180, HORIZON - 50, 380, HORIZON + 8, 620, HORIZON - 28);
    ctx.bezierCurveTo(860, HORIZON - 60, 1060, HORIZON + 6, 1400, HORIZON - 14);
    ctx.lineTo(1400, HORIZON + 8);
    ctx.closePath();
    ctx.fill();
  }

  function drawBarn(ctx) {
    ctx.save();
    ctx.translate(188, HORIZON + 2);

    const wall = ctx.createLinearGradient(0, -160, 0, 0);
    wall.addColorStop(0, P.barnWall);
    wall.addColorStop(1, P.barnShade);
    ctx.fillStyle = wall;
    ctx.fillRect(-92, -140, 184, 140);

    ctx.strokeStyle = 'rgba(90,44,34,0.2)';
    ctx.lineWidth = 1.6;
    for (let i = -92; i <= 92; i += 15) {
      ctx.beginPath();
      ctx.moveTo(i, -140);
      ctx.lineTo(i, 0);
      ctx.stroke();
    }

    // крыша с выносом
    ctx.fillStyle = P.barnRoof;
    ctx.beginPath();
    ctx.moveTo(-108, -138);
    ctx.lineTo(0, -226);
    ctx.lineTo(108, -138);
    ctx.lineTo(96, -132);
    ctx.lineTo(0, -214);
    ctx.lineTo(-96, -132);
    ctx.closePath();
    ctx.fill();

    // фронтон
    ctx.fillStyle = '#b96148';
    ctx.beginPath();
    ctx.moveTo(-92, -140);
    ctx.lineTo(0, -210);
    ctx.lineTo(92, -140);
    ctx.closePath();
    ctx.fill();

    // дверь и окно
    ctx.fillStyle = 'rgba(58,32,24,0.66)';
    ctx.fillRect(-32, -86, 64, 86);
    ctx.strokeStyle = 'rgba(255,226,186,0.28)';
    ctx.lineWidth = 2;
    ctx.strokeRect(-32, -86, 64, 86);
    ctx.fillStyle = 'rgba(255,238,198,0.42)';
    ctx.fillRect(-8, -170, 16, 16);
    ctx.strokeStyle = 'rgba(58,32,24,0.5)';
    ctx.strokeRect(-8, -170, 16, 16);

    // флюгер
    ctx.strokeStyle = 'rgba(58,32,24,0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -214);
    ctx.lineTo(0, -240);
    ctx.stroke();
    ctx.fillStyle = 'rgba(58,32,24,0.45)';
    ctx.beginPath();
    ctx.moveTo(0, -240);
    ctx.lineTo(20, -234);
    ctx.lineTo(0, -228);
    ctx.closePath();
    ctx.fill();

    // дымка (мягкая, без видимого прямоугольника)
    const haze = ctx.createRadialGradient(0, -110, 40, 0, -110, 210);
    haze.addColorStop(0, 'rgba(255,242,222,0.3)');
    haze.addColorStop(1, 'rgba(255,242,222,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(-230, -330, 460, 350);
    ctx.restore();
  }

  function drawFence(ctx) {
    const postTop = HORIZON - 72;
    ctx.save();
    ctx.strokeStyle = 'rgba(122,77,49,0.92)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    [postTop + 24, postTop + 54].forEach((y) => {
      ctx.beginPath();
      ctx.moveTo(-20, y);
      for (let x = -20; x <= W + 20; x += 118) ctx.lineTo(x, y + Math.sin(x * 0.013) * 2);
      ctx.stroke();
    });
    for (let x = -10; x <= W + 20; x += 118) {
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#4a2f16';
      ctx.beginPath();
      ctx.moveTo(x + 5, HORIZON + 4);
      ctx.lineTo(x - 46, HORIZON + 30);
      ctx.lineTo(x - 40, HORIZON + 38);
      ctx.lineTo(x + 5, HORIZON + 12);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = 'rgba(126,80,50,0.95)';
      ctx.fillRect(x - 5.5, postTop, 11, HORIZON - postTop + 10);
      ctx.fillStyle = 'rgba(186,140,96,0.85)';
      ctx.fillRect(x - 5.5, postTop, 3.6, HORIZON - postTop + 10);
      ctx.fillStyle = 'rgba(58,34,18,0.22)';
      ctx.fillRect(x + 2.4, postTop, 3, HORIZON - postTop + 10);
    }
    ctx.restore();
  }

  function drawGround(ctx, t) {
    const g = ctx.createLinearGradient(0, HORIZON, 0, H);
    g.addColorStop(0, '#a87a4f');
    g.addColorStop(0.22, P.dirtTop);
    g.addColorStop(0.72, '#7d5531');
    g.addColorStop(1, P.dirtBottom);
    ctx.fillStyle = g;
    ctx.fillRect(-500, HORIZON, W + 1000, H + 500);

    const sh = ctx.createLinearGradient(0, HORIZON, 0, HORIZON + 54);
    sh.addColorStop(0, 'rgba(88,58,32,0.32)');
    sh.addColorStop(1, 'rgba(88,58,32,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(-500, HORIZON, W + 1000, 54);

    dirtSpeckles.forEach((s) => {
      ctx.globalAlpha = s.a;
      ctx.fillStyle = s.dark ? P.dirtDark : '#e8caa0';
      ellipsePath(ctx, s.x, s.y, s.r, s.r * 0.6);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // солнечное пятно на земле
    const pool = ctx.createRadialGradient(940, HORIZON + 110, 40, 940, HORIZON + 110, 460);
    pool.addColorStop(0, 'rgba(255,220,158,0.3)');
    pool.addColorStop(1, 'rgba(255,220,158,0)');
    ctx.fillStyle = pool;
    ctx.fillRect(-500, HORIZON, W + 1000, H + 400);

    ctx.strokeStyle = 'rgba(108,136,76,0.9)';
    ctx.lineCap = 'round';
    grassBack.forEach((g2) => {
      const sway = Math.sin(t * LP * 2 + g2.x * 0.05) * 2.4;
      ctx.lineWidth = g2.w;
      ctx.beginPath();
      ctx.moveTo(g2.x, HORIZON + 3);
      ctx.quadraticCurveTo(g2.x + g2.lean * 0.5, HORIZON + 3 - g2.h * 0.6, g2.x + g2.lean + sway, HORIZON + 3 - g2.h);
      ctx.stroke();
    });
  }

  function drawForegroundGrass(ctx, t) {
    ctx.save();
    ctx.strokeStyle = 'rgba(66,94,52,0.9)';
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(44,64,36,0.45)';
    ctx.shadowBlur = 16;
    const blades = [
      [-10, H + 20, 74, 210, 9], [34, H + 24, 42, 156, 6],
      [W + 10, H + 20, -84, 220, 10], [W - 46, H + 20, -48, 156, 6],
      [W - 156, H + 26, -32, 112, 4],
    ];
    blades.forEach(([x, y, dx, h, w], i) => {
      const sway = Math.sin(t * LP * 2 + i) * 5;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + dx * 0.6, y - h * 0.62, x + dx + sway, y - h);
      ctx.stroke();
      ctx.lineWidth = w * 0.68;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + dx * 0.9, y - h * 0.5, x + dx * 1.35 + sway, y - h * 0.8);
      ctx.stroke();
    });
    ctx.restore();
  }

  /* ---------- зёрна ------------------------------------------------------- */
  function drawGrains(ctx, t) {
    const fadeIn = smooth(t / 0.35);
    grains.forEach((g) => {
      if (t > g.eatenAt) return;
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.rot);
      ctx.globalAlpha = 0.22 * fadeIn;
      ctx.fillStyle = '#5b3f26';
      ellipsePath(ctx, 1.6, 2.4, g.r * 1.1, g.r * 0.5);
      ctx.fill();

      ctx.globalAlpha = fadeIn;
      const gg = ctx.createLinearGradient(0, -g.r, 0, g.r);
      gg.addColorStop(0, g.tone > 0.5 ? '#ffe89f' : '#ffd886');
      gg.addColorStop(1, P.grainDark);
      ctx.fillStyle = gg;
      ellipsePath(ctx, 0, 0, g.r * 1.2, g.r * 0.72);
      ctx.fill();

      ctx.globalAlpha = 0.5 * fadeIn;
      ctx.fillStyle = 'rgba(255,252,235,0.95)';
      ellipsePath(ctx, -g.r * 0.32, -g.r * 0.3, g.r * 0.36, g.r * 0.18);
      ctx.fill();
      ctx.restore();
    });
  }

  /* ---------- эффекты ----------------------------------------------------- */
  function dustPuff(ctx, x, y, age, power) {
    if (age < 0 || age > 0.7) return;
    const k = age / 0.7;
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.4;
      const dist = (16 + i * 5) * easeOutCubic(k) * power;
      const px = x + Math.cos(a) * dist;
      const py = y + Math.sin(a) * dist * 0.45 - k * 16;
      const r = (4.2 + i * 0.9) * (1 - k * 0.3);
      ctx.globalAlpha = 0.5 * (1 - k) * (1 - k);
      ctx.fillStyle = '#f7e9d2';
      ellipsePath(ctx, px, py, r, r * 0.78);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ударная волна по земле
  function impactRing(ctx, x, y, age, power) {
    if (age < 0 || age > 0.45) return;
    const k = age / 0.45;
    ctx.save();
    ctx.translate(x, y + 1);
    ctx.scale(1, 0.3);
    ctx.globalAlpha = 0.5 * (1 - k) * (1 - k);
    ctx.strokeStyle = '#fff3d8';
    ctx.lineWidth = 3 + 4 * (1 - k);
    ctx.beginPath();
    ctx.arc(0, 0, (10 + 52 * easeOutCubic(k)) * power, 0, TAU);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function crumbs(ctx, x, y, age, seed) {
    if (age < 0 || age > 0.7) return;
    const r2 = mulberry32(seed);
    for (let i = 0; i < 5; i++) {
      const ang = -Math.PI * (0.18 + r2() * 0.64);
      const spd = 70 + r2() * 150;
      const vx = Math.cos(ang) * spd, vy = Math.sin(ang) * spd;
      const px = x + vx * age;
      const py = y + vy * age + 620 * age * age;
      const r = 1.4 + r2() * 1.6;
      ctx.globalAlpha = 0.9 * (1 - age / 0.7);
      ctx.fillStyle = r2() > 0.5 ? '#f7d07a' : '#dbaa50';
      ellipsePath(ctx, px, py, r, r * 0.8);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function sparkles(ctx, x, y, age) {
    if (age < 0 || age > 0.42) return;
    const k = age / 0.42;
    for (let i = 0; i < 3; i++) {
      const a = -0.9 + i * 1.1;
      const d = 12 + 26 * easeOutCubic(k);
      const px = x + Math.cos(a) * d;
      const py = y + Math.sin(a) * d - 10 * k;
      const s = (1 - k) * 7;
      ctx.globalAlpha = (1 - k) * 0.95;
      ctx.fillStyle = '#fff8d8';
      ctx.beginPath();
      ctx.moveTo(px, py - s); ctx.lineTo(px + s * 0.28, py);
      ctx.lineTo(px, py + s); ctx.lineTo(px - s * 0.28, py);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(px - s, py); ctx.lineTo(px, py + s * 0.28);
      ctx.lineTo(px + s, py); ctx.lineTo(px, py - s * 0.28);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawMotes(ctx, t) {
    motes.forEach((m) => {
      const y = m.y + Math.sin(t * LP * 2 + m.ph) * (18 + m.sp);
      const x = m.x + Math.sin(t * LP * 1 + m.ph) * 16;
      ctx.globalAlpha = m.a * (0.55 + 0.45 * Math.sin(t * 1.7 + m.ph));
      ctx.fillStyle = '#fff6dc';
      ellipsePath(ctx, x, y, m.r, m.r);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  /* ---------- курица ------------------------------------------------------ */
  function rotAbout(pt, pivot, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const dx = pt.x - pivot.x, dy = pt.y - pivot.y;
    return { x: pivot.x + dx * c - dy * s, y: pivot.y + dx * s + dy * c };
  }

  function drawLeg(ctx, hip, foot, alpha) {
    const a = 66, b = 66;
    const dx = foot.x - hip.x, dy = foot.y - hip.y;
    const dist = Math.min(Math.hypot(dx, dy), a + b - 1);
    const baseAng = Math.atan2(dy, dx);
    const cosA = clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1);
    const A = Math.acos(cosA);
    const kneeAng = baseAng - A;
    const knee = { x: hip.x + Math.cos(kneeAng) * a, y: hip.y + Math.sin(kneeAng) * a };
    const ankle = { x: foot.x, y: foot.y - 9 };

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';

    // бедро (уходит под перья корпуса)
    ctx.strokeStyle = '#dfa76c';
    ctx.lineWidth = 24;
    ctx.beginPath();
    ctx.moveTo(hip.x, hip.y - 6);
    ctx.lineTo(knee.x, knee.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(150,95,46,0.35)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(hip.x - 11, hip.y - 4);
    ctx.lineTo(knee.x - 9, knee.y);
    ctx.stroke();

    // цевка
    ctx.strokeStyle = P.legDark;
    ctx.lineWidth = 12.5;
    ctx.beginPath();
    ctx.moveTo(knee.x, knee.y);
    ctx.lineTo(ankle.x, ankle.y);
    ctx.stroke();
    ctx.strokeStyle = P.leg;
    ctx.lineWidth = 9.5;
    ctx.beginPath();
    ctx.moveTo(knee.x, knee.y);
    ctx.lineTo(ankle.x, ankle.y);
    ctx.stroke();

    // сустав
    ctx.fillStyle = P.leg;
    ctx.beginPath();
    ctx.arc(ankle.x, ankle.y, 4.6, 0, TAU);
    ctx.fill();

    // пальцы
    ctx.strokeStyle = P.leg;
    ctx.lineWidth = 5.8;
    const toes = [
      { ang: -0.52, len: 15 },
      { ang: -0.03, len: 22 },
      { ang: 0.5, len: 15 },
    ];
    toes.forEach((toe) => {
      const tx = ankle.x + Math.cos(toe.ang) * toe.len;
      const ty = ankle.y + Math.sin(toe.ang) * toe.len * 0.55 + 3;
      ctx.beginPath();
      ctx.moveTo(ankle.x, ankle.y);
      ctx.quadraticCurveTo(
        ankle.x + Math.cos(toe.ang) * toe.len * 0.6,
        ankle.y + Math.sin(toe.ang) * toe.len * 0.55 + 1,
        tx, ty
      );
      ctx.stroke();
      ctx.fillStyle = '#8a6236';
      ctx.beginPath();
      ctx.arc(tx, ty, 2, 0, TAU);
      ctx.fill();
    });
    // задний палец
    ctx.strokeStyle = P.leg;
    ctx.beginPath();
    ctx.moveTo(ankle.x, ankle.y);
    ctx.quadraticCurveTo(ankle.x - 7, ankle.y + 3, ankle.x - 13, ankle.y + 5);
    ctx.stroke();

    // тень под лапой
    ctx.globalAlpha = alpha * 0.25;
    ctx.fillStyle = '#4a3018';
    ellipsePath(ctx, ankle.x + 2, foot.y + 4, 20, 5);
    ctx.fill();

    ctx.restore();
  }

  function drawTail(ctx, st) {
    const anchors = [
      { x: -62, y: -240, ang: -2.62, len: 112, w: 19, tone: 1, dark: 0 },
      { x: -72, y: -232, ang: -2.34, len: 140, w: 23, tone: 0, dark: 1 },
      { x: -78, y: -220, ang: -2.06, len: 156, w: 25, tone: 1, dark: 0 },
      { x: -80, y: -208, ang: -1.76, len: 138, w: 22, tone: 0, dark: 1 },
      { x: -76, y: -196, ang: -1.48, len: 108, w: 18, tone: 1, dark: 0 },
    ];
    anchors.forEach((f, i) => {
      const wob = st.imp * (0.045 + i * 0.01) + Math.sin(st.t * LP * 2 + i * 0.7) * 0.014;
      const ang = f.ang + wob - st.bodyPitch * 0.18;
      const len = f.len * (1 + st.imp * 0.035);
      const base = { x: f.x, y: f.y };
      const tip = { x: base.x + Math.cos(ang) * len, y: base.y + Math.sin(ang) * len };
      const perp = { x: -Math.sin(ang), y: Math.cos(ang) };
      // контрольные точки дают серповидную форму пера
      const bend = 0.35 * f.w;
      const midA = {
        x: base.x + Math.cos(ang + 0.16) * len * 0.58 + perp.x * f.w,
        y: base.y + Math.sin(ang + 0.16) * len * 0.58 + perp.y * f.w,
      };
      const midB = {
        x: base.x + Math.cos(ang - 0.1) * len * 0.5 - perp.x * (f.w * 1.1 + bend),
        y: base.y + Math.sin(ang - 0.1) * len * 0.5 - perp.y * (f.w * 1.1 + bend),
      };
      const g = ctx.createLinearGradient(base.x, base.y, tip.x, tip.y);
      g.addColorStop(0, f.tone ? '#ffe4bc' : '#f9cf99');
      g.addColorStop(0.6, f.tone ? '#f3c089' : '#eeb679');
      g.addColorStop(1, f.dark ? '#a26634' : '#c68a4f');
      ctx.save();
      ctx.fillStyle = g;
      ctx.strokeStyle = 'rgba(134,86,42,0.45)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.quadraticCurveTo(midA.x, midA.y, tip.x, tip.y);
      ctx.quadraticCurveTo(midB.x, midB.y, base.x, base.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,248,228,0.4)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.quadraticCurveTo((midA.x + midB.x) / 2, (midA.y + midB.y) / 2, tip.x, tip.y);
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawBody(ctx) {
    const g = ctx.createLinearGradient(-50, -270, 50, -100);
    g.addColorStop(0, P.cream);
    g.addColorStop(0.4, P.bodyHi);
    g.addColorStop(1, P.bodyLo);
    ctx.fillStyle = g;
    ctx.strokeStyle = 'rgba(150,94,46,0.8)';
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(-94, -126);
    ctx.bezierCurveTo(-116, -174, -102, -234, -36, -250);
    ctx.bezierCurveTo(26, -266, 86, -234, 96, -184);
    ctx.bezierCurveTo(104, -144, 82, -110, 42, -102);
    ctx.bezierCurveTo(2, -94, -66, -98, -94, -126);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.clip();
    // перьевые чешуйки
    ctx.strokeStyle = 'rgba(190,132,70,0.32)';
    ctx.lineWidth = 2;
    for (let row = 0; row < 4; row++) {
      const y = -132 + row * 25;
      for (let i = 0; i < 7; i++) {
        const x = -100 + i * 32 + (row % 2) * 16;
        ctx.beginPath();
        ctx.arc(x, y, 15, 0.12 * Math.PI, 0.88 * Math.PI);
        ctx.stroke();
      }
    }
    // объём снизу
    const shade = ctx.createLinearGradient(0, -180, 0, -96);
    shade.addColorStop(0, 'rgba(196,132,72,0)');
    shade.addColorStop(1, 'rgba(178,112,56,0.42)');
    ctx.fillStyle = shade;
    ctx.fillRect(-130, -180, 250, 90);
    // контровой свет справа
    const rim = ctx.createLinearGradient(60, 0, 112, 0);
    rim.addColorStop(0, 'rgba(255,250,232,0)');
    rim.addColorStop(1, 'rgba(255,252,236,0.6)');
    ctx.fillStyle = rim;
    ctx.fillRect(50, -270, 80, 190);
    // тень на стыке с шеей
    const neckShade = ctx.createRadialGradient(40, -232, 6, 40, -232, 62);
    neckShade.addColorStop(0, 'rgba(176,112,56,0.3)');
    neckShade.addColorStop(1, 'rgba(176,112,56,0)');
    ctx.fillStyle = neckShade;
    ctx.fillRect(-30, -300, 160, 120);
    ctx.restore();
  }

  function featherLeaf(ctx, a, b, w) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    const p = (k, s2) => ({ x: a.x + dx * k + nx * w * s2, y: a.y + dy * k + ny * w * s2 });
    const c1 = p(0.3, 1), c2 = p(0.72, 0.62), c3 = p(0.72, -0.62), c4 = p(0.3, -1);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
    ctx.bezierCurveTo(c3.x, c3.y, c4.x, c4.y, a.x, a.y);
    ctx.closePath();
  }

  function drawWing(ctx, st) {
    ctx.save();
    ctx.translate(-12, -182);
    ctx.rotate(-0.34 + st.wings);
    ctx.scale(1.04, 0.94);

    // тень под крылом
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#a86e35';
    ellipsePath(ctx, -4, 14, 54, 24);
    ctx.fill();
    ctx.globalAlpha = 1;

    const g = ctx.createLinearGradient(46, -26, -50, 30);
    g.addColorStop(0, '#ffe7bd');
    g.addColorStop(0.5, '#f9cd96');
    g.addColorStop(1, '#e0a468');
    ctx.fillStyle = g;
    ctx.strokeStyle = 'rgba(150,95,46,0.6)';
    ctx.lineWidth = 2.4;

    ctx.beginPath();
    ctx.moveTo(46, -18);
    ctx.bezierCurveTo(24, -36, -18, -40, -46, -30);
    ctx.bezierCurveTo(-56, -26, -64, -18, -66, -10);
    ctx.bezierCurveTo(-56, 10, -18, 26, 12, 24);
    ctx.bezierCurveTo(38, 22, 50, 4, 46, -18);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // перья, сходящиеся к кончику
    ctx.save();
    ctx.clip();
    for (let i = 0; i < 4; i++) {
      const y = -14 + i * 12;
      ctx.beginPath();
      ctx.moveTo(42, y + 6);
      ctx.quadraticCurveTo(2, y + 4, -66, -10);
      ctx.strokeStyle = 'rgba(148,92,42,0.42)';
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(42, y + 3);
      ctx.quadraticCurveTo(2, y + 1, -66, -13);
      ctx.strokeStyle = 'rgba(255,247,226,0.35)';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
    // тень у верхней кромки
    const sh = ctx.createLinearGradient(0, -46, 0, -8);
    sh.addColorStop(0, 'rgba(178,112,54,0.34)');
    sh.addColorStop(1, 'rgba(178,112,54,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(-70, -50, 130, 46);
    ctx.restore();

    // блик
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = 'rgba(255,252,238,0.95)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(40, -22);
    ctx.quadraticCurveTo(14, -38, -18, -36);
    ctx.stroke();
    ctx.restore();
  }

  function drawNeck(ctx, st) {
    const { x0, y0, head } = { x0: st.neck.x0, y0: st.neck.y0, head: st.head };
    const stretch = clamp((st.neck.len - NECK_REST.len) / (NECK_PECK.len - NECK_REST.len), 0, 1);
    const ctrl = {
      x: lerp(x0, head.x, 0.5) - 20 * (1 - stretch) + 46 * stretch,
      y: lerp(y0, head.y, 0.5) - 6 - 12 * stretch,
    };
    const n = 14;
    const pts = [], widths = [];
    for (let i = 0; i <= n; i++) {
      const tt = i / n;
      pts.push(quadPoint({ x: x0, y: y0 }, ctrl, head, tt));
      widths.push(lerp(23, 14, tt) * (1 + Math.sin(Math.PI * tt) * 0.06) * (1 - 0.18 * stretch));
    }
    const g = ctx.createLinearGradient(x0, y0, head.x, head.y);
    g.addColorStop(0, '#e6b980');
    g.addColorStop(0.45, P.bodyHi);
    g.addColorStop(1, '#ffedc9');
    ctx.save();
    ctx.fillStyle = g;
    ctx.strokeStyle = 'rgba(158,102,52,0.6)';
    ctx.lineWidth = 2.4;
    taperedCurve(ctx, pts, widths);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(200,146,86,0.3)';
    ctx.lineWidth = 1.6;
    for (let i = 3; i < n - 1; i += 3) {
      const a = pts[i - 1], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      const nx = (-dy / l) * 10, ny = (dx / l) * 10;
      ctx.beginPath();
      ctx.moveTo(pts[i].x + nx, pts[i].y + ny);
      ctx.quadraticCurveTo(pts[i].x, pts[i].y - 3, pts[i].x - nx, pts[i].y - ny);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawHead(ctx, st) {
    const { x, y } = st.head;
    const R = G.headR;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(st.headRot + 0.02 * Math.sin(st.t * LP * 2 + 0.4));

    // гребешок
    const combWob = st.imp * 0.05;
    ctx.save();
    ctx.rotate(-0.08 + combWob);
    ctx.fillStyle = P.red;
    ctx.strokeStyle = P.redDark;
    ctx.lineWidth = 2;
    [[-20, -24, 11], [-8, -37, 13.5], [7, -38, 14], [19, -28, 11], [26, -16, 8]].forEach(([cx, cy, rr]) => {
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, TAU);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();

    // голова
    const g = ctx.createLinearGradient(-26, -34, 28, 34);
    g.addColorStop(0, '#fff7e6');
    g.addColorStop(0.55, '#ffe8c2');
    g.addColorStop(1, '#f2cd99');
    ctx.fillStyle = g;
    ctx.strokeStyle = 'rgba(158,102,52,0.7)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.ellipse(0, 0, R + 3, R - 2, 0.05, 0, TAU);
    ctx.fill();
    ctx.stroke();

    // щека
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#f8c8a2';
    ctx.beginPath();
    ctx.ellipse(2, 12, 17, 12, -0.2, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    // клюв
    const open = st.open;
    ctx.save();
    ctx.translate(26, 5);
    ctx.rotate(0.05);
    ctx.fillStyle = P.beak;
    ctx.strokeStyle = P.beakDark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6, -10);
    ctx.quadraticCurveTo(26, -7, 36, 3);
    ctx.quadraticCurveTo(24, 7, -6, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.rotate(open * 0.3);
    ctx.fillStyle = '#f0ae4d';
    ctx.beginPath();
    ctx.moveTo(-6, 4);
    ctx.quadraticCurveTo(18, 8, 27, 6 + open * 5);
    ctx.quadraticCurveTo(16, 13 + open * 3, -6, 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = 'rgba(146,88,24,0.55)';
    ctx.beginPath();
    ctx.arc(5, -3.5, 1.6, 0, TAU);
    ctx.fill();
    ctx.restore();

    // серьга
    ctx.save();
    ctx.translate(15, 25);
    ctx.rotate(0.12 + st.imp * 0.09);
    ctx.fillStyle = P.red;
    ctx.strokeStyle = P.redDark;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(0, 5, 6.4, 9.4, 0.1, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(10, 2, 5, 7.6, -0.2, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // глаз
    const eyeX = 7, eyeY = -8;
    ctx.fillStyle = '#fffdf6';
    ctx.beginPath();
    ctx.ellipse(eyeX, eyeY, 9.6, 10.2, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,84,48,0.42)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const lookX = clamp(st.look * 14, -3.6, 3.6);
    ctx.fillStyle = P.eye;
    ctx.beginPath();
    ctx.arc(eyeX + 2.2 + lookX, eyeY + 0.6, 5.7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(eyeX + 0.4 + lookX, eyeY - 2.4, 1.9, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(eyeX + 4.6 + lookX, eyeY + 3, 1, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (st.blink > 0.02) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(eyeX, eyeY, 10.2, 10.6, 0, 0, TAU);
      ctx.clip();
      ctx.fillStyle = '#f6d9a8';
      ctx.fillRect(eyeX - 12, eyeY - 12, 24, 24 * st.blink + 0.5);
      ctx.strokeStyle = 'rgba(146,98,54,0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(eyeX - 11, eyeY - 12 + 24 * st.blink);
      ctx.lineTo(eyeX + 11, eyeY - 12 + 24 * st.blink);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  function drawChicken(ctx, t, st) {
    ctx.save();
    ctx.translate(CHICK_X, GROUND);
    ctx.scale(CHICK_SCALE, CHICK_SCALE);

    // контактная тень под курицей
    ctx.save();
    ctx.translate(-80, 10);
    ctx.scale(1, 0.16);
    const longSh = ctx.createRadialGradient(0, 0, 10, 0, 0, 160);
    longSh.addColorStop(0, 'rgba(75,47,22,0.32)');
    longSh.addColorStop(0.7, 'rgba(75,47,22,0.12)');
    longSh.addColorStop(1, 'rgba(75,47,22,0)');
    ctx.fillStyle = longSh;
    ctx.beginPath();
    ctx.arc(0, 0, 160, 0, TAU);
    ctx.fill();
    ctx.restore();

    const contact = ctx.createRadialGradient(0, 0, 14, 0, 0, 168);
    contact.addColorStop(0, 'rgba(70,44,22,0.34)');
    contact.addColorStop(0.6, 'rgba(70,44,22,0.14)');
    contact.addColorStop(1, 'rgba(70,44,22,0)');
    ctx.fillStyle = contact;
    ctx.save();
    ctx.scale(1, 0.2);
    ctx.beginPath();
    ctx.arc(0, 4, 168, 0, TAU);
    ctx.fill();
    ctx.restore();

    const bodyTransform = () => {
      ctx.translate(G.pivot.x + st.bodyShiftX, G.pivot.y + st.bodyBob);
      ctx.rotate(st.bodyPitch);
      ctx.translate(-G.pivot.x, -G.pivot.y);
    };

    // шея уходит за корпус — стык не виден
    drawNeck(ctx, st);

    // корпус
    ctx.save();
    bodyTransform();
    drawTail(ctx, st);
    drawBody(ctx);
    drawWing(ctx, st);
    ctx.restore();

    // лапы: бедро телесного цвета «продолжает» корпус
    const hipBack = rotAbout(G.hipBack, G.pivot, st.bodyPitch);
    drawLeg(ctx, { x: hipBack.x + st.bodyShiftX, y: hipBack.y + st.bodyBob }, st.footBack, 0.92);
    const hipFront = rotAbout(G.hipFront, G.pivot, st.bodyPitch);
    drawLeg(ctx, { x: hipFront.x + st.bodyShiftX, y: hipFront.y + st.bodyBob }, st.footFront, 1);

    drawHead(ctx, st);

    ctx.restore();
  }

  /* ---------- кадр -------------------------------------------------------- */
  function drawFrame(ctx, time) {
    const t = ((time % DURATION) + DURATION) % DURATION;
    const st = chickenState(t);
    const camZoom = 1.03 + Math.sin(t * LP * 1 + 0.9) * 0.01;
    const camX = Math.sin(t * LP * 1 + 1.1) * 8;
    // микро-толчок камеры на ударах
    let kick = 0;
    for (const pk of PECKS) {
      const d = t - pk.impact;
      if (d > 0 && d < 0.4) kick += Math.exp(-d * 18) * Math.sin(d * 46) * 3.2 * pk.power;
    }
    const camY = Math.cos(t * LP * 2 + 0.3) * 6 + kick;
    const focusX = 566, focusY = 470;

    ctx.save();
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(camZoom, camZoom);
    ctx.translate(-focusX + camX, -focusY + camY);

    drawSky(ctx, t);
    drawHills(ctx);
    drawBarn(ctx);
    drawFence(ctx);
    drawGround(ctx, t);
    drawGrains(ctx, t);

    PECKS.forEach((pk) => {
      const age = t - pk.impact;
      if (age >= 0 && age < 0.7) {
        const bw = beakWorld(chickenState(pk.impact));
        const bx = bw.x;
        const by = bw.y;
        dustPuff(ctx, bx, by - 2, age, pk.power);
        impactRing(ctx, bx, by + 2, age, pk.power);
        crumbs(ctx, bx, by - 2, age, 991 + Math.round(pk.start * 100));
        sparkles(ctx, bx, by - 4, age);
      }
    });

    drawChicken(ctx, t, st);
    drawForegroundGrass(ctx, t);
    drawMotes(ctx, t);

    // виньетка
    const vg = ctx.createRadialGradient(W / 2, H * 0.44, H * 0.3, W / 2, H * 0.5, H * 1.05);
    vg.addColorStop(0, 'rgba(34,24,14,0)');
    vg.addColorStop(1, 'rgba(34,24,14,0.34)');
    ctx.fillStyle = vg;
    ctx.fillRect(-600, -600, W + 1200, H + 1200);

    // затемнение нижнего края — рамка кадра
    const bottomShade = ctx.createLinearGradient(0, H * 0.72, 0, H + 20);
    bottomShade.addColorStop(0, 'rgba(38,22,9,0)');
    bottomShade.addColorStop(1, 'rgba(38,22,9,0.42)');
    ctx.fillStyle = bottomShade;
    ctx.fillRect(-600, H * 0.72, W + 1200, H * 0.42);

    // тёплый грейд
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = 'rgba(255,166,86,0.1)';
    ctx.fillRect(-600, -600, W + 1200, H + 1200);
    ctx.globalCompositeOperation = 'source-over';

    ctx.restore();
    ctx.restore();

    return st;
  }

  /* ---------- фазы для таймлайна ----------------------------------------- */
  const PHASES = [
    { name: 'осмотр', t0: 0.0, t1: 1.42, color: '#8fb6ff' },
    { name: 'клевок', t0: 1.42, t1: 2.56, color: '#ffb057' },
    { name: 'пауза', t0: 2.56, t1: 3.10, color: '#8fb6ff' },
    { name: 'двойной клевок', t0: 3.10, t1: 4.86, color: '#ffb057' },
    { name: 'подбор', t0: 4.86, t1: 5.44, color: '#8fb6ff' },
    { name: 'клевок', t0: 5.44, t1: 6.44, color: '#ffb057' },
    { name: 'шаг', t0: 6.44, t1: 8.0, color: '#9ddc8f' },
  ];
  const MARKERS = PECKS.map((pk) => ({ t: pk.impact, label: 'удар' }));

  return { W, H, DURATION, drawFrame, chickenState, PHASES, MARKERS, PECKS, GROUND, CHICK_X, CHICK_SCALE, beakWorld };
});
