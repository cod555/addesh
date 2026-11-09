// Scanner: camera → model → stabilizer → voice.

import { CONFIG } from './config.js';
import { store } from './store.js';
import { loadModelFromUrl, normalizeModelUrl, ranked } from './model.js';
import { parseLabel, displayParts, speechText, fullName, shortName } from './labels.js';
import {
  speak, speakQueue, stopSpeaking, unlockAudio, chime, buzz, hasVoiceFor, speechSupported,
  recognitionSupported, listenForLanguage, stopListening,
} from './speech.js';
import { Stabilizer } from './stabilizer.js';
import { setLang, getLang, t, tl, applyI18n } from './i18n.js';
import { rosettePath, medallionPaths } from './rosette.js';
import { registerServiceWorker } from './pwa.js';

const $ = (id) => document.getElementById(id);
const els = {
  stage: $('stage'), video: $('video'), frame: $('frame'), repeat: $('repeat'),
  btnLang: $('btn-lang'), langLabel: $('lang-label'), btnVoice: $('btn-voice'),
  btnTorch: $('btn-torch'), btnCamera: $('btn-camera'), btnSettings: $('btn-settings'),
  bars: $('bars'), barsList: $('bars-list'), barsStats: $('bars-stats'),
  result: $('result'), ringTrack: $('ring-track'), ringFill: $('ring-fill'),
  message: $('message'), amount: $('amount'), unit: $('unit'), announcer: $('announcer'),
  start: $('start'), medallion: $('medallion'), startHit: $('start-hit'), changeLang: $('change-lang'), startStatus: $('start-status'),
  chooser: $('chooser'), chooseEn: $('choose-en'), chooseAr: $('choose-ar'), listening: $('listening'),
  problem: $('problem'), problemTitle: $('problem-title'), problemText: $('problem-text'),
  problemRetry: $('problem-retry'), problemSettings: $('problem-settings'),
  settings: $('settings'), modelUrl: $('model-url'), loadLink: $('load-link'), useBuiltin: $('use-builtin'),
  modelStatus: $('model-status'), threshold: $('threshold'), thresholdOut: $('threshold-out'),
  hold: $('hold'), holdOut: $('hold-out'), optMirror: $('opt-mirror'), optVoice: $('opt-voice'),
  optFeedback: $('opt-feedback'), optBars: $('opt-bars'), toast: $('toast'),
};

// ---------- preferences ----------

const prefs = {
  lang: store.get('lang', null),
  voice: store.get('voice', true),
  feedback: store.get('feedback', true),
  bars: store.get('bars', false),
  mirror: store.get('mirror', CONFIG.mirrorCheck),
  threshold: store.get('threshold', CONFIG.threshold),
  holdMs: store.get('holdMs', CONFIG.holdMs),
  modelUrl: store.get('modelUrl', ''),
};

function save(key, value) {
  prefs[key] = value;
  store.set(key, value);
}

// The model is built in and locked: no link, setting or address-bar option can change it.
let paramModel = null;
store.set('modelUrl', '');

const builtInUrl = () => normalizeModelUrl(CONFIG.modelUrl);
const activeModelUrl = () => builtInUrl();

// ---------- state ----------

let model = null;
let infos = [];
let stabilizer = null;
let modelState = { status: 'idle', error: null, pct: 0, url: null };
let modelPromise = Promise.resolve(null);

let started = false;
let running = false;
let busy = false;
let pending = false;
let lastRun = 0;

let stream = null;
let track = null;
let cameras = [];
let torchOn = false;
let wakeLock = null;

let lastAnnounced = null;
let chosen = false;
let shown = { state: null, index: null };
let ringLength = 0;
let warnedVoice = false;
const frameTimes = [];

// ---------- model ----------

function loadModel(url) {
  modelState = { status: 'loading', error: null, pct: 0, url };
  renderModelStatus();
  const p = loadModelFromUrl(url, {
    onProgress: (fraction) => {
      if (modelPromise === p) {
        modelState.pct = fraction;
        renderModelStatus();
      }
    },
  })
    .then(async (m) => {
      await m.warmUp();
      return m;
    })
    .then((m) => {
      if (modelPromise !== p) {
        m.dispose();
        return null;
      }
      const old = model;
      model = m;
      infos = m.labels.map(parseLabel);
      stabilizer = new Stabilizer({
        threshold: prefs.threshold,
        holdMs: prefs.holdMs,
        isSilent: (i) => infos[i]?.kind === 'nothing',
      });
      shown = { state: null, index: null };
      lastAnnounced = null;
      // Let any prediction still running on the old model finish first.
      if (old) setTimeout(() => old.dispose(), 1500);
      modelState = { status: 'ready', error: null, pct: 1, url };
      renderModelStatus();
      return m;
    })
    .catch((err) => {
      if (modelPromise !== p) return null;
      console.error(err);
      modelState = { status: err.code === 'not-found' ? 'missing' : 'error', error: err, pct: 0, url };
      renderModelStatus();
      return null;
    });
  modelPromise = p;
  return p;
}

function sourceName(url) {
  const tm = url && url.match(/teachablemachine\.withgoogle\.com\/models\/([^/]+)/);
  const name = tm ? `Teachable Machine (${tm[1]})` : url === builtInUrl() ? t('modelFolder') : url;
  return `⁨${name}⁩`; // keep a left-to-right link readable inside Arabic text
}

function renderModelStatus() {
  const { status, pct, error, url } = modelState;
  let short = '';
  if (status === 'loading') short = t('modelLoading', { pct: pct ? `${Math.round(pct * 100)}%` : '' });
  else if (status === 'ready') short = model?.meta?.userMetadata?.demo ? t('modelDemo') : t('modelReady', { n: infos.length });
  else if (status === 'missing') short = t('modelMissing');
  else if (status === 'error') short = t('modelFailed');
  els.startStatus.textContent = short;

  const isError = status === 'missing' || status === 'error';
  els.modelStatus.classList.toggle('error', isError);
  if (status === 'ready') els.modelStatus.textContent = t('statusLoaded', { n: infos.length, src: sourceName(url) });
  else if (isError) els.modelStatus.textContent = error?.message || short;
  else els.modelStatus.textContent = short;
}

// ---------- camera ----------

async function startCamera(deviceId) {
  stopCamera();
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    const err = new Error('Camera needs HTTPS');
    err.name = 'InsecureContextError';
    throw err;
  }
  const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
  const video = deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: { ideal: 'environment' }, ...size };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (err) {
    if (err.name !== 'OverconstrainedError') throw err;
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }

  els.video.srcObject = stream;
  await els.video.play().catch(() => {});
  await new Promise((resolve) => {
    if (els.video.videoWidth) return resolve();
    els.video.addEventListener('loadedmetadata', resolve, { once: true });
    setTimeout(resolve, 4000);
  });

  track = stream.getVideoTracks()[0];
  const settings = track.getSettings ? track.getSettings() : {};
  const coarse = matchMedia('(pointer: coarse)').matches;
  const facing = settings.facingMode || (/back|rear|environment/i.test(track.label) || coarse ? 'environment' : 'user');
  els.stage.classList.toggle('mirrored', facing === 'user');

  const caps = track.getCapabilities ? track.getCapabilities() : {};
  torchOn = false;
  els.btnTorch.hidden = !caps.torch;
  els.btnTorch.setAttribute('aria-pressed', 'false');

  try {
    cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  } catch {
    cameras = [];
  }
  els.btnCamera.hidden = cameras.length < 2;
  els.btnCamera.dataset.deviceId = settings.deviceId || '';
  layoutFrame();
}

function stopCamera() {
  stream?.getTracks().forEach((tr) => tr.stop());
  stream = null;
  track = null;
}

/** Puts the guide over the centre square the model looks at. */
function layoutFrame() {
  const vw = els.video.videoWidth;
  const vh = els.video.videoHeight;
  if (!vw || !vh) return;
  const box = els.stage.getBoundingClientRect();
  const scale = Math.max(box.width / vw, box.height / vh);
  const side = Math.min(Math.min(vw, vh) * scale, Math.min(box.width, box.height) - 32);
  Object.assign(els.frame.style, { width: `${side}px`, height: `${side}px` });
}

const torchSupported = () => Boolean(track?.getCapabilities?.().torch);

async function setTorch(on, { say = false } = {}) {
  if (!track) return false;
  let ok = true;
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] });
    torchOn = on;
  } catch {
    ok = false;
    torchOn = false;
    toast(t('torchFailed'));
  }
  els.btnTorch.setAttribute('aria-pressed', String(torchOn));
  if (say && prefs.voice) {
    const key = !ok ? 'sNoTorch' : torchOn ? 'sTorchOn' : 'sTorchOff';
    speak(tl(voiceLang(), key), voiceLang());
  }
  return ok;
}

// ---------- low light: warn the user and offer the flashlight ----------

const DARK_LEVEL = 55; // average brightness 0–255 below which the picture is too dark
const DARK_FOR_MS = 1500; // must stay dark this long before we warn
const DARK_REPEAT_MS = 30000; // repeat the warning while it stays dark
const lightCanvas = document.createElement('canvas');
lightCanvas.width = lightCanvas.height = 24;
const lightCtx = lightCanvas.getContext('2d', { willReadFrequently: true });
let lastLightCheck = 0;
let darkSince = 0;
let lastDarkWarning = -Infinity;

const speechBusy = () => Boolean(window.speechSynthesis?.speaking);

function frameBrightness() {
  try {
    lightCtx.drawImage(els.video, 0, 0, 24, 24);
    const d = lightCtx.getImageData(0, 0, 24, 24).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return sum / (d.length / 4);
  } catch {
    return 255;
  }
}

function checkLight(now) {
  if (now - lastLightCheck < 500 || torchOn) return;
  lastLightCheck = now;
  if (frameBrightness() >= DARK_LEVEL) {
    darkSince = 0;
    return;
  }
  if (!darkSince) darkSince = now;
  if (now - darkSince < DARK_FOR_MS || now - lastDarkWarning < DARK_REPEAT_MS) return;
  if (!greeted || !prefs.voice || askingLanguage || speechBusy()) return;
  lastDarkWarning = now;
  speak(tl(voiceLang(), torchSupported() ? 'sDarkTorch' : 'sDarkNoTorch'), voiceLang());
}

async function switchCamera() {
  if (cameras.length < 2) return;
  const currentId = els.btnCamera.dataset.deviceId;
  const i = cameras.findIndex((c) => c.deviceId === currentId);
  const next = cameras[(i + 1) % cameras.length];
  pause();
  try {
    await startCamera(next.deviceId);
    resume();
  } catch (err) {
    showCameraProblem(err);
  }
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch {
    wakeLock = null;
  }
}

// ---------- start / stop ----------

async function start(lang) {
  setLang(lang);
  save('lang', lang);
  refreshDynamicText();
  unlockAudio();

  chosen = true;
  stopListening();
  els.start.hidden = true;
  els.chooser.hidden = true;
  els.problem.hidden = true;
  els.stage.hidden = false;
  setLoading(t('startingCamera'));

  try {
    await startCamera();
  } catch (err) {
    showCameraProblem(err);
    return;
  }

  if (modelState.status !== 'ready' && modelState.status !== 'loading') loadModel(activeModelUrl());
  setLoading(t('loadingModel'));
  await modelPromise;
  if (!model) {
    showModelProblem();
    return;
  }

  started = true;
  requestWakeLock();
  resume();
  warnIfNoArabicVoice();
  // Phones block speech until the first touch, so the welcome is spoken on the first tap.
  if (greeted && prefs.voice) speak(tl(voiceLang(), 'sReady'), voiceLang());
}

function resume() {
  if (!model || !stream) return;
  els.problem.hidden = true;
  running = true;
  if (shown.state === null) renderResult({ state: 'searching', progress: 0, candidate: null, current: null });
  scheduleNext();
}

function pause() {
  running = false;
}

function scheduleNext() {
  if (!running || pending) return;
  pending = true;
  const next = () => {
    pending = false;
    tick();
  };
  if (els.video.requestVideoFrameCallback) els.video.requestVideoFrameCallback(next);
  else requestAnimationFrame(next);
}

async function tick() {
  if (!running) return;
  const now = performance.now();
  if (els.video.readyState >= 2) checkLight(now);
  if (!busy && model && now - lastRun >= CONFIG.inferenceIntervalMs && els.video.readyState >= 2) {
    busy = true;
    lastRun = now;
    const m = model;
    try {
      const t0 = performance.now();
      const probs = await m.predict(els.video, { mirror: prefs.mirror });
      if (m === model && running) onPrediction(probs, performance.now() - t0);
    } catch (err) {
      console.error(err);
    } finally {
      busy = false;
    }
  }
  scheduleNext();
}

// ---------- results ----------

function onPrediction(probs, ms) {
  const s = stabilizer.update(probs, performance.now());
  renderResult(s);
  if (prefs.bars) renderBars(probs, ms);
  if (s.announce !== null) announce(s.announce);
  else if (s.removed) sayGone();
}

/** The note left the camera: say so once, then stay quiet until a note is shown again. */
function sayGone() {
  lastAnnounced = null;
  if (prefs.voice && speechSupported()) speak(tl(voiceLang(), 'sGone'), voiceLang());
  else els.announcer.textContent = t('sGone');
}

function setLoading(text) {
  shown = { state: 'loading', index: null };
  els.result.dataset.state = 'loading';
  els.stage.dataset.state = 'loading';
  els.stage.removeAttribute('data-currency');
  els.message.textContent = text;
  setRing(0.33);
}

function setRing(progress) {
  if (!ringLength) return;
  els.ringFill.style.strokeDashoffset = String(ringLength * (1 - progress));
}

function renderResult(s) {
  const index = s.state === 'candidate' ? s.candidate : s.state === 'confirmed' ? s.current : null;
  setRing(s.state === 'confirmed' ? 1 : s.state === 'candidate' ? s.progress : 0);
  if (shown.state === s.state && shown.index === index) return;
  shown = { state: s.state, index };

  els.result.dataset.state = s.state;
  els.stage.dataset.state = s.state;
  if (index === null) {
    els.stage.removeAttribute('data-currency');
    els.message.textContent = t('pointCamera');
    els.amount.textContent = '';
    els.unit.textContent = '';
    return;
  }
  const info = infos[index];
  const parts = displayParts(info, getLang());
  if (info.currency) els.stage.dataset.currency = info.currency;
  else els.stage.removeAttribute('data-currency');
  els.message.textContent = s.state === 'candidate' ? t('holdSteady') : '';
  els.amount.textContent = parts.amount;
  els.amount.classList.toggle('long', parts.amount.length > 8);
  els.unit.textContent = parts.unit;
}

function announce(index) {
  lastAnnounced = index;
  const info = infos[index];
  if (prefs.feedback) {
    chime(info.currency);
    buzz(info.currency);
  }
  els.result.classList.remove('pop');
  void els.result.offsetWidth; // restart the animation
  els.result.classList.add('pop');
  sayResult(info);
}

function sayResult(info) {
  if (askingLanguage) return;
  warnIfNoArabicVoice();
  if (prefs.voice && speechSupported()) {
    els.announcer.textContent = '';
    const lang = voiceLang();
    speak(speechText(info, lang), lang);
  } else {
    // Voice is off: let the phone's screen reader (TalkBack/VoiceOver) read it instead.
    els.announcer.textContent = fullName(info, getLang());
  }
}

function repeatLast() {
  unlockAudio();
  const current = stabilizer?.current;
  if (current !== null && current !== undefined && infos[current]?.kind !== 'nothing') sayResult(infos[current]);
  else if (prefs.voice) speak(tl(voiceLang(), 'sPoint'), voiceLang());
  else els.announcer.textContent = t('pointCamera');
}

/** Arabic interface but no Arabic voice installed: speak English instead of mispronouncing. */
function voiceLang() {
  return getLang() === 'ar' && !hasVoiceFor('ar') ? 'en' : getLang();
}

function warnIfNoArabicVoice() {
  if (!warnedVoice && prefs.voice && getLang() === 'ar' && !hasVoiceFor('ar')) {
    warnedVoice = true;
    toast(t('noArabicVoice'), 6000);
  }
}

const COLOR_VAR = { LBP: 'var(--lbp)', USD: 'var(--usd)', EUR: 'var(--eur)' };

function renderBars(probs, ms) {
  const now = performance.now();
  frameTimes.push(now);
  while (frameTimes.length > 12) frameTimes.shift();
  const fps = frameTimes.length > 1 ? ((frameTimes.length - 1) * 1000) / (now - frameTimes[0]) : 0;

  const top = ranked(probs).slice(0, 5);
  while (els.barsList.children.length < top.length) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="name"></span><span class="bar"><b></b></span><span class="pct"></span>';
    els.barsList.append(li);
  }
  [...els.barsList.children].forEach((li, k) => {
    const i = top[k];
    li.hidden = i === undefined;
    if (i === undefined) return;
    li.querySelector('.name').textContent = shortName(infos[i]);
    const b = li.querySelector('b');
    b.style.width = `${(probs[i] * 100).toFixed(1)}%`;
    b.style.setProperty('--c', COLOR_VAR[infos[i].currency] || 'var(--paper)');
    li.querySelector('.pct').textContent = `${Math.round(probs[i] * 100)}%`;
  });
  els.barsStats.textContent = `${fps.toFixed(0)} predictions/s, ${ms.toFixed(0)} ms each (${model.backend})`;
}

// ---------- problems ----------

function showCameraProblem(err) {
  const name = err?.name;
  let title;
  let text;
  if (name === 'InsecureContextError') [title, text] = [t('eInsecureT'), t('eInsecureM')];
  else if (name === 'NotAllowedError' || name === 'SecurityError') [title, text] = [t('eDeniedT'), t('eDeniedM')];
  else if (name === 'NotFoundError' || name === 'OverconstrainedError') [title, text] = [t('eNoCamT'), t('eNoCamM')];
  else [title, text] = [t('eBusyT'), t('eBusyM')];
  showProblem(title, text, false);
}

function showModelProblem() {
  if (modelState.status === 'missing') showProblem(t('eNoModelT'), t('eNoModelM'), true);
  else showProblem(t('eModelT'), modelState.error?.message || '', true);
}

function showProblem(title, text, offerSettings) {
  pause();
  els.problemTitle.textContent = title;
  els.problemText.textContent = text;
  els.problemSettings.hidden = !offerSettings;
  els.problem.hidden = false;
  els.problemRetry.focus();
  if (prefs.voice) speak(title, voiceLang());
}

async function retry() {
  els.problem.hidden = true;
  if (!model) loadModel(activeModelUrl());
  if (!stream) {
    await start(getLang());
    return;
  }
  setLoading(t('loadingModel'));
  await modelPromise;
  if (!model) {
    showModelProblem();
    return;
  }
  started = true;
  resume();
}

// ---------- settings ----------

function openSettings() {
  els.modelUrl.value = paramModel || prefs.modelUrl || '';
  els.threshold.value = Math.round(prefs.threshold * 100);
  els.hold.value = prefs.holdMs;
  els.optMirror.checked = prefs.mirror;
  els.optVoice.checked = prefs.voice;
  els.optFeedback.checked = prefs.feedback;
  els.optBars.checked = prefs.bars;
  renderSliderValues();
  renderModelStatus();
  if (!els.settings.open) els.settings.showModal();
}

function renderSliderValues() {
  els.thresholdOut.textContent = `${els.threshold.value}%`;
  els.holdOut.textContent = `${(Number(els.hold.value) / 1000).toFixed(1)} s`;
}

async function switchModel(url, storedValue) {
  save('modelUrl', storedValue);
  if (paramModel) {
    // The address-bar override no longer applies once a model is picked here.
    paramModel = null;
    history.replaceState(null, '', location.pathname);
  }
  const m = await loadModel(url);
  if (m) {
    toast(t('modelSwitched', { n: infos.length }));
    if (stream) {
      // Camera already on (possibly behind the "No model yet" screen): start scanning.
      els.problem.hidden = true;
      if (!started) {
        started = true;
        requestWakeLock();
      }
      resume();
    }
  }
}

// ---------- small UI helpers ----------

let toastTimer = 0;
function toast(text, ms = 3200) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, ms);
}

function renderVoiceButton() {
  els.btnVoice.setAttribute('aria-pressed', String(prefs.voice));
}

function refreshDynamicText() {
  const lang = getLang();
  els.langLabel.textContent = lang === 'ar' ? 'EN' : 'ع';
  els.btnLang.setAttribute('aria-label', t('aLanguage'));
  els.btnLang.setAttribute('lang', lang === 'ar' ? 'en' : 'ar');
  renderModelStatus();
  renderSliderValues();
  if (shown.state && shown.state !== 'loading') {
    const s = { state: shown.state, candidate: shown.index, current: shown.index, progress: 0 };
    shown = { state: null, index: null };
    renderResult(s);
  }
}

function buildGraphics() {
  const ring = rosettePath({ radius: 37, amp: 7, freq: -23 });
  els.ringTrack.setAttribute('d', ring);
  els.ringFill.setAttribute('d', ring);
  ringLength = els.ringFill.getTotalLength ? els.ringFill.getTotalLength() : 0;
  if (ringLength) {
    els.ringFill.style.strokeDasharray = String(ringLength);
    els.ringFill.style.strokeDashoffset = String(ringLength);
  }
  els.medallion.innerHTML = medallionPaths().map((d) => `<path d="${d}"/>`).join('');
}

// ---------- touch: tap = repeat, press and hold = change language by voice ----------
// The app opens straight on the camera in Arabic. A blind user never has to find a
// button: the whole screen is one target.

let greeted = false;
let askingLanguage = false;
let holdTimer = 0;
let swallowClick = false;
const HOLD_MS = 800;

/** First touch anywhere: phones only allow speech after a touch, so say the welcome now. */
function greet() {
  greeted = true;
  unlockAudio();
  if (!prefs.voice) return;
  const lang = voiceLang();
  const items = [{ text: tl(lang, 'sWelcome'), lang }];
  // One English sentence for English speakers, so they know how to switch.
  if (getLang() === 'ar') items.push({ text: 'For English, press and hold the screen.', lang: 'en' });
  speakQueue(items, () => {
    const current = stabilizer?.current;
    if (current !== null && current !== undefined && infos[current]?.kind !== 'nothing') sayResult(infos[current]);
  });
}

let tapTimer = 0;
const DOUBLE_TAP_MS = 350;

/** One tap: repeat the result. Two quick taps: flashlight on or off. */
function onScreenTap() {
  if (swallowClick) {
    swallowClick = false;
    return;
  }
  unlockAudio();
  if (tapTimer) {
    clearTimeout(tapTimer);
    tapTimer = 0;
    greeted = true;
    setTorch(!torchOn, { say: true });
    return;
  }
  tapTimer = setTimeout(() => {
    tapTimer = 0;
    if (!greeted) greet();
    else repeatLast();
  }, DOUBLE_TAP_MS);
}

function onHoldStart() {
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    swallowClick = true;
    if (navigator.vibrate) navigator.vibrate(60);
    chooseLanguageByVoice();
  }, HOLD_MS);
}

function onHoldEnd() {
  clearTimeout(holdTimer);
}

const ASK = [
  { text: 'قل: عربي، أو إنجليزي.', lang: 'ar' },
  { text: 'Say Arabic, or English.', lang: 'en' },
];

function applyLanguage(lang) {
  setLang(lang);
  save('lang', lang);
  warnedVoice = false;
  refreshDynamicText();
  warnIfNoArabicVoice();
  if (prefs.voice) speak(tl(voiceLang(), 'sReady'), voiceLang());
}

/** Ask "Arabic or English?" out loud and listen for the answer. Without a microphone API, just switch. */
function chooseLanguageByVoice() {
  greeted = true;
  unlockAudio();
  if (askingLanguage) return;
  if (!recognitionSupported()) {
    applyLanguage(getLang() === 'ar' ? 'en' : 'ar');
    return;
  }
  askingLanguage = true;
  speakQueue(ASK, async () => {
    const lang = await listenForLanguage();
    askingLanguage = false;
    if (lang) applyLanguage(lang);
    else if (prefs.voice) speak(tl(voiceLang(), 'sNotUnderstood'), voiceLang());
  });
}

// ---------- wiring ----------

function init() {
  // Arabic unless the person chose English before (press and hold the screen to change).
  setLang(prefs.lang || 'ar');
  buildGraphics();
  renderVoiceButton();
  els.bars.hidden = !prefs.bars;
  refreshDynamicText();

  els.repeat.addEventListener('click', onScreenTap);
  els.repeat.addEventListener('pointerdown', onHoldStart);
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((e) => els.repeat.addEventListener(e, onHoldEnd));
  els.repeat.addEventListener('contextmenu', (e) => e.preventDefault());
  // Any first touch (even on a top-bar button) unlocks sound.
  document.addEventListener('click', () => unlockAudio(), { capture: true, once: true });
  els.problemRetry.addEventListener('click', retry);
  els.problemSettings.addEventListener('click', openSettings);
  els.btnSettings.addEventListener('click', openSettings);

  els.btnLang.addEventListener('click', () => {
    greeted = true;
    applyLanguage(getLang() === 'ar' ? 'en' : 'ar');
  });

  els.btnVoice.addEventListener('click', () => {
    save('voice', !prefs.voice);
    renderVoiceButton();
    if (!prefs.voice) stopSpeaking();
    else {
      unlockAudio();
      warnIfNoArabicVoice();
    }
  });

  els.btnTorch.addEventListener('click', () => setTorch(!torchOn, { say: true }));
  els.btnCamera.addEventListener('click', switchCamera);

  els.threshold.addEventListener('input', () => {
    save('threshold', Number(els.threshold.value) / 100);
    if (stabilizer) stabilizer.threshold = prefs.threshold;
    renderSliderValues();
  });
  els.hold.addEventListener('input', () => {
    save('holdMs', Number(els.hold.value));
    if (stabilizer) stabilizer.holdMs = prefs.holdMs;
    renderSliderValues();
  });
  els.optMirror.addEventListener('change', () => save('mirror', els.optMirror.checked));
  els.optVoice.addEventListener('change', () => {
    save('voice', els.optVoice.checked);
    renderVoiceButton();
    if (!prefs.voice) stopSpeaking();
  });
  els.optFeedback.addEventListener('change', () => save('feedback', els.optFeedback.checked));
  els.optBars.addEventListener('change', () => {
    save('bars', els.optBars.checked);
    els.bars.hidden = !prefs.bars;
  });

  els.loadLink.addEventListener('click', () => {
    const raw = els.modelUrl.value.trim();
    const url = normalizeModelUrl(raw);
    if (!url) {
      els.modelUrl.focus();
      return;
    }
    switchModel(url, raw);
  });
  els.modelUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      els.loadLink.click();
    }
  });
  els.useBuiltin.addEventListener('click', () => {
    els.modelUrl.value = '';
    switchModel(builtInUrl(), '');
  });

  els.settings.addEventListener('close', () => {
    if (started && model && stream && els.problem.hidden) resume();
  });

  window.addEventListener('resize', layoutFrame);
  document.addEventListener('visibilitychange', () => {
    if (!started) return;
    if (document.hidden) {
      pause();
    } else {
      els.video.play().catch(() => {});
      requestWakeLock();
      if (els.problem.hidden) resume();
    }
  });

  // No start page: open the camera and load the model straight away.
  loadModel(activeModelUrl());
  start(getLang());
  registerServiceWorker();
}

applyI18n(document);
init();
