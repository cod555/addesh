// Tiny DOM helpers for the Lab. Text always goes in as text nodes, never as HTML.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) node.style.setProperty(prop, v);
        else node.style[prop] = v;
      }
    }
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'html') node.innerHTML = value; // only ever used with our own static markup
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function replace(node, ...children) {
  node.replaceChildren();
  append(node, children);
  return node;
}

export const pct = (x, digits = 1) => (x === null || x === undefined || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(digits)}%`);

export function plural(n, one, many = `${one}s`) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

let toastTimer = 0;
export function toast(text, ms = 3500) {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = text;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, ms);
}

export function download(filename, text, type = 'text/csv') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function toCsv(rows) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM so Excel on Windows opens UTF-8 (Arabic names, €) correctly.
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}`;
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Copies a table so it pastes into PowerPoint/Word/Google Slides as a real table
 * (HTML on the clipboard), with tab-separated text as a fallback.
 */
export async function copyTable(headers, rows) {
  const th = 'border:1px solid #9FB2AD;padding:6px 10px;background:#0F5C55;color:#ffffff;font-weight:600;text-align:left;';
  const td = 'border:1px solid #9FB2AD;padding:6px 10px;';
  const html = `<table style="border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:14px;">`
    + `<thead><tr>${headers.map((h) => `<th style="${th}">${escapeHtml(h)}</th>`).join('')}</tr></thead>`
    + `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td style="${td}">${escapeHtml(c ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const tsv = [headers, ...rows].map((r) => r.map((c) => String(c ?? '')).join('\t')).join('\n');
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([tsv], { type: 'text/plain' }),
      }),
    ]);
    toast('Table copied. Paste it into PowerPoint with Ctrl+V.');
    return true;
  } catch {
    try {
      // Plain-text fallback: pastes into Excel or Google Sheets as columns.
      await navigator.clipboard.writeText(tsv);
      toast('Table copied as text. Paste it into Excel, then copy it into PowerPoint.');
      return true;
    } catch {
      toast('The browser blocked copying. Use the CSV download instead.');
      return false;
    }
  }
}
