// Runs the model over a labelled test set and computes the numbers for the slides.

import { ranked } from './model.js';

async function decode(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('The browser could not read this image.');
  }
  return { img, release: () => URL.revokeObjectURL(url) };
}

const scratch = [document.createElement('canvas'), document.createElement('canvas')];

/** Centre square of the photo, i.e. exactly the part the model looks at. */
async function squareThumb(img, size) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  let side = Math.min(w, h);
  let sx = (w - side) / 2;
  let sy = (h - side) / 2;
  let source = img;
  let flip = 0;
  while (side > size * 2) {
    const next = Math.ceil(side / 2);
    const c = scratch[flip];
    flip = 1 - flip;
    c.width = c.height = next;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, sx, sy, side, side, 0, 0, next, next);
    source = c;
    sx = 0;
    sy = 0;
    side = next;
  }
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size);
  const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', 0.86));
  return blob ? URL.createObjectURL(blob) : out.toDataURL('image/jpeg', 0.86);
}

/**
 * items: [{ file, trueIndex, folder }]
 * Returns one row per photo: { name, folder, trueIndex, predIndex, conf, top, correct, thumb, error }
 */
export async function evaluate(model, items, { mirror = true, onProgress, shouldStop } = {}) {
  const rows = [];
  for (let i = 0; i < items.length; i++) {
    if (shouldStop?.()) break;
    const item = items[i];
    const row = { name: item.file.name, folder: item.folder, trueIndex: item.trueIndex, file: item.file };
    let decoded = null;
    try {
      decoded = await decode(item.file);
      const probs = await model.predict(decoded.img, { mirror });
      const order = ranked(probs);
      row.predIndex = order[0];
      row.conf = probs[order[0]];
      row.top = order.slice(0, 3).map((index) => ({ index, p: probs[index] }));
      row.correct = row.predIndex === row.trueIndex;
      row.thumb = await squareThumb(decoded.img, 360);
    } catch (err) {
      row.error = err.message || String(err);
    } finally {
      decoded?.release();
    }
    rows.push(row);
    onProgress?.(i + 1, items.length);
    if (i % 3 === 2) await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
  }
  return rows;
}

/** Accuracy per class and overall, plus the confusion matrix (rows = actual, columns = predicted). */
export function summarize(rows, classCount) {
  const matrix = Array.from({ length: classCount }, () => new Array(classCount).fill(0));
  const perClass = Array.from({ length: classCount }, () => ({ total: 0, correct: 0 }));
  let total = 0;
  let correct = 0;
  let confSum = 0;
  let errors = 0;
  for (const r of rows) {
    if (r.error) {
      errors++;
      continue;
    }
    matrix[r.trueIndex][r.predIndex]++;
    perClass[r.trueIndex].total++;
    total++;
    confSum += r.conf;
    if (r.correct) {
      perClass[r.trueIndex].correct++;
      correct++;
    }
  }
  perClass.forEach((c, i) => {
    c.accuracy = c.total ? c.correct / c.total : null;
    let worst = -1;
    let worstCount = 0;
    matrix[i].forEach((n, j) => {
      if (j !== i && n > worstCount) {
        worst = j;
        worstCount = n;
      }
    });
    c.confusedWith = worst;
    c.confusedCount = worstCount;
  });
  return {
    total,
    correct,
    accuracy: total ? correct / total : null,
    avgConfidence: total ? confSum / total : null,
    perClass,
    matrix,
    errors,
  };
}
