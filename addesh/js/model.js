// Loads a Teachable Machine image model and classifies images with it.
// Preprocessing matches Teachable Machine exactly: centre square crop, resize to
// 224x224, scale pixels to the range -1..1 (pixel / 127 - 1).

const tf = () => {
  if (!window.tf) throw new ModelError('tfjs', 'TensorFlow.js did not load. Check that vendor/tf-4.22.0.min.js exists.');
  return window.tf;
};

export class ModelError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'ModelError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Accepts anything people tend to paste and returns a folder URL ending in "/":
 *   https://teachablemachine.withgoogle.com/models/AbC123/   (shareable link)
 *   https://teachablemachine.withgoogle.com/models/AbC123/model.json
 *   AbC123                                                     (just the ID)
 *   ./model/                                                   (folder in this site)
 */
export function normalizeModelUrl(input) {
  let s = String(input ?? '').trim();
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{6,}$/.test(s) && !/^model(s)?$/i.test(s)) {
    s = `https://teachablemachine.withgoogle.com/models/${s}/`;
  }
  s = s.replace(/[?#].*$/, '').replace(/(model|metadata)\.json$/i, '');
  if (!s.endsWith('/')) s += '/';
  return s;
}

export const isRemoteUrl = (url) => /^https?:\/\//i.test(url) && !url.startsWith(location.origin);

/** Load from a folder URL (see normalizeModelUrl). */
export async function loadModelFromUrl(url, { onProgress } = {}) {
  const base = new URL(url, location.href).href;
  await tf().ready();

  let meta;
  try {
    const res = await fetch(`${base}metadata.json`, { cache: 'no-cache' });
    if (res.status === 404) throw new ModelError('not-found', `No model found at ${url}`);
    if (!res.ok) throw new ModelError('http', `metadata.json returned HTTP ${res.status}.`);
    meta = await res.json();
  } catch (err) {
    if (err instanceof ModelError) throw err;
    if (err instanceof SyntaxError) throw new ModelError('not-found', `No model found at ${url}`, err);
    throw new ModelError('network', `Couldn't reach ${base}metadata.json. Check the link and your internet connection.`, err);
  }

  let model;
  try {
    model = await tf().loadLayersModel(`${base}model.json`, {
      onProgress,
      requestInit: { cache: 'no-cache' },
    });
  } catch (err) {
    throw new ModelError('model', `model.json didn't load: ${err.message}`, err);
  }
  return wrap(model, meta, { kind: 'url', url, label: url });
}

/**
 * Load from files the person picked: the .zip Teachable Machine gives you, or the
 * three files inside it. Windows renames repeated downloads ("model (1).json"),
 * so files are recognised by their contents, not their names.
 */
export async function loadModelFromFiles(fileList) {
  await tf().ready();
  let files = Array.from(fileList);
  const zip = files.find((f) => /\.zip$/i.test(f.name));
  if (zip) files = await unzip(zip);

  let modelJson = null;
  let modelFile = null;
  let meta = null;
  for (const f of files.filter((x) => /\.json$/i.test(x.name))) {
    try {
      const data = JSON.parse(await f.text());
      if (data.modelTopology) {
        modelJson = data;
        modelFile = f;
      } else if (Array.isArray(data.labels)) {
        meta = data;
      }
    } catch {
      /* not JSON we care about */
    }
  }
  const bins = files.filter((f) => /\.bin$/i.test(f.name));
  const missing = [!modelFile && 'model.json', !meta && 'metadata.json', !bins.length && 'weights.bin'].filter(Boolean);
  if (missing.length) {
    throw new ModelError('files', `Missing ${missing.join(', ')}. Choose the .zip from Teachable Machine, or all three files inside it.`);
  }

  // Give the weight files the names model.json expects.
  const expected = (modelJson.weightsManifest || []).flatMap((g) => g.paths).map((p) => p.split('/').pop());
  let weights = bins;
  const names = new Set(bins.map((b) => b.name));
  if (!expected.every((n) => names.has(n))) {
    if (expected.length !== bins.length) {
      throw new ModelError('files', `model.json expects ${expected.length} weight file(s) but ${bins.length} were chosen.`);
    }
    const sorted = [...bins].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    weights = expected.map((name, i) => new File([sorted[i]], name));
  }

  let model;
  try {
    model = await tf().loadLayersModel(tf().io.browserFiles([modelFile, ...weights]));
  } catch (err) {
    throw new ModelError('model', `The model files didn't load: ${err.message}`, err);
  }
  return wrap(model, meta, { kind: 'files', label: zip ? zip.name : 'chosen files' });
}

function wrap(model, meta, source) {
  const labels = Array.isArray(meta?.labels) ? meta.labels.map(String) : [];
  if (!labels.length) {
    model.dispose();
    throw new ModelError('metadata', 'metadata.json has no class names.');
  }
  const out = model.outputs[0].shape;
  const outputs = out[out.length - 1];
  if (outputs !== labels.length) {
    model.dispose();
    throw new ModelError('mismatch', `The model has ${outputs} outputs but metadata.json lists ${labels.length} classes. Use files from the same export.`);
  }
  if (meta.grayscale) {
    model.dispose();
    throw new ModelError('grayscale', 'This is an embedded (grayscale) model. In Teachable Machine choose "Standard image model".');
  }
  const size = meta.imageSize || model.inputs[0].shape[1] || 224;
  return new ImageModel(model, labels, size, meta, source);
}

class ImageModel {
  constructor(model, labels, size, meta, source) {
    this.model = model;
    this.labels = labels;
    this.size = size;
    this.meta = meta;
    this.source = source;
    this.backend = tf().getBackend();
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
  }

  /**
   * Draws the centre square of any image or video frame into this.canvas at size x size.
   * Same arithmetic and same (default) resampling as Teachable Machine's cropTo(), so the
   * model sees exactly what it saw during training and in Teachable Machine's preview.
   */
  drawSquare(src) {
    const w = src.videoWidth || src.naturalWidth || src.width;
    const h = src.videoHeight || src.naturalHeight || src.height;
    if (!w || !h) throw new Error('The image has no pixels yet.');
    const scale = this.size / Math.min(w, h);
    const scaledW = Math.ceil(w * scale);
    const scaledH = Math.ceil(h * scale);
    this.ctx.drawImage(src, -Math.trunc((scaledW - this.size) / 2), -Math.trunc((scaledH - this.size) / 2), scaledW, scaledH);
    return this.canvas;
  }

  /**
   * Returns one probability per class, in the same order as this.labels.
   * mirror: also classify the left-right flipped image and average the two.
   */
  async predict(src, { mirror = true } = {}) {
    const T = tf();
    this.drawSquare(src);
    const probs = T.tidy(() => {
      const img = T.browser.fromPixels(this.canvas).toFloat().div(127).sub(1);
      const batch = mirror ? T.stack([img, T.reverse(img, 1)]) : img.expandDims(0);
      const out = this.model.predict(batch);
      return mirror ? out.mean(0) : out.squeeze([0]);
    });
    const values = await probs.data();
    probs.dispose();
    return Array.from(values);
  }

  /** Runs one prediction so the first real frame is fast (shaders compile here). */
  async warmUp() {
    this.ctx.fillStyle = '#808080';
    this.ctx.fillRect(0, 0, this.size, this.size);
    await this.predict(this.canvas, { mirror: true });
  }

  dispose() {
    try {
      this.model.dispose();
    } catch {
      /* ignore */
    }
  }
}

/** Indexes sorted from most to least likely. */
export function ranked(probs) {
  return probs.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
}

// Minimal .zip reader using the browser's built-in decompression (no library needed).
async function unzip(file) {
  if (typeof DecompressionStream === 'undefined') {
    throw new ModelError('zip', 'This browser cannot open .zip files. Unzip it first and choose the three files inside.');
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ModelError('zip', `${file.name} is not a valid .zip file.`);
  const count = dv.getUint16(end + 10, true);
  let p = dv.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const out = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new ModelError('zip', `${file.name} uses an unsupported .zip layout.`);
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = decoder.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const base = name.split('/').pop();
    if (!base || base.startsWith('.') || name.startsWith('__MACOSX')) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = buf.subarray(start, start + size);
    let bytes;
    if (method === 0) bytes = data;
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new ModelError('zip', `${base} uses an unsupported compression method.`);
    out.push(new File([bytes], base));
  }
  return out;
}
