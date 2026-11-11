// Turns Teachable Machine class names into something the app can show and speak.
//
// Recommended class names (one class per denomination, both sides of the note in it):
//   LBP 5000, LBP 10000, LBP 20000, LBP 50000, LBP 100000
//   USD 1, USD 5, USD 10, USD 20, USD 50, USD 100
//   EUR 5, EUR 10, EUR 20, EUR 50, EUR 100, EUR 200
//   Nothing
// The parser is forgiving: "20000 LL", "lira_20k", "$20", "20 dollars", "€50", "Euro 50",
// "Background" and Arabic names such as "٢٠ دولار" all work.

export const CURRENCIES = {
  LBP: { code: 'LBP', prefix: '', unit: { en: 'Lebanese pounds', ar: 'ليرة لبنانية' }, sign: { en: 'LBP', ar: 'ل.ل' } },
  USD: { code: 'USD', prefix: '$', unit: { en: 'US dollars', ar: 'دولار أمريكي' }, sign: { en: '$', ar: '$' } },
  EUR: { code: 'EUR', prefix: '€', unit: { en: 'Euros', ar: 'يورو' }, sign: { en: '€', ar: '€' } },
};

// Arabic wording for every banknote in circulation, so the voice says it naturally.
const ARABIC_SPEECH = {
  LBP: {
    1000: 'ألف ليرة لبنانية',
    5000: 'خمسة آلاف ليرة لبنانية',
    10000: 'عشرة آلاف ليرة لبنانية',
    20000: 'عشرون ألف ليرة لبنانية',
    50000: 'خمسون ألف ليرة لبنانية',
    100000: 'مئة ألف ليرة لبنانية',
    500000: 'خمسمئة ألف ليرة لبنانية',
    1000000: 'مليون ليرة لبنانية',
  },
  USD: {
    1: 'دولار واحد',
    2: 'دولاران',
    5: 'خمسة دولارات',
    10: 'عشرة دولارات',
    20: 'عشرون دولاراً',
    50: 'خمسون دولاراً',
    100: 'مئة دولار',
  },
  EUR: {
    5: 'خمسة يورو',
    10: 'عشرة يورو',
    20: 'عشرون يورو',
    50: 'خمسون يورو',
    100: 'مئة يورو',
    200: 'مئتا يورو',
    500: 'خمسمئة يورو',
  },
};

const ARABIC_WORD = { LBP: 'ليرة لبنانية', USD: 'دولار', EUR: 'يورو' };

// Tokens are matched as whole words so "us" never matches inside "bus".
const W = (alts) => new RegExp(`(^|[^a-z])(${alts})(?=[^a-z]|$)`);
const CURRENCY_TESTS = [
  ['LBP', W('lbp|ll|l\\.l\\.?|lira|liras|lirat|lebanese|leb|pounds?|lb'), /ليرة|ل\.ل/],
  ['USD', W('usd|us|dollars?|dolar|dollar'), /\$|دولار/],
  ['EUR', W('eur|euros?'), /€|يورو/],
];
const NOTHING_TEST = W('nothing|background|none|empty|blank|bg|other|no|no[ _-]?(note|banknote|money|bill|cash)');
const NOTHING_TEST_AR = /لا شيء|خلفية|فارغ|لا يوجد/;

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function westernDigits(s) {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const i = ARABIC_DIGITS.indexOf(d);
    return String(i >= 0 ? i : PERSIAN_DIGITS.indexOf(d));
  }).replace(/٬/g, ',');
}

/** Lowercase and strip spacing/punctuation, for comparing folder names with class names. */
export function normalizeName(s) {
  return westernDigits(String(s)).normalize('NFKC').toLowerCase().replace(/[\s_\-.,'"()]+/g, '');
}

function findNumber(s) {
  const m = s.match(/(\d{1,3}(?:[,.\s]\d{3})+|\d+)\s*(k|thousand|ألف|الف)?(?![\d])/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/[,.\s]/g, ''), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return m[2] ? n * 1000 : n;
}

/**
 * Parse one class name.
 * Returns { label, kind: 'note' | 'nothing' | 'unknown', currency, value, key, warning }.
 */
export function parseLabel(label) {
  const raw = String(label ?? '').trim();
  const s = westernDigits(raw).toLowerCase();
  const value = findNumber(s);

  let currency = null;
  for (const [code, latin, other] of CURRENCY_TESTS) {
    if (latin.test(s) || other.test(s)) {
      currency = code;
      break;
    }
  }

  if (currency === null && value === null && (NOTHING_TEST.test(s) || NOTHING_TEST_AR.test(s))) {
    return { label: raw, kind: 'nothing', currency: null, value: null, key: 'NOTHING', warning: null };
  }

  if (currency && value) {
    return { label: raw, kind: 'note', currency, value, key: `${currency}-${value}`, warning: null };
  }

  if (!currency && value && value >= 1000) {
    // Only the lira has notes of 1,000 and above.
    return {
      label: raw, kind: 'note', currency: 'LBP', value, key: `LBP-${value}`,
      warning: `Assumed Lebanese pounds. Rename the class to "LBP ${value}" to be explicit.`,
    };
  }

  let warning;
  if (/^class\s*\d+$/.test(s)) warning = 'This is Teachable Machine\'s default name. Rename it, e.g. "USD 20".';
  else if (currency && !value) warning = `No amount found. Rename it like "${currency} 20".`;
  else if (!currency && value) warning = `No currency found. Rename it like "USD ${value}" or "EUR ${value}".`;
  else warning = 'Not recognised. Use names like "USD 20", "EUR 50", "LBP 20000" or "Nothing".';

  return { label: raw, kind: 'unknown', currency, value, key: `RAW:${normalizeName(raw)}`, warning };
}

function formatNumber(n) {
  return Number(n).toLocaleString('en-US');
}

/** Big amount + unit for the result card. */
export function displayParts(info, lang = 'en') {
  if (info.kind === 'note') {
    const c = CURRENCIES[info.currency];
    return {
      amount: `${c.prefix}${formatNumber(info.value)}`,
      unit: c.unit[lang] || c.unit.en,
    };
  }
  if (info.kind === 'nothing') return { amount: '', unit: '' };
  return { amount: info.label, unit: '' };
}

/** Compact name for table headers and chips, e.g. "LBP 20k", "$20", "€50". */
export function shortName(info) {
  if (info.kind === 'note') {
    if (info.currency === 'LBP') {
      const v = info.value >= 1000 && info.value % 1000 === 0 ? `${formatNumber(info.value / 1000)}k` : formatNumber(info.value);
      return `LBP ${v}`;
    }
    return `${CURRENCIES[info.currency].prefix}${formatNumber(info.value)}`;
  }
  if (info.kind === 'nothing') return 'Nothing';
  return info.label.length > 12 ? `${info.label.slice(0, 11)}…` : info.label;
}

const FULL_UNIT = {
  en: { LBP: 'Lebanese pounds', USD: 'US dollars', EUR: 'euros' },
  ar: { LBP: 'ليرة لبنانية', USD: 'دولار أمريكي', EUR: 'يورو' },
};

/** Full readable name, e.g. "20,000 Lebanese pounds", "20 US dollars". */
export function fullName(info, lang = 'en') {
  if (info.kind === 'note') {
    return `${formatNumber(info.value)} ${(FULL_UNIT[lang] || FULL_UNIT.en)[info.currency]}`;
  }
  if (info.kind === 'nothing') return lang === 'ar' ? 'لا توجد ورقة' : 'Nothing';
  return info.label;
}

/** What the voice says. */
export function speechText(info, lang = 'en') {
  if (info.kind === 'nothing') return '';
  if (info.kind !== 'note') return info.label;
  const { currency, value } = info;
  if (lang === 'ar') {
    return ARABIC_SPEECH[currency]?.[value] || `${value} ${ARABIC_WORD[currency]}`;
  }
  if (currency === 'LBP') return `${formatNumber(value)} Lebanese pounds`;
  if (currency === 'USD') return value === 1 ? '1 US dollar' : `${formatNumber(value)} US dollars`;
  return value === 1 ? '1 euro' : `${formatNumber(value)} euros`;
}
