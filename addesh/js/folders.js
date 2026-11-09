// Reads a folder of photos (picked or dropped) and groups them by class subfolder:
//   test/USD 20/IMG_001.jpg  →  class folder "USD 20"

import { normalizeName, parseLabel } from './labels.js';

const IMAGE_EXT = /\.(jpe?g|jfif|png|webp|bmp|gif|avif)$/i;
const HEIC_EXT = /\.(heic|heif)$/i;
const JUNK = /^(\.|thumbs\.db$|desktop\.ini$)/i;

export function entriesFromInput(input) {
  return Array.from(input.files || []).map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}

/** Must be called synchronously inside the drop handler (the DataTransfer expires afterwards). */
export function entriesFromDrop(dataTransfer) {
  const roots = Array.from(dataTransfer.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
    .filter(Boolean);
  const looseFiles = roots.length ? [] : Array.from(dataTransfer.files || []);
  return (async () => {
    const out = looseFiles.map((file) => ({ file, path: file.name }));
    for (const root of roots) await walk(root, '', out);
    return out;
  })();
}

async function walk(entry, prefix, out) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    out.push({ file, path: `${prefix}${file.name}` });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    for (;;) {
      // readEntries returns at most ~100 entries per call, so keep reading until empty.
      const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await walk(child, `${prefix}${entry.name}/`, out);
    }
  }
}

/** { groups: Map(folderName → File[]), total, heic, other, loose } */
export function groupByFolder(entries) {
  const groups = new Map();
  let heic = 0;
  let other = 0;
  let loose = 0;
  // A picked folder ("test/USD 20/a.jpg") has a root shared by every path. Drop it when there
  // are class subfolders below it, so photos lying directly in the root count as loose.
  const split = entries.map(({ path }) => path.split('/').filter(Boolean));
  const root = split[0]?.[0];
  const sharedRoot = split.length && split.every((parts) => parts.length >= 2 && parts[0] === root) && split.some((parts) => parts.length >= 3);
  for (let k = 0; k < entries.length; k++) {
    const { file } = entries[k];
    const parts = sharedRoot ? split[k].slice(1) : split[k];
    const name = parts[parts.length - 1] || file.name;
    if (JUNK.test(name)) continue;
    if (HEIC_EXT.test(name)) {
      heic++;
      continue;
    }
    if (!IMAGE_EXT.test(name)) {
      other++;
      continue;
    }
    if (parts.length < 2) {
      loose++;
      continue;
    }
    const folder = parts[parts.length - 2];
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(file);
  }
  const sorted = new Map([...groups].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })));
  let total = 0;
  sorted.forEach((files) => {
    total += files.length;
  });
  return { groups: sorted, total, heic, other, loose };
}

/** Finds the model class a folder belongs to: same name, or same note ("20 dollars" = "USD 20"). */
export function matchFolder(folder, infos) {
  const name = normalizeName(folder);
  let index = infos.findIndex((info) => normalizeName(info.label) === name);
  if (index >= 0) return index;
  const parsed = parseLabel(folder);
  if (parsed.kind !== 'unknown') index = infos.findIndex((info) => info.key === parsed.key);
  return index;
}

/** Splits folders into those that map to a model class and those that don't. */
export function mapToModel(groups, infos) {
  const mapped = [];
  const unmatched = [];
  for (const [folder, files] of groups) {
    const index = matchFolder(folder, infos);
    if (index >= 0) mapped.push({ folder, files, index });
    else unmatched.push({ folder, files });
  }
  const covered = new Set(mapped.map((m) => m.index));
  const missing = infos.map((_, i) => i).filter((i) => !covered.has(i));
  return { mapped, unmatched, missing };
}

export async function sha256(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
