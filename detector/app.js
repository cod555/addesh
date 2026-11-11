// Addesh Detect: YOLO11 banknote detector running in the browser (ONNX Runtime Web).
// Finds each note, draws a box around it and says its value. Arabic first, like Addesh.
'use strict';

const CLASSES = ['LBP_5000', 'LBP_20000', 'LBP_50000', 'LBP_100000', 'USD_1', 'USD_5', 'USD_10', 'USD_20', 'USD_50', 'USD_100'];
const SAY = {
  ar: { LBP_5000: 'خمسة آلاف ليرة', LBP_20000: 'عشرون ألف ليرة', LBP_50000: 'خمسون ألف ليرة', LBP_100000: 'مئة ألف ليرة',
        USD_1: 'دولار واحد', USD_5: 'خمسة دولارات', USD_10: 'عشرة دولارات', USD_20: 'عشرون دولارًا', USD_50: 'خمسون دولارًا', USD_100: 'مئة دولار' },
  en: { LBP_5000: '5,000 Lebanese pounds', LBP_20000: '20,000 Lebanese pounds', LBP_50000: '50,000 Lebanese pounds', LBP_100000: '100,000 Lebanese pounds',
        USD_1: '1 dollar', USD_5: '5 dollars', USD_10: '10 dollars', USD_20: '20 dollars', USD_50: '50 dollars', USD_100: '100 dollars' },
};
const SHOW = { LBP_5000: '5,000 ل.ل', LBP_20000: '20,000 ل.ل', LBP_50000: '50,000 ل.ل', LBP_100000: '100,000 ل.ل',
               USD_1: '$1', USD_5: '$5', USD_10: '$10', USD_20: '$20', USD_50: '$50', USD_100: '$100' };
const T = {
  ar: { loading: 'جارٍ تحميل النموذج…', point: 'وجّه الكاميرا نحو ورقة نقدية', none: 'لا توجد ورقة نقدية', sure: 'الثقة', camera: 'الكاميرا', photo: 'صورة',
        welcome: 'قدّيش جاهز. ضع الورقة النقدية أمام الكاميرا. اضغط على الشاشة لسماع النتيجة مرة أخرى، واضغط مرتين لتشغيل الضوء.',
        torchOn: 'تم تشغيل الضوء.', torchOff: 'تم إطفاء الضوء.', noTorch: 'هذا الهاتف لا يسمح بتشغيل الضوء هنا.',
        camErr: 'تعذّر فتح الكاميرا. اسمح باستخدامها أو جرّب صورة.', modelErr: 'تعذّر تحميل النموذج. تحقّق من الاتصال.', and: ' و ' },
  en: { loading: 'Loading the model…', point: 'Point the camera at a banknote', none: 'No banknote', sure: 'sure', camera: 'Camera', photo: 'Photo',
        welcome: 'Addesh is ready. Hold a banknote in front of the camera. Tap the screen to hear the result again. Double tap for the flashlight.',
        torchOn: 'Flashlight on.', torchOff: 'Flashlight off.', noTorch: 'This phone does not allow the flashlight here.',
        camErr: 'Could not open the camera. Allow it, or try a photo.', modelErr: 'Could not load the model. Check your connection.', and: ' and ' },
};
const CONF = 0.50;      // minimum confidence to draw and count a note
const IOU = 0.50;       // boxes overlapping more than this are the same note
const HOLD = 4;         // same answer for this many frames before speaking
const SIZE = 640;

const $ = (id) => document.getElementById(id);
const el = { stage: $('stage'), video: $('video'), still: $('still'), overlay: $('overlay'), value: $('value'), sub: $('sub'),
             lang: $('lang'), live: $('live'), file: $('file'), stats: $('stats'), samples: $('samples'), announcer: $('announcer') };
const ctx = el.overlay.getContext('2d');
const work = document.createElement('canvas'); work.width = work.height = SIZE;
const wctx = work.getContext('2d', { willReadFrequently: true });

let lang = localStorage.getItem('detect-lang') || 'ar';
let session = null, stream = null, mode = 'camera', busy = false, torch = false;
let lastKey = '', streak = 0, spokenKey = '', lastText = '', greeted = false, emptyFrames = 0;

// ---------- speech ----------
function speak(text) {
  lastText = text; el.announcer.textContent = text;
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = lang === 'ar' ? 'ar-SA' : 'en-US';
  const v = speechSynthesis.getVoices().find((x) => x.lang.toLowerCase().startsWith(lang)); if (v) u.voice = v;
  speechSynthesis.speak(u);
}
function setLang(l) {
  lang = l; localStorage.setItem('detect-lang', l);
  document.documentElement.lang = l; document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
  el.lang.textContent = l === 'ar' ? 'EN' : 'ع'; el.live.textContent = T[l].camera;
  document.querySelector('label[for=file]').textContent = T[l].photo;
}

// ---------- model ----------
function preprocess(src, sw, sh) {
  const r = SIZE / Math.max(sw, sh), nw = Math.round(sw * r), nh = Math.round(sh * r), px = (SIZE - nw) >> 1, py = (SIZE - nh) >> 1;
  wctx.fillStyle = 'rgb(114,114,114)'; wctx.fillRect(0, 0, SIZE, SIZE); wctx.drawImage(src, 0, 0, sw, sh, px, py, nw, nh);
  const d = wctx.getImageData(0, 0, SIZE, SIZE).data, n = SIZE * SIZE, out = new Float32Array(3 * n);
  for (let i = 0, j = 0; i < n; i++, j += 4) { out[i] = d[j] / 255; out[n + i] = d[j + 1] / 255; out[2 * n + i] = d[j + 2] / 255; }
  return { tensor: new ort.Tensor('float32', out, [1, 3, SIZE, SIZE]), r, px, py };
}
function iou(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0); return i / (a.w * a.h + b.w * b.h - i);
}
function decode(data, r, px, py) {
  const N = 8400, C = CLASSES.length, boxes = [];          // output is [1, 4 + C, 8400]
  for (let i = 0; i < N; i++) {
    let best = 0, cls = -1;
    for (let c = 0; c < C; c++) { const s = data[(4 + c) * N + i]; if (s > best) { best = s; cls = c; } }
    if (best < CONF) continue;
    const w = data[2 * N + i], h = data[3 * N + i];
    boxes.push({ x: (data[i] - w / 2 - px) / r, y: (data[N + i] - h / 2 - py) / r, w: w / r, h: h / r, p: best, cls });
  }
  boxes.sort((a, b) => b.p - a.p);
  const keep = [];
  for (const b of boxes) if (!keep.some((k) => iou(k, b) > IOU)) keep.push(b);   // class-agnostic: one answer per note
  return keep;
}
async function detect(src, sw, sh) {
  const { tensor, r, px, py } = preprocess(src, sw, sh);
  const t0 = performance.now();
  const out = await session.run({ [session.inputNames[0]]: tensor });
  const ms = performance.now() - t0;
  return { boxes: decode(out[session.outputNames[0]].data, r, px, py), ms };
}

// ---------- drawing ----------
function draw(boxes, sw, sh, cover) {
  const dpr = window.devicePixelRatio || 1, W = el.overlay.clientWidth, H = el.overlay.clientHeight;
  if (el.overlay.width !== W * dpr) { el.overlay.width = W * dpr; el.overlay.height = H * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const s = cover ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh), ox = (W - sw * s) / 2, oy = (H - sh * s) / 2;
  ctx.font = '600 16px "Readex Pro", system-ui, sans-serif'; ctx.textBaseline = 'middle';
  for (const b of boxes) {
    const name = CLASSES[b.cls], col = name.startsWith('USD') ? '#6FE0A0' : '#FFB547';
    const x = ox + b.x * s, y = oy + b.y * s, w = b.w * s, h = b.h * s;
    ctx.lineWidth = 4; ctx.strokeStyle = col; ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.stroke();
    const label = `${name.replace('_', ' ')}  ${Math.round(b.p * 100)}%`, tw = ctx.measureText(label).width + 16;
    const ly = Math.max(60, y - 28), lx = Math.min(Math.max(4, x), W - tw - 4);
    ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(lx, ly, tw, 26, 8); ctx.fill();
    ctx.fillStyle = '#0B2421'; ctx.direction = 'ltr'; ctx.textAlign = 'left'; ctx.fillText(label, lx + 8, ly + 14);
  }
}
function phrase(boxes, table) {
  const names = boxes.map((b) => table[CLASSES[b.cls]]);
  return names.length <= 1 ? (names[0] || '') : names.slice(0, -1).join('، ') + T[lang].and + names[names.length - 1];
}
function show(boxes, immediate) {
  boxes.sort((a, b) => a.cls - b.cls);
  const key = boxes.map((b) => b.cls).join(',');
  if (boxes.length) {
    emptyFrames = 0;
    el.stage.dataset.state = 'found'; el.stage.dataset.cur = CLASSES[boxes[0].cls].slice(0, 3);
    el.value.textContent = boxes.map((b) => SHOW[CLASSES[b.cls]]).join(' + ');
    el.sub.textContent = `${T[lang].sure} ${Math.round(Math.min(...boxes.map((b) => b.p)) * 100)}%`;
  } else {
    emptyFrames++;
    el.stage.dataset.state = 'searching'; el.value.textContent = mode === 'camera' ? T[lang].point : T[lang].none; el.sub.textContent = '';
  }
  streak = key === lastKey ? streak + 1 : 1; lastKey = key;
  if (boxes.length && (immediate || streak >= HOLD) && key !== spokenKey) { spokenKey = key; speak(phrase(boxes, SAY[lang])); }
  if (!boxes.length && (immediate || emptyFrames >= 8) && spokenKey) { spokenKey = ''; speak(T[lang].none); }
  else if (!boxes.length && immediate) speak(T[lang].none);
}

// ---------- camera loop ----------
async function startCamera() {
  mode = 'camera'; el.still.hidden = true; el.video.hidden = false; el.live.classList.add('on'); spokenKey = ''; lastKey = '';
  if (!stream) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      el.video.srcObject = stream; await el.video.play();
    } catch (e) { console.error(e); el.stage.dataset.state = 'error'; el.value.textContent = T[lang].camErr; return; }
  }
  loop();
}
async function loop() {
  if (mode !== 'camera' || !session) return;
  if (!busy && el.video.readyState >= 2 && el.video.videoWidth) {
    busy = true;
    try {
      const { boxes, ms } = await detect(el.video, el.video.videoWidth, el.video.videoHeight);
      if (mode === 'camera') { draw(boxes, el.video.videoWidth, el.video.videoHeight, true); show(boxes, false); el.stats.textContent = `${Math.round(ms)} ms`; }
    } catch (e) { console.error(e); }
    busy = false;
  }
  requestAnimationFrame(loop);
}
async function runImage(url) {
  mode = 'image'; el.live.classList.remove('on'); el.video.hidden = true; el.still.hidden = false;
  await new Promise((ok, no) => { el.still.onload = ok; el.still.onerror = no; el.still.src = url; });
  while (busy) await new Promise((r) => setTimeout(r, 30));
  busy = true;
  try {
    const { boxes, ms } = await detect(el.still, el.still.naturalWidth, el.still.naturalHeight);
    draw(boxes, el.still.naturalWidth, el.still.naturalHeight, false); spokenKey = ''; show(boxes, true); el.stats.textContent = `${Math.round(ms)} ms`;
    window.__last = boxes.map((b) => ({ name: CLASSES[b.cls], p: +b.p.toFixed(3) }));
  } finally { busy = false; }
}
async function setTorch(on) {
  const track = stream && stream.getVideoTracks()[0];
  try {
    if (!track || !(track.getCapabilities && track.getCapabilities().torch)) throw new Error('no torch');
    await track.applyConstraints({ advanced: [{ torch: on }] }); torch = on; speak(on ? T[lang].torchOn : T[lang].torchOff);
  } catch { speak(T[lang].noTorch); }
}

// ---------- start ----------
async function init() {
  setLang(lang);
  el.value.textContent = T[lang].loading;
  for (const c of CLASSES) {
    const b = document.createElement('button'); b.type = 'button'; b.title = c.replace('_', ' ');
    b.innerHTML = `<img src="samples/${c}.jpg" alt="${c.replace('_', ' ')}" loading="lazy">`;
    b.addEventListener('click', (e) => { e.stopPropagation(); runImage(`samples/${c}.jpg`); });
    el.samples.appendChild(b);
  }
  try {
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/';
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    session = await ort.InferenceSession.create('model/best.onnx', { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    window.__ready = true;
  } catch (e) { console.error(e); el.stage.dataset.state = 'error'; el.value.textContent = T[lang].modelErr; window.__ready = String(e); return; }
  const sample = new URLSearchParams(location.search).get('sample');
  if (sample) runImage(`samples/${sample}.jpg`); else startCamera();
}

let tapTimer = null;
el.stage.addEventListener('click', (e) => {
  if (e.target.closest('button, label, input')) return;
  if (!greeted) { greeted = true; speak(T[lang].welcome); return; }
  if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; setTorch(!torch); return; }
  tapTimer = setTimeout(() => { tapTimer = null; if (lastText) speak(lastText); }, 350);
});
el.lang.addEventListener('click', () => { setLang(lang === 'ar' ? 'en' : 'ar'); spokenKey = ''; lastKey = ''; });
el.live.addEventListener('click', startCamera);
el.file.addEventListener('change', () => { const f = el.file.files[0]; if (f) runImage(URL.createObjectURL(f)); el.file.value = ''; });
window.addEventListener('resize', () => { ctx.clearRect(0, 0, el.overlay.width, el.overlay.height); });
init();
