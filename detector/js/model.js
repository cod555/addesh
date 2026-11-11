// Loads the YOLO banknote detector (ONNX) and runs it with ONNX Runtime Web.
// The app still gets one probability per class, like a classifier: the confidence of the
// best box for each note, and "Nothing" when no box is found. The boxes are kept in lastBoxes.

const ORT_DIST = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/';
const MIN_CONF = 0.25; // boxes below this are ignored
const IOU = 0.5; // boxes overlapping more than this are the same note

const ort = () => {
  if (!window.ort) throw new ModelError('ort', 'ONNX Runtime did not load. Check your internet connection and reload.');
  return window.ort;
};

export class ModelError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'ModelError';
    this.code = code;
    this.cause = cause;
  }
}

/** Returns a folder URL ending in "/" (the folder holds best.onnx and metadata.json). */
export function normalizeModelUrl(input) {
  let s = String(input ?? '').trim();
  if (!s) return null;
  s = s.replace(/[?#].*$/, '').replace(/(best\.onnx|metadata\.json)$/i, '');
  if (!s.endsWith('/')) s += '/';
  return s;
}

export const isRemoteUrl = (url) => /^https?:\/\//i.test(url) && !url.startsWith(location.origin);

async function createSession(bytes) {
  const o = ort();
  o.env.wasm.wasmPaths = ORT_DIST;
  o.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  try {
    return await o.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  } catch (err) {
    throw new ModelError('model', 'The detector did not load: ' + err.message, err);
  }
}

/** Load best.onnx and metadata.json from a folder URL. */
export async function loadModelFromUrl(url, { onProgress } = {}) {
  const base = new URL(url, location.href).href;
  ort();
  let meta;
  try {
    const res = await fetch(base + 'metadata.json', { cache: 'no-cache' });
    if (res.status === 404) throw new ModelError('not-found', 'No model found at ' + url);
    if (!res.ok) throw new ModelError('http', 'metadata.json returned HTTP ' + res.status + '.');
    meta = await res.json();
  } catch (err) {
    if (err instanceof ModelError) throw err;
    if (err instanceof SyntaxError) throw new ModelError('not-found', 'No model found at ' + url, err);
    throw new ModelError('network', "Couldn't reach " + base + 'metadata.json. Check your internet connection.', err);
  }
  let bytes;
  try {
    const res = await fetch(base + 'best.onnx', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const total = Number(res.headers.get('content-length')) || 0;
    if (res.body && total) {
      const reader = res.body.getReader();
      bytes = new Uint8Array(total);
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (got + value.length > bytes.length) {
          const bigger = new Uint8Array(Math.max(bytes.length * 2, got + value.length));
          bigger.set(bytes.subarray(0, got));
          bytes = bigger;
        }
        bytes.set(value, got);
        got += value.length;
        onProgress?.(Math.min(1, got / total));
      }
      bytes = bytes.subarray(0, got);
    } else {
      bytes = new Uint8Array(await res.arrayBuffer());
    }
  } catch (err) {
    throw new ModelError('model', "best.onnx didn't load: " + err.message, err);
  }
  return wrap(await createSession(bytes), meta, { kind: 'url', url, label: url });
}

/** Load from files the person picked: best.onnx and metadata.json. */
export async function loadModelFromFiles(fileList) {
  ort();
  const files = Array.from(fileList);
  const onnx = files.find((f) => /\.onnx$/i.test(f.name));
  let meta = null;
  for (const f of files.filter((x) => /\.json$/i.test(x.name))) {
    try {
      const data = JSON.parse(await f.text());
      if (Array.isArray(data.labels)) meta = data;
    } catch {
      /* not JSON we care about */
    }
  }
  const missing = [!onnx && 'best.onnx', !meta && 'metadata.json'].filter(Boolean);
  if (missing.length) throw new ModelError('files', 'Missing ' + missing.join(', ') + '. Choose best.onnx and metadata.json.');
  const bytes = new Uint8Array(await onnx.arrayBuffer());
  return wrap(await createSession(bytes), meta, { kind: 'files', label: onnx.name });
}

function wrap(session, meta, source) {
  const labels = Array.isArray(meta?.labels) ? meta.labels.map(String) : [];
  if (labels.length < 2) throw new ModelError('metadata', 'metadata.json has no class names.');
  return new ImageModel(session, labels, meta.imageSize || 640, meta, source);
}

function iou(a, b) {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return inter / (a.w * a.h + b.w * b.h - inter);
}

class ImageModel {
  constructor(session, labels, size, meta, source) {
    this.session = session;
    this.labels = labels; // note classes, then "Nothing" last
    this.classes = labels.length - 1;
    this.size = size;
    this.meta = meta;
    this.source = source;
    this.backend = 'wasm';
    this.lastBoxes = [];
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.queue = Promise.resolve();
  }

  /** Finds the notes in an image or video frame. Boxes are in the source's own pixels. */
  async detect(src) {
    const S = this.size;
    const w = src.videoWidth || src.naturalWidth || src.width;
    const h = src.videoHeight || src.naturalHeight || src.height;
    if (!w || !h) throw new Error('The image has no pixels yet.');
    const r = S / Math.max(w, h);
    const nw = Math.round(w * r);
    const nh = Math.round(h * r);
    const px = (S - nw) >> 1;
    const py = (S - nh) >> 1;
    this.ctx.fillStyle = 'rgb(114,114,114)';
    this.ctx.fillRect(0, 0, S, S);
    this.ctx.drawImage(src, 0, 0, w, h, px, py, nw, nh);
    const d = this.ctx.getImageData(0, 0, S, S).data;
    const n = S * S;
    const input = new Float32Array(3 * n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      input[i] = d[j] / 255;
      input[n + i] = d[j + 1] / 255;
      input[2 * n + i] = d[j + 2] / 255;
    }
    const o = ort();
    const feeds = { [this.session.inputNames[0]]: new o.Tensor('float32', input, [1, 3, S, S]) };
    const out = (await this.session.run(feeds))[this.session.outputNames[0]];
    const data = out.data;
    const N = out.dims[2]; // output is [1, 4 + classes, N]
    const C = Math.min(this.classes, out.dims[1] - 4);
    const found = [];
    for (let i = 0; i < N; i++) {
      let best = 0;
      let cls = -1;
      for (let c = 0; c < C; c++) {
        const s = data[(4 + c) * N + i];
        if (s > best) {
          best = s;
          cls = c;
        }
      }
      if (best < MIN_CONF) continue;
      const bw = data[2 * N + i];
      const bh = data[3 * N + i];
      found.push({ x: (data[i] - bw / 2 - px) / r, y: (data[N + i] - bh / 2 - py) / r, w: bw / r, h: bh / r, p: best, cls });
    }
    found.sort((a, b) => b.p - a.p);
    const keep = [];
    for (const b of found) if (!keep.some((k) => iou(k, b) > IOU)) keep.push(b);
    return keep;
  }

  /**
   * Returns one probability per class, in the same order as this.labels.
   * (The mirror option is ignored: a mirrored banknote does not exist.)
   */
  predict(src) {
    const run = this.queue.then(async () => {
      const boxes = await this.detect(src);
      this.lastBoxes = boxes;
      const probs = new Array(this.labels.length).fill(0);
      let top = 0;
      for (const b of boxes) {
        if (b.p > probs[b.cls]) probs[b.cls] = b.p;
        if (b.p > top) top = b.p;
      }
      probs[this.classes] = 1 - top;
      return probs;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  /** Runs one prediction so the first real frame is fast. */
  async warmUp() {
    this.ctx.fillStyle = '#808080';
    this.ctx.fillRect(0, 0, this.size, this.size);
    await this.predict(this.canvas);
    this.lastBoxes = [];
  }

  dispose() {
    try {
      this.session.release();
    } catch {
      /* ignore */
    }
  }
}

/** Indexes sorted from most to least likely. */
export function ranked(probs) {
  return probs.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
}
