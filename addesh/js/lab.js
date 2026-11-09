// Model Lab: test the model on unseen photos and produce the numbers for the slides.

import { CONFIG } from './config.js';
import { store } from './store.js';
import { loadModelFromUrl, loadModelFromFiles, normalizeModelUrl } from './model.js';
import { parseLabel, shortName, speechText, fullName } from './labels.js';
import { speak, unlockAudio, hasVoiceFor } from './speech.js';
import { entriesFromInput, entriesFromDrop, groupByFolder, mapToModel, matchFolder, sha256 } from './folders.js';
import { evaluate, summarize } from './evaluate.js';
import { el, replace, pct, plural, toast, download, toCsv, copyTable } from './dom.js';
import { rosettePath } from './rosette.js';
import { registerServiceWorker } from './pwa.js';

const $ = (id) => document.getElementById(id);
const out = { model: $('model-out'), train: $('train-out'), test: $('test-out'), compare: $('compare-out') };

const state = {
  model: null,
  infos: [],
  loading: false,
  train: null, // grouped training folder
  test: null, // grouped test folder
  rows: null, // one row per tested photo
  summary: null,
  runMeta: null,
  running: false,
  stop: false,
  filter: 'wrong',
  showAll: false,
  viewerList: [],
  viewerPos: 0,
};

const params = new URLSearchParams(location.search);
const builtInUrl = () => normalizeModelUrl(CONFIG.modelUrl);
const activeUrl = () => normalizeModelUrl(params.get('model') || store.get('modelUrl', '') || CONFIG.modelUrl);

const SPEAKER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

// ---------- shared bits ----------

function chip(info) {
  return el('span', { class: 'chip', dataset: { currency: info.currency || '', kind: info.kind } }, info.label);
}

function speakButton(text, lang) {
  return el('button', {
    class: 'speak-btn',
    type: 'button',
    'aria-label': `Play: ${text}`,
    html: SPEAKER,
    onclick: () => {
      unlockAudio();
      speak(text, lang);
    },
  });
}

function checks(items) {
  const cls = (ok) => (ok === true ? 'ok' : ok === 'warn' ? 'warn' : 'fail');
  const sign = (ok) => (ok === true ? '✓' : ok === 'warn' ? '!' : '✕');
  const said = (ok) => (ok === true ? 'Passed: ' : ok === 'warn' ? 'Check: ' : 'Not met: ');
  return el('ul', { class: 'checks' }, items.filter(Boolean).map((c) =>
    el('li', { class: cls(c.ok) },
      el('span', { class: 'mark', 'aria-hidden': 'true' }, sign(c.ok)),
      el('span', {}, el('span', { class: 'visually-hidden' }, said(c.ok)), c.text, c.detail ? el('span', { class: 'detail' }, c.detail) : null))));
}

function toolbar(title, ...actions) {
  return el('div', { class: 'toolbar' }, el('h3', {}, title), el('div', { class: 'inline wrap' }, actions));
}

function meter(fraction, low = false) {
  return el('span', { class: `meter${low ? ' low' : ''}`, 'aria-hidden': 'true' },
    el('b', { style: { width: `${Math.max(0, Math.min(1, fraction || 0)) * 100}%` } }));
}

function describeSource(model) {
  if (model.source.kind !== 'url') return model.source.label;
  const tm = model.source.url.match(/teachablemachine\.withgoogle\.com\/models\/([^/]+)/);
  if (tm) return `Teachable Machine (${tm[1]})`;
  return model.source.url === builtInUrl() ? 'the model folder' : model.source.url;
}

// ---------- step 1: model ----------

async function loadModel(kind, payload, { quietIfMissing = false } = {}) {
  if (state.loading || state.running) return;
  state.loading = true;
  const status = el('p', { class: 'summary' }, kind === 'files' ? 'Reading the model files…' : 'Loading the model…');
  replace(out.model, status);
  try {
    const m = kind === 'files'
      ? await loadModelFromFiles(payload)
      : await loadModelFromUrl(payload, {
        onProgress: (f) => {
          status.textContent = `Loading the model… ${Math.round(f * 100)}%`;
        },
      });
    await m.warmUp();
    state.model?.dispose();
    state.model = m;
    state.infos = m.labels.map(parseLabel);
    clearResults();
    renderModel();
    renderTrain();
    renderTest();
  } catch (err) {
    console.error(err);
    if (err.code === 'not-found' && quietIfMissing) {
      replace(out.model, el('p', { class: 'empty' }, 'There is no model in the model folder yet. Paste your Teachable Machine link above, or choose the model files.'));
    } else {
      replace(out.model, el('p', { class: 'summary bad-text' }, el('strong', {}, 'The model didn’t load. '), err.message));
    }
  } finally {
    state.loading = false;
  }
}

function renderModel() {
  const m = state.model;
  const infos = state.infos;
  const unknown = infos.filter((i) => i.kind === 'unknown');
  const assumed = infos.filter((i) => i.kind === 'note' && i.warning);
  const hasNothing = infos.some((i) => i.kind === 'nothing');
  const byKey = new Map();
  infos.forEach((i) => byKey.set(i.key, [...(byKey.get(i.key) || []), i.label]));
  const dupes = [...byKey.values()].filter((labels) => labels.length > 1);
  const arabicVoice = hasVoiceFor('ar');

  replace(out.model,
    m.meta?.userMetadata?.demo
      ? el('p', { class: 'summary warn-text' }, el('strong', {}, 'This is the demo model. '), 'It only looks at colour (orange, green, blue, grey) so you can try the app. Replace the files in the model folder with your Teachable Machine export.')
      : null,
    el('p', { class: 'summary' },
      el('strong', {}, plural(infos.length, 'class', 'classes')),
      ` loaded from ${describeSource(m)}. Photos are cropped to the centre square and resized to ${m.size} × ${m.size} pixels; running on ${m.backend}.`),
    checks([
      { ok: infos.length >= 3, text: 'At least 3 classes', detail: infos.length < 3 ? `This model has ${infos.length}.` : null },
      {
        ok: hasNothing,
        text: 'A “Nothing” class for when no note is in view',
        detail: hasNothing ? null : 'Add a class named Nothing with photos of an empty table, hands, receipts and other papers.',
      },
      {
        ok: unknown.length ? false : assumed.length ? 'warn' : true,
        text: 'Every class name says which note it is',
        detail: unknown.length
          ? `Rename in Teachable Machine: ${unknown.map((i) => `“${i.label}”`).join(', ')}. Use names like “USD 20”, “EUR 50”, “LBP 20000”, “Nothing”.`
          : assumed.length ? assumed[0].warning : null,
      },
      { ok: dupes.length === 0, text: 'No two classes are the same note', detail: dupes.length ? dupes.map((d) => d.join(' and ')).join('; ') : null },
      arabicVoice ? null : { ok: 'warn', text: 'This computer has no Arabic voice, so the Arabic play buttons may stay silent. Phones usually have one.' },
    ]),
    el('div', { class: 'table-wrap' },
      el('table', { class: 'data' },
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col' }, 'Class in Teachable Machine'),
          el('th', { scope: 'col' }, 'Understood as'),
          el('th', { scope: 'col' }, 'Spoken in English'),
          el('th', { scope: 'col' }, 'Spoken in Arabic'))),
        el('tbody', {}, infos.map((info) => el('tr', {},
          el('td', {}, chip(info)),
          el('td', { class: info.kind === 'unknown' ? 'bad-text' : info.warning ? 'warn-text' : '' },
            info.kind === 'unknown' ? 'Not recognised' : info.kind === 'nothing' ? 'No banknote (stays silent)' : fullName(info, 'en')),
          el('td', {}, info.kind === 'nothing' ? '—' : [speakButton(speechText(info, 'en'), 'en'), speechText(info, 'en')]),
          el('td', { class: 'ar', lang: 'ar', dir: 'rtl' }, info.kind === 'nothing' ? '—' : [speakButton(speechText(info, 'ar'), 'ar'), speechText(info, 'ar')]),
        ))))),
    false
      ? el('div', { class: 'toolbar' },
        el('p', { class: 'hint' }, 'The scanner uses the model folder unless you tell it otherwise.'),
        el('button', {
          class: 'btn',
          type: 'button',
          onclick: () => {
            store.set('modelUrl', m.source.url);
            toast('The scanner on this device now uses this link.');
          },
        }, 'Use this link in the scanner on this device'))
      : null,
  );
}

// ---------- step 2: training photos ----------

async function onTrainFolder(entriesPromise) {
  replace(out.train, el('p', { class: 'summary' }, 'Reading the folder…'));
  state.train = groupByFolder(await entriesPromise);
  renderTrain();
}

function skippedNote(grouped) {
  const parts = [];
  if (grouped.heic) parts.push(`${plural(grouped.heic, 'HEIC photo')} (iPhone format the browser can’t read; on the iPhone choose Settings, Camera, Formats, Most Compatible, or export as JPG)`);
  if (grouped.loose) parts.push(`${plural(grouped.loose, 'photo')} not inside a class folder`);
  if (grouped.other) parts.push(`${plural(grouped.other, 'file')} that are not photos`);
  return parts.length ? el('p', { class: 'hint' }, `Skipped: ${parts.join('; ')}.`) : null;
}

function renderTrain() {
  const tr = state.train;
  if (!tr) return;
  if (!tr.groups.size) {
    replace(out.train, el('p', { class: 'empty' }, 'No photos found inside class folders. Choose the folder that contains one subfolder per class.'), skippedNote(tr));
    return;
  }
  const counts = [...tr.groups].map(([folder, files]) => ({ folder, n: files.length }));
  const min = Math.min(...counts.map((c) => c.n));
  const max = Math.max(...counts.map((c) => c.n));
  const ratio = max / min;
  const under = counts.filter((c) => c.n < 100);
  const nothingIndex = state.infos.findIndex((i) => i.kind === 'nothing');
  const hasNothing = counts.some((c) => parseLabel(c.folder).kind === 'nothing' || (nothingIndex >= 0 && matchFolder(c.folder, state.infos) === nothingIndex));
  const map = state.model ? mapToModel(tr.groups, state.infos) : null;

  const copyRows = counts.map((c) => [c.folder, c.n]);
  copyRows.push(['Total', tr.total]);

  replace(out.train,
    el('p', { class: 'summary' }, el('strong', {}, plural(tr.total, 'photo')), ` in ${plural(counts.length, 'class folder')}.`),
    checks([
      { ok: counts.length >= 3, text: 'At least 3 classes' },
      { ok: under.length === 0, text: 'At least 100 photos in every class', detail: under.length ? `Below 100: ${under.map((c) => `${c.folder} (${c.n})`).join(', ')}` : null },
      { ok: ratio <= 1.5, text: 'Biggest class has at most 1.5 times the photos of the smallest', detail: `Yours: ${ratio.toFixed(2)} times (${max} vs ${min}).` },
      { ok: hasNothing, text: 'Includes a Nothing class', detail: hasNothing ? null : 'Name the folder “Nothing”.' },
      map ? {
        ok: map.missing.length || map.unmatched.length ? 'warn' : true,
        text: 'Folders match the model’s classes',
        detail: [
          map.missing.length ? `No folder for: ${map.missing.map((i) => state.infos[i].label).join(', ')}.` : '',
          map.unmatched.length ? `Not in the model: ${map.unmatched.map((u) => u.folder).join(', ')}.` : '',
        ].join(' ').trim() || null,
      } : null,
    ]),
    toolbar('Photos per class',
      el('button', { class: 'btn small', type: 'button', onclick: () => copyTable(['Class', 'Training photos'], copyRows) }, 'Copy table for PowerPoint')),
    el('div', { class: 'table-wrap' },
      el('table', { class: 'data' },
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col' }, 'Class folder'),
          el('th', { scope: 'col', class: 'num' }, 'Photos'),
          el('th', { scope: 'col' }, ''),
          el('th', { scope: 'col', class: 'num' }, 'Compared with smallest'))),
        el('tbody', {},
          counts.map((c) => el('tr', {},
            el('td', {}, chip(parseLabel(c.folder))),
            el('td', { class: `num${c.n < 100 ? ' bad-text' : ''}` }, c.n.toLocaleString('en-US')),
            el('td', {}, meter(c.n / max, c.n < 100)),
            el('td', { class: `num${c.n / min > 1.5 ? ' bad-text' : ''}` }, `${(c.n / min).toFixed(2)}×`))),
          el('tr', { class: 'total' }, el('td', {}, 'Total'), el('td', { class: 'num' }, tr.total.toLocaleString('en-US')), el('td', {}), el('td', {}))))),
    skippedNote(tr),
  );
}

// ---------- step 3: test ----------

async function onTestFolder(entriesPromise) {
  if (state.running) return;
  replace(out.test, el('p', { class: 'summary' }, 'Reading the folder…'));
  state.test = groupByFolder(await entriesPromise);
  clearResults();
  renderTest();
}

function clearResults() {
  state.rows?.forEach((r) => {
    if (r.thumb?.startsWith('blob:')) URL.revokeObjectURL(r.thumb);
  });
  state.rows = null;
  state.summary = null;
  state.runMeta = null;
  state.showAll = false;
}

function testItems() {
  const map = mapToModel(state.test.groups, state.infos);
  const items = map.mapped.flatMap((m) => m.files.map((file) => ({ file, trueIndex: m.index, folder: m.folder })));
  return { map, items };
}

function renderTest() {
  if (state.running) return;
  const te = state.test;
  if (!te) return;
  if (!state.model) {
    replace(out.test, el('p', { class: 'empty' }, 'Load the model in step 1 first.'));
    return;
  }
  if (state.rows) {
    renderResults();
    return;
  }
  if (!te.groups.size) {
    replace(out.test, el('p', { class: 'empty' }, 'No photos found inside class folders. Choose the folder that contains one subfolder per class.'), skippedNote(te));
    return;
  }
  const { map, items } = testItems();
  const perClass = state.infos.map((_, i) => map.mapped.filter((m) => m.index === i).reduce((n, m) => n + m.files.length, 0));
  const few = state.infos.map((info, i) => ({ info, n: perClass[i] })).filter((x) => x.n > 0 && x.n < 10);

  replace(out.test,
    el('p', { class: 'summary' }, el('strong', {}, plural(items.length, 'photo')), ` in ${plural(map.mapped.length, 'folder')} match the model’s classes.`),
    checks([
      { ok: map.missing.length === 0, text: 'Every class has test photos', detail: map.missing.length ? `Missing: ${map.missing.map((i) => state.infos[i].label).join(', ')}` : null },
      { ok: few.length === 0, text: 'At least 10 test photos per class', detail: few.length ? `Below 10: ${few.map((x) => `${x.info.label} (${x.n})`).join(', ')}` : null },
      map.unmatched.length ? {
        ok: 'warn',
        text: `${plural(map.unmatched.length, 'folder')} will be skipped because no class has that name`,
        detail: map.unmatched.map((u) => `${u.folder} (${u.files.length})`).join(', '),
      } : null,
    ]),
    el('div', { class: 'inline wrap' },
      el('button', { class: 'btn primary', type: 'button', disabled: !items.length, onclick: () => runTest(items) }, `Run the test on ${plural(items.length, 'photo')}`)),
    skippedNote(te),
  );
}

async function runTest(items) {
  if (state.running || !items.length) return;
  state.running = true;
  state.stop = false;
  const mirror = $('lab-mirror').checked;
  const bar = el('b');
  const label = el('span', {}, `Testing 0 of ${items.length}…`);
  replace(out.test,
    el('div', { class: 'progress' },
      el('div', { class: 'inline' }, label,
        el('button', { class: 'btn small', type: 'button', onclick: () => { state.stop = true; } }, 'Stop')),
      el('div', { class: 'progress-track' }, bar)));
  const t0 = performance.now();
  clearResults();
  let rows;
  try {
    rows = await evaluate(state.model, items, {
      mirror,
      shouldStop: () => state.stop,
      onProgress: (done, total) => {
        bar.style.width = `${(done / total) * 100}%`;
        label.textContent = `Testing ${done} of ${total}…`;
      },
    });
  } finally {
    state.running = false;
  }
  state.rows = rows;
  state.summary = summarize(rows, state.infos.length);
  state.runMeta = { mirror, seconds: (performance.now() - t0) / 1000, stopped: state.stop, planned: items.length };
  state.filter = state.summary.total > state.summary.correct ? 'wrong' : 'correct';
  renderResults();
}

function renderResults() {
  const s = state.summary;
  const infos = state.infos;
  const rows = state.rows;
  const meta = state.runMeta;
  const errored = rows.filter((r) => r.error);
  const few = infos.map((info, i) => ({ info, n: s.perClass[i].total })).filter((x) => x.n > 0 && x.n < 10);
  const untested = infos.filter((_, i) => s.perClass[i].total === 0);

  const perClassRows = infos.map((info, i) => {
    const c = s.perClass[i];
    return [info.label, c.total, c.correct, c.total ? pct(c.accuracy) : '—', c.confusedWith >= 0 ? `${infos[c.confusedWith].label} (${c.confusedCount})` : '—'];
  });
  perClassRows.push(['Overall', s.total, s.correct, pct(s.accuracy), '']);

  replace(out.test,
    el('div', { class: 'headline' },
      el('div', { class: 'big' }, pct(s.accuracy)),
      el('div', {},
        el('p', {}, el('strong', {}, `${s.correct.toLocaleString('en-US')} correct`), ` out of ${plural(s.total, 'test photo')}`, meta.stopped ? ` (stopped after ${rows.length} of ${meta.planned})` : ''),
        el('p', { class: 'formula' }, `Accuracy = ${s.correct} ÷ ${s.total} × 100% = ${pct(s.accuracy, 2)}`),
        el('p', { class: 'formula' }, `Prediction = the class with the highest probability${meta.mirror ? ', averaged with the mirrored image' : ''}. Took ${meta.seconds.toFixed(1)} s.`))),
    checks([
      { ok: untested.length === 0, text: 'Every class was tested', detail: untested.length ? `No test photos for: ${untested.map((i) => i.label).join(', ')}` : null },
      { ok: few.length === 0, text: 'At least 10 test photos per class', detail: few.length ? `Below 10: ${few.map((x) => `${x.info.label} (${x.n})`).join(', ')}` : null },
      errored.length ? { ok: 'warn', text: `${plural(errored.length, 'photo')} could not be read and were left out`, detail: errored.slice(0, 5).map((r) => r.name).join(', ') } : null,
    ]),

    toolbar('Accuracy per class',
      el('button', { class: 'btn small', type: 'button', onclick: () => copyTable(['Class', 'Test photos', 'Correct', 'Accuracy', 'Most often mistaken for'], perClassRows) }, 'Copy table for PowerPoint')),
    perClassTable(),

    toolbar('Confusion matrix',
      el('button', { class: 'btn small', type: 'button', onclick: copyMatrix }, 'Copy matrix for PowerPoint')),
    matrixView(),

    toolbar('Predictions', galleryFilters()),
    el('div', { id: 'gallery-slot' }, galleryView()),

    toolbar('Save and export'),
    el('div', { class: 'inline wrap' },
      el('button', { class: 'btn primary', type: 'button', onclick: showSaveForm }, 'Save this run for step 4'),
      el('button', { class: 'btn', type: 'button', onclick: exportCsv }, 'Download every prediction (CSV)'),
      el('button', { class: 'btn', type: 'button', disabled: !state.train, title: state.train ? '' : 'Choose the training folder in step 2 first', onclick: checkOverlap }, 'Check no test photo is also a training photo')),
    el('div', { id: 'save-slot' }),
    el('div', { id: 'overlap-slot' }),
  );
}

function perClassTable() {
  const s = state.summary;
  const infos = state.infos;
  return el('div', { class: 'table-wrap' },
    el('table', { class: 'data' },
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Class'),
        el('th', { scope: 'col', class: 'num' }, 'Test photos'),
        el('th', { scope: 'col', class: 'num' }, 'Correct'),
        el('th', { scope: 'col' }, 'Accuracy'),
        el('th', { scope: 'col' }, 'Most often mistaken for'))),
      el('tbody', {},
        infos.map((info, i) => {
          const c = s.perClass[i];
          return el('tr', {},
            el('td', {}, chip(info)),
            el('td', { class: `num${c.total < 10 ? ' bad-text' : ''}` }, c.total),
            el('td', { class: 'num' }, c.correct),
            el('td', { class: 'num', style: { textAlign: 'start' } }, c.total ? [meter(c.accuracy, c.accuracy < 0.8), pct(c.accuracy)] : '—'),
            el('td', {}, c.confusedWith >= 0 ? `${infos[c.confusedWith].label} (${c.confusedCount})` : '—'));
        }),
        el('tr', { class: 'total' },
          el('td', {}, 'Overall'),
          el('td', { class: 'num' }, s.total),
          el('td', { class: 'num' }, s.correct),
          el('td', { class: 'num', style: { textAlign: 'start' } }, [meter(s.accuracy), pct(s.accuracy)]),
          el('td', {})))));
}

function matrixView() {
  const s = state.summary;
  const infos = state.infos;
  const names = infos.map(shortName);
  return el('div', { class: 'matrix-wrap' },
    el('table', { class: 'matrix' },
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col', class: 'corner' }, 'Actual ↓  Predicted →'),
        names.map((n) => el('th', { scope: 'col', title: n }, el('span', { class: 'col' }, n))))),
      el('tbody', {}, infos.map((info, i) => {
        const rowTotal = s.perClass[i].total || 1;
        return el('tr', {},
          el('th', { scope: 'row' }, names[i]),
          s.matrix[i].map((n, j) => {
            const a = n ? 0.12 + 0.78 * (n / rowTotal) : 0;
            const cls = [i === j ? 'diag' : 'off', n === 0 ? 'zero' : '', a > 0.55 ? 'strong' : ''].join(' ').trim();
            return el('td', { class: cls, style: { '--a': a.toFixed(3) }, title: `Actual ${infos[i].label}, predicted ${infos[j].label}: ${n}` }, n);
          }));
      }))),
    el('p', { class: 'axis-note' }, 'Rows are the actual note, columns are what the model predicted. The diagonal is correct; anything else is a mistake.'));
}

function copyMatrix() {
  const s = state.summary;
  const names = state.infos.map(shortName);
  copyTable(['Actual \\ Predicted', ...names], s.matrix.map((row, i) => [names[i], ...row]));
}

function galleryFilters() {
  const rows = state.rows.filter((r) => !r.error);
  const wrong = rows.filter((r) => !r.correct).length;
  const options = [['wrong', `Wrong (${wrong})`], ['correct', `Correct (${rows.length - wrong})`], ['all', `All (${rows.length})`]];
  return el('div', { class: 'filters', role: 'group', 'aria-label': 'Show predictions' },
    options.map(([key, text]) => el('button', {
      type: 'button',
      'aria-pressed': String(state.filter === key),
      onclick: (e) => {
        state.filter = key;
        state.showAll = false;
        e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        replace($('gallery-slot'), galleryView());
      },
    }, text)));
}

function filteredRows() {
  const rows = state.rows.filter((r) => !r.error);
  if (state.filter === 'wrong') return rows.filter((r) => !r.correct);
  if (state.filter === 'correct') return rows.filter((r) => r.correct);
  return rows;
}

function galleryView() {
  const list = filteredRows();
  if (!list.length) {
    return el('p', { class: 'empty' }, state.filter === 'wrong' ? 'No wrong predictions. Every test photo was classified correctly.' : 'Nothing to show.');
  }
  const limit = state.showAll ? list.length : 48;
  const infos = state.infos;
  const cards = list.slice(0, limit).map((r, k) => el('button', {
    class: `card${r.correct ? '' : ' wrong'}`,
    type: 'button',
    onclick: () => openViewer(list, k),
  },
  el('img', { src: r.thumb, alt: `${r.name}: actual ${infos[r.trueIndex].label}, predicted ${infos[r.predIndex].label}`, loading: 'lazy' }),
  el('span', { class: 'cap' },
    el('strong', {}, `Actual: ${shortName(infos[r.trueIndex])}`),
    el('span', { class: 'said' }, `Predicted: ${shortName(infos[r.predIndex])}, ${pct(r.conf, 0)}`))));
  return el('div', {},
    el('div', { class: 'gallery' }, cards),
    list.length > limit
      ? el('div', { class: 'more' }, el('button', {
        class: 'btn',
        type: 'button',
        onclick: () => {
          state.showAll = true;
          replace($('gallery-slot'), galleryView());
        },
      }, `Show all ${list.length}`))
      : null);
}

// ---------- slide-ready viewer ----------

function openViewer(list, pos) {
  state.viewerList = list;
  state.viewerPos = pos;
  renderViewer();
  const dlg = $('viewer');
  if (!dlg.open) dlg.showModal();
}

function renderViewer() {
  const r = state.viewerList[state.viewerPos];
  if (!r) return;
  const infos = state.infos;
  const actual = infos[r.trueIndex];
  const predicted = infos[r.predIndex];
  replace($('slide'),
    el('img', { src: r.thumb, alt: r.name }),
    el('div', {},
      el('p', { class: `verdict ${r.correct ? 'correct' : 'wrong'}` }, r.correct ? '✓ Correct' : '✕ Wrong'),
      el('dl', {},
        el('dt', {}, 'Actual note'), el('dd', {}, fullName(actual, 'en')),
        el('dt', {}, 'Model said'), el('dd', {}, `${fullName(predicted, 'en')}, ${pct(r.conf, 1)}`)),
      el('ol', { class: 'bars3' }, r.top.map((t) => el('li', { class: t.index === r.trueIndex ? '' : 'miss' },
        el('span', {}, shortName(infos[t.index])),
        el('span', { class: 'track' }, el('b', { style: { width: `${(t.p * 100).toFixed(1)}%` } })),
        el('span', { class: 'num' }, pct(t.p, 1))))),
      el('p', { class: 'file' }, `${r.folder}/${r.name}`)));
  $('v-prev').disabled = state.viewerPos === 0;
  $('v-next').disabled = state.viewerPos >= state.viewerList.length - 1;
}

function stepViewer(delta) {
  const next = state.viewerPos + delta;
  if (next < 0 || next >= state.viewerList.length) return;
  state.viewerPos = next;
  renderViewer();
}

// ---------- save, export, overlap ----------

function exportCsv() {
  const infos = state.infos;
  const header = ['file', 'folder', 'actual_class', 'predicted_class', 'confidence', 'correct', 'second_choice', 'second_confidence', 'error'];
  const lines = state.rows.map((r) => r.error
    ? [r.name, r.folder, infos[r.trueIndex].label, '', '', '', '', '', r.error]
    : [r.name, r.folder, infos[r.trueIndex].label, infos[r.predIndex].label, r.conf.toFixed(4), r.correct ? 'yes' : 'no',
      r.top[1] ? infos[r.top[1].index].label : '', r.top[1] ? r.top[1].p.toFixed(4) : '', '']);
  download(`addesh-test-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`, toCsv([header, ...lines]));
}

function showSaveForm() {
  const runs = store.get('runs', []);
  const last = runs[runs.length - 1];
  const field = (id, label, value, attrs = {}) => el('div', { class: `field${attrs.wide ? ' wide' : ''}` },
    el('label', { for: id }, label),
    el('input', { id, type: attrs.type || 'text', value, step: attrs.step, min: attrs.min, inputmode: attrs.inputmode, placeholder: attrs.placeholder }));
  const form = el('form', {
    class: 'save-form',
    onsubmit: (e) => {
      e.preventDefault();
      saveRun({
        name: $('run-name').value.trim() || `Run ${runs.length + 1}`,
        epochs: $('run-epochs').value.trim(),
        batch: $('run-batch').value.trim(),
        lr: $('run-lr').value.trim(),
        change: $('run-change').value.trim(),
      });
      replace($('save-slot'));
    },
  },
  field('run-name', 'Run name', ['Before', 'After'][runs.length] || `Run ${runs.length + 1}`),
  field('run-epochs', 'Epochs', last?.epochs || '50', { type: 'number', min: 1, step: 1, inputmode: 'numeric' }),
  field('run-batch', 'Batch size', last?.batch || '16', { type: 'number', min: 1, step: 1, inputmode: 'numeric' }),
  field('run-lr', 'Learning rate', last?.lr || '0.001', { inputmode: 'decimal' }),
  field('run-change', 'What changed since the last run', runs.length ? '' : 'Nothing yet: Teachable Machine defaults', { wide: true, placeholder: 'e.g. 40 more photos of USD 50 and USD 100' }),
  el('div', { class: 'actions' },
    el('button', { class: 'btn primary', type: 'submit' }, 'Save run'),
    el('button', { class: 'btn', type: 'button', onclick: () => replace($('save-slot')) }, 'Cancel')));
  replace($('save-slot'), form);
  $('run-name').focus();
  $('run-name').select();
}

function saveRun(fields) {
  const s = state.summary;
  const runs = store.get('runs', []);
  runs.push({
    id: Date.now(),
    date: new Date().toISOString(),
    ...fields,
    mirror: state.runMeta.mirror,
    total: s.total,
    correct: s.correct,
    labels: state.infos.map((i) => i.label),
    perClass: s.perClass.map((c) => ({ total: c.total, correct: c.correct })),
  });
  if (!store.set('runs', runs)) {
    toast('This browser blocked saving. Download the CSV instead.');
    return;
  }
  toast(`Saved “${fields.name}”. Compare it in step 4.`);
  renderCompare();
}

async function checkOverlap() {
  if (!state.train || !state.test) return;
  const slot = $('overlap-slot');
  const testFiles = [...state.test.groups.values()].flat();
  const trainFiles = [...state.train.groups.values()].flat();
  const status = el('p', { class: 'summary' }, `Comparing ${plural(testFiles.length, 'test photo')} with ${plural(trainFiles.length, 'training photo')}…`);
  replace(slot, status);
  try {
    // Same size first (cheap), then a fingerprint of the bytes for the candidates.
    const sizes = new Set(trainFiles.map((f) => f.size));
    const candidates = testFiles.filter((f) => sizes.has(f.size));
    const trainHashes = new Set();
    const candidateSizes = new Set(candidates.map((f) => f.size));
    for (const f of trainFiles.filter((x) => candidateSizes.has(x.size))) trainHashes.add(await sha256(f));
    const dupes = [];
    for (const f of candidates) if (trainHashes.has(await sha256(f))) dupes.push(f.name);
    replace(slot, checks([dupes.length
      ? { ok: false, text: `${plural(dupes.length, 'test photo')} also appear in the training photos`, detail: `Remove them from the test folder: ${dupes.slice(0, 12).join(', ')}${dupes.length > 12 ? '…' : ''}` }
      : { ok: true, text: 'No test photo is also a training photo' }]));
  } catch (err) {
    replace(slot, el('p', { class: 'summary bad-text' }, `Couldn’t compare the photos: ${err.message}`));
  }
}

// ---------- step 4: compare ----------

function renderCompare() {
  const runs = store.get('runs', []);
  if (!runs.length) {
    replace(out.compare, el('p', { class: 'empty' }, 'No saved runs yet. Run a test in step 3, then choose “Save this run for step 4”.'));
    return;
  }
  const accuracy = (r) => (r.total ? r.correct / r.total : null);
  const runTable = el('div', { class: 'table-wrap' },
    el('table', { class: 'data' },
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Run'),
        el('th', { scope: 'col', class: 'num' }, 'Accuracy'),
        el('th', { scope: 'col', class: 'num' }, 'Epochs'),
        el('th', { scope: 'col', class: 'num' }, 'Batch size'),
        el('th', { scope: 'col', class: 'num' }, 'Learning rate'),
        el('th', { scope: 'col' }, 'What changed'),
        el('th', { scope: 'col' }, el('span', { class: 'visually-hidden' }, 'Actions')))),
      el('tbody', {}, runs.map((r) => el('tr', {},
        el('td', {}, el('strong', {}, r.name), el('br'), el('span', { class: 'hint' }, new Date(r.date).toLocaleString())),
        el('td', { class: 'num' }, `${pct(accuracy(r))} (${r.correct}/${r.total})`),
        el('td', { class: 'num' }, r.epochs || '—'),
        el('td', { class: 'num' }, r.batch || '—'),
        el('td', { class: 'num' }, r.lr || '—'),
        el('td', {}, r.change || '—'),
        el('td', {}, el('button', {
          class: 'btn small ghost',
          type: 'button',
          'aria-label': `Delete ${r.name}`,
          onclick: () => {
            if (!window.confirm(`Delete “${r.name}”?`)) return;
            store.set('runs', store.get('runs', []).filter((x) => x.id !== r.id));
            renderCompare();
          },
        }, 'Delete')))))));

  if (runs.length < 2) {
    replace(out.compare, runTable, el('p', { class: 'hint' }, 'Save one more run after your change to compare them.'));
    return;
  }

  const options = (selectedId) => runs.map((r) => el('option', { value: r.id, selected: r.id === selectedId }, `${r.name} (${pct(accuracy(r))})`));
  const beforeSel = el('select', { id: 'cmp-before' }, options(runs[runs.length - 2].id));
  const afterSel = el('select', { id: 'cmp-after' }, options(runs[runs.length - 1].id));
  const slot = el('div');
  const draw = () => replace(slot, comparison(runs.find((r) => String(r.id) === beforeSel.value), runs.find((r) => String(r.id) === afterSel.value)));
  beforeSel.addEventListener('change', draw);
  afterSel.addEventListener('change', draw);

  replace(out.compare,
    runTable,
    el('div', { class: 'compare-pick' },
      el('div', { class: 'field' }, el('label', { for: 'cmp-before' }, 'Before'), beforeSel),
      el('div', { class: 'field' }, el('label', { for: 'cmp-after' }, 'After'), afterSel)),
    slot);
  draw();
}

function comparison(before, after) {
  if (!before || !after) return null;
  const acc = (run, i) => (run.perClass[i]?.total ? run.perClass[i].correct / run.perClass[i].total : null);
  const labels = [...new Set([...after.labels, ...before.labels])];
  const lines = labels.map((label) => {
    const bi = before.labels.indexOf(label);
    const ai = after.labels.indexOf(label);
    return { label, b: bi >= 0 ? acc(before, bi) : null, a: ai >= 0 ? acc(after, ai) : null };
  });
  const overallB = before.total ? before.correct / before.total : null;
  const overallA = after.total ? after.correct / after.total : null;
  const delta = (b, a) => (a === null || b === null ? '—' : `${a - b >= 0 ? '+' : ''}${((a - b) * 100).toFixed(1)} pts`);
  const deltaClass = (b, a) => (a === null || b === null || Math.abs(a - b) < 0.0005 ? '' : a > b ? 'delta-up' : 'delta-down');

  const copyRows = [
    ['Epochs', before.epochs || '—', after.epochs || '—', ''],
    ['Batch size', before.batch || '—', after.batch || '—', ''],
    ['Learning rate', before.lr || '—', after.lr || '—', ''],
    ['What changed', '', after.change || '—', ''],
    ['Overall accuracy', pct(overallB), pct(overallA), delta(overallB, overallA)],
    ...lines.map((l) => [l.label, pct(l.b), pct(l.a), delta(l.b, l.a)]),
  ];

  return el('div', {},
    el('div', { class: 'headline' },
      el('div', { class: 'big' }, `${pct(overallB, 1)} → ${pct(overallA, 1)}`),
      el('div', {},
        el('p', {}, el('strong', { class: deltaClass(overallB, overallA) }, delta(overallB, overallA)), ` overall after: ${after.change || 'your change'}`),
        el('p', { class: 'formula' }, `Before: ${before.epochs || '?'} epochs, batch ${before.batch || '?'}, learning rate ${before.lr || '?'}. After: ${after.epochs || '?'} epochs, batch ${after.batch || '?'}, learning rate ${after.lr || '?'}.`))),
    toolbar('Before and after, per class',
      el('button', { class: 'btn small', type: 'button', onclick: () => copyTable(['', before.name, after.name, 'Change'], copyRows) }, 'Copy table for PowerPoint')),
    el('div', { class: 'table-wrap' },
      el('table', { class: 'data' },
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col' }, 'Class'),
          el('th', { scope: 'col', class: 'num' }, 'Before'),
          el('th', { scope: 'col', class: 'num' }, 'After'),
          el('th', { scope: 'col', class: 'num' }, 'Change'))),
        el('tbody', {},
          lines.map((l) => el('tr', {},
            el('td', {}, chip(parseLabel(l.label))),
            el('td', { class: 'num' }, pct(l.b)),
            el('td', { class: 'num' }, pct(l.a)),
            el('td', { class: `num ${deltaClass(l.b, l.a)}` }, delta(l.b, l.a)))),
          el('tr', { class: 'total' },
            el('td', {}, 'Overall'),
            el('td', { class: 'num' }, pct(overallB)),
            el('td', { class: 'num' }, pct(overallA)),
            el('td', { class: `num ${deltaClass(overallB, overallA)}` }, delta(overallB, overallA)))))));
}

// ---------- wiring ----------

function wireFolderDrop(zone, input, handler) {
  input.addEventListener('change', () => {
    if (input.files.length) handler(Promise.resolve(entriesFromInput(input)));
    input.value = '';
  });
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', (e) => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove('over');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    handler(entriesFromDrop(e.dataTransfer));
  });
}

function init() {
  $('brand-mark').innerHTML = `<path d="${rosettePath({ radius: 33, amp: 10, freq: -15, steps: 900 })}"/>`;
  $('lab-url').value = params.get('model') || store.get('modelUrl', '') || '';
  $('lab-mirror').checked = store.get('mirror', CONFIG.mirrorCheck);

  $('lab-load-url').addEventListener('click', () => {
    const url = normalizeModelUrl($('lab-url').value);
    if (!url) {
      $('lab-url').focus();
      toast('Paste your Teachable Machine link first.');
      return;
    }
    loadModel('url', url);
  });
  $('lab-url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('lab-load-url').click();
    }
  });
  $('lab-load-builtin').addEventListener('click', () => loadModel('url', builtInUrl()));
  $('lab-files').addEventListener('change', (e) => {
    if (e.target.files.length) loadModel('files', [...e.target.files]);
    e.target.value = '';
  });

  wireFolderDrop($('train-drop'), $('train-input'), onTrainFolder);
  wireFolderDrop($('test-drop'), $('test-input'), onTestFolder);
  // Dropping a folder anywhere else must not open it in the browser.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  $('v-prev').addEventListener('click', () => stepViewer(-1));
  $('v-next').addEventListener('click', () => stepViewer(1));
  $('v-close').addEventListener('click', () => $('viewer').close());
  $('viewer').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') stepViewer(-1);
    if (e.key === 'ArrowRight') stepViewer(1);
  });
  $('viewer').addEventListener('click', (e) => {
    if (e.target === $('viewer')) $('viewer').close();
  });

  renderCompare();
  loadModel('url', activeUrl(), { quietIfMissing: true });
  registerServiceWorker();
}

init();
