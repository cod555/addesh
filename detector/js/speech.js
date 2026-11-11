// Voice, chime and vibration feedback.
// Uses the phone's built-in text-to-speech (Web Speech API), so it works offline.

let voices = [];
let keepAlive = null; // Chrome can drop an utterance that gets garbage-collected mid-sentence.
let audioCtx = null;

function refreshVoices() {
  try {
    voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  } catch {
    voices = [];
  }
}

if ('speechSynthesis' in window) {
  refreshVoices();
  window.speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
}

export const speechSupported = () => 'speechSynthesis' in window;

/** True once the browser has told us which voices exist (some load them late). */
export const voicesKnown = () => voices.length > 0;

const PREFERENCES = {
  ar: ['ar-lb', 'ar-sa', 'ar-ae', 'ar-jo', 'ar-eg', 'ar-xa', 'ar'],
  en: ['en-us', 'en-gb', 'en-au', 'en-ca', 'en'],
};

export function findVoice(lang) {
  const tag = (v) => (v.lang || '').toLowerCase().replace('_', '-');
  for (const prefix of PREFERENCES[lang] || PREFERENCES.en) {
    const matches = voices.filter((v) => tag(v).startsWith(prefix));
    if (matches.length) return matches.find((v) => v.localService) || matches[0];
  }
  return null;
}

/** False only when we know for sure there is no voice for this language. */
export function hasVoiceFor(lang) {
  return !voicesKnown() || findVoice(lang) !== null;
}

function utterance(text, lang) {
  const u = new SpeechSynthesisUtterance(text);
  const voice = findVoice(lang);
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  } else {
    u.lang = lang === 'ar' ? 'ar-SA' : 'en-US';
  }
  u.rate = 1;
  u.pitch = 1;
  return u;
}

/**
 * Speaks several sentences in a row (each in its own language) without cutting any off,
 * then calls onDone. Used for the bilingual "English or Arabic?" question.
 */
export function speakQueue(items, onDone) {
  const synth = window.speechSynthesis;
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    onDone?.();
  };
  if (!synth || !items.length) {
    done();
    return;
  }
  synth.cancel();
  const list = items.map(({ text, lang }) => utterance(text, lang));
  keepAlive = list;
  const last = list[list.length - 1];
  last.onend = done;
  last.onerror = done;
  // Some browsers never fire "end": give up waiting after a generous estimate.
  const chars = items.reduce((n, i) => n + i.text.length, 0);
  setTimeout(done, 2500 + chars * 110);
  setTimeout(() => list.forEach((u) => synth.speak(u)), 60);
}

// ---------- voice recognition (the language question) ----------

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const recognitionSupported = () => Boolean(Recognition);

/** "english", "إنجليزي", "انكليزي", "inglizi" → 'en'; "arabic", "عربي", "3arabe" → 'ar'. */
export function matchLanguage(text) {
  const s = String(text).toLowerCase();
  const en = /eng|ingl|inkl|انج|انك|إنج|إنك|اينج|انقل|انگ|engl/.test(s);
  const ar = /arab|3arab|عرب|arabi|arabe|عربي/.test(s);
  if (en && !ar) return 'en';
  if (ar && !en) return 'ar';
  return null;
}

let activeRecognition = null;

/** Listens once and resolves 'en', 'ar' or null (nothing understood, no permission, or timeout). */
export function listenForLanguage({ timeoutMs = 7000 } = {}) {
  return new Promise((resolve) => {
    if (!Recognition) {
      resolve(null);
      return;
    }
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
      activeRecognition = null;
      resolve(value);
    };
    const rec = new Recognition();
    // Lebanese Arabic recognition also writes "English" as "انجليزي"/"English", so it catches both answers.
    rec.lang = 'ar-LB';
    rec.interimResults = true;
    rec.maxAlternatives = 5;
    rec.continuous = false;
    rec.onresult = (event) => {
      for (const result of event.results) {
        for (const alt of result) {
          const lang = matchLanguage(alt.transcript);
          if (lang) {
            finish(lang);
            return;
          }
        }
      }
    };
    rec.onerror = () => finish(null);
    rec.onend = () => finish(null);
    const timer = setTimeout(() => finish(null), timeoutMs);
    activeRecognition = { stop: () => finish(null) };
    try {
      rec.start();
    } catch {
      finish(null);
    }
  });
}

export function stopListening() {
  activeRecognition?.stop();
}

export function speak(text, lang = 'en') {
  const synth = window.speechSynthesis;
  if (!synth || !text) return false;
  const u = utterance(text, lang);
  keepAlive = u;
  if (synth.speaking || synth.pending) {
    // Interrupt the previous sentence; a short gap avoids a Chrome bug that drops the new one.
    synth.cancel();
    setTimeout(() => synth.speak(u), 60);
  } else {
    synth.speak(u);
  }
  return true;
}

export function stopSpeaking() {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}

/**
 * Must run inside a tap/click handler. iPhones only allow speech and sound that
 * start from a user gesture, so we "unlock" both on the first tap.
 */
export function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    audioCtx = null;
  }
  try {
    const synth = window.speechSynthesis;
    if (synth && !synth.speaking) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      synth.speak(u);
    }
  } catch {
    /* ignore */
  }
}

// Each currency gets its own pitch, so you can tell them apart before the voice finishes.
const CHIME_BASE = { LBP: 440, USD: 554.37, EUR: 659.25 };

export function chime(currency) {
  if (!audioCtx) return;
  try {
    const base = CHIME_BASE[currency] || 494;
    const t0 = audioCtx.currentTime + 0.01;
    [base, base * 1.5].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const start = t0 + i * 0.09;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.17);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    });
  } catch {
    /* ignore */
  }
}

// Lira: one pulse. Dollar: two. Euro: three.
const BUZZ = { LBP: [70], USD: [70, 90, 70], EUR: [70, 90, 70, 90, 70] };

export function buzz(currency) {
  try {
    navigator.vibrate?.(BUZZ[currency] || [70]);
  } catch {
    /* ignore */
  }
}
