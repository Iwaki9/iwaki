// Собирает автономный index.html: сцена + плеер в одном файле.
//   node src/build-html.mjs
import fs from 'fs';
import path from 'path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const sceneSrc = fs.readFileSync(path.join(root, 'src/scene.js'), 'utf8');

const template = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Курица клюёт зёрна — motion study</title>
<style>
  :root{
    --bg:#120c08;
    --panel:rgba(28,19,12,.72);
    --panel-strong:rgba(20,13,8,.86);
    --line:rgba(255,214,160,.16);
    --ink:#f6e6cf;
    --ink-dim:rgba(246,230,207,.55);
    --accent:#ffb457;
    --accent-soft:rgba(255,180,87,.16);
    --idle:#8fb6ff;
    --peck:#ffb057;
    --step:#9ddc8f;
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{
    margin:0;background:radial-gradient(120% 90% at 50% 0%,#1d1409 0%,var(--bg) 60%,#0a0705 100%);
    color:var(--ink);
    font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    -webkit-font-smoothing:antialiased;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    min-height:100vh;padding:22px 22px 18px;gap:14px;overflow:auto;
  }
  .wrap{display:flex;flex-direction:column;gap:12px;width:min(1280px,100%)}
  .topbar{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap}
  .title{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;font-size:clamp(20px,2.4vw,30px);letter-spacing:.01em;margin:0}
  .title span{color:var(--accent)}
  .subtitle{margin:4px 0 0;color:var(--ink-dim);font-size:12.5px;letter-spacing:.06em;text-transform:uppercase}
  .meta{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
  .chip{border:1px solid var(--line);background:rgba(255,214,160,.05);color:var(--ink-dim);
        padding:5px 10px;border-radius:999px;font-size:11.5px;letter-spacing:.05em;white-space:nowrap}
  .stage{
    position:relative;width:100%;aspect-ratio:16/9;border-radius:16px;overflow:hidden;
    max-width:min(1280px, calc((100vh - 210px) * 16 / 9));
    max-width:min(1280px, calc((100dvh - 210px) * 16 / 9));
    margin-inline:auto;
    background:#0d0906;border:1px solid rgba(255,214,160,.12);
    box-shadow:0 30px 80px -30px rgba(0,0,0,.9),0 0 0 1px rgba(0,0,0,.4) inset;
  }
  canvas{display:block;width:100%;height:100%}
  .hud{
    position:absolute;left:0;right:0;display:flex;gap:14px;align-items:center;
    transition:opacity .35s ease,transform .35s ease;pointer-events:none;
  }
  .hud > *{pointer-events:auto}
  .hud-bottom{
    bottom:0;padding:44px 16px 12px;align-items:flex-end;flex-wrap:wrap;
    background:linear-gradient(to top,rgba(12,8,5,.86),rgba(12,8,5,.55) 42%,transparent);
  }
  body.hide-ui .hud,body.hide-ui .hint{opacity:0;pointer-events:none;transform:translateY(6px)}
  body.hide-ui .hud > *{pointer-events:none}
  button{
    font:inherit;color:var(--ink);background:rgba(255,214,160,.07);border:1px solid var(--line);
    border-radius:10px;padding:8px 12px;cursor:pointer;transition:background .18s,border-color .18s,transform .12s;
    backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);white-space:nowrap;
  }
  button:hover{background:rgba(255,214,160,.14);border-color:rgba(255,214,160,.3)}
  button:active{transform:translateY(1px)}
  button.on{background:var(--accent-soft);border-color:rgba(255,180,87,.5);color:#ffd6a0}
  .play{width:48px;height:48px;padding:0;border-radius:50%;display:grid;place-items:center;background:rgba(255,180,87,.92);border:none;color:#22150a;box-shadow:0 6px 20px -6px rgba(255,180,87,.7)}
  .play:hover{background:#ffc477}
  .play svg{width:18px;height:18px;fill:currentColor}
  .time{font-variant-numeric:tabular-nums;font-size:12px;color:var(--ink-dim);letter-spacing:.04em;padding-bottom:2px;white-space:nowrap}
  .track{position:relative;flex:1 1 320px;min-width:200px;height:46px;display:flex;flex-direction:column;justify-content:flex-end;gap:6px;cursor:pointer;touch-action:none}
  .phases{position:relative;height:22px;border-radius:7px;overflow:hidden;background:rgba(255,255,255,.05)}
  .phase{position:absolute;top:0;bottom:0;opacity:.34;transition:opacity .2s}
  .phase:hover{opacity:.55}
  .phase-label{
    position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    font-size:9.5px;letter-spacing:.03em;color:rgba(255,255,255,.92);overflow:hidden;padding:0 3px;
    text-shadow:0 1px 2px rgba(0,0,0,.5);pointer-events:none;white-space:nowrap;
  }
  .ticks{position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none}
  .marker{position:absolute;top:0;width:1px;height:22px;background:rgba(255,255,255,.55)}
  .head{position:absolute;top:-3px;width:2px;height:28px;background:var(--accent);border-radius:2px;box-shadow:0 0 10px rgba(255,180,87,.9);pointer-events:none}
  .head::after{content:"";position:absolute;left:-3px;top:-4px;width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px rgba(255,180,87,.9)}
  .speeds{display:flex;gap:6px}
  .speeds button{padding:7px 9px;font-size:12px;border-radius:8px}
  .right{display:flex;gap:8px;align-items:center}
  .hint{position:absolute;top:12px;right:16px;transition:opacity .35s ease;font-size:11px;color:rgba(246,230,207,.4);letter-spacing:.05em}
  .hint b{color:rgba(246,230,207,.7);font-weight:600}
  a.dl{text-decoration:none;color:inherit}
  @media (max-width:760px){
    .hud-bottom{padding:38px 12px 10px;gap:10px}
    .time{display:none}
    .hint{display:none}
    .phase-label{font-size:8px}
    .right .label{display:none}
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div>
        <h1 class="title">Курица клюёт <span>зёрна</span></h1>
        <p class="subtitle">motion study · петля 8 c · 1280 × 720</p>
      </div>
      <div class="meta">
        <span class="chip" id="fpsChip">60 fps</span>
        <span class="chip">4 клевка · 1 шаг</span>
        <span class="chip">canvas 2D</span>
      </div>
    </div>

    <div class="stage" id="stage">
      <canvas id="view" width="1280" height="720"></canvas>
      <div class="hint"><b>Space</b> — пауза · <b>← →</b> — по кадрам · <b>H</b> — скрыть интерфейс</div>
      <div class="hud hud-bottom">
        <button class="play" id="play" title="Пауза / воспроизведение (Space)" aria-label="Пауза">
          <svg viewBox="0 0 24 24" id="playIcon"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>
        </button>
        <div class="time" id="time">0.00 / 8.00</div>
        <div class="track" id="track">
          <div class="phases" id="phases"></div>
          <div class="ticks" id="ticks"></div>
          <div class="head" id="head"></div>
        </div>
        <div class="speeds" id="speeds">
          <button data-speed="0.25">0.25×</button>
          <button data-speed="0.5">0.5×</button>
          <button data-speed="1" class="on">1×</button>
        </div>
        <div class="right">
          <button id="loop" class="on" title="Зацикливание">петля</button>
          <button id="hide" title="Скрыть интерфейс (H)"><span class="label">чистый кадр</span></button>
        </div>
      </div>
    </div>
  </div>

<script>
/*__SCENE__*/
</script>
<script>
(function () {
  var S = window.ChickenScene;
  var canvas = document.getElementById('view');
  var ctx = canvas.getContext('2d');
  var stage = document.getElementById('stage');
  var playBtn = document.getElementById('play');
  var playIcon = document.getElementById('playIcon');
  var timeEl = document.getElementById('time');
  var headEl = document.getElementById('head');
  var phasesEl = document.getElementById('phases');
  var ticksEl = document.getElementById('ticks');
  var track = document.getElementById('track');
  var loopBtn = document.getElementById('loop');
  var fpsChip = document.getElementById('fpsChip');
  var speedButtons = Array.prototype.slice.call(document.querySelectorAll('#speeds button'));

  var D = S.DURATION;
  var state = { t: 0, playing: true, loop: true, speed: 1 };
  var last = performance.now();
  var hiding = false;

  // ---------- таймлайн ----------
  S.PHASES.forEach(function (p) {
    var d = document.createElement('div');
    d.className = 'phase';
    d.style.left = (p.t0 / D * 100) + '%';
    d.style.width = ((p.t1 - p.t0) / D * 100) + '%';
    d.style.background = p.color;
    if ((p.t1 - p.t0) / D > 0.075) {
      var l = document.createElement('div');
      l.className = 'phase-label';
      l.textContent = p.name;
      l.style.left = (p.t0 / D * 100) + '%';
      l.style.width = ((p.t1 - p.t0) / D * 100) + '%';
      l.style.position = 'absolute';
      phasesEl.appendChild(l);
    }
    phasesEl.appendChild(d);
  });
  S.MARKERS.forEach(function (m) {
    var k = document.createElement('div');
    k.className = 'marker';
    k.style.left = (m.t / D * 100) + '%';
    ticksEl.appendChild(k);
  });

  // ---------- отрисовка ----------
  function resize() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var r = stage.getBoundingClientRect();
    var w = Math.max(320, Math.round(r.width * dpr));
    var h = Math.round(w * 9 / 16);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function render() {
    var k = canvas.width / S.W;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(k, k);
    S.drawFrame(ctx, state.t);
  }

  function syncUI() {
    var pct = state.t / D * 100;
    headEl.style.left = pct + '%';
    timeEl.textContent = state.t.toFixed(2) + ' / ' + D.toFixed(2);
    playIcon.innerHTML = state.playing
      ? '<rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect>'
      : '<path d="M8 5.5v13a1 1 0 0 0 1.53.85l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5z"></path>';
    playBtn.setAttribute('aria-label', state.playing ? 'Пауза' : 'Воспроизведение');
  }

  function frame(now) {
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (state.playing) {
      state.t += dt * state.speed;
      if (state.t >= D) {
        if (state.loop) state.t = state.t % D;
        else { state.t = D - 0.001; state.playing = false; }
      }
    }
    render();
    syncUI();
    requestAnimationFrame(frame);
  }

  // ---------- управление ----------
  function togglePlay() {
    if (!state.playing && state.t >= D - 0.002) state.t = 0;
    state.playing = !state.playing;
    syncUI();
  }
  playBtn.addEventListener('click', togglePlay);

  function scrubFromEvent(e) {
    var r = track.getBoundingClientRect();
    var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    state.t = Math.max(0, Math.min(0.999, x / r.width)) * D;
    syncUI();
    render();
  }
  var dragging = false;
  track.addEventListener('pointerdown', function (e) {
    dragging = true;
    track.setPointerCapture(e.pointerId);
    scrubFromEvent(e);
  });
  track.addEventListener('pointermove', function (e) { if (dragging) scrubFromEvent(e); });
  track.addEventListener('pointerup', function (e) { dragging = false; });
  track.addEventListener('pointercancel', function () { dragging = false; });

  speedButtons.forEach(function (b) {
    b.addEventListener('click', function () {
      state.speed = parseFloat(b.dataset.speed);
      speedButtons.forEach(function (o) { o.classList.toggle('on', o === b); });
    });
  });

  loopBtn.addEventListener('click', function () {
    state.loop = !state.loop;
    loopBtn.classList.toggle('on', state.loop);
  });

  function setHidden(v) {
    hiding = v;
    document.body.classList.toggle('hide-ui', v);
  }
  document.getElementById('hide').addEventListener('click', function () { setHidden(!hiding); });

  window.addEventListener('keydown', function (e) {
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); state.t = Math.min(D - 0.001, state.t + 1 / 60); render(); syncUI(); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); state.t = Math.max(0, state.t - 1 / 60); render(); syncUI(); }
    else if (e.key === 'h' || e.key === 'H' || e.key === 'р' || e.key === 'Р') { setHidden(!hiding); }
    else if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') { state.t = 0; state.playing = true; }
  });

  // ---------- счётчик fps ----------
  var fpsFrames = 0, fpsLast = performance.now();
  function countFps(now) {
    fpsFrames++;
    if (now - fpsLast > 500) {
      fpsChip.textContent = Math.round(fpsFrames * 1000 / (now - fpsLast)) + ' fps';
      fpsFrames = 0;
      fpsLast = now;
    }
    requestAnimationFrame(countFps);
  }

  window.addEventListener('resize', function () { resize(); render(); });
  resize();
  render();
  syncUI();
  requestAnimationFrame(frame);
  requestAnimationFrame(countFps);
})();
</script>
</body>
</html>
`;

const out = template.replace('/*__SCENE__*/', () => sceneSrc);
fs.writeFileSync(path.join(root, 'index.html'), out);
console.log('index.html: ' + (out.length / 1024).toFixed(0) + ' KB');
